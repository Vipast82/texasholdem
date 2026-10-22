import { estimateWinTieLose } from './ai/aiMonteCarlo.js';

/**
 * HUD-odds equity (Sprint 4).
 *
 * This is the single source of truth for client-side win/tie/lose estimates.
 * It is a thin, defensive wrapper over the one Monte-Carlo implementation
 * (aiMonteCarlo.estimateWinTieLose) — there is exactly ONE Monte-Carlo, reused
 * here and by the HARD AI. All randomness flows through the seeded deck, so a
 * given (view, seed) always produces the same numbers (determinism is a hard
 * requirement). Iterations are clamped to a hard cap so the UI stays
 * responsive even if a caller asks for an absurd count.
 *
 * Everything here is pure: no I/O, no sockets, no GameTable dependency — it
 * works on a plain snapshot object (what the client actually receives).
 */

export const MAX_EQUITY_ITERATIONS = 2000;
export const MIN_EQUITY_ITERATIONS = 10;
const DEFAULT_ITERATIONS = 300;
const DEFAULT_OPPONENTS = 3;

/** Clamp a requested iteration count into [MIN, MAX]. */
export function clampIterations(n) {
  let v = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : DEFAULT_ITERATIONS;
  if (v < MIN_EQUITY_ITERATIONS) v = MIN_EQUITY_ITERATIONS;
  if (v > MAX_EQUITY_ITERATIONS) v = MAX_EQUITY_ITERATIONS;
  return v;
}

/**
 * Estimate win/tie/lose for a single seat.
 *
 * @param {object} view { hole: [card, card], community: card[], opponents?: number }
 * @param {string|number} seed any seed (required — determinism is a hard rule)
 * @param {number} [iterations] simulation count (clamped to [MIN, MAX])
 * @param {number} [opponents] random opponents to deal against (default 3)
 * @returns {{win,tie,lose,confidence,iterations,opponents}|null} null on any bad input.
 */
export function estimateEquity(view, seed, iterations = DEFAULT_ITERATIONS, opponents = DEFAULT_OPPONENTS) {
  if (!view || !Array.isArray(view.hole) || view.hole.length !== 2) return null;
  if (seed === undefined || seed === null || seed === '') return null;
  const community = Array.isArray(view.community) ? view.community : [];
  const opp = Number(view.opponents != null ? view.opponents : opponents);
  const iters = clampIterations(iterations);
  try {
    const r = estimateWinTieLose(view.hole, community, seed, iters, opp);
    return {
      win: r.win,
      tie: r.tie,
      lose: r.lose,
      confidence: r.confidence,
      iterations: iters,
      opponents: opp
    };
  } catch (err) {
    return null; // defensive: a bad card set must never break the HUD
  }
}

/**
 * Convenience for the client: derive the equity view from a per-viewer snapshot
 * and estimate a given player's odds. Returns null when the player's hole cards
 * are not available in this snapshot (e.g. another player's hand — private by
 * design) or the player has folded.
 *
 * @param {object} snapshot a server snapshotFor(viewerId) object
 * @param {string} playerId the seat to estimate
 * @param {string|number} seed
 * @param {number} [iterations]
 * @returns {{win,tie,lose,confidence,iterations,opponents}|null}
 */
export function equityForPlayer(snapshot, playerId, seed, iterations = DEFAULT_ITERATIONS) {
  if (!snapshot || !playerId) return null;
  const players = Array.isArray(snapshot.players) ? snapshot.players : [];
  const me = players.find((p) => p && p.id === playerId);
  if (!me || !Array.isArray(me.holeCards) || me.holeCards.length !== 2) return null;
  if (me.hasFolded) return null;

  const opponents = players.filter(
    (p) => p && p.id !== playerId && p.status === 'in-hand' && !p.hasFolded
  ).length;

  // Everyone else folded: this seat has already won the pot.
  if (opponents === 0) {
    return { win: 1, tie: 0, lose: 0, confidence: 1, iterations: 0, opponents: 0 };
  }

  const view = { hole: me.holeCards, community: snapshot.community || [], opponents };
  return estimateEquity(view, seed, iterations, opponents);
}
