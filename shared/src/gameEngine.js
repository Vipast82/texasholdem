import { createShuffledDeck } from './rng.js';
import { minRaise, maxBet, maxRaisesPerStreet } from './bettingRules.js';
import { showdown } from './handEvaluator.js';

/**
 * GameTable - authoritative Hold'em hand lifecycle.
 *
 * Pure logic: no I/O, no sockets. The server instantiates one per table and
 * drives it; the client mirrors it for UI. Events for the tutorial engine
 * and the network layer:
 *
 *   handStarted, blindsPosted, holeDealt, streetStarted, actionTaken,
 *   streetEnded, showdown, handEnded
 *
 * All randomness flows through the seeded deck, so a given seed + action
 * sequence always replays identically (tutorial determinism requirement).
 */
export class GameTable {
  constructor(config = {}) {
    if (!config.smallBlind || !config.bigBlind || config.smallBlind <= 0 || config.bigBlind <= config.smallBlind) {
      throw new Error('invalid blinds: need smallBlind>0 and bigBlind>smallBlind');
    }
    this.tableId = config.tableId || 'table-1';
    this.gameType = config.gameType || 'no-limit';
    if (!['no-limit', 'limit', 'pot-limit'].includes(this.gameType)) {
      throw new Error(`unknown gameType: ${this.gameType}`);
    }
    this.smallBlind = config.smallBlind;
    this.bigBlind = config.bigBlind;
    this.startingStack = config.startingStack || 1500;
    this.chipDenominations = config.chipDenominations || [1, 5, 25, 100, 500];
    this.tutorialSeed = config.tutorialSeed || 'saloon-seed';

    this.players = [];
    this.seatToPlayer = new Map(); // seat number -> player id
    this.dealerSeat = 0;

    // Per-hand state
    this.deck = null;
    this.community = [];
    this.street = 'idle';
    this.currentBet = 0;
    this.lastRaiseIncrement = 0;
    this.raiseCount = 0;
    this.actionIndex = null; // seat number of next actor
    this._actionOrder = []; // seats in current action order
    this._actionPos = 0;
    this.activePlayers = []; // player ids in the hand
    this.pot = 0;
    this.payouts = {};
    this.lastShowdown = null;
    this.handNumber = 0;
    // Sprint 4: hand-history + spectator bookkeeping (all read by the server /
    // the pure history serializer, never mutated outside applyAction/finishHand).
    this.actionLog = []; // ordered { playerId, action, amount, street, pot } for the current hand
    this.lastSeed = null; // deck seed actually used by the most recent hand
    this.lastPot = 0; // total pot at the moment the hand ended (before payout reset)
    this.lastEnd = null; // { reason, winnerId? } from the most recent finishHand
    this.listeners = new Map();
  }

