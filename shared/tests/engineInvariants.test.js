import { describe, it, expect } from 'vitest';
import { GameTable } from '../src/gameEngine.js';
import { decideAction } from '../src/ai/aiEngine.js';
import { Rng } from '../src/rng.js';

const chipTotal = (t) => t.players.reduce((s, p) => s + p.chips, 0) + t.pot;

function headsUp(stackA = 1500, stackB = 1500) {
  const t = new GameTable({ smallBlind: 10, bigBlind: 20, startingStack: 1500 });
  t.addPlayer({ id: 'A', seat: 0 });
  t.addPlayer({ id: 'B', seat: 1 });
  t.playerById('A').chips = stackA;
  t.playerById('B').chips = stackB;
  return t;
}

/** A random legal action for whoever is next (mix of AI and raw random play). */
function randomAction(t, id, rng) {
  if (rng.next() < 0.5) {
    const d = decideAction(t, id, { difficulty: rng.pick(['easy', 'normal']), rng });
    return [d.action, d.amount || 0];
  }
  const p = t.playerById(id);
  const toCall = Math.max(0, t.currentBet - p.contributions[t.street]);
  const r = rng.next();
  if (r < 0.15) return ['fold', 0];
  if (r < 0.25) return ['allin', 0];
  if (r < 0.45) {
    const min = t.currentBet === 0 ? t.bigBlind : t.currentBet + Math.max(t.lastRaiseIncrement, t.bigBlind);
    const target = min + rng.nextInt(3) * t.bigBlind;
    if (target - p.contributions[t.street] < p.chips) return [t.currentBet === 0 ? 'bet' : 'raise', target];
  }
  return [toCall > 0 ? 'call' : 'check', 0];
}

describe('GameTable rules', () => {
  it('heads-up: the button posts the small blind and acts first preflop, last postflop', () => {
    const t = headsUp();
    t.startHand();
    const button = t.seatToPlayer.get(t.dealerSeat);
    const other = button === 'A' ? 'B' : 'A';
    expect(t.playerById(button).contributions.preflop).toBe(10);
    expect(t.playerById(other).contributions.preflop).toBe(20);
    expect(t.nextActorId()).toBe(button);
    t.applyAction(button, 'call');
    t.applyAction(other, 'check');
    expect(t.street).toBe('flop');
    expect(t.nextActorId()).toBe(other);
  });

  it('heads-up: an all-in shove still lets the opponent call or fold', () => {
    const t = headsUp();
    t.startHand();
    const first = t.nextActorId();
    t.applyAction(first, 'allin');
    expect(t.inHand).toBe(true);
    const other = first === 'A' ? 'B' : 'A';
    expect(t.nextActorId()).toBe(other);
    t.applyAction(other, 'fold');
    expect(t.inHand).toBe(false);
    expect(t.playerById(first).chips).toBe(1520);
  });

  it('a short-stacked blind only puts what it has into the pot', () => {
    const t = headsUp(1500, 5);
    const before = chipTotal(t);
    t.startHand();
    expect(chipTotal(t)).toBe(before);
  });

  it('a hand where both blinds are all-in runs out instead of stalling', () => {
    // Button (B) posts its whole 10-chip stack as SB; A has only 5 for the BB.
    const t = headsUp(5, 10);
    t.startHand();
    expect(t.inHand).toBe(false);
    expect(t.community).toHaveLength(5);
    expect(chipTotal(t)).toBe(15);
  });

  it('the hand continues when the last player still to act leaves', () => {
    const t = new GameTable({ smallBlind: 10, bigBlind: 20 });
    ['A', 'B', 'C'].forEach((id, seat) => t.addPlayer({ id, seat }));
    t.startHand();
    t.applyAction(t.nextActorId(), 'call');
    t.applyAction(t.nextActorId(), 'call');
    const before = chipTotal(t);
    const leaver = t.nextActorId();
    const leaverChips = t.playerById(leaver).chips;
    t.removePlayer(leaver);
    expect(t.inHand).toBe(true);
    expect(t.street).toBe('flop');
    expect(t.nextActorId()).not.toBeNull();
    // The leaver's blind stays in the pot as dead money.
    expect(chipTotal(t)).toBe(before - leaverChips);
  });

  it('rejects non-numeric or fractional bet sizes', () => {
    const t = headsUp();
    t.startHand();
    const id = t.nextActorId();
    expect(() => t.applyAction(id, 'raise', 'abc')).toThrow(/whole number/);
    expect(() => t.applyAction(id, 'raise', 40.5)).toThrow(/whole number/);
    t.applyAction(id, 'raise', '60');
    expect(t.pot).toBe(80);
    expect(typeof t.pot).toBe('number');
  });

  it('clears the next actor once the hand is over', () => {
    const t = headsUp();
    t.startHand();
    t.applyAction(t.nextActorId(), 'fold');
    expect(t.snapshot().nextActorId).toBeNull();
    expect(t.players.every((p) => !p.toAct)).toBe(true);
  });

  it('a short all-in raise does not shrink the minimum raise', () => {
    const t = new GameTable({ smallBlind: 10, bigBlind: 20 });
    ['A', 'B', 'C'].forEach((id, seat) => t.addPlayer({ id, seat }));
    t.startHand();
    const utg = t.nextActorId();
    t.applyAction(utg, 'raise', 100); // raise of 80
    const short = t.nextActorId();
    t.playerById(short).chips = 110 - t.playerById(short).contributions.preflop; // all-in to 110
    t.applyAction(short, 'allin');
    expect(t.currentBet).toBe(110);
    expect(t.lastRaiseIncrement).toBe(80);
  });
});

describe('GameTable invariants under random play', () => {
  it('conserves chips and never stalls across hundreds of random hands', () => {
    const rng = new Rng('engine-fuzz');
    let hands = 0;
    for (let table = 0; table < 120; table += 1) {
      const t = new GameTable({
        smallBlind: 10,
        bigBlind: 20,
        startingStack: 1500,
        tutorialSeed: `fuzz-${table}`
      });
      const n = 2 + rng.nextInt(5);
      const seats = rng.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, n);
      seats.forEach((seat, i) => {
        t.addPlayer({ id: `p${i}`, seat });
        t.playerById(`p${i}`).chips = 5 + rng.nextInt(800);
      });
      let expected = chipTotal(t);

      for (let h = 0; h < 25; h += 1) {
        if (t.players.filter((p) => p.chips > 0).length < 2) break;
        t.startHand();
        hands += 1;
        let guard = 0;
        while (t.inHand) {
          guard += 1;
          expect(guard).toBeLessThan(500);
          // Occasionally someone leaves mid-hand; their chips leave with them.
          if (t.players.length > 2 && rng.next() < 0.01) {
            const leaver = rng.pick(t.players);
            expected -= leaver.chips;
            t.removePlayer(leaver.id);
            expect(chipTotal(t)).toBe(expected);
            continue;
          }
          const id = t.nextActorId();
          expect(id, `stalled on ${t.street} with pot ${t.pot}`).not.toBeNull();
          const [action, amount] = randomAction(t, id, rng);
          t.applyAction(id, action, amount);
          expect(chipTotal(t)).toBe(expected);
          for (const p of t.players) expect(p.chips).toBeGreaterThanOrEqual(0);
        }
        expect(t.pot).toBe(0);
        expect(t.nextActorId()).toBeNull();
        expect(chipTotal(t)).toBe(expected);
      }
    }
    expect(hands).toBeGreaterThan(500);
  });
});
