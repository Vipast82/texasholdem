import { describe, it, expect } from 'vitest';
import { Rng, createShuffledDeck } from '../src/rng.js';
import { DECK } from '../src/cards.js';

describe('Rng', () => {
  it('rejects a missing seed', () => {
    expect(() => new Rng()).toThrow();
  });

  it('produces deterministic sequences for the same seed', () => {
    const a = new Rng('saloon');
    const b = new Rng('saloon');
    for (let i = 0; i < 50; i += 1) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('produces different sequences for different seeds', () => {
    const a = new Rng('seed-one');
    const b = new Rng('seed-two');
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('stays within [0, 1)', () => {
    const r = new Rng('bounds');
    for (let i = 0; i < 1000; i += 1) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('nextInt covers the range', () => {
    const r = new Rng('range');
    const seen = new Set();
    for (let i = 0; i < 200; i += 1) seen.add(r.nextInt(6));
    expect(seen).toEqual(new Set([0, 1, 2, 3, 4, 5]));
  });

  it('intBetween is inclusive', () => {
    const r = new Rng('between');
    const seen = new Set();
    for (let i = 0; i < 200; i += 1) {
      const v = r.intBetween(2, 5);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(5);
      seen.add(v);
    }
    expect(seen).toEqual(new Set([2, 3, 4, 5]));
  });
});

describe('createShuffledDeck', () => {
  it('is deterministic for a given seed', () => {
    expect(createShuffledDeck('saloon')).toEqual(createShuffledDeck('saloon'));
  });

  it('contains every card exactly once', () => {
    const deck = createShuffledDeck('saloon');
    expect(deck).toHaveLength(52);
    expect(new Set(deck).size).toBe(52);
    expect(deck.sort()).toEqual([...DECK].sort());
  });

  it('actually shuffles (not identity order)', () => {
    const deck = createShuffledDeck('saloon');
    expect(deck).not.toEqual(DECK);
  });
});
