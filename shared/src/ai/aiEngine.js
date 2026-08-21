import { minRaise, maxBet, maxRaisesPerStreet } from '../bettingRules.js';
import { parseCard } from '../cards.js';
import { Rng } from '../rng.js';
import { rankCandidates, monteCarloEquity, handStrength } from './aiDecision.js';
import { getProfile } from './aiProfiles.js';

/**
 * Top-level AI engine.
 *
 * decideAction(game, actorId, { difficulty | profile, seed, rng })
 *   -> { action, amount?, reason, confidence, meta }
 *
 * Guarantees:
 *   - action is legal for the game type (validated against bettingRules)
 *   - amount never exceeds the actor's chips
 *   - deterministic for a given (game, actorId, seed)
 *
 * The engine normalizes the GameTable view into a compact `state`, calls the
 * decision module, then coerces the chosen action into a legal shape.
 *
 * Note: `game` is a GameTable instance (or any object with the same public
 * fields). The engine is a pure consumer — it does not mutate.
 */

/**
 * Map the actor's seat relative to the dealer into a bucket:
 *   'button'  — the dealer
 *   'cutoff'  — one before the dealer
 *   'early'   — the first actor after the big blind (UTG)
 *   'middle'  — anything else
 */
export function positionFor(game, seat) {
  if (seat === game.dealerSeat) return 'button';
  const seats = game.players.map((p) => p.seat).sort((a, b) => a - b);
  const n = seats.length;
  if (n <= 2) return 'middle';
  const dealerIdx = seats.indexOf(game.dealerSeat);
  const myIdx = seats.indexOf(seat);
  const distLeft = (dealerIdx - myIdx + n) % n;
  if (distLeft === 1) return 'cutoff';
  if (distLeft === n - 1) return 'early';
  return 'middle';
}

/**
 * Detect simple board texture: paired, flush draw, straight draw.
 * Derived from the community cards only (postflop).
 * boardTexture = { paired, flushDraw, straightDraw } (all booleans).
 */
export function boardTexture(community) {
  const out = { paired: false, flushDraw: false, straightDraw: false };
  if (!community || community.length < 2) return out;
  const counts = new Map();
  for (const c of community) {
    const r = c.slice(0, -1);
    counts.set(r, (counts.get(r) || 0) + 1);
  }
  out.paired = [...counts.values()].some((nn) => nn >= 2);
  if (community.length === 3) {
    const suitCounts = new Map();
    for (const c of community) {
      const s = c.slice(-1);
      suitCounts.set(s, (suitCounts.get(s) || 0) + 1);
    }
    out.flushDraw = [...suitCounts.values()].some((nn) => nn >= 3);
  }
  // Straight draw: 4 distinct ranks within a 4-wide window.
  const values = [...new Set(community.map((c) => parseCard(c).value))].sort((a, b) => a - b);
  for (let i = 0; i + 3 < values.length; i += 1) {
    if (values[i + 3] - values[i] === 3) {
      out.straightDraw = true;
      break;
    }
  }
  return out;
}

/**
 * Normalize the GameTable view for a given actor into the compact `state`
 * shape consumed by aiDecision.js.
 */
export function normalizeState(game, actorId) {
  const actor = game.playerById(actorId);
  if (!actor) throw new Error(`unknown player ${actorId}`);
  const street = game.street;
  const committed = actor.contributions[street] || 0;
  const toCall = Math.max(0, game.currentBet - committed);
  const playersRemaining = game.players.filter((p) => p.status === 'in-hand' && !p.hasFolded).length;
  return {
    hole: actor.holeCards,
    community: game.community,
    street,
    pot: game.pot,
    toCall,
    committed,
    chips: actor.chips,
    bigBlind: game.bigBlind,
    smallBlind: game.smallBlind,
    currentBet: game.currentBet,
    gameType: game.gameType,
    lastRaiseIncrement: game.lastRaiseIncrement,
    raiseCount: game.raiseCount,
    maxRaises: maxRaisesPerStreet(game.gameType, street),
    playersRemaining,
    position: positionFor(game, actor.seat),
    boardTexture: boardTexture(game.community)
  };
}

/**
 * Coerce a candidate action into a legal shape for the current betting state.
 * Handles min/max raises, pot-limit caps, no-limit stacks, short all-ins, and
 * the limit "exactly one bet size" rule.
 *
 * 'amount' is the *total* bet level the raise/bet must reach (matches
 * GameTable.applyAction). For 'allin' amount is ignored (full stack).
 */
