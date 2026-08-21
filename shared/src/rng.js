import { DECK } from './cards.js';

/**
 * Deterministic PRNG.
 *
 * xmur3: string -> 32-bit seed hash (based on Murmur3).
 * mulberry32: 32-bit seed -> fast, well-distributed [0,1) generator.
 *
 * Same seed always produces the same sequence, in Node and in the browser,
 * which is what makes seeded tutorial hands reproducible.
 */
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed) {
    if (seed === undefined || seed === null) {
      throw new Error('Rng requires an explicit seed (determinism is a hard requirement)');
    }
    this.seed = String(seed);
    this._next =
      typeof seed === 'number' ? mulberry32(seed >>> 0) : mulberry32(xmur3(this.seed)());
  }

  /** Uniform float in [0, 1). */
  next() {
    return this._next();
  }

  /** Uniform integer in [0, n). */
  nextInt(n) {
    if (n <= 0) throw new Error('nextInt requires n > 0');
    return Math.floor(this._next() * n);
  }

  /** Inclusive integer in [min, max]. */
  intBetween(min, max) {
    if (max < min) throw new Error('intBetween requires max >= min');
    return min + this.nextInt(max - min + 1);
  }

  /** Fisher-Yates shuffle of an array (returns a new array). */
  shuffle(items) {
    const arr = items.slice();
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = this.nextInt(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** Pick a random element. */
  pick(items) {
    if (!items.length) throw new Error('pick requires a non-empty list');
    return items[this.nextInt(items.length)];
  }
}

/** Create a shuffled 52-card deck from a seed. Deterministic. */
export function createShuffledDeck(seed) {
  return new Rng(seed).shuffle(DECK);
}
