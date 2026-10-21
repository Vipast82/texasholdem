import { describe, it, expect } from 'vitest';
import { GameTable } from '@saloon/shared';
import { actionOptions, sizingPresets } from '../src/actionOptions.js';

function table(stacks = [1500, 1500, 1500]) {
  const t = new GameTable({ smallBlind: 10, bigBlind: 20, startingStack: 1500 });
  stacks.forEach((chips, seat) => {
    t.addPlayer({ id: `p${seat}`, seat });
    t.playerById(`p${seat}`).chips = chips;
  });
  t.startHand();
  return t;
}

/** Act until `id` is next, everyone else just calling/checking. */
function advanceTo(t, id) {
  while (t.nextActorId() !== id) {
    const next = t.nextActorId();
    const p = t.playerById(next);
    t.applyAction(next, t.currentBet > p.contributions[t.street] ? 'call' : 'check');
  }
}

describe('actionOptions', () => {
  it('is null when it is not my turn', () => {
    const t = table();
    const someoneElse = t.players.find((p) => p.id !== t.nextActorId()).id;
    expect(actionOptions(t.snapshotFor(someoneElse), someoneElse)).toBeNull();
  });

  it('gives the big blind a raise (not a bet) when limped to', () => {
    const t = table();
    const bb = t.players.find((p) => p.contributions.preflop === 20).id;
    advanceTo(t, bb);
    const o = actionOptions(t.snapshotFor(bb), bb);
    expect(o.canCheck).toBe(true);
    expect(o.raiseAction).toBe('raise');
    expect(o.minTotal).toBe(40);
    // The engine accepts what the buttons offer.
    t.applyAction(bb, o.raiseAction, o.minTotal);
    expect(t.currentBet).toBe(40);
  });

  it('caps the raise at the whole stack including chips already bet', () => {
    const t = table();
    const first = t.nextActorId();
    const o = actionOptions(t.snapshotFor(first), first);
    expect(o.maxTotal).toBe(1500);
    t.applyAction(first, 'raise', o.maxTotal);
    expect(t.playerById(first).chips).toBe(0);
  });

  it('offers only call / all-in when the stack cannot make a full raise', () => {
    const t = table([30, 1500, 1500]);
    advanceTo(t, 'p0');
    const o = actionOptions(t.snapshotFor('p0'), 'p0');
    expect(o.raiseAction).toBeNull();
  });

  it('sizes pot-fraction presets inside the legal range', () => {
    const t = table();
    const first = t.nextActorId();
    const o = actionOptions(t.snapshotFor(first), first);
    const presets = sizingPresets(o);
    expect(presets.length).toBeGreaterThan(0);
    for (const p of presets) {
      expect(p.total).toBeGreaterThanOrEqual(o.minTotal);
      expect(p.total).toBeLessThanOrEqual(o.maxTotal);
    }
  });
});
