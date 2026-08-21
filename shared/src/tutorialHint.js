/**
 * Tutorial strategy hint - a THIN adapter over the existing AI decision engine.
 *
 * The spec requires the tutorial's optional "strategy hint" to REUSE the AI's
 * reason/confidence and NOT duplicate its logic. So this function simply calls
 * the same `decideAction` the server uses for bots, with a fixed profile and
 * the caller's seed (determinism), and reshapes the result into the tutorial
 * hint shape:
 *
 *   { action, amount?, reason, confidence, meta? }
 *
 * It is pure and side-effect free: the GameTable is only read (normalized),
 * never mutated. A bad/missing seed surfaces as `null` (the hint is optional)
 * rather than throwing into the UI.
 */
import { decideAction } from './ai/aiEngine.js';
import { getProfile } from './ai/aiProfiles.js';

/**
 * @param {object} game  a GameTable instance (read-only)
 * @param {string} actorId the player who is about to act
 * @param {object} [opts]
 * @param {string|number} [opts.seed] deterministic seed (falls back to a derived one)
 * @param {string} [opts.difficulty='normal'] profile to compute the hint with
 * @returns {{action:string, amount?:number, reason?:string, confidence?:number, meta?:object}|null}
 */
export function strategyHint(game, actorId, opts = {}) {
  try {
    const seed = opts.seed !== undefined && opts.seed !== null ? opts.seed : `hint:${actorId}:${game.pot}`;
    const profile = getProfile(opts.difficulty || 'normal');
    const result = decideAction(game, actorId, { profile, seed });
    return {
      action: result.action,
      amount: result.amount,
      reason: result.reason,
      confidence: result.confidence,
      meta: result.meta
    };
  } catch (err) {
    return null; // hint is optional — never break the tutorial over a bad state
  }
}