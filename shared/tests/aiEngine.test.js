import { describe, it, expect } from 'vitest';
import { GameTable } from '../src/gameEngine.js';
import { Rng } from '../src/rng.js';
import { DIFFICULTIES, getProfile, pickBotName } from '../src/ai/aiProfiles.js';
import { estimateWinTieLose } from '../src/ai/aiMonteCarlo.js';
import { handStrength, potOddsRequired, rankCandidates } from '../src/ai/aiDecision.js';
import { decideAction, positionFor, boardTexture, normalizeState } from '../src/ai/aiEngine.js';

const ALICE = 'alice';
const BOB = 'bob';

/**
 * Build a two-handed no-limit table (seats 0 and 1) and start a hand.
 * A and B are auto-assigned blinds; startHand sets the dealer + action order.
 */
function makeGame(opts = {}) {
  const game = new GameTable({
    tableId: 't',
    gameType: opts.gameType || 'no-limit',
    smallBlind: 10,
    bigBlind: 20,
    startingStack: 1000,
    tutorialSeed: opts.tutorialSeed || 'ai-seed'
  });
  game.addPlayer({ id: ALICE, name: 'Alice', seat: 0 });
  game.addPlayer({ id: BOB, name: 'Bob', seat: 1 });
  if (opts.start !== false) game.startHand();
  return game;
}

/** The id of the player who must act now (or null if the hand is over). */
function actor(game) {
  return game.nextActorId();
}

describe('AI profiles', () => {
  it('exposes all three difficulties with distinct personalities', () => {
    expect(DIFFICULTIES).toEqual(['easy', 'normal', 'hard']);
    const easy = getProfile('easy');
    const hard = getProfile('hard');
    expect(easy.difficulty).toBe('easy');
    expect(hard.difficulty).toBe('hard');
    expect(hard.mcIterations).toBeGreaterThanOrEqual(easy.mcIterations);
    expect(easy.personality.namePool.length).toBeGreaterThan(0);
    expect(hard.personality.avatarId).toBeTruthy();
  });

  it('falls back to normal for unknown difficulty', () => {
    expect(getProfile('weird').difficulty).toBe('normal');
  });

  it('pickBotName is deterministic given an rng', () => {
    const name1 = pickBotName(getProfile('easy'), new Rng('s1'));
    const name2 = pickBotName(getProfile('easy'), new Rng('s1'));
    expect(name1).toBe(name2);
  });
});

describe('Monte-Carlo equity', () => {
  it('AA has clearly > 50% win vs 3 random hands (deterministic)', () => {
    const r1 = estimateWinTieLose(['As', 'Ad'], [], 42, 400, 3);
    const r2 = estimateWinTieLose(['As', 'Ad'], [], 42, 400, 3);
    // Determinism: same inputs + seed => identical result.
    expect(r1.win).toBe(r2.win);
    // AA is the best preflop hand; it must beat random opponents more often
    // than not (real value ~58-60% vs 3 random opponents).
    expect(r1.win).toBeGreaterThan(0.5);
    expect(r1.win + r1.tie + r1.lose).toBeCloseTo(1, 5);
  });

  it('AA (vs 1 opponent) is much stronger than AA (vs 3) and > 70%', () => {
    const vs1 = estimateWinTieLose(['As', 'Ad'], [], 42, 400, 1);
    const vs3 = estimateWinTieLose(['As', 'Ad'], [], 42, 400, 3);
    expect(vs1.win).toBeGreaterThan(0.7);
    expect(vs1.win).toBeGreaterThan(vs3.win);
  });

  it('72o has well below 50% win (sanity)', () => {
    const r = estimateWinTieLose(['7s', '2d'], [], 42, 400, 3);
    expect(r.win).toBeLessThan(0.5);
  });

  it('ranks AA above 72o', () => {
    const aa = estimateWinTieLose(['As', 'Ad'], [], 42, 300, 3);
    const junk = estimateWinTieLose(['7s', '2d'], [], 42, 300, 3);
    expect(aa.win).toBeGreaterThan(junk.win);
  });

  it('validates inputs', () => {
    expect(() => estimateWinTieLose(['As'], [], 1)).toThrow();
    expect(() => estimateWinTieLose(['As', 'Ad'], [], 1, 0)).toThrow();
    expect(() => estimateWinTieLose(['As', 'Ad'], ['Ah', 'Ad', 'Ac', 'As', 'Ah', 'Ad'], 1)).toThrow();
  });
});

describe('handStrength heuristics', () => {
  it('AA is stronger than 72o preflop', () => {
    const base = { community: [], boardTexture: { paired: false, flushDraw: false, straightDraw: false } };
    const strong = { ...base, hole: ['As', 'Ad'] };
    const weak = { ...base, hole: ['7s', '2d'] };
    expect(handStrength(strong)).toBeGreaterThan(handStrength(weak));
  });
});

describe('potOddsRequired', () => {
  it('is 0 when there is nothing to call', () => {
    expect(potOddsRequired({ pot: 100, toCall: 0 })).toBe(0);
  });
  it('computes toCall / (pot + toCall)', () => {
    expect(potOddsRequired({ pot: 80, toCall: 20 })).toBeCloseTo(0.2, 5);
  });
});

