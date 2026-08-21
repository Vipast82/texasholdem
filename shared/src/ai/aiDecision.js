import { minRaise, maxBet } from '../bettingRules.js';
import { parseCard } from '../cards.js';
import { evaluateBest } from '../handEvaluator.js';
import { estimateWinTieLose } from './aiMonteCarlo.js';

/**
 * Heuristic decision logic for the AI. Pure functions: no I/O, no sockets.
 *
 * The engine (aiEngine.js) normalizes a GameTable view into a compact
 * `state` and hands it to these helpers. They return a *ranked* list of
 * candidate actions; the engine picks the best legal one and sizes the bet.
 *
 * `state` shape (see aiEngine.normalizeState):
 *   { hole, community, street, pot, toCall, chips, bigBlind, currentBet,
 *     gameType, lastRaiseIncrement, raiseCount, maxRaises, playersRemaining,
 *     position, boardTexture }
 *
 * position ∈ 'early' | 'middle' | 'cutoff' | 'button'
 * boardTexture = { paired, flushDraw, straightDraw } (all booleans)
 */

/** A 0..1 measure of raw hand strength based on known cards only. */
export function handStrength(state) {
  const { hole, community } = state;
  const values = hole.map((c) => parseCard(c).value);
  const high = Math.max(...values);
  const low = Math.min(...values);
  const suited = hole[0].slice(-1) === hole[1].slice(-1);
  const isPair = values[0] === values[1];

  let s;
  if (isPair) {
    s = 0.55 + (values[0] / 14) * 0.4; // 22 → ~0.60, AA → 0.95
    if (values[0] >= 13) s = 0.95;
  } else {
    s = 0.25 + (high / 14) * 0.25; // junk ~0.28, AKo ~0.5
    if (suited) s += 0.05;
    if (high === 14 && low === 13) s += 0.08; // AK
    if (high === 14 && low >= 10) s += 0.05; // AQ / AK
  }
  // Board connection (pair on board, straight/flush draw) bumps strength.
  if (state.boardTexture) {
    if (state.boardTexture.paired) s += 0.05;
    if (state.boardTexture.flushDraw) s += 0.08;
    if (state.boardTexture.straightDraw) s += 0.06;
  }
  if (community.length >= 3) {
    try {
      const best = evaluateBest([...community, ...hole]);
      // Category 0..9 -> 0.3 + category*0.08
      s = Math.max(s, 0.3 + best.category * 0.08);
      if (best.category >= 6) s = 0.9;
    } catch (err) {
      // ignore: evaluator is authoritative elsewhere
    }
  }
  return Math.min(1, Math.max(0, s));
}

/**
 * Pot-odds required to call `toCall` into `pot`. A number 0..1:
 * fraction of (pot + toCall) we must win to break even on a call.
 * Returns 0 when there is nothing to call.
 */
export function potOddsRequired(state) {
  const { pot, toCall } = state;
  if (toCall <= 0) return 0;
  return toCall / (pot + toCall);
}

/**
 * Build a ranked list of candidate actions for the given state + profile.
 * Returns an array of { action, weight, amount? } sorted by weight desc.
 *
 * The engine guarantees only legal actions are ever chosen; here we express
 * preference. `rng` is used only for bluff coin-flips.
 */
export function rankCandidates(state, profile, rng) {
  const rawStrength = handStrength(state);
  // HARD pre-computes a blended strength (heuristic + Monte-Carlo equity) in
  // state.effectiveStrength. Fall back to the raw heuristic otherwise.
  const strength =
    typeof state.effectiveStrength === 'number' ? state.effectiveStrength : rawStrength;
  const required = potOddsRequired(state);
  const { pot, toCall, chips, bigBlind, raiseCount, maxRaises, currentBet, lastRaiseIncrement } = state;
  const posMult = (profile.positionMultipliers || {})[state.position] || 1.0;
  const oppFactor = 1 - 0.15 * Math.min(1, Math.max(0, (state.playersRemaining - 1) - 1));
  const effectiveStrength = strength * posMult * oppFactor;

  // Bluff coin-flip (deterministic given rng).
  const bluff = rng ? rng.next() < profile.bluffFreq : false;

  // Legal range for the next bet/raise target.
  const minTarget = toCall > 0
    ? minRaise(currentBet, bigBlind, lastRaiseIncrement)
    : bigBlind;
  const maxTarget = maxBet(state.gameType, pot, state.street, bigBlind, currentBet);
  const maxAllowed = maxTarget === null ? chips : Math.min(maxTarget, chips);
  const raiseAllowed = raiseCount < maxRaises;
  // Engine rule: 'bet' is only legal when nothing is out (currentBet === 0);
  // 'raise' is only legal when a bet is already out (currentBet > 0).
  const canBet = currentBet === 0;
  const canRaise = currentBet > 0;

  const candidates = [];
  const add = (action, weight, amount = 0) => candidates.push({ action, weight, amount });

  if (toCall === 0) {
    // Nothing to call: check, bet (nothing out), raise (bet out), or all-in.
    add('check', 0.5);
    const canAggress = raiseAllowed && maxAllowed >= minTarget && chips > 0;
    if (canAggress) {
      const action = canBet ? 'bet' : 'raise';
      // Size scales with strength + aggression (pot-relative).
      const size = Math.min(
        maxAllowed,
        Math.max(minTarget, Math.round((pot * 0.4 + minTarget) * (0.5 + profile.aggression)))
      );
      const want = effectiveStrength > profile.callThreshold || bluff;
      add(action, want ? 0.6 + effectiveStrength * 0.4 : 0.1 + bluff * 0.2, size);
      if (bluff && maxAllowed >= minTarget) add(action, 0.4, maxAllowed);
    }
    // All-in shove when strongly ahead or bluffing.
    if (chips > 0 && (effectiveStrength > 0.85 || (bluff && pot < chips))) {
      add('allin', 0.3 + effectiveStrength * 0.4);
    }
  } else {
    // Facing a bet. Fold weight climbs as our hand weakens; call weight
    // climbs when we have value vs the pot odds.
    add('fold', 0.3 + (1 - effectiveStrength) * 0.5);
    add('call', Math.max(0, 0.4 + (effectiveStrength - required) * 1.5));
    if (raiseAllowed && canRaise && maxAllowed >= minTarget && chips > toCall) {
      const size = Math.min(
        maxAllowed,
        Math.max(minTarget, Math.round(minTarget * (0.8 + profile.aggression)))
      );
      const wantRaise = effectiveStrength > (profile.callThreshold + 0.1) || bluff;
      add('raise', wantRaise ? 0.5 + effectiveStrength * 0.4 : 0.05 + bluff * 0.15, size);
      if (bluff && maxAllowed >= minTarget) add('raise', 0.35, maxAllowed);
    }
    // Aggressive shove when we are the value (or a committed bluff).
    if (chips > toCall && (effectiveStrength > 0.85 || (bluff && chips > pot))) {
      add('allin', 0.4 + effectiveStrength * 0.3);
    }
  }

  // Sort by weight desc; stable for equal weights (insertion order).
  candidates.sort((a, b) => b.weight - a.weight);
  return candidates;
}

/**
 * Full-deck equity path for HARD players. Returns { win, tie, lose } as
 * fractions (0..1) so the engine can treat it like `handStrength` for
 * sizing, or compare against pot odds for value.
 */
export function monteCarloEquity(state, profile, seed) {
  return estimateWinTieLose(state.hole, state.community, seed, profile.mcIterations || 200, profile.opponents || 3);
}