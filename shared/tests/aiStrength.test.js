import { describe, it, expect } from 'vitest';
import { GameTable } from '../src/gameEngine.js';
import { decideAction } from '../src/ai/aiEngine.js';
import { recordHand, readOf, emptyStats } from '../src/ai/opponentModel.js';
import { chenScore } from '../src/ai/aiDecision.js';

const BB = 20;
const STACK = 2000;

/** Heads-up match: CPU vs a fixed exploit strategy. Returns the CPU's bb/100. */
function versus(difficulty, exploit, hands = 600) {
  const t = new GameTable({
    tableId: 'x',
    smallBlind: 10,
    bigBlind: BB,
    startingStack: STACK,
    tutorialSeed: `t-${exploit}`
  });
  t.addPlayer({ id: 'bot', name: 'Vera', seat: 0 });
  t.addPlayer({ id: 'human', name: 'H', seat: 1 });
  const reads = {};
  let net = 0;
  for (let h = 0; h < hands; h += 1) {
    t.players.forEach((p) => (p.chips = STACK));
    t.startHand();
    let g = 0;
    while (t.inHand && g < 200) {
      g += 1;
      const id = t.nextActorId();
      const p = t.playerById(id);
      const toCall = t.currentBet - p.contributions[t.street];
      if (id === 'human') {
        if (exploit === 'shove') t.applyAction(id, 'allin');
        else t.applyAction(id, toCall > 0 ? 'call' : 'check');
      } else {
        const d = decideAction(t, id, { difficulty, persona: 'Vera', seed: `${h}:${g}`, reads });
        t.applyAction(id, d.action, d.amount || 0);
      }
    }
    recordHand(reads, t);
    net += t.playerById('bot').chips - STACK;
  }
  return net / BB / (hands / 100);
}

describe('CPU strength', () => {
  it('rates starting hands sensibly (Chen formula)', () => {
    expect(chenScore(['As', 'Ad'])).toBe(20);
    expect(chenScore(['As', 'Ks'])).toBe(12);
    expect(chenScore(['7c', '2d'])).toBeLessThan(2);
    expect(chenScore(['Js', 'Ts'])).toBeGreaterThan(chenScore(['Jd', '4c']));
  });

  it('every difficulty beats a player who shoves every hand', () => {
    for (const diff of ['easy', 'normal', 'hard']) expect(versus(diff, 'shove')).toBeGreaterThan(50);
  });

  it('every difficulty beats a calling station', () => {
    for (const diff of ['easy', 'normal', 'hard']) expect(versus(diff, 'station')).toBeGreaterThan(50);
  });

  it('learns who is a maniac', () => {
    const stats = { maniac: emptyStats(), rock: emptyStats() };
    stats.maniac = { hands: 40, vpip: 38, pfr: 36, aggr: 60, passive: 2, allins: 30 };
    stats.rock = { hands: 40, vpip: 6, pfr: 4, aggr: 5, passive: 4, allins: 1 };
    expect(readOf(stats.maniac).betWidth).toBeGreaterThan(0.8);
    expect(readOf(stats.rock).betWidth).toBeLessThan(0.3);
  });
});