describe('rankCandidates', () => {
  it('returns a weight-sorted list and includes check at toCall 0', () => {
    const state = {
      hole: ['As', 'Ks'],
      community: [],
      street: 'preflop',
      pot: 30,
      toCall: 0,
      committed: 0,
      chips: 500,
      bigBlind: 20,
      currentBet: 0,
      gameType: 'no-limit',
      lastRaiseIncrement: 0,
      raiseCount: 0,
      maxRaises: Infinity,
      playersRemaining: 2,
      position: 'button',
      boardTexture: { paired: false, flushDraw: false, straightDraw: false }
    };
    const cands = rankCandidates(state, getProfile('hard'), new Rng(1));
    expect(cands.length).toBeGreaterThan(0);
    expect(cands.map((c) => c.action)).toContain('check');
    for (let i = 1; i < cands.length; i += 1) {
      expect(cands[i - 1].weight).toBeGreaterThanOrEqual(cands[i].weight);
    }
  });

  it('only offers raise (not bet) when a bet is out', () => {
    const state = {
      hole: ['As', 'Ks'],
      community: [],
      street: 'flop',
      pot: 100,
      toCall: 30,
      committed: 0,
      chips: 500,
      bigBlind: 20,
      currentBet: 30,
      gameType: 'no-limit',
      lastRaiseIncrement: 30,
      raiseCount: 0,
      maxRaises: Infinity,
      playersRemaining: 2,
      position: 'button',
      boardTexture: { paired: false, flushDraw: false, straightDraw: false }
    };
    const actions = rankCandidates(state, getProfile('hard'), new Rng(1)).map((c) => c.action);
    expect(actions).not.toContain('bet');
    expect(actions).toContain('call');
    expect(actions).toContain('fold');
  });
});

describe('positionFor', () => {
  it('labels the dealer as button', () => {
    const g = makeGame({ start: false });
    g.dealerSeat = 0;
    expect(positionFor(g, 0)).toBe('button');
  });
});

describe('boardTexture', () => {
  it('detects a paired board and a flush draw', () => {
    expect(boardTexture(['Ah', 'Ah', '2c']).paired).toBe(true);
    expect(boardTexture(['Ah', 'Kh', '2h']).flushDraw).toBe(true);
    expect(boardTexture(['As', 'Kd', '2c']).flushDraw).toBe(false);
  });
});

describe('normalizeState', () => {
  it('computes toCall and committed against currentBet', () => {
    const g = makeGame();
    const id = actor(g);
    const s = normalizeState(g, id);
    expect(s.committed).toBeGreaterThanOrEqual(0);
    expect(s.toCall).toBeGreaterThanOrEqual(0);
    expect(s.hole).toHaveLength(2);
    expect(['early', 'middle', 'cutoff', 'button']).toContain(s.position);
  });
});

describe('decideAction (engine)', () => {
  it('requires a seed or rng (determinism)', () => {
    const g = makeGame();
    const id = actor(g);
    expect(() => decideAction(g, id)).toThrow(/seed|Rng/);
  });

  it('returns a legal action in the allowed set with metadata', () => {
    const g = makeGame();
    const id = actor(g);
    const d = decideAction(g, id, { difficulty: 'normal', seed: 7 });
    expect(['check', 'call', 'fold', 'bet', 'raise', 'allin']).toContain(d.action);
    expect(typeof d.reason).toBe('string');
    expect(d.reason.length).toBeGreaterThan(0);
    expect(d.confidence).toBeGreaterThanOrEqual(0);
    expect(d.confidence).toBeLessThanOrEqual(1);
    expect(d.meta).toBeTruthy();
  });

  it('is deterministic for the same seed', () => {
    const g1 = makeGame();
    const g2 = makeGame();
    const d1 = decideAction(g1, actor(g1), { difficulty: 'hard', seed: 99 });
    const d2 = decideAction(g2, actor(g2), { difficulty: 'hard', seed: 99 });
    expect(d1.action).toBe(d2.action);
    expect(d1.amount).toBe(d2.amount);
    expect(d1.reason).toBe(d2.reason);
  });

  it('drives a full hand to completion with legal actions (chips conserved)', () => {
    const g = makeGame();
    const totalInPlay = () => g.players.reduce((sum, p) => sum + p.chips, 0) + g.pot;
    const startTotal = totalInPlay();
    let guard = 0;
    while (g.inHand && guard < 400) {
      guard += 1;
      const id = g.nextActorId();
      if (!id) break;
      const d = decideAction(g, id, { difficulty: 'normal', seed: guard + 1000 });
      g.applyAction(id, d.action, d.amount);
    }
    expect(g.inHand).toBe(false);
    // Total chips in play (stacks + pot) are never destroyed or created;
    // at the end the pot is fully paid out so it returns to stacks.
    expect(totalInPlay()).toBe(startTotal);
    expect(g.pot).toBe(0);
  });

  it('plays a full hand on every difficulty without throwing', () => {
    for (const diff of DIFFICULTIES) {
      const g = makeGame();
      let guard = 0;
      while (g.inHand && guard < 400) {
        guard += 1;
        const id = g.nextActorId();
        if (!id) break;
        const d = decideAction(g, id, { difficulty: diff, seed: guard + 5 });
        g.applyAction(id, d.action, d.amount);
      }
      expect(g.inHand).toBe(false);
    }
  });

  it('folds sometimes but not always (bluff/value variance)', () => {
    let folds = 0;
    let total = 0;
    for (let i = 0; i < 80; i += 1) {
      // Vary the deck seed so each hand deals differently (the AI's own seed
      // only drives bluffs, not the cards dealt).
      const g = makeGame({ tutorialSeed: `variance-${i}` });
      const id = actor(g);
      const d = decideAction(g, id, { difficulty: 'normal', seed: i * 131 + 1 });
      total += 1;
      if (d.action === 'fold') folds += 1;
    }
    expect(folds).toBeGreaterThan(0);
    expect(folds).toBeLessThan(total);
  });
});
