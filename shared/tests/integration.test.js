/**
 * Sprint 6 — cross-cutting integration tests (shared domain, pure + deterministic).
 *
 * These tie several modules together (gameEngine + ai + equity + history) and
 * assert invariants that only hold when the whole stack works in concert.
 * Everything uses fixed seeds — determinism is a hard requirement.
 */
import { describe, it, expect } from 'vitest';
import { GameTable } from '../src/gameEngine.js';
import { decideAction } from '../src/ai/aiEngine.js';
import { equityForPlayer, clampIterations } from '../src/equity.js';
import { buildHandRecord, serializeHandRecord } from '../src/history.js';

/**
 * Play a full AI-only hand using the seeded AI. The per-move seed is a pure
 * function of the move index (and the table's deck seed), so two runs with the
 * same `seed` replay the identical action sequence.
 * @returns {object} a summary of the finished hand
 */
function playAiOnlyHand(seed, difficulty = 'normal') {
  const game = new GameTable({
    tableId: 'ai',
    smallBlind: 10,
    bigBlind: 20,
    startingStack: 1000,
    tutorialSeed: seed
  });
  game.addPlayer({ id: 'bot1', name: 'Bot1', seat: 0 });
  game.addPlayer({ id: 'bot2', name: 'Bot2', seat: 1 });
  game.startHand();

  const actions = [];
  let guard = 0;
  while (game.inHand && guard < 400) {
    guard += 1;
    const id = game.nextActorId();
    if (!id) break;
    const d = decideAction(game, id, {
      difficulty,
      // Deterministic per-move seed (no Date.now / Math.random).
      seed: `${seed}:move${guard}`
    });
    game.applyAction(id, d.action, d.amount || 0);
    const log = game.actionLog[game.actionLog.length - 1];
    actions.push({ playerId: log.playerId, action: log.action, amount: log.amount, street: log.street });
  }

  return {
    board: game.community.slice(),
    holes: game.players.map((p) => (p.holeCards || []).join('')).join('|'),
    payouts: { ...game.payouts },
    actions,
    chipsAfter: Object.fromEntries(game.players.map((p) => [p.id, p.chips]))
  };
}

describe('integration: AI-only full hand determinism', () => {
  it('same seed + difficulty => identical board, action log, and payouts', () => {
    const a = playAiOnlyHand('sprint6-ai-seed', 'normal');
    const b = playAiOnlyHand('sprint6-ai-seed', 'normal');
    expect(a.board).toEqual(b.board);
    expect(a.actions).toEqual(b.actions);
    expect(a.payouts).toEqual(b.payouts);
    expect(a.chipsAfter).toEqual(b.chipsAfter);
  });

  it('chips are conserved across the whole hand (stacks sum to 2 * start)', () => {
    const run = playAiOnlyHand('sprint6-ai-seed', 'hard');
    const total = Object.values(run.chipsAfter).reduce((s, v) => s + v, 0);
    expect(total).toBe(1000 * 2);
    // At hand end the pot is fully paid out, so every chip is back in stacks.
    expect(run.actions.length).toBeGreaterThan(0);
  });

  it('different deck seeds deal different cards', () => {
    // Compare the dealt hole cards: the hand may end before any board is dealt.
    const a = playAiOnlyHand('seed-one', 'normal');
    const b = playAiOnlyHand('seed-two', 'normal');
    expect(a.holes).not.toBe(b.holes);
  });
});

describe('integration: HUD equity privacy + determinism on one snapshot', () => {
  const snapshot = {
    tableId: 't',
    handNumber: 1,
    street: 'flop',
    community: ['Kd', 'Qd', '9c'],
    players: [
      { id: 'me', holeCards: ['As', 'Ah'], status: 'in-hand', hasFolded: false },
      { id: 'opp', holeCards: null, status: 'in-hand', hasFolded: false } // private by design
    ]
  };

  it('estimates only for a seat whose hole cards are in the snapshot', () => {
    const mine = equityForPlayer(snapshot, 'me', 'sprint6-hud', 300);
    expect(mine).not.toBeNull();
    expect(mine.win + mine.tie + mine.lose).toBeCloseTo(1, 6);
    // The opponent's hole cards are private -> not estimable from this view.
    expect(equityForPlayer(snapshot, 'opp', 'sprint6-hud', 300)).toBeNull();
  });

  it('is deterministic: same seed => identical win/tie/lose', () => {
    const a = equityForPlayer(snapshot, 'me', 'same-seed', 500);
    const b = equityForPlayer(snapshot, 'me', 'same-seed', 500);
    expect(a).toEqual(b);
  });

  it('clamps iterations to the documented cap', () => {
    const r = equityForPlayer(snapshot, 'me', 's', 999999);
    expect(r.iterations).toBe(clampIterations(999999));
  });
});

describe('integration: hand-record round-trip stability', () => {
  function drive(g) {
    let guard = 0;
    while (g.inHand && guard < 500) {
      guard += 1;
      const id = g.nextActorId();
      if (!id) break;
      const p = g.playerById(id);
      const toCall = Math.max(0, g.currentBet - (p.contributions[g.street] || 0));
      try {
        g.applyAction(id, toCall === 0 ? 'check' : 'call', 0);
      } catch (err) {
        break;
      }
    }
    return g;
  }

  it('serialize -> parse -> serialize is byte-stable', () => {
    const g = new GameTable({
      tableId: 'rt',
      smallBlind: 10,
      bigBlind: 20,
      startingStack: 1000,
      tutorialSeed: 'rt-seed'
    });
    g.addPlayer({ id: 'p1', name: 'Al', seat: 0 });
    g.addPlayer({ id: 'p2', name: 'Bo', seat: 1 });
    g.startHand();
    drive(g);
    const rec = buildHandRecord(g, { ts: 0 });

    const json1 = serializeHandRecord(rec);
    const parsed = JSON.parse(json1);
    const json2 = serializeHandRecord(parsed);
    expect(json2).toBe(json1);
    expect(parsed.schema).toBe('saloon.hand-record/v1');
    expect(parsed.board).toHaveLength(5);
  });
});