function legalize(state, action, amount) {
  const {
    chips,
    bigBlind,
    pot,
    street,
    gameType,
    currentBet,
    lastRaiseIncrement,
    raiseCount,
    maxRaises,
    committed
  } = state;
  const toCall = Math.max(0, currentBet - committed);
  // A full all-in that does not exceed the current bet level is just a call.
  if (action === 'allin' && committed + chips <= currentBet) return { action: 'call', amount: 0 };

  const minTarget = currentBet === 0 ? bigBlind : minRaise(currentBet, bigBlind, lastRaiseIncrement);
  const maxTarget = maxBet(gameType, pot, street, bigBlind, currentBet);
  const maxAllowed = maxTarget === null ? chips : Math.min(maxTarget, chips);

  if (action === 'fold' || action === 'check') return { action, amount: 0 };
  if (action === 'call') return { action, amount: 0 };

  // 'bet' is only legal when nothing is out; 'raise' when a bet is out.
  if (action === 'bet' && currentBet === 0) {
    let total = Math.max(bigBlind, Math.min(amount || bigBlind, maxAllowed));
    if (gameType === 'limit') total = bigBlind; // limit: exactly one bet
    if (total >= chips) return { action: 'allin', amount: 0 };
    return { action: 'bet', amount: total };
  }
  if (action === 'raise' && currentBet > 0) {
    if (raiseCount >= maxRaises) return { action: 'call', amount: 0 };
    let total = Math.max(minTarget, Math.min(amount || minTarget, maxAllowed));
    if (gameType === 'limit') total = currentBet + bigBlind;
    if (total >= chips) return { action: 'allin', amount: 0 };
    return { action: 'raise', amount: total };
  }

  // All-in that is not a plain call.
  if (action === 'allin') {
    if (committed + chips < minTarget) {
      // Short all-in below the minimum raise is still legal (all-in).
      if (raiseCount >= maxRaises) return { action: 'call', amount: 0 };
      return { action: 'allin', amount: 0 };
    }
    if (raiseCount >= maxRaises) return { action: 'call', amount: 0 };
    return { action: 'allin', amount: 0 };
  }

  // Fallback: pick the cheapest legal response.
  if (toCall > 0) return { action: 'call', amount: 0 };
  return { action: 'check', amount: 0 };
}

/** Build a human-readable reason string from the inputs the AI used. */
function buildReason(state, action, strength, profile) {
  const parts = [];
  const pct = Math.round(strength * 100);
  if (action === 'fold') parts.push(`weak hand (~${pct}%) vs ${state.toCall} to call`);
  else if (action === 'check') parts.push('no bet out; conserving chips');
  else if (action === 'call') parts.push(`value call: ~${pct}% strength vs pot odds`);
  else if (action === 'allin') parts.push(`committed ~${pct}%; shoving ${state.pot} pot`);
  else parts.push(`value ${action}: ~${pct}% strength into a ${state.pot} pot`);
  if (state.boardTexture.flushDraw) parts.push('flush draw');
  if (state.boardTexture.straightDraw) parts.push('straight draw');
  if (state.boardTexture.paired) parts.push('paired board');
  parts.push(`position: ${state.position}`);
  if (profile.difficulty === 'hard') parts.push('monte-carlo equity considered');
  return parts.join('; ');
}

/**
 * The public entry point.
 *
 * @param {object} game a GameTable instance
 * @param {string} actorId the id of the actor (bot) about to act
 * @param {object} [opts]
 * @param {string} [opts.difficulty] 'easy' | 'normal' | 'hard'
 * @param {object} [opts.profile] explicit profile (overrides difficulty)
 * @param {string|number} [opts.seed] deterministic seed
 * @param {Rng} [opts.rng] pre-injected Rng (overrides seed)
 * @returns {{action:string, amount?:number, reason?:string, confidence?:number, meta?:object}}
 */
export function decideAction(game, actorId, opts = {}) {
  const profile = opts.profile || getProfile(opts.difficulty || 'normal');
  if (!opts.rng && (opts.seed === undefined || opts.seed === null)) {
    throw new Error('decideAction requires a seed or an injected Rng (determinism)');
  }
  const rng = opts.rng || new Rng(opts.seed);

  const state = normalizeState(game, actorId);
  const strength = handStrength(state);

  // HARD refines the decision with Monte-Carlo equity.
  let equity = null;
  let effectiveStrength = strength;
  if (profile.difficulty === 'hard') {
    equity = monteCarloEquity(state, profile, opts.seed);
    effectiveStrength = strength * 0.5 + equity.win * 0.5;
    state.effectiveStrength = effectiveStrength;
  }

  const candidates = rankCandidates(state, profile, rng);
  const chosen = candidates.length ? candidates[0] : { action: 'check', weight: 0, amount: 0 };

  const legal = legalize(state, chosen.action, chosen.amount);
  const confidence = Math.min(
    1,
    Math.max(0, effectiveStrength * (legal.action === 'check' || legal.action === 'fold' ? 0.85 : 1))
  );
  return {
    action: legal.action,
    amount: legal.amount,
    reason: buildReason(state, legal.action, effectiveStrength, profile),
    confidence,
    meta: {
      profile: profile.difficulty,
      strength,
      equity,
      position: state.position,
      boardTexture: state.boardTexture
    }
  };
}