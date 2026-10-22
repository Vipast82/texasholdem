import { DECK, SUITS, parseCard } from './cards.js';

/**
 * Fast best-hand ranking for 5-7 cards, used by the Monte-Carlo simulations
 * (AI decisions and the odds HUD), which rank thousands of hands per decision.
 *
 * Single pass over rank/suit counts instead of trying all 21 five-card combos.
 * Returns the same { category, tiebreakers } as handEvaluator.evaluateBest
 * (minus the `cards` list), so results compare with compareRanked().
 */

const INFO = new Map(DECK.map((c) => [c, { r: parseCard(c).value, s: SUITS.indexOf(c.slice(-1)) }]));

/** Highest straight in a rank bitmask (bit r set for rank r), or 0. Ace plays low too. */
function straightHigh(mask) {
  let m = mask;
  if (m & (1 << 14)) m |= 1 << 1;
  for (let h = 14; h >= 5; h -= 1) {
    if (((m >> (h - 4)) & 0b11111) === 0b11111) return h;
  }
  return 0;
}

function topRanks(mask, n) {
  const out = [];
  for (let r = 14; r >= 2 && out.length < n; r -= 1) if (mask & (1 << r)) out.push(r);
  return out;
}

export function rankCards(cards) {
  const counts = new Array(15).fill(0);
  const suitCounts = [0, 0, 0, 0];
  const suitMasks = [0, 0, 0, 0];
  let mask = 0;
  for (const c of cards) {
    const info = INFO.get(c);
    if (!info) throw new Error(`Invalid card: ${c}`);
    counts[info.r] += 1;
    suitCounts[info.s] += 1;
    suitMasks[info.s] |= 1 << info.r;
    mask |= 1 << info.r;
  }

  let flushSuit = -1;
  for (let s = 0; s < 4; s += 1) if (suitCounts[s] >= 5) flushSuit = s;
  if (flushSuit >= 0) {
    const sf = straightHigh(suitMasks[flushSuit]);
    if (sf) return { category: sf === 14 ? 9 : 8, tiebreakers: [sf] };
  }

  let quad = 0;
  const trips = [];
  const pairs = [];
  const singles = [];
  for (let r = 14; r >= 2; r -= 1) {
    const n = counts[r];
    if (n === 4) quad = r;
    else if (n === 3) trips.push(r);
    else if (n === 2) pairs.push(r);
    else if (n === 1) singles.push(r);
  }

  if (quad) {
    let kicker = 0;
    for (let r = 14; r >= 2; r -= 1) {
      if (r !== quad && counts[r] > 0) {
        kicker = r;
        break;
      }
    }
    return { category: 7, tiebreakers: [quad, kicker] };
  }
  if (trips.length && (trips.length > 1 || pairs.length)) {
    return { category: 6, tiebreakers: [trips[0], Math.max(trips[1] || 0, pairs[0] || 0)] };
  }
  if (flushSuit >= 0) return { category: 5, tiebreakers: topRanks(suitMasks[flushSuit], 5) };
  const st = straightHigh(mask);
  if (st) return { category: 4, tiebreakers: [st] };
  if (trips.length) return { category: 3, tiebreakers: [trips[0], ...singles.slice(0, 2)] };
  if (pairs.length >= 2) {
    const kicker = Math.max(pairs[2] || 0, singles[0] || 0);
    return { category: 2, tiebreakers: [pairs[0], pairs[1], kicker] };
  }
  if (pairs.length === 1) return { category: 1, tiebreakers: [pairs[0], ...singles.slice(0, 3)] };
  return { category: 0, tiebreakers: singles.slice(0, 5) };
}

/** Compare two rankCards results: >0 if a wins, <0 if b wins, 0 for a tie. */
export function compareFast(a, b) {
  if (a.category !== b.category) return a.category - b.category;
  const len = Math.max(a.tiebreakers.length, b.tiebreakers.length);
  for (let i = 0; i < len; i += 1) {
    const d = (a.tiebreakers[i] || 0) - (b.tiebreakers[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}
