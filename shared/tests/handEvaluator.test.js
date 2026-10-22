import { describe, it, expect } from 'vitest';
import {
  evaluate5,
  evaluateBest,
  compareRanked,
  showdown,
  CATEGORIES,
  categoryName
} from '../src/handEvaluator.js';

describe('evaluate5 - categories', () => {
  it('high card', () => {
    const r = evaluate5(['2c', '7d', '9h', 'Js', 'Kc']);
    expect(r.category).toBe(CATEGORIES.HIGH_CARD);
  });

  it('one pair, ace kicker', () => {
    const r = evaluate5(['2c', '2d', '7h', '9s', 'Ac']);
    expect(r.category).toBe(CATEGORIES.ONE_PAIR);
    expect(r.tiebreakers).toEqual([2, 14, 9, 7]);
  });

  it('two pair, highest pair first', () => {
    const r = evaluate5(['2c', '2d', 'Qh', 'Qs', '9c']);
    expect(r.category).toBe(CATEGORIES.TWO_PAIR);
    expect(r.tiebreakers).toEqual([12, 2, 9]);
  });

  it('three of a kind', () => {
    const r = evaluate5(['8c', '8d', '8h', '7s', '2c']);
    expect(r.category).toBe(CATEGORIES.THREE_OF_A_KIND);
    expect(r.tiebreakers).toEqual([8, 7, 2]);
  });

  it('straight (ten high)', () => {
    const r = evaluate5(['7c', '8d', '9h', 'Ts', 'Jc']);
    expect(r.category).toBe(CATEGORIES.STRAIGHT);
    expect(r.tiebreakers).toEqual([11]);
  });

  it('wheel straight (ace low)', () => {
    const r = evaluate5(['Ac', '2d', '3h', '4s', '5c']);
    expect(r.category).toBe(CATEGORIES.STRAIGHT);
    expect(r.tiebreakers).toEqual([5]);
  });

  it('flush', () => {
    const r = evaluate5(['2c', '7c', '9c', 'Jc', 'Kc']);
    expect(r.category).toBe(CATEGORIES.FLUSH);
    expect(r.tiebreakers).toEqual([13, 11, 9, 7, 2]);
  });

  it('full house', () => {
    const r = evaluate5(['Kc', 'Kd', 'Kh', '7s', '7c']);
    expect(r.category).toBe(CATEGORIES.FULL_HOUSE);
    expect(r.tiebreakers).toEqual([13, 7]);
  });

  it('four of a kind', () => {
    const r = evaluate5(['9c', '9d', '9h', '9s', 'Ac']);
    expect(r.category).toBe(CATEGORIES.QUADS);
    expect(r.tiebreakers).toEqual([9, 14]);
  });

  it('straight flush', () => {
    const r = evaluate5(['8c', '9c', 'Tc', 'Jc', 'Qc']);
    expect(r.category).toBe(CATEGORIES.STRAIGHT_FLUSH);
    expect(r.tiebreakers).toEqual([12]);
  });

  it('royal flush', () => {
    const r = evaluate5(['Tc', 'Jc', 'Qc', 'Kc', 'Ac']);
    expect(r.category).toBe(CATEGORIES.ROYAL_FLUSH);
    expect(r.tiebreakers).toEqual([14]);
  });

  it('requires exactly 5 cards', () => {
    expect(() => evaluate5(['2c', '3c'])).toThrow();
  });
});

describe('compareRanked', () => {
  it('higher category wins', () => {
    const pair = evaluate5(['2c', '2d', '9h', 'Ts', 'Kc']);
    const high = evaluate5(['3c', '7d', '9h', 'Js', 'Kc']);
    expect(compareRanked(pair, high)).toBeGreaterThan(0);
  });

  it('same category, kicker decides', () => {
    const pairA = evaluate5(['2c', '2d', 'Ah', '9s', '7c']);
    const pairB = evaluate5(['2c', '2h', 'Ks', '9d', '7c']);
    expect(compareRanked(pairA, pairB)).toBeGreaterThan(0);
  });

  it('identical hands tie', () => {
    const a = evaluate5(['2c', '7d', '9h', 'Js', 'Kc']);
    const b = evaluate5(['2c', '7d', '9h', 'Js', 'Kc']);
    expect(compareRanked(a, b)).toBe(0);
  });
});

describe('evaluateBest (7 cards)', () => {
  it('finds the best 5 of 7 (two pair)', () => {
    // KK + 99 + Q kicker -> two pair
    const r = evaluateBest(['2c', '7d', '9h', 'Ks', 'Kd', '9c', 'Qc']);
    expect(r.category).toBe(CATEGORIES.TWO_PAIR);
  });

  it('prefers the flush hidden in 7 over a pair', () => {
    // 5 hearts (2,7,9,J,K) form a flush, which beats the ace pair
    const r = evaluateBest(['2h', '7h', '9h', 'Jh', 'Kh', 'Ac', 'Ad']);
    expect(r.category).toBe(CATEGORIES.FLUSH);
  });

  it('picks straight flush from 7', () => {
    const r = evaluateBest(['8c', '9c', 'Tc', 'Jc', 'Qc', '2d', '3h']);
    expect(r.category).toBe(CATEGORIES.STRAIGHT_FLUSH);
  });
});

describe('showdown', () => {
  it('single winner takes all', () => {
    // a makes a king-high straight (9 T J Q K), b only a jack-high straight
    const hands = { a: ['Qc', 'Kd'], b: ['2h', '3s'] };
    const board = ['9c', 'Td', 'Jh', '8s', '7c'];
    const res = showdown(hands, board, ['a', 'b']);
    expect(res.winnerIds).toEqual(['a']);
  });

  it('splits on a tie (board royal flush)', () => {
    const hands = { a: ['2c', '3d'], b: ['7h', '8s'] };
    const board = ['Tc', 'Jd', 'Qh', 'Ks', 'Ac'];
    const res = showdown(hands, board, ['a', 'b']);
    expect(res.winnerIds).toEqual(['a', 'b']);
  });

  it('requires at least flop', () => {
    expect(() => showdown({ a: ['2c', '3d'] }, ['Ac'], ['a'])).toThrow();
  });
});

describe('categoryName', () => {
  it('english names', () => {
    expect(categoryName(CATEGORIES.ROYAL_FLUSH)).toBe('Royal flush');
    expect(categoryName(CATEGORIES.FULL_HOUSE)).toBe('Full house');
  });

  it('spanish names', () => {
    expect(categoryName(CATEGORIES.ROYAL_FLUSH, 'es')).toBe('Escalera real');
    expect(categoryName(CATEGORIES.FULL_HOUSE, 'es')).toBe('Full house');
  });
});

describe('fast evaluator matches the reference evaluator', () => {
  it('agrees on category and tiebreakers for thousands of random hands', async () => {
    const { rankCards } = await import('../src/fastEval.js');
    const { evaluateBest } = await import('../src/handEvaluator.js');
    const { createShuffledDeck } = await import('../src/rng.js');
    for (let i = 0; i < 4000; i += 1) {
      const deck = createShuffledDeck(`fast-${i}`);
      const n = 5 + (i % 3);
      const cards = deck.slice(0, n);
      const ref = evaluateBest(cards);
      const fast = rankCards(cards);
      expect(fast.category, cards.join(' ')).toBe(ref.category);
      expect(fast.tiebreakers, cards.join(' ')).toEqual(ref.tiebreakers);
    }
  });
});
