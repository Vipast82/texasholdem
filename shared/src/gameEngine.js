import { createShuffledDeck } from './rng.js';
import { minRaise, maxBet, maxRaisesPerStreet } from './bettingRules.js';
import { showdown, compareRanked } from './handEvaluator.js';
import { computePots, distributePot } from './potSplit.js';

function totalCommitted(p) {
  const c = p.contributions;
  return c.preflop + c.flop + c.turn + c.river;
}

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
    if (
      !config.smallBlind ||
      !config.bigBlind ||
      config.smallBlind <= 0 ||
      config.bigBlind <= config.smallBlind
    ) {
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
    this.runoutFrom = null; // board size when an all-in runout began (null = no runout)
    this._departed = []; // { id, committed } for players who left mid-hand (dead money)
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
      sittingOut: false,
      contributions: { preflop: 0, flop: 0, turn: 0, river: 0 }
    };
    this.players.push(player);
    this.seatToPlayer.set(player.seat, id);
    return id;
  }

  removePlayer(id) {
    const i = this.players.findIndex((p) => p.id === id);
    if (i < 0) return false;
    const p = this.players[i];
    const wasInHand = this.inHand && p.status === 'in-hand';
    // Whatever they already put in stays in the pot as dead money, so side-pot
    // math still balances after their seat is gone.
    if (wasInHand) {
      const committed = totalCommitted(p);
      if (committed > 0) this._departed.push({ id: p.id, committed });
      p.hasFolded = true;
      p.toAct = false;
    }
    this.players.splice(i, 1);
    this.seatToPlayer.delete(p.seat);
    if (!wasInHand) return true;
    // Fewer than two players left in the hand: end it and give the pot to the
    // last one standing. See resolveOrphanedHand().
    this.resolveOrphanedHand();
    // Otherwise the hand goes on — but the leaver may have been the last one
    // still to act, so close the street if nobody else owes an action.
    if (this.inHand && this.streetComplete) this.advanceStreet();
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
    const stillIn = this.players.filter((p) => p.status === 'in-hand' && !p.hasFolded);
    if (stillIn.length >= 2) return; // hand can continue with 2+ players
    const pot = this.pot;
    const payouts = {};
    if (pot > 0 && stillIn.length === 1) {
      // Sole remaining player takes the whole pot so no chips are destroyed.
      const p = stillIn[0];
      payouts[p.id] = pot;
      p.chips += pot;
    }
    this.payouts = payouts;
    this.lastShowdown = null;
    this.finishHand({ winnerId: stillIn.length === 1 ? stillIn[0].id : null, reason: 'table-orphaned' });
  }

  /** A busted player buys back in for a fresh starting stack (never mid-hand). */
  rebuy(id) {
    const p = this.playerById(id);
    if (!p) throw new Error(`unknown player ${id}`);
    if (p.chips > 0) throw new Error('you still have chips');
    if (p.status === 'in-hand') throw new Error('wait for the hand to end');
    p.chips = this.startingStack;
    return p.chips;
  }

  /** Sit out (skip the next deals) or come back. Takes effect from the next hand. */
  setSittingOut(id, out) {
    const p = this.playerById(id);
    if (!p) throw new Error(`unknown player ${id}`);
    p.sittingOut = !!out;
    return p.sittingOut;
  }

  /** Change the blinds between hands (tournament levels, table settings). */
  setBlinds(smallBlind, bigBlind) {
    if (this.inHand) throw new Error('blinds can only change between hands');
    if (!(smallBlind > 0) || !(bigBlind > smallBlind)) throw new Error('invalid blinds');
    this.smallBlind = Math.round(smallBlind);
    this.bigBlind = Math.round(bigBlind);
  }

  playerById(id) {
    return this.players.find((p) => p.id === id);
  }

  /**
   * Main pot and side pots as they stand right now (folded players' chips stay
   * in the pots they paid into). Each pot lists how many live players can win it.
   */
  currentPots() {
    if (!this.inHand) return [];
    const commitments = [
      ...this.players.filter((p) => this.activePlayers.includes(p.id)).map((p) => totalCommitted(p)),
      ...this._departed.map((d) => d.committed)
    ];
    const live = this.playersStillIn();
    // Pots only split where a live player is all in: each all-in amount caps
    // a pot, and everything above the last cap is one pot for whoever is left.
    const caps = [...new Set(live.filter((p) => p.isAllIn).map((p) => totalCommitted(p)))].sort(
      (x, y) => x - y
    );
    const pots = [];
    let prev = 0;
    const add = (amount, contenders) => {
      if (amount <= 0) return;
      // A pot only one player can win is just their uncalled chips: fold it
      // into the pot below rather than calling it a side pot.
      if (contenders < 2 && pots.length) pots[pots.length - 1].amount += amount;
      else pots.push({ amount, contenders });
    };
    for (const cap of caps) {
      const amount = commitments.reduce((sum, c) => sum + Math.max(0, Math.min(c, cap) - prev), 0);
      add(amount, live.filter((p) => !p.isAllIn || totalCommitted(p) >= cap).length);
      prev = cap;
    }
    add(
      commitments.reduce((sum, c) => sum + Math.max(0, c - prev), 0),
      live.filter((p) => !p.isAllIn || totalCommitted(p) > prev).length
    );
    return pots;
  }

  // ---------------------------------------------------------------- helpers

  activeSeats() {
    return this.players
      .filter((p) => p.status === 'seated' || p.status === 'in-hand')
      .map((p) => p.seat)
      .sort((a, b) => a - b);
  }

  /** Next seat clockwise from `seat` (which need not itself be in `seats`). */
  seatAfter(seat, seats) {
    return seats.find((s) => s > seat) ?? seats[0];
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
    const active = this.players.filter((p) => p.status === 'seated' && p.chips > 0 && !p.sittingOut);
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
    this._departed = [];
    this.runoutFrom = null;

    for (const p of this.players) {
      if (p.status === 'seated') {
        p.holeCards = null;
        p.isAllIn = false;
        p.hasFolded = false;
        p.toAct = false;
        p.contributions = { preflop: 0, flop: 0, turn: 0, river: 0 };
      }
    }

    // Button and blinds only move between players who are actually dealt in
    // (a busted 0-chip seat never gets the button or a blind).
    const seats = active.map((p) => p.seat).sort((a, b) => a - b);
    this.dealerSeat = this.seatAfter(this.dealerSeat, seats);

    this.activePlayers = active.map((p) => p.id);
    for (const p of active) {
      p.holeCards = [this.deck.pop(), this.deck.pop()];
      p.status = 'in-hand';
    }

    // Heads-up: the button posts the small blind and acts first preflop, last
    // after the flop. With 3+ players the small blind sits left of the button.
    const sbSeat = seats.length === 2 ? this.dealerSeat : this.seatAfter(this.dealerSeat, seats);
    const bbSeat = this.seatAfter(sbSeat, seats);
    const sbId = this.seatToPlayer.get(sbSeat);
    const bbId = this.seatToPlayer.get(bbSeat);

    // Post blinds first so all-in blinds are excluded from the action list.
    // A short stack may post less than the full blind, so the pot is what was
    // actually posted, not smallBlind + bigBlind.
    this.pot = this.postBlind(sbId, this.smallBlind) + this.postBlind(bbId, this.bigBlind);

    // Set up the preflop betting round (resets street/raise state + toAct flags).
    const utgSeat = this.seatAfter(bbSeat, seats);
    this._setupStreet('preflop', utgSeat);
    this.currentBet = this.bigBlind;

    this.emit('handStarted', this.snapshot());
    this.emit('blindsPosted', { sb: sbId, bb: bbId, smallBlind: this.smallBlind, bigBlind: this.bigBlind });
    this.emit('holeDealt', this.snapshot());
    // Blinds can put everyone (or all but one uncontested player) all-in
    // before anyone acts; deal the board out instead of waiting forever.
    if (this.streetComplete) this.advanceStreet();
    return this.snapshot();
  }

  postBlind(id, amount) {
    const p = this.playerById(id);
    const pay = Math.min(amount, p.chips);
    p.chips -= pay;
    p.contributions.preflop += pay;
    if (p.chips === 0) p.isAllIn = true;
    return pay;
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

  /**
   * The betting round is over when nobody still owes an action. A player who
   * is the only one left with chips only needs to act if they face a bet
   * (e.g. calling or folding to an all-in) — otherwise there is nobody left
   * to bet against.
   */
  get streetComplete() {
    const canAct = this.canActPlayers();
    if (canAct.length > 1) return !canAct.some((p) => p.toAct);
    const [last] = canAct;
    return !last || !last.toAct || last.contributions[this.street] >= this.currentBet;
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
    if (action === 'bet' || action === 'raise') {
      // Amounts come straight off the network: insist on a whole chip count so
      // a string or fraction can never corrupt the pot arithmetic.
      amount = Number(amount);
      if (!Number.isInteger(amount) || amount <= 0) throw new Error('amount must be a positive whole number');
    }

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
        const increment = newBetLevel - this.currentBet;
        // A short all-in that is less than a full raise does not lower the
        // minimum raise for the next player and does not count as a raise.
        const fullRaise =
          this.currentBet === 0 || increment >= Math.max(this.lastRaiseIncrement, this.bigBlind);
        if (fullRaise) {
          this.lastRaiseIncrement = increment;
          this.raiseCount += 1;
        }
        this.currentBet = newBetLevel;
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
    if (this.community.length < 5) this.runoutFrom = this.community.length;
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
    const result = showdown(
      hands,
      this.community,
      stillIn.map((p) => p.id)
    );

    const orderWinners = (ids) => {
      const seats = ids.map((id) => this.playerById(id).seat).sort((a, b) => a - b);
      const start = (seats.indexOf(this.dealerSeat) + 1) % seats.length;
      const ordered = [];
      for (let i = 0; i < seats.length; i += 1) ordered.push(seats[(start + i) % seats.length]);
      return ordered.map((seat) => this.seatToPlayer.get(seat));
    };

    // Main + side pots. Folded players and players who left mid-hand still
    // fund the pots they paid into; only players still in can win them, and
    // each pot goes to the best hand among the players eligible for it.
    const commitments = [
      ...this.players
        .filter((p) => this.activePlayers.includes(p.id))
        .map((p) => ({ id: p.id, committed: totalCommitted(p) })),
      ...this._departed
    ];
    const contenders = new Set(stillIn.map((p) => p.id));
    const payouts = {};
    let carry = 0; // a pot nobody still in paid into rolls into the next one
    for (const pot of computePots(commitments)) {
      const eligible = pot.eligible.filter((id) => contenders.has(id));
      if (!eligible.length) {
        carry += pot.amount;
        continue;
      }
      const best = eligible.reduce((a, b) => (compareRanked(result.all[b], result.all[a]) > 0 ? b : a));
      const winners = orderWinners(
        eligible.filter((id) => compareRanked(result.all[id], result.all[best]) === 0)
      );
      for (const [id, share] of Object.entries(distributePot(pot.amount + carry, winners))) {
        payouts[id] = (payouts[id] || 0) + share;
      }
      carry = 0;
    }
    if (carry > 0) {
      // Only possible when the top pots were funded solely by folded players:
      // give it to the overall winner(s).
      const winners = orderWinners(result.winnerIds);
      for (const [id, share] of Object.entries(distributePot(carry, winners))) {
        payouts[id] = (payouts[id] || 0) + share;
      }
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
      p.toAct = false;
    }
    this._actionOrder = [];
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
   * PRIVACY RULE: while a hand is being played a live player only ever sees
   * THEIR OWN hole cards. Once the hand ends at a showdown, the hands that
   * reached it are shown to everyone (folded and uncontested hands never
   * are). Spectators with "show all" (revealAll) may see every card.
   *
   * @returns {(player:object)=>boolean} predicate
   */
  _revealPredicate(viewerId, revealAll) {
    if (revealAll) return () => true; // spectator: every card
    // After a showdown, every hand that reached it is turned face up (as at a
    // real table). Folded hands and hands won uncontested stay hidden.
    const shown =
      this.street === 'ended' && this.lastShowdown && this.lastShowdown.all
        ? new Set(Object.keys(this.lastShowdown.all))
        : null;
    return (p) => p.id === viewerId || (shown !== null && shown.has(p.id));
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
      pots: this.currentPots(),
      dealerSeat: this.dealerSeat,
      nextActorId: this.nextActorId(),
      streetComplete: this.streetComplete,
      inHand: this.inHand,
      lastShowdown: this.lastShowdown,
      runoutFrom: this.runoutFrom,
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
        sittingOut: !!p.sittingOut,
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
