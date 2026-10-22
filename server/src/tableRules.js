/**
 * Table rules and flavour that the server applies around the pure game engine:
 * table settings, the tournament blind schedule, CPU thinking time and CPU
 * table talk. Pure functions only, so they are easy to test.
 */

export const IS_TEST = !!(
  process.env.VITEST ||
  process.env.VITEST_WORKER_ID ||
  process.env.NODE_ENV === 'test'
);

/**
 * Defaults for a table nobody configured (e.g. created by a test or an old
 * client). The join screen sends its own options for new tables.
 */
export const DEFAULT_SETTINGS = Object.freeze({
  mode: 'cash', // 'cash' | 'tournament'
  smallBlind: 10,
  bigBlind: 20,
  startingStack: 1500,
  turnSeconds: 0, // 0 = no shot clock
  autoDeal: false, // deal the next hand automatically
  cpuRebuy: false, // busted CPUs buy back in (cash games)
  levelHands: 8, // tournament: hands per blind level
  speed: 'normal' // 'normal' | 'fast' (CPU thinking time + pause between hands)
});

const pickNum = (v, min, max, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

/** Validate table options from a client; anything odd falls back to the default. */
export function sanitizeSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_SETTINGS;
  const bigBlind = pickNum(r.bigBlind, 2, 100000, d.bigBlind);
  let smallBlind = pickNum(r.smallBlind, 1, 100000, Math.max(1, Math.floor(bigBlind / 2)));
  if (smallBlind >= bigBlind) smallBlind = Math.max(1, Math.floor(bigBlind / 2));
  return {
    mode: r.mode === 'tournament' ? 'tournament' : 'cash',
    smallBlind,
    bigBlind,
    startingStack: pickNum(
      r.startingStack,
      bigBlind * 10,
      bigBlind * 1000,
      Math.max(d.startingStack, bigBlind * 50)
    ),
    turnSeconds: [0, 15, 20, 30, 45, 60].includes(Number(r.turnSeconds))
      ? Number(r.turnSeconds)
      : d.turnSeconds,
    autoDeal: r.autoDeal === undefined ? d.autoDeal : !!r.autoDeal,
    cpuRebuy: r.cpuRebuy === undefined ? d.cpuRebuy : !!r.cpuRebuy,
    levelHands: pickNum(r.levelHands, 3, 50, d.levelHands),
    speed: r.speed === 'fast' ? 'fast' : 'normal'
  };
}

/** What clients get to see of the settings. */
export function publicSettings(s) {
  return {
    mode: s.mode,
    startingStack: s.startingStack,
    turnSeconds: s.turnSeconds,
    autoDeal: s.autoDeal,
    levelHands: s.levelHands,
    speed: s.speed
  };
}

/** Round to a "chip-friendly" number (1, 2, 5 × 10^n steps). */
function nice(n) {
  const mag = 10 ** Math.floor(Math.log10(n));
  const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  const unit = steps.find((s) => s * mag >= n) * mag;
  return Math.round(unit);
}

/**
 * Tournament blinds for `level` (1-based): roughly +50% per level, rounded
 * to tidy numbers. Returns [smallBlind, bigBlind].
 */
export function blindsForLevel(level, baseSmall, baseBig) {
  if (level <= 1) return [baseSmall, baseBig];
  const big = nice(baseBig * 1.5 ** (level - 1));
  const small = Math.max(baseSmall, Math.round(big / 2));
  return [small, big];
}

/** How long a CPU "thinks" before acting (ms). Harder spots take longer. */
export function thinkingTimeMs({
  speed = 'normal',
  toCall = 0,
  pot = 0,
  chips = 1,
  random = Math.random
} = {}) {
  if (IS_TEST) return 15;
  const base = speed === 'fast' ? 350 : 800;
  const spread = speed === 'fast' ? 400 : 1100;
  let ms = base + random() * spread;
  // Big decisions (a large bet or a shove to call) get a longer pause.
  if (toCall > 0 && toCall >= Math.min(chips, pot) * 0.5) ms += speed === 'fast' ? 300 : 900;
  return Math.round(ms);
}

/** Pause between hands (ms), longer after a showdown so people can see it. */
export function dealDelayMs({ speed = 'normal', showdown = false, first = false } = {}) {
  if (IS_TEST) return 15;
  if (first) return 2500;
  const base = speed === 'fast' ? 2500 : 4000;
  return base + (showdown ? 1500 : 0);
}

const LINES = {
  win: [
    'Yee-haw!',
    "Pleasure doin' business.",
    "Read 'em and weep.",
    'Much obliged, partners.',
    "The cards don't lie.",
    "That's how we do it out west."
  ],
  bigLoss: ["Well, I'll be...", 'Dang river.', 'That stings worse than a scorpion.', 'Next time, partner.'],
  busted: ["I'm plumb out. Good game, folks.", "Reckon I'll mosey on.", 'Cleaned me out, fair and square.'],
  greet: ['Howdy, partners.', "Evenin'.", 'Deal me in.', 'Mind if I sit a spell?']
};

/** A line of CPU table talk for a moment, or null to stay quiet. */
export function botLine(kind, random = Math.random) {
  const lines = LINES[kind];
  if (!lines) return null;
  return lines[Math.floor(random() * lines.length)];
}