  on(event, cb) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(cb);
    return () => this.off(event, cb);
  }

  off(event, cb) {
    const list = this.listeners.get(event) || [];
    const i = list.indexOf(cb);
    if (i >= 0) list.splice(i, 1);
  }

  emit(event, payload) {
    for (const cb of this.listeners.get(event) || []) cb(payload);
  }

  // ---------------------------------------------------------------- players

  addPlayer({ id, name, seat, isBot = false, bot = null, avatarMeta = null }) {
    if (this.players.length >= 10) throw new Error('table is full (max 10 seats)');
    if (this.players.some((p) => p.id === id)) throw new Error(`duplicate player id ${id}`);
    if (this.players.some((p) => p.seat === seat)) throw new Error(`seat ${seat} taken`);
    const player = {
      id,
      name: name || 'Player',
      seat: Number(seat),
      isBot: !!isBot,
      bot: isBot ? bot : null,
      avatarMeta,
      chips: this.startingStack,
      status: 'seated',
      holeCards: null,
      isAllIn: false,
      hasFolded: false,
      contributions: { preflop: 0, flop: 0, turn: 0, river: 0 }
    };
    this.players.push(player);
    this.seatToPlayer.set(player.seat, id);
    return id;
  }

  removePlayer(id) {
    const i = this.players.findIndex((p) => p.id === id);
    if (i < 0) return false;
    const [p] = this.players.splice(i, 1);
    this.seatToPlayer.delete(p.seat);
    // If removing this player strands the table mid-hand (fewer than two
    // active players), end the hand immediately: the pot is refunded to the
    // sole remaining player (chips preserved) so the table returns to the
    // idle state and no "Waiting for the next player…" limbo is left behind.
    // See resolveOrphanedHand().
    this.resolveOrphanedHand();
    return true;
  }

  /**
   * When a mid-hand departure leaves the table with fewer than two active
   * players, end the hand and refund the pot to the sole remaining player so
   * the table returns to a clean idle state.
   *
   * The pot is returned to the "still-in" players (not folded — folded players
   * already gave up their claim) proportional to what each of them committed
   * to the pot on this hand, so chips are never destroyed. After the refund,
   * everyone is back to 'seated' and `inHand` is false, so the table is
   * cleanly idle: a remaining player can click "Start Hand" or add a CPU.
   *
   * Safe to call unconditionally; it is a no-op when not inHand or when the
   * table still has 2+ active players.
   */
  resolveOrphanedHand() {
    if (!this.inHand) return;
    const stillIn = this.players.filter(
      (p) => p.status === 'in-hand' && !p.hasFolded
    );
    if (stillIn.length >= 2) return; // hand can continue with 2+ players
    const pot = this.pot;
    const payouts = {};
    if (pot > 0 && stillIn.length === 1) {
      // Sole remaining player: refund the ENTIRE pot (chips preserved).
      // Fairness: the departing player(s) lost their blinds/bets, but the
      // remaining player did NOT "win" against them — the table just emptied.
      // Refunding the full pot to them avoids destroying chips.
      const p = stillIn[0];
      payouts[p.id] = pot;
      p.chips += pot;
    }
    this.payouts = payouts;
    this.lastShowdown = null;
    this.finishHand({ winnerId: null, reason: 'table-orphaned' });
  }

  playerById(id) {
    return this.players.find((p) => p.id === id);
  }

  // ---------------------------------------------------------------- helpers

  activeSeats() {
    return this.players
      .filter((p) => p.status === 'seated' || p.status === 'in-hand')
      .map((p) => p.seat)
      .sort((a, b) => a - b);
  }

  seatAfter(seat, seats) {
    const idx = seats.indexOf(seat);
    if (idx < 0) return seats[0];
    return seats[(idx + 1) % seats.length];
  }

  /**
   * Seats in action order for a street, starting left of the dealer.
   * (Preflop the engine adjusts the starting position to UTG.)
   */
  actionOrder(dealerSeat) {
    const seats = this.activeSeats().filter((s) => {
      const p = this.playerById(this.seatToPlayer.get(s));
      return p && !p.hasFolded;
    });
    if (seats.length <= 1) return seats;
    const order = [];
    const start = (seats.indexOf(dealerSeat) + 1) % seats.length;
    for (let i = 0; i < seats.length; i += 1) order.push(seats[(start + i) % seats.length]);
    return order;
  }

  get inHand() {
    return this.street !== 'idle' && this.street !== 'ended';
  }

  /** Begin a new hand. Emits handStarted, blindsPosted, holeDealt. */
  startHand() {
    if (this.inHand) throw new Error('a hand is already in progress');
    const active = this.players.filter((p) => p.status === 'seated' && p.chips > 0);
    if (active.length < 2) throw new Error('need at least 2 players with chips to start a hand');

    this.handNumber += 1;
    const seed = this._handSeed || `${this.tutorialSeed}:${this.handNumber}`;
    this._handSeed = null; // one-shot seed
    this.lastSeed = seed; // remember for the hand record
    this.actionLog = []; // fresh per-hand action history
    this.deck = createShuffledDeck(seed);

    this.community = [];
    this.street = 'preflop';
    this.currentBet = 0;
    this.lastRaiseIncrement = 0;
    this.raiseCount = 0;
    this.payouts = {};
    this.lastShowdown = null;

    for (const p of this.players) {
      if (p.status === 'seated') {
        p.holeCards = null;
        p.isAllIn = false;
        p.hasFolded = false;
        p.toAct = false;
        p.contributions = { preflop: 0, flop: 0, turn: 0, river: 0 };
      }
    }

    const seats = this.activeSeats();
    this.dealerSeat = this.seatAfter(this.dealerSeat, seats);

    this.activePlayers = active.map((p) => p.id);
    for (const p of active) {
      p.holeCards = [this.deck.pop(), this.deck.pop()];
      p.status = 'in-hand';
    }

    const sbSeat = this.seatAfter(this.dealerSeat, seats);
    const bbSeat = this.seatAfter(sbSeat, seats);
    const sbId = this.seatToPlayer.get(sbSeat);
    const bbId = this.seatToPlayer.get(bbSeat);

    // Post blinds first so all-in blinds are excluded from the action list.
    this.postBlind(sbId, this.smallBlind);
    this.postBlind(bbId, this.bigBlind);
    this.pot = this.smallBlind + this.bigBlind;

    // Set up the preflop betting round (resets street/raise state + toAct flags).
    const utgSeat = this.seatAfter(bbSeat, seats);
    this._setupStreet('preflop', utgSeat);
    this.currentBet = this.bigBlind;

    this.emit('handStarted', this.snapshot());
    this.emit('blindsPosted', { sb: sbId, bb: bbId, smallBlind: this.smallBlind, bigBlind: this.bigBlind });
    this.emit('holeDealt', this.snapshot());
    return this.snapshot();
  }

  postBlind(id, amount) {
    const p = this.playerById(id);
    const pay = Math.min(amount, p.chips);
    p.chips -= pay;
    p.contributions.preflop += pay;
    if (p.chips === 0) p.isAllIn = true;
  }

  // ---------------------------------------------------------------- betting

  canActPlayers() {
    return this.players.filter((p) => p.status === 'in-hand' && !p.hasFolded && p.chips > 0);
  }

  playersStillIn() {
    return this.players.filter((p) => p.status === 'in-hand' && !p.hasFolded);
  }

  nextActorId() {
    for (const seat of this._actionOrder) {
      const id = this.seatToPlayer.get(seat);
      const p = this.playerById(id);
      if (p && p.toAct) return id;
    }
    return null;
  }

  get streetComplete() {
    const canAct = this.canActPlayers();
    return canAct.length <= 1 || !canAct.some((p) => p.toAct);
  }

  get handOver() {
    return this.playersStillIn().length <= 1;
  }

  _setupStreet(street, startSeat) {
    this.street = street;
    this.currentBet = 0;
    this.lastRaiseIncrement = 0;
    this.raiseCount = 0;
    for (const p of this.players) p.toAct = false;
    for (const p of this.canActPlayers()) p.toAct = true;
    const all = this.actionOrder(this.dealerSeat);
    const i = all.indexOf(startSeat);
    this._actionOrder = i >= 0 ? [...all.slice(i), ...all.slice(0, i)] : all;
  }

  /**
   * Apply one player action. Emits actionTaken; advances the hand.
   * @returns snapshot
   */
  applyAction(playerId, action, amount = 0) {
    if (!this.inHand) throw new Error('no hand in progress');
    const actor = this.playerById(playerId);
    if (!actor) throw new Error(`unknown player ${playerId}`);
    if (this.nextActorId() !== playerId) throw new Error(`${playerId} is not to act`);
    if (actor.hasFolded) throw new Error('already folded');
    if (actor.chips <= 0) throw new Error('already all in');

    const street = this.street;
    const toCall = Math.max(0, this.currentBet - actor.contributions[street]);
    let commit = 0;
    let newBetLevel = this.currentBet;
    let isRaise = false;
    let fold = false;

    switch (action) {
      case 'fold':
        fold = true;
        break;
      case 'check':
        if (toCall !== 0) throw new Error('must call before checking');
        break;
      case 'call': {
        if (toCall === 0) throw new Error('nothing to call; check instead');
        commit = Math.min(toCall, actor.chips);
        break;
      }
      case 'allin': {
        commit = actor.chips;
        if (actor.contributions[street] + commit > newBetLevel) {
          newBetLevel = actor.contributions[street] + commit;
          isRaise = true;
        }
        break;
      }
      case 'bet': {
        if (this.currentBet !== 0) throw new Error('must call or raise when a bet is out');
        if (amount < this.bigBlind) throw new Error(`minimum bet is ${this.bigBlind}`);
        if (this.gameType === 'pot-limit') {
          const maxTarget = maxBet('pot-limit', this.pot, street, this.bigBlind, 0);
          if (amount > maxTarget) throw new Error(`pot-limit maximum is ${maxTarget}`);
        }
        commit = amount;
        newBetLevel = amount;
        isRaise = true;
        break;
      }
      case 'raise': {
        if (this.currentBet === 0) throw new Error('use bet when no bet is out');
        const minTarget = minRaise(this.currentBet, this.bigBlind, this.lastRaiseIncrement);
        if (amount < minTarget) throw new Error(`minimum raise is to ${minTarget}`);
        if (this.gameType === 'limit') {
          const expected = this.currentBet + this.bigBlind;
          if (amount !== expected) throw new Error(`limit raise must be exactly ${expected}`);
        } else if (this.gameType === 'pot-limit') {
          const maxTarget = maxBet('pot-limit', this.pot, street, this.bigBlind, this.currentBet);
          if (amount > maxTarget) throw new Error(`pot-limit maximum is ${maxTarget}`);
        }
        commit = amount - actor.contributions[street];
        newBetLevel = amount;
        isRaise = true;
        break;
      }
      default:
        throw new Error(`unknown action: ${action}`);
    }

    if (isRaise && this.raiseCount >= maxRaisesPerStreet(this.gameType, street)) {
      throw new Error('maximum raises for this street reached');
    }
    if (commit > actor.chips) throw new Error('not enough chips');

    actor.chips -= commit;
    actor.contributions[street] += commit;
    this.pot += commit;
    if (actor.chips === 0) actor.isAllIn = true;

    if (fold) {
      actor.hasFolded = true;
      actor.toAct = false;
    } else {
      actor.toAct = false;
      if (isRaise && newBetLevel > this.currentBet) {
        this.lastRaiseIncrement = newBetLevel - this.currentBet;
        this.currentBet = newBetLevel;
        this.raiseCount += 1;
        for (const p of this.players) {
          if (p.status === 'in-hand' && !p.hasFolded && p.id !== actor.id && p.chips > 0) {
            p.toAct = true;
          }
        }
      }
    }

    this.emit('actionTaken', {
      playerId: actor.id,
      action,
      amount: commit,
      street,
      pot: this.pot,
      snapshot: this.snapshot()
    });

    // Sprint 4: hand-history — record every legal action for the hand record.
    this.actionLog.push({
      playerId: actor.id,
      action,
      amount: commit,
      street,
      pot: this.pot
    });

    if (this.handOver) {
      this.endHandByFold();
      return this.snapshot();
    }
    if (this.streetComplete) this.advanceStreet();
    return this.snapshot();
  }

  advanceStreet() {
    const stillIn = this.playersStillIn();
    if (stillIn.length <= 1) {
      this.endHandByFold();
      return;
    }
    const next = { preflop: 'flop', flop: 'turn', turn: 'river', river: null }[this.street];
    if (!next || this.canActPlayers().length <= 1) {
      this.runout();
      return;
    }
    this.deck.pop(); // burn
    if (next === 'flop') this.community.push(this.deck.pop(), this.deck.pop(), this.deck.pop());
    else this.community.push(this.deck.pop());
    const startSeat = this.seatAfter(this.dealerSeat, this.activeSeats());
    this._setupStreet(next, startSeat);
    const cardEvent = { flop: 'flopRevealed', turn: 'turnRevealed', river: 'riverRevealed' }[next];
    this.emit('streetStarted', { street: next, community: this.community, snapshot: this.snapshot() });
    this.emit(cardEvent, { community: this.community, snapshot: this.snapshot() });
  }

  /** No more betting possible: deal the remaining board cards, then showdown. */
  runout() {
    while (this.community.length < 5) {
      this.deck.pop(); // burn
      this.community.push(this.deck.pop());
    }
    this.street = 'river';
    this.doShowdown();
  }

  endHandByFold() {
    const winner = this.playersStillIn()[0];
    this.lastPot = this.pot; // capture before the pot is paid to the winner
    if (winner) winner.chips += this.pot;
    this.payouts = winner ? { [winner.id]: this.pot } : {};
    this.lastShowdown = null;
    this.finishHand({ winnerId: winner ? winner.id : null, reason: 'fold' });
  }

  doShowdown() {
    const stillIn = this.playersStillIn();
    const hands = {};
    for (const p of stillIn) hands[p.id] = p.holeCards;
    const result = showdown(hands, this.community, stillIn.map((p) => p.id));

    const orderWinners = (ids) => {
      const seats = ids.map((id) => this.playerById(id).seat).sort((a, b) => a - b);
      const start = (seats.indexOf(this.dealerSeat) + 1) % seats.length;
      const ordered = [];
      for (let i = 0; i < seats.length; i += 1) ordered.push(seats[(start + i) % seats.length]);
      return ordered.map((seat) => this.seatToPlayer.get(seat));
    };

    // Side pots: distinct commitment levels, each paid to eligible winners
    const commitments = this.players
      .filter((p) => this.activePlayers.includes(p.id))
      .map((p) => ({
        id: p.id,
        committed: p.contributions.preflop + p.contributions.flop + p.contributions.turn + p.contributions.river
      }));
    const levels = [...new Set(commitments.map((c) => c.committed))].sort((a, b) => a - b).filter((l) => l > 0);
    const payouts = {};
    for (let i = 0; i < levels.length; i += 1) {
      const level = levels[i];
      const lower = i > 0 ? levels[i - 1] : 0;
      const contributors = commitments.filter((c) => c.committed >= level);
      const amount = (level - lower) * contributors.length;
      const winners = orderWinners(contributors.map((c) => c.id).filter((id) => result.winnerIds.includes(id)));
      if (!winners.length) continue;
      const share = Math.floor(amount / winners.length);
      const odd = amount - share * winners.length;
      winners.forEach((id, wi) => {
        payouts[id] = (payouts[id] || 0) + share + (wi === 0 ? odd : 0);
      });
    }
    for (const [id, amount] of Object.entries(payouts)) {
      const p = this.playerById(id);
      if (p) p.chips += amount;
    }
    this.payouts = payouts;
    this.lastShowdown = { winnerIds: result.winnerIds, ranked: result.ranked, all: result.all, payouts };
    this.finishHand({ winnerIds: result.winnerIds, reason: 'showdown' });
  }

  finishHand(meta) {
    for (const p of this.players) {
      if (p.status === 'in-hand') p.status = 'seated';
    }
    this.lastPot = this.pot; // capture before the pot is reset to 0
    this.lastEnd = { reason: meta && meta.reason, winnerId: meta ? meta.winnerId : null };
    this.street = 'ended';
    this.pot = 0; // pot has been paid out
    this.emit('showdown', this.lastShowdown);
    this.emit('handEnded', { ...meta, payouts: this.payouts, snapshot: this.snapshot() });
  }

  // ---------------------------------------------------------------- snapshot

  /**
   * Who may reveal their hole cards in a given view, for LIVE players.
   *
   * HARD PRIVACY RULE: a live player can only ever see THEIR OWN hole cards —
   * both during betting and after the hand ends. The showdown result is
   * communicated via `lastShowdown` (winnerIds / ranked / all), NOT by
   * exposing other players' hole cards over the wire. Spectators (revealAll)
   * are the only exception and may see every card.
   *
   * @returns {(player:object)=>boolean} predicate
   */
  _revealPredicate(viewerId, revealAll) {
    if (revealAll) return () => true; // spectator: every card
    // Only the viewer's own cards are ever visible to a live player.
    return (p) => p.id === viewerId;
  }

  snapshotFor(viewerId, options = {}) {
    const revealAll = !!options.revealAllHoles;
    const mayReveal = this._revealPredicate(viewerId, revealAll);
    return {
      tableId: this.tableId,
      gameType: this.gameType,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      startingStack: this.startingStack,
      chipDenominations: this.chipDenominations,
      handNumber: this.handNumber,
      street: this.street,
      community: this.community,
      currentBet: this.currentBet,
      lastRaiseIncrement: this.lastRaiseIncrement,
      raiseCount: this.raiseCount,
      pot: this.pot,
      dealerSeat: this.dealerSeat,
      nextActorId: this.nextActorId(),
      streetComplete: this.streetComplete,
      inHand: this.inHand,
      lastShowdown: this.lastShowdown,
      payouts: this.payouts,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        seat: p.seat,
        isBot: p.isBot,
        bot: p.bot ? p.bot : null,
        avatarMeta: p.avatarMeta,
        chips: p.chips,
        status: p.status,
        hasFolded: p.hasFolded,
        isAllIn: p.isAllIn,
        toAct: !!p.toAct,
        contributions: p.contributions,
        holeCards: mayReveal(p) ? p.holeCards : null
      }))
    };
  }

  /** Convenience: snapshot with no hole cards revealed (tests/debug). */
  snapshot() {
    return this.snapshotFor(null);
  }
}
