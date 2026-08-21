import { parseCard, assertValidCards } from './cards.js';

/**
 * 5-card hand evaluator.
 *
 * A ranked hand is:
 *   { category: 0..9, tiebreakers: [v1, v2, ...], cards: [5 card strings] }
 *
 * Categories (higher = better), 14 = Ace, 2 = Two:
 *   9: royal flush        4: straight
 *   8: straight flush     3: three of a kind
 *   7: four of a kind     2: two pair
 *   6: full house         1: one pair
 *   5: flush              0: high card
 *
 * compareRanked() orders by category desc, then tiebreakers desc.
 */

export const CATEGORIES = {
  HIGH_CARD: 0,
  ONE_PAIR: 1,
  TWO_PAIR: 2,
  THREE_OF_A_KIND: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  QUADS: 7,
  STRAIGHT_FLUSH: 8,
  ROYAL_FLUSH: 9
};

const CATEGORY_NAMES_EN = {
  0: 'High card',
  1: 'Pair',
  2: 'Two pair',
  3: 'Three of a kind',
  4: 'Straight',
  5: 'Flush',
  6: 'Full house',
  7: 'Four of a kind',
  8: 'Straight flush',
  9: 'Royal flush'
};

const CATEGORY_NAMES_ES = {
  0: 'Carta alta',
  1: 'Pareja',
  2: 'Doble pareja',
  3: 'Trío',
  4: 'Escalera',
  5: 'Póker de color',
  6: 'Full house',
  7: 'Póker',
  8: 'Escalera de color',
  9: 'Escalera real'
};

export function categoryName(category, lang = 'en') {
  const table = lang === 'es' ? CATEGORY_NAMES_ES : CATEGORY_NAMES_EN;
  return table[category] || String(category);
}

/** Rank exactly five cards. Returns a ranked hand. */
export function evaluate5(cards) {
  if (cards.length !== 5) throw new Error('evaluate5 requires exactly 5 cards');
  assertValidCards(cards);
  const values = cards.map((c) => parseCard(c).value).sort((a, b) => b - a);
  const suits = cards.map((c) => parseCard(c).suit);

  const isFlush = suits.every((s) => s === suits[0]);

  // Straight: 5 distinct values each one apart. Wheel: A 5 4 3 2 (ace low).
  let straightHigh = 0;
  const distinct = [...new Set(values)];
  if (distinct.length === 5) {
    if (distinct[0] - distinct[4] === 4) {
      straightHigh = distinct[0];
    } else if (
      distinct[0] === 14 &&
      distinct[1] === 5 &&
      distinct[2] === 4 &&
      distinct[3] === 3 &&
      distinct[4] === 2
    ) {
      straightHigh = 5; // wheel: ace plays low
    }
  }

  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  // Groups sorted by count desc, then value desc: [[count, value], ...]
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  if (isFlush && straightHigh) {
    return {
      category: straightHigh === 14 ? CATEGORIES.ROYAL_FLUSH : CATEGORIES.STRAIGHT_FLUSH,
      tiebreakers: [straightHigh],
      cards
    };
  }
  if (groups[0][1] === 4) {
    return { category: CATEGORIES.QUADS, tiebreakers: [groups[0][0], groups[1][0]], cards };
  }
  if (groups[0][1] === 3 && groups[1][1] === 2) {
    return { category: CATEGORIES.FULL_HOUSE, tiebreakers: [groups[0][0], groups[1][0]], cards };
  }
  if (isFlush) {
    return { category: CATEGORIES.FLUSH, tiebreakers: values, cards };
  }
  if (straightHigh) {
    return { category: CATEGORIES.STRAIGHT, tiebreakers: [straightHigh], cards };
  }
  if (groups[0][1] === 3) {
    return {
      category: CATEGORIES.THREE_OF_A_KIND,
      tiebreakers: [groups[0][0], groups[1][0], groups[2][0]],
      cards
    };
  }
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    return {
      category: CATEGORIES.TWO_PAIR,
      tiebreakers: [groups[0][0], groups[1][0], groups[2][0]],
      cards
    };
  }
  if (groups[0][1] === 2) {
    return {
      category: CATEGORIES.ONE_PAIR,
      tiebreakers: [groups[0][0], groups[1][0], groups[2][0], groups[3][0]],
      cards
    };
  }
  return { category: CATEGORIES.HIGH_CARD, tiebreakers: values, cards };
}

/**
 * Compare two ranked hands. Returns >0 if a wins, <0 if b wins, 0 for a tie.
 */
export function compareRanked(a, b) {
  if (a.category !== b.category) return a.category - b.category;
  const len = Math.max(a.tiebreakers.length, b.tiebreakers.length);
  for (let i = 0; i < len; i += 1) {
    const av = a.tiebreakers[i] || 0;
    const bv = b.tiebreakers[i] || 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

/**
 * Rank up to 7 cards (typically 5 community + 2 hole) by trying all 5-card
 * combinations and keeping the best.
 */
export function evaluateBest(cards) {
  if (cards.length < 5 || cards.length > 7) {
    throw new Error('evaluateBest requires 5-7 cards');
  }
  assertValidCards(cards);
  let best = null;
  const n = cards.length;
  for (let i = 0; i < n - 4; i += 1) {
    for (let j = i + 1; j < n - 3; j += 1) {
      for (let k = j + 1; k < n - 2; k += 1) {
        for (let l = k + 1; l < n - 1; l += 1) {
          for (let m = l + 1; m < n; m += 1) {
            const combo = [cards[i], cards[j], cards[k], cards[l], cards[m]];
            const candidate = evaluate5(combo);
            if (!best || compareRanked(candidate, best) > 0) best = candidate;
          }
        }
      }
    }
  }
  return best;
}

/**
 * Evaluate all players' best hands against the community board and pick the
 * winning group (ties split).
 *
 * @param {object} hands - map playerId -> 2 hole cards
 * @param {string[]} board - community cards (flop or more)
 * @param {string[]} playerIds - eligible players (still in the hand)
 * @returns {{winnerIds: string[], ranked: object, all: object}}
 */
export function showdown(hands, board, playerIds) {
  if (board.length < 3) throw new Error('showdown requires at least the flop');
  if (!playerIds.length) throw new Error('showdown requires at least one player');
  const all = {};
  for (const id of playerIds) {
    if (!hands[id] || hands[id].length !== 2) throw new Error(`missing hole cards for ${id}`);
    all[id] = evaluateBest([...board, ...hands[id]]);
  }
  let bestRank = null;
  for (const id of playerIds) {
    if (!bestRank || compareRanked(all[id], bestRank) > 0) bestRank = all[id];
  }
  const winnerIds = playerIds.filter((id) => compareRanked(all[id], bestRank) === 0);
  return { winnerIds, ranked: bestRank, all };
}
