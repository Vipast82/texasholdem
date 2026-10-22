export * from './cards.js';
export * from './rng.js';
export * from './handEvaluator.js';
export * from './potSplit.js';
export * from './bettingRules.js';
export { GameTable } from './gameEngine.js';

// AI (Sprint 2) - pure, deterministic. Re-export the public surface.
export { getProfile, DIFFICULTIES, pickBotName, personaFor, styleLabel } from './ai/aiProfiles.js';
export { emptyStats, recordHand as recordOpponentHand, readOf } from './ai/opponentModel.js';
export { estimateWinTieLose } from './ai/aiMonteCarlo.js';
export { handStrength, potOddsRequired, rankCandidates } from './ai/aiDecision.js';
export {
  decideAction,
  positionFor,
  boardTexture,
  normalizeState
} from './ai/aiEngine.js';
export { strategyHint } from './tutorialHint.js';

// Sprint 4 - HUD equity (thin wrapper over the single Monte-Carlo) + hand history.
export {
  estimateEquity,
  equityForPlayer,
  clampIterations,
  MAX_EQUITY_ITERATIONS,
  MIN_EQUITY_ITERATIONS
} from './equity.js';
export { buildHandRecord, serializeHandRecord } from './history.js';
