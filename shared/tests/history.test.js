import { describe, it, expect } from 'vitest';
import { GameTable } from '../src/gameEngine.js';
import { buildHandRecord, serializeHandRecord } from '../src/history.js';

/** Drive a hand to completion with the cheapest legal actions (check/call). */
function driveToFinish(game) {
  let guard = 0;
  while (game.inHand && guard < 500) {
    guard += 1;
    const actor = game.nextActorId();
    if (!actor) break;
    const p = game.playerById(actor);
    const toCall = Math.max(0, game.currentBet - (p.contributions[game.street] || 0));
    try {
      game.applyAction(actor, toCall === 0 ? 'check' : 'call', 0);
    } catch (err) {
      break;
    }
  }
  return game;
}

function makeTable() {
  const game = new GameTable({ tableId: 't', smallBlind: 10, bigBlind: 20, startingStack: 1500 });
  game.addPlayer({ id: 'p1', name: 'Al', seat: 0 });
  game.addPlayer({ id: 'p2', name: 'Bess', seat: 1 });
  game.addPlayer({ id: 'p3', name: 'Cal', seat: 2 });
  return game;
}

describe('buildHandRecord schema', () => {
  it('captures the full hand (players, blinds, board, winner, pot, seed)', () => {
    const game = makeTable();
    game._handSeed = 'record-seed';
    game.startHand();
    driveToFinish(game);

    const rec = buildHandRecord(game);
    expect(rec.schema).toBe('saloon.hand-record/v1');
    expect(rec.tableId).toBe('t');
    expect(rec.smallBlind).toBe(10);
    expect(rec.bigBlind).toBe(20);
    expect(rec.board).toHaveLength(5);
    expect(rec.seed).toBe('record-seed');
    expect(rec.handNumber).toBe(1);
    expect(rec.winnerIds.length).toBeGreaterThan(0);
    expect(rec.potAtEnd).toBeGreaterThan(0);
    expect(Array.isArray(rec.actions)).toBe(true);
    expect(rec.actions.length).toBeGreaterThan(0);
    expect(rec.players).toHaveLength(3);

    // Every player summary has the expected shape.
    for (const p of rec.players) {
      expect(p.id).toBeTruthy();
      expect(p.contributed.total).toBeGreaterThanOrEqual(0);
      expect(p.contributed).toHaveProperty('preflop');
      expect(p.contributed).toHaveProperty('flop');
      expect(p.contributed).toHaveProperty('turn');
      expect(p.contributed).toHaveProperty('river');
      expect(p.holeCards).toHaveLength(2);
      expect(p.chipsAfter).toBeGreaterThan(0);
    }

    // Chips are conserved: everyone's stack + paid pot = starting total.
    const stacks = rec.players.reduce((sum, p) => sum + p.chipsAfter, 0);
    expect(stacks).toBe(1500 * 3);
  });

  it('is JSON-serializable (no functions, no undefined, no circular refs)', () => {
    const game = makeTable();
    game._handSeed = 'json-seed';
    game.startHand();
    driveToFinish(game);
    const rec = buildHandRecord(game);
    const json = JSON.parse(JSON.stringify(rec));
    expect(json.schema).toBe('saloon.hand-record/v1');
    expect(json.winnerIds.length).toBe(rec.winnerIds.length);
  });

  it('records the showdown best hands + payouts for the winners', () => {
    const game = makeTable();
    game._handSeed = 'showdown-seed';
    game.startHand();
    driveToFinish(game);
    const rec = buildHandRecord(game);
    const winners = rec.winnerIds;
    expect(winners.length).toBeGreaterThan(0);
    for (const id of winners) {
      expect(rec.payouts[id]).toBeGreaterThan(0);
      const p = rec.players.find((x) => x.id === id);
      expect(p.bestHand).not.toBeNull();
      expect(p.bestHand.category).toBeGreaterThanOrEqual(0);
    }
    expect(rec.rankedHand).not.toBeNull();
  });
});

describe('buildHandRecord determinism', () => {
  it('same seed + same actions => byte-identical record (ts fixed)', () => {
    const a = buildHandRecord(
      (() => {
        const g = makeTable();
        g._handSeed = 'determinism-seed';
        g.startHand();
        driveToFinish(g);
        return g;
      })(),
      { ts: 0 }
    );

    const b = buildHandRecord(
      (() => {
        const g = makeTable();
        g._handSeed = 'determinism-seed';
        g.startHand();
        driveToFinish(g);
        return g;
      })(),
      { ts: 0 }
    );

    expect(serializeHandRecord(a)).toBe(serializeHandRecord(b));
  });

  it('different seeds produce different boards', () => {
    const run = (seed) => {
      const g = makeTable();
      g._handSeed = seed;
      g.startHand();
      driveToFinish(g);
      return buildHandRecord(g);
    };
    expect(run('seed-one').board.join(',')).not.toBe(run('seed-two').board.join(','));
  });

  it('serializeHandRecord wraps arrays under a `hands` key', () => {
    const g = makeTable();
    g._handSeed = 'arr-seed';
    g.startHand();
    driveToFinish(g);
    const rec = buildHandRecord(g);
    const parsed = JSON.parse(serializeHandRecord([rec]));
    expect(parsed.hands).toHaveLength(1);
    expect(parsed.hands[0].schema).toBe('saloon.hand-record/v1');
  });
});
