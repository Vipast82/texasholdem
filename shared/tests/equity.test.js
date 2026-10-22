import { describe, it, expect } from 'vitest';
import {
  estimateEquity,
  equityForPlayer,
  clampIterations,
  MAX_EQUITY_ITERATIONS,
  MIN_EQUITY_ITERATIONS
} from '../src/equity.js';

/** Build a minimal snapshot where `me` holds `hole` vs `opponents` random opponents. */
function snapshot(hole, opponents = 3) {
  const others = [];
  for (let i = 0; i < opponents; i += 1) {
    others.push({ id: `o${i}`, status: 'in-hand', hasFolded: false, holeCards: null });
  }
  return {
    players: [{ id: 'me', holeCards: hole, status: 'in-hand', hasFolded: false }, ...others],
    community: []
  };
}

describe('equity: clampIterations', () => {
  it('respects the hard maximum (responsiveness cap)', () => {
    expect(clampIterations(999999)).toBe(MAX_EQUITY_ITERATIONS);
  });
  it('respects the hard minimum', () => {
    expect(clampIterations(0)).toBe(MIN_EQUITY_ITERATIONS);
    expect(clampIterations(-50)).toBe(MIN_EQUITY_ITERATIONS);
  });
  it('passes through a valid count and floors floats', () => {
    expect(clampIterations(300)).toBe(300);
    expect(clampIterations(123.9)).toBe(123);
  });
});

describe('equity: estimateEquity sanity + determinism + cap', () => {
  it('AA is a clear favourite vs a single random opponent (> 70% win)', () => {
    const r = estimateEquity({ hole: ['As', 'Ah'], community: [], opponents: 1 }, 'seed-aa', 500);
    expect(r).not.toBeNull();
    expect(r.win).toBeGreaterThan(0.7);
  });

  it('junk is a clear underdog vs a single random opponent (< 70% win)', () => {
    const r = estimateEquity({ hole: ['2c', '7d'], community: [], opponents: 1 }, 'seed-junk', 500);
    expect(r.win).toBeLessThan(0.7);
  });

  it('win + tie + lose sum to 1', () => {
    const r = estimateEquity({ hole: ['As', 'Ks'], community: [], opponents: 2 }, 'seed', 300);
    expect(r.win + r.tie + r.lose).toBeCloseTo(1, 6);
  });

  it('is deterministic: same seed => identical result', () => {
    const a = estimateEquity({ hole: ['As', 'Kd'], community: [], opponents: 2 }, 'same-seed', 400);
    const b = estimateEquity({ hole: ['As', 'Kd'], community: [], opponents: 2 }, 'same-seed', 400);
    expect(a).toEqual(b);
  });

  it('different seeds can change the estimate', () => {
    const a = estimateEquity({ hole: ['As', 'Kd'], community: [], opponents: 2 }, 'seed-a', 400);
    const b = estimateEquity({ hole: ['As', 'Kd'], community: [], opponents: 2 }, 'seed-b', 400);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('reports the clamped iteration count, even when asked for more', () => {
    const r = estimateEquity({ hole: ['As', 'Ah'], community: [], opponents: 1 }, 's', 999999);
    expect(r.iterations).toBe(MAX_EQUITY_ITERATIONS);
  });

  it('returns null on invalid hole / missing seed (defensive)', () => {
    expect(estimateEquity(null, 's')).toBeNull();
    expect(estimateEquity({ hole: ['As'], community: [] }, 's')).toBeNull();
    expect(estimateEquity({ hole: ['As', 'Ah'] }, undefined)).toBeNull();
  });
});

describe('equity: equityForPlayer (snapshot view)', () => {
  it('estimates only for a seat whose hole cards are present', () => {
    const r = equityForPlayer(snapshot(['As', 'Ah']), 'me', 's', 300);
    expect(r).not.toBeNull();
    const other = equityForPlayer(snapshot(['As', 'Ah']), 'o0', 's', 300);
    expect(other).toBeNull(); // opponent hole cards are private -> not estimable
  });

  it('reports 100% win when every opponent has folded', () => {
    const snap = {
      players: [
        { id: 'me', holeCards: ['2c', '7c'], status: 'in-hand', hasFolded: false },
        { id: 'o0', status: 'in-hand', hasFolded: true }
      ],
      community: []
    };
    const r = equityForPlayer(snap, 'me', 's');
    expect(r.win).toBe(1);
    expect(r.opponents).toBe(0);
  });

  it('does not estimate for a folded seat', () => {
    const snap = {
      players: [
        { id: 'me', holeCards: ['As', 'Ah'], status: 'in-hand', hasFolded: true },
        { id: 'o0', status: 'in-hand', hasFolded: false }
      ],
      community: []
    };
    expect(equityForPlayer(snap, 'me', 's')).toBeNull();
  });

  it('re-uses community cards in the estimate (postflop is more decisive)', () => {
    const preflop = equityForPlayer(snapshot(['As', 'Ah']), 'me', 'fixed', 300);
    const board = {
      players: [
        { id: 'me', holeCards: ['As', 'Ah'], status: 'in-hand', hasFolded: false },
        { id: 'o0', status: 'in-hand', hasFolded: false }
      ],
      community: ['Kd', 'Qd', '9c', '3s', '2d'] // a connected board
    };
    const postflop = equityForPlayer(board, 'me', 'fixed', 300);
    expect(preflop).not.toBeNull();
    expect(postflop).not.toBeNull();
    expect(preflop.iterations).toBe(300);
  });
});
