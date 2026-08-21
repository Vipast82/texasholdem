import { describe, it, expect } from 'vitest';
import {
  limitBetSize,
  maxRaisesPerStreet,
  maxBet,
  minRaise,
  validateAction
} from '../src/bettingRules.js';

describe('limitBetSize', () => {
  it('preflop = BB', () => {
    expect(limitBetSize('preflop', 20)).toBe(20);
  });
  it('postflop = 2*BB', () => {
    expect(limitBetSize('flop', 20)).toBe(40);
    expect(limitBetSize('turn', 20)).toBe(40);
    expect(limitBetSize('river', 20)).toBe(40);
  });
});

describe('maxRaisesPerStreet', () => {
  it('limit game has a cap', () => {
    expect(maxRaisesPerStreet('limit', 'preflop')).toBe(4);
    expect(maxRaisesPerStreet('limit', 'flop')).toBe(6);
  });
  it('no-limit and pot-limit are unlimited', () => {
    expect(maxRaisesPerStreet('no-limit', 'preflop')).toBe(Infinity);
    expect(maxRaisesPerStreet('pot-limit', 'flop')).toBe(Infinity);
  });
});

describe('minRaise', () => {
  it('opening bet is the big blind', () => {
    expect(minRaise(0, 20, 0)).toBe(20);
  });
  it('min raise is current bet + max(lastRaise, BB)', () => {
    expect(minRaise(40, 20, 0)).toBe(60);
    expect(minRaise(100, 20, 60)).toBe(160);
  });
});

describe('maxBet', () => {
  it('no-limit is null (unbounded)', () => {
    expect(maxBet('no-limit', 300, 'flop', 20, 40)).toBeNull();
  });
  it('limit: currentBet + street bet size', () => {
    expect(maxBet('limit', 300, 'preflop', 20, 20)).toBe(40);
    expect(maxBet('limit', 300, 'flop', 20, 40)).toBe(80);
  });
  it('pot-limit: pot + max(currentBet, minRaise)', () => {
    // pot 300, current 40, min raise = 40+20=60, so max = 300 + 60 = 360
    expect(maxBet('pot-limit', 300, 'flop', 20, 40)).toBe(360);
  });
});

describe('validateAction', () => {
  const base = {
    street: 'preflop',
    currentBet: 20,
    maxBet: null,
    minRaiseTarget: 40,
    raiseCount: 0,
    maxRaises: Infinity,
    player: { chips: 100, committedThisStreet: 0, isAllIn: false, hasFolded: false }
  };

  it('allows fold always', () => {
    expect(validateAction(base, 'fold').ok).toBe(true);
  });

  it('forbids check when there is a bet', () => {
    expect(validateAction(base, 'check').ok).toBe(false);
  });

  it('allows call', () => {
    expect(validateAction(base, 'call').ok).toBe(true);
  });

  it('forbids bet when a bet is already out', () => {
    // currentBet=20, bet requires minRaiseTarget
    const res = validateAction(base, 'bet', 20);
    // bet is legal when amount >= minRaiseTarget? No: minRaiseTarget is 40
    expect(res.ok).toBe(false);
  });

  it('allows raise above min', () => {
    expect(validateAction(base, 'raise', 40).ok).toBe(true);
  });

  it('forbids raise below min', () => {
    expect(validateAction(base, 'raise', 30).ok).toBe(false);
  });

  it('forbids action when folded', () => {
    const s = { ...base, player: { ...base.player, hasFolded: true } };
    expect(validateAction(s, 'call').ok).toBe(false);
  });

  it('forbids action when all-in', () => {
    const s = { ...base, player: { ...base.player, isAllIn: true } };
    expect(validateAction(s, 'call').ok).toBe(false);
  });

  it('rejects unknown actions', () => {
    expect(validateAction(base, 'dance').ok).toBe(false);
  });
});
