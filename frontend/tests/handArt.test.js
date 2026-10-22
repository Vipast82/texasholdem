import { describe, it, expect } from 'vitest';
import { describeHand } from '../src/handStrength.js';
import { characterSvg } from '../src/services/characterArt.js';

describe('describeHand', () => {
  it('names pocket pairs and high cards before the flop', () => {
    expect(describeHand(['As', 'Ad'], [])).toBe('Pair');
    expect(describeHand(['As', 'Kd'], [])).toBe('High card');
  });

  it('uses the board once there are five or more cards', () => {
    expect(describeHand(['As', 'Kd'], ['Ah', 'Kc', '7s'])).toBe('Two pair');
    expect(describeHand(['2h', '9h'], ['Ah', 'Kh', '7h', '3c'])).toBe('Flush');
  });

  it('localizes and survives bad input', () => {
    expect(describeHand(['As', 'Ad'], [], 'es')).toBe('Pareja');
    expect(describeHand(null)).toBeNull();
  });
});

describe('characterSvg', () => {
  it('is stable per name and differs between names', () => {
    expect(characterSvg('Nina')).toBe(characterSvg('Nina'));
    expect(characterSvg('Nina')).not.toBe(characterSvg('Wade'));
    expect(characterSvg('Nina').startsWith('data:image/svg+xml')).toBe(true);
  });
});
