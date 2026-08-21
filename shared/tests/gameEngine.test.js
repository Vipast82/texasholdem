import { describe, it, expect } from 'vitest';
import { GameTable } from '../src/gameEngine.js';

/**
 * Drive a full hand. `mode` selects the scripted strategy:
 *  - 'check' : always the cheapest action (check/call, never bet)
 *  - 'fold'  : everyone folds
 *  - 'call'  : always call (never bet) - for fold-out tests
 */
function driveHand(game, mode = 'check') {
  let guard = 0;
  while (game.inHand && guard < 500) {
    guard += 1;
    const actor = game.nextActorId();
    if (!actor) break;
    const player = game.playerById(actor);
    const toCall = Math.max(0, game.currentBet - (player.contributions[game.street] || 0));
    let action = 'fold';
    let amount = 0;
    if (mode === 'check' || mode === 'call') {
      if (toCall === 0) action = 'check';
      else action = 'call';
    }
    try {
      game.applyAction(actor, action, amount);
    } catch (err) {
      break;
    }
  }
  return game;
}

function makeTable(overrides = {}) {
  const game = new GameTable({
    tableId: 't1',
    smallBlind: 10,
    bigBlind: 20,
    startingStack: 2000,
    ...overrides
  });
  game.addPlayer({ id: 'p1', name: 'Al', seat: 0 });
  game.addPlayer({ id: 'p2', name: 'Bess', seat: 1 });
  game.addPlayer({ id: 'p3', name: 'Cal', seat: 2 });
  return game;
}

const totalChips = (g) => g.players.reduce((sum, p) => sum + p.chips, 0) + g.pot;

describe('GameTable - full hand lifecycle', () => {
  it('plays a 3-player hand to the river with everyone calling/checking', () => {
    const game = makeTable();
    game.startHand();
    expect(game.street).toBe('preflop');
    expect(game.pot).toBe(30); // blinds

    driveHand(game, 'check');

    expect(game.inHand).toBe(false);
    expect(game.street).toBe('ended');
    expect(game.community).toHaveLength(5);
    const winner = Object.keys(game.payouts).find((id) => game.payouts[id] > 0);
    expect(winner).toBeTruthy();
    expect(game.payouts[winner]).toBe(60); // 3 players each match the BB (20)
    expect(totalChips(game)).toBe(6000);
  });

  it('deterministic replay: same seed + same policy -> identical results', () => {
    const results = [];
    for (let i = 0; i < 2; i += 1) {
      const game = makeTable();
      game._handSeed = 'replay-seed';
      game.startHand();
      driveHand(game, 'check');
      results.push({
        payouts: game.payouts,
        community: game.community
      });
    }
    expect(results[0]).toEqual(results[1]);
    expect(results[0].community).toHaveLength(5);
  });

  it('different seeds deal different boards', () => {
    const boards = [];
    for (const seed of ['seed-A', 'seed-B']) {
      const game = makeTable();
      game._handSeed = seed;
      game.startHand();
      driveHand(game, 'check');
      boards.push(game.community.join(','));
    }
    expect(boards[0]).not.toBe(boards[1]);
  });

  it('ends by fold when everyone else folds', () => {
    const game = makeTable();
    game.startHand();
    driveHand(game, 'fold');
    expect(game.lastShowdown).toBeNull();
    const winners = Object.entries(game.payouts);
    expect(winners.length).toBe(1);
    expect(winners[0][1]).toBeGreaterThan(0);
  });

  it('enforces turn order (cannot act out of turn)', () => {
    const game = makeTable();
    game.startHand();
    const first = game.nextActorId();
    const other = game.players.find((p) => p.id !== first);
    expect(() => game.applyAction(other.id, 'fold')).toThrow(/not to act/);
  });

  it('requires two players to start', () => {
    const game = new GameTable({ tableId: 't', smallBlind: 10, bigBlind: 20 });
    game.addPlayer({ id: 'solo', name: 'Solo', seat: 0 });
    expect(() => game.startHand()).toThrow();
  });
});

describe('GameTable - game types', () => {
  it('limit: an opening bet must be exactly one bet size (BB)', () => {
    const game = makeTable({ gameType: 'limit' });
    game.startHand();
    // Make currentBet zero so the next actor opens: all-in is not possible,
    // so force the situation by having both blinds already posted and a raise.
    const first = game.nextActorId();
    // currentBet = 20 (BB). A limit raise must be exactly to 40.
    expect(() => game.applyAction(first, 'raise', 60)).toThrow(/limit raise must be exactly 40/);
    game.applyAction(first, 'raise', 40);
    expect(game.currentBet).toBe(40);
  });

  it('pot-limit: a raise above the pot-limit maximum is rejected', () => {
    const game = makeTable({ gameType: 'pot-limit', startingStack: 20000 });
    game.startHand();
    const first = game.nextActorId();
    // pot=30, currentBet=20 (BB); min raise to 40; pot-limit max = 30 + 40 = 70
    expect(() => game.applyAction(first, 'raise', 1000)).toThrow(/pot-limit maximum is 70/);
    game.applyAction(first, 'raise', 70);
    expect(game.currentBet).toBe(70);
  });

  it('no-limit: an opening bet of any size within stack is allowed', () => {
    const game = makeTable({ gameType: 'no-limit', startingStack: 500 });
    game.startHand();
    const first = game.nextActorId();
    // No bet out yet -> must use 'bet' (currentBet is the BB posted by blinds)
    // Here a raise to 100 is legal and unbounded (no-limit)
    game.applyAction(first, 'raise', 100);
    expect(game.currentBet).toBe(100);
  });
});
