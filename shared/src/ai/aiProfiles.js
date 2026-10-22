/**
 * AI profiles - the "personality" and tuning parameters for each difficulty.
 *
 * Pure data, no I/O. The server (and later the tutorial HUD) read these to
 * drive the AI and to render a stable identity (name pool, avatar id, SFX
 * hints) in later sprints. All numeric parameters are dimensionless
 * (fractions of pot/stack) so the engine can scale them safely.
 */
const SHARED_SFX = {
  bet: 'chip',
  fold: 'flick',
  win: 'cheer',
  lose: 'grunt'
};

const PROFILES = {
  easy: {
    difficulty: 'easy',
    aggression: 0.35,
    callThreshold: 0.18,
    bluffFreq: 0.35,
    mcIterations: 120,
    opponents: 3,
    positionMultipliers: { button: 1.05, cutoff: 1.0, middle: 1.0, early: 0.9 },
    opponentWeights: { aggression: 0.1, frequency: 0.1 },
    personality: {
      namePool: ['Cactus Kate', 'Dusty Dave', 'Lucky Lou', 'Salty Sam', 'Mabel', 'Rico'],
      avatarId: 'bot-easy',
      sfxMap: SHARED_SFX
    }
  },
  normal: {
    difficulty: 'normal',
    aggression: 0.55,
    callThreshold: 0.28,
    bluffFreq: 0.15,
    mcIterations: 200,
    opponents: 3,
    positionMultipliers: { button: 1.1, cutoff: 1.05, middle: 1.0, early: 0.95 },
    opponentWeights: { aggression: 0.3, frequency: 0.3 },
    personality: {
      namePool: ['Ace Annie', 'Pete Sharp', 'Nina', 'Oscar', 'Tessa', 'Wade'],
      avatarId: 'bot-normal',
      sfxMap: SHARED_SFX
    }
  },
  hard: {
    difficulty: 'hard',
    aggression: 0.7,
    callThreshold: 0.34,
    bluffFreq: 0.2,
    mcIterations: 600,
    opponents: 4,
    positionMultipliers: { button: 1.15, cutoff: 1.08, middle: 1.0, early: 0.92 },
    opponentWeights: { aggression: 0.5, frequency: 0.5 },
    personality: {
      namePool: ['Blind Jack', 'The Count', 'Vera Vain', 'Ghost', 'Rook', 'Silas'],
      avatarId: 'bot-hard',
      sfxMap: SHARED_SFX
    }
  }
};

export const DIFFICULTIES = Object.keys(PROFILES);

/**
 * @param {string} difficulty 'easy' | 'normal' | 'hard'
 * @returns {object} a profile object (safe to read, do not mutate)
 */
export function getProfile(difficulty) {
  const key = String(difficulty || 'normal').toLowerCase();
  return PROFILES[key] || PROFILES.normal;
}

/** Deterministic name pick for a new bot (uses an injected Rng for stability). */
export function pickBotName(profile, rng, taken = []) {
  const pool =
    (profile && profile.personality && profile.personality.namePool) || PROFILES.normal.personality.namePool;
  // Prefer a name nobody at the table is using; fall back to any name from
  // every difficulty's pool, then to a numbered name.
  const used = new Set(taken);
  const everyName = Object.values(PROFILES).flatMap((p) => p.personality.namePool);
  const free = pool.filter((n) => !used.has(n));
  const candidates = free.length ? free : everyName.filter((n) => !used.has(n));
  if (!candidates.length) return `${pool[0]} ${taken.length + 1}`;
  if (!rng || typeof rng.nextInt !== 'function') return candidates[0];
  return candidates[rng.nextInt(candidates.length)];
}
