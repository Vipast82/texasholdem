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
    // Loose-passive "calling station": plays too many hands, calls too much,
    // rarely raises, and misjudges hands now and then.
    style: 'loose-passive',
    looseness: 0.75,
    aggression: 0.25,
    callThreshold: 0.18,
    bluffFreq: 0.05,
    cbet: 0.3,
    callDown: 0.14,
    callMargin: 0,
    rangeRespect: 0,
    rangeRespectPre: 0.3,
    slowplay: 0.25,
    noise: 0.12,
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
    // Solid, straightforward player.
    style: 'solid',
    looseness: 0.45,
    aggression: 0.5,
    callThreshold: 0.28,
    bluffFreq: 0.08,
    cbet: 0.55,
    callDown: 0.04,
    callMargin: 0.02,
    rangeRespect: 0.12,
    rangeRespectPre: 0.6,
    slowplay: 0.12,
    noise: 0.05,
    mcIterations: 300,
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
    // Tight-aggressive: disciplined ranges, position-aware, bets for value,
    // bluffs in good spots, respects strong betting.
    style: 'tight-aggressive',
    looseness: 0.52,
    aggression: 0.85,
    callThreshold: 0.34,
    bluffFreq: 0.13,
    cbet: 0.68,
    callDown: 0,
    callMargin: 0.03,
    rangeRespect: 0.2,
    rangeRespectPre: 0.75,
    slowplay: 0.12,
    noise: 0.015,
    mcIterations: 700,
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

/**
 * Small, stable personality tweaks so two CPUs of the same difficulty do not
 * play identically. Seeded by the player's name.
 */
export function personaFor(profile, name) {
  if (!name) return profile;
  let h = 2166136261;
  for (let i = 0; i < name.length; i += 1) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  const unit = (shift) => (((h >>> shift) & 0xff) / 255) * 2 - 1; // -1..1
  const clamp = (v) => Math.min(0.95, Math.max(0.05, v));
  return {
    ...profile,
    looseness: clamp(profile.looseness + unit(0) * 0.1),
    aggression: clamp(profile.aggression + unit(8) * 0.12),
    bluffFreq: Math.max(0, profile.bluffFreq + unit(16) * 0.04)
  };
}

/** Plain-language label for a CPU's playing style. */
export function styleLabel(profile) {
  const loose = profile.looseness >= 0.5;
  const aggro = profile.aggression >= 0.5;
  return `${loose ? 'loose' : 'tight'}-${aggro ? 'aggressive' : 'passive'}`;
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
