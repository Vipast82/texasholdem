import { describe, it, expect } from 'vitest';
import { computePots, distributePot, resolveHand } from '../src/potSplit.js';

describe('computePots', () => {
  it('single pot when all committed equally', () => {
    const pots = computePots([
      { id: 'a', committed: 100 },
      { id: 'b', committed: 100 }
    ]);
    expect(pots).toEqual([{ amount: 200, eligible: ['a', 'b'] }]);
  });

  it('main + side pot with one all-in', () => {
    const pots = computePots([
      { id: 'a', committed: 100 },
      { id: 'b', committed: 500 },
      { id: 'c', committed: 100 }
    ]);
    // Level 1: 100 * 3 = 300 (all eligible)
    // Level 2: 400 * 1 = 400 (only b)
    expect(pots[0]).toEqual({ amount: 300, eligible: ['a', 'b', 'c'] });
    expect(pots[1]).toEqual({ amount: 400, eligible: ['b'] });
  });

  it('three-way split with two side pots', () => {
    const pots = computePots([
      { id: 'a', committed: 50 },
      { id: 'b', committed: 150 },
      { id: 'c', committed: 300 }
    ]);
    // Level 1: 50*3 = 150 (a,b,c)
    // Level 2: 100*2 = 200 (b,c)
    // Level 3: 150*1 = 150 (c)
    expect(pots).toEqual([
      { amount: 150, eligible: ['a', 'b', 'c'] },
      { amount: 200, eligible: ['b', 'c'] },
      { amount: 150, eligible: ['c'] }
    ]);
  });

  it('ignores players with zero commitment', () => {
    const pots = computePots([
      { id: 'a', committed: 100 },
      { id: 'b', committed: 0 }
    ]);
    expect(pots).toEqual([{ amount: 100, eligible: ['a'] }]);
  });
});

describe('distributePot', () => {
  it('splits evenly', () => {
    expect(distributePot(100, ['a', 'b'])).toEqual({ a: 50, b: 50 });
  });

  it('gives the odd chip to the first winner', () => {
    expect(distributePot(101, ['a', 'b'])).toEqual({ a: 51, b: 50 });
  });

  it('single winner takes it all', () => {
    expect(distributePot(250, ['a'])).toEqual({ a: 250 });
  });

  it('requires at least one winner', () => {
    expect(() => distributePot(100, [])).toThrow();
  });
});

describe('resolveHand', () => {
  it('awards each pot to its eligible winners', () => {
    const payouts = resolveHand(
      [
        { id: 'a', committed: 100 },
        { id: 'b', committed: 500 }
      ],
      (eligible) => (eligible.includes('a') ? ['a'] : ['b'])
    );
    // Level 1: 200 (a and b in, but a wins) -> a gets 200
    // Level 2: 400 (b only) -> b gets 400
    expect(payouts.payouts).toEqual({ a: 200, b: 400 });
  });

  it('splits the main pot evenly among co-winners', () => {
    const payouts = resolveHand(
      [
        { id: 'a', committed: 100 },
        { id: 'b', committed: 100 }
      ],
      () => ['a', 'b']
    );
    expect(payouts.payouts).toEqual({ a: 100, b: 100 });
  });
});
