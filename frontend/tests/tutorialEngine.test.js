/**
 * Sprint 3 — Tutorial engine unit tests.
 * Coverage: resolveEventKey mapping, selectMessage/shouldPause/mapEvent,
 * TutorialEngine.handleEvent + narration + pause/resume + hints + resolveText,
 * i18n parity (en/es), seeded determinism, content bundling.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  resolveEventKey,
  selectMessage,
  shouldPause,
  mapEvent,
  TutorialEngine
} from '../src/engine/tutorialEngine.js';
import { loadTutorialContent } from '../src/tutorial/content.js';
import en from '../src/i18n/en.json';
import es from '../src/i18n/es.json';
import tutorialSeed from '../src/tutorial/tutorialSeed.json';

// Fake narration service (no window / speech needed in Node)
const narrationStub = { speak: vi.fn() };

// Minimal content map that exercises all branches
const content = {
  shuffle: {
    eventKey: 'shuffle',
    title: 'tut.shuffle.title',
    messages: { concise: 'C', normal: 'N', detailed: 'D' },
    highlight: ['table'],
    pause: false
  },
  bet: {
    eventKey: 'bet',
    title: 'tut.bet.title',
    messages: { concise: 'cb', normal: 'nb' },
    highlight: ['controls', 'pot'],
    pause: true,
    strategyHint: { enabled: true, text: 'tut.hint.text' }
  }
};

describe('resolveEventKey', () => {
  const cases = [
    ['handStarted', {}, 'shuffle'],
    ['blindsPosted', {}, 'deal'],
    ['holeDealt', {}, 'deal'],
    ['flopRevealed', {}, 'flop'],
    ['turnRevealed', {}, 'turn'],
    ['riverRevealed', {}, 'river'],
    ['showdown', {}, 'showdown'],
    ['handEnded', {}, 'showdown'],
    ['actionTaken', { action: 'fold' }, 'fold'],
    ['actionTaken', { action: 'bet' }, 'bet'],
    ['actionTaken', { action: 'raise' }, 'bet'],
    ['streetStarted', {}, null],
    ['unknownEvent', {}, null]
  ];

  it.each(cases)('maps %j to %j', (event, payload, expected) => {
    expect(resolveEventKey(event, payload)).toBe(expected);
  });
});

describe('selectMessage', () => {
  const messages = { concise: 'C', normal: 'N', detailed: 'D' };

  it('picks the requested verbosity when present', () => {
    expect(selectMessage(messages, 'concise')).toBe('C');
    expect(selectMessage(messages, 'normal')).toBe('N');
    expect(selectMessage(messages, 'detailed')).toBe('D');
  });

  it('falls back to normal → concise → detailed', () => {
    const partial = { concise: 'C', detailed: 'D' };
    expect(selectMessage(partial, 'normal')).toBe('C');
    expect(selectMessage(partial, 'detailed')).toBe('D');
  });

  it('returns empty string when no string is present', () => {
    expect(selectMessage({}, 'normal')).toBe('');
    expect(selectMessage(null, 'normal')).toBe('');
  });
});

describe('shouldPause', () => {
  it('never pauses outside guided mode', () => {
    expect(shouldPause({ pause: true }, 'passive')).toBe(false);
    expect(shouldPause({ pause: true }, 'off')).toBe(false);
  });

  it('pauses in guided mode only when entry.pause === true', () => {
    expect(shouldPause({ pause: true }, 'guided')).toBe(true);
    expect(shouldPause({ pause: false }, 'guided')).toBe(false);
    expect(shouldPause(null, 'guided')).toBe(false);
  });
});

describe('mapEvent', () => {
  it('returns null for mode=off', () => {
    expect(mapEvent('handStarted', {}, content, { mode: 'off' })).toBeNull();
  });

  it('returns null for events with no content', () => {
    expect(mapEvent('unknownEvent', {}, content, { mode: 'passive' })).toBeNull();
  });

  it('picks the verbosity variant', () => {
    const concise = mapEvent('handStarted', {}, content, {
      mode: 'passive',
      verbosity: 'concise'
    });
    expect(concise.message).toBe('C');
    const detailed = mapEvent('handStarted', {}, content, {
      mode: 'passive',
      verbosity: 'detailed'
    });
    expect(detailed.message).toBe('D');
  });

  it('marks paused=true in guided mode when entry.pause=true', () => {
    const item = mapEvent('actionTaken', { action: 'bet' }, content, {
      mode: 'guided',
      verbosity: 'normal'
    });
    expect(item).not.toBeNull();
    expect(item.eventKey).toBe('bet');
    expect(item.paused).toBe(true);
  });

  it('marks paused=false in passive mode even when entry.pause=true', () => {
    const item = mapEvent('actionTaken', { action: 'bet' }, content, {
      mode: 'passive',
      verbosity: 'normal'
    });
    expect(item.paused).toBe(false);
  });

  it('attaches strategyHint only when enabled + provider + context present', () => {
    const fakeHint = vi.fn().mockReturnValue({
      action: 'call',
      reason: 'tight',
      confidence: 0.8
    });
    const withHint = mapEvent(
      'actionTaken',
      { action: 'bet' },
      content,
      { mode: 'passive', verbosity: 'normal', hintsEnabled: true },
      fakeHint,
      { game: { pot: 100 }, actorId: 'p1', seed: 's' }
    );
    expect(withHint.strategyHint).toMatchObject({
      enabled: true,
      action: 'call',
      confidence: 0.8
    });

    const withoutHint = mapEvent('actionTaken', { action: 'bet' }, content, {
      mode: 'passive',
      verbosity: 'normal',
      hintsEnabled: false
    });
    expect(withoutHint.strategyHint.enabled).toBe(false);
  });

  it('swallows provider errors and returns a safe hint shape', () => {
    const throwing = vi.fn().mockImplementation(() => {
      throw new Error('boom');
    });
    const item = mapEvent(
      'actionTaken',
      { action: 'bet' },
      content,
      { mode: 'passive', verbosity: 'normal', hintsEnabled: true },
      throwing,
      { game: { pot: 10 }, actorId: 'p1' }
    );
    expect(item.strategyHint).toMatchObject({ enabled: false });
  });
});

describe('TutorialEngine', () => {
  it('handleEvent pushes an item and calls narration.speak with the message', () => {
    const engine = new TutorialEngine({
      content,
      mode: 'passive',
      verbosity: 'normal',
      narration: narrationStub
    });
    narrationStub.speak.mockClear();
    const item = engine.handleEvent('handStarted', {});
    expect(item).not.toBeNull();
    expect(item.eventKey).toBe('shuffle');
    expect(item.message).toBe('N');
    expect(narrationStub.speak).toHaveBeenCalledWith('N');
    expect(engine.history.length).toBe(1);
    expect(engine.current).toBe(item);
    expect(engine.isPaused).toBe(false);
  });

  it('does nothing in off mode', () => {
    const engine = new TutorialEngine({ content, mode: 'off', narration: narrationStub });
    narrationStub.speak.mockClear();
    const item = engine.handleEvent('handStarted', {});
    expect(item).toBeNull();
    expect(engine.history.length).toBe(0);
    expect(narrationStub.speak).not.toHaveBeenCalled();
  });

  it('guided mode pauses on pause=true entries and continues cleanly', () => {
    const engine = new TutorialEngine({ content, mode: 'guided', verbosity: 'normal' });
    const betItem = engine.handleEvent('actionTaken', { action: 'bet' });
    expect(betItem).not.toBeNull();
    expect(engine.isPaused).toBe(true);
    expect(engine.continue()).toBe(true);
    expect(engine.isPaused).toBe(false);
    expect(engine.continue()).toBe(false);
  });

  it('setMode to non-guided clears any active pause', () => {
    const engine = new TutorialEngine({ content, mode: 'guided' });
    engine.handleEvent('actionTaken', { action: 'bet' });
    expect(engine.isPaused).toBe(true);
    engine.setMode('passive');
    expect(engine.isPaused).toBe(false);
  });

  it('clearHistory resets history, current, and pause', () => {
    const engine = new TutorialEngine({ content, mode: 'guided' });
    engine.handleEvent('actionTaken', { action: 'bet' });
    expect(engine.isPaused).toBe(true);
    engine.clearHistory();
    expect(engine.history.length).toBe(0);
    expect(engine.current).toBeNull();
    expect(engine.isPaused).toBe(false);
  });

  it('applies resolveText to title/message/hint.reason', () => {
    const resolveText = vi.fn((key) => {
      const map = { 'tut.bet.title': 'BET!', nb: 'normal bet', tight: 'tight play' };
      return map[key] || key;
    });
    const hint = vi.fn().mockReturnValue({ action: 'call', reason: 'tight', confidence: 0.9 });
    const engine = new TutorialEngine({
      content,
      mode: 'passive',
      verbosity: 'normal',
      hintsEnabled: true,
      hintProvider: hint,
      resolveText
    });
    const item = engine.handleEvent(
      'actionTaken',
      { action: 'bet' },
      {
        game: { pot: 10 },
        actorId: 'p1'
      }
    );
    expect(item.title).toBe('BET!');
    expect(item.message).toBe('normal bet');
    expect(item.strategyHint.reason).toBe('tight play');
  });
});

describe('i18n parity (en.json vs es.json)', () => {
  it('every key in en.json exists in es.json', () => {
    const esKeys = new Set(Object.keys(es));
    const missing = Object.keys(en).filter((k) => !esKeys.has(k));
    expect(missing).toEqual([]);
  });

  it('every key in es.json exists in en.json', () => {
    const enKeys = new Set(Object.keys(en));
    const missing = Object.keys(es).filter((k) => !enKeys.has(k));
    expect(missing).toEqual([]);
  });
});

describe('seeded determinism (tutorialSeed.json)', () => {
  it('has a non-empty seed and a valid hand shape', () => {
    expect(tutorialSeed.seed).toBeTruthy();
    expect(tutorialSeed.seed).toBe('sprint3-tutorial-v1');
    expect(tutorialSeed.table).toBeDefined();
    expect(tutorialSeed.table.smallBlind).toBeGreaterThan(0);
    expect(tutorialSeed.table.bigBlind).toBeGreaterThan(tutorialSeed.table.smallBlind);
  });

  it('reproduces the same shuffled deck for the same seed', async () => {
    const { createShuffledDeck } = await import('@saloon/shared/rng');
    const deck1 = createShuffledDeck(tutorialSeed.seed);
    const deck2 = createShuffledDeck(tutorialSeed.seed);
    expect(deck1).toEqual(deck2);
    const deck3 = createShuffledDeck('a-different-seed');
    expect(deck1).not.toEqual(deck3);
  });
});

describe('loadTutorialContent', () => {
  it('bundles all 8 canonical event keys', () => {
    const c = loadTutorialContent();
    const expected = ['shuffle', 'deal', 'flop', 'turn', 'river', 'bet', 'fold', 'showdown'];
    for (const k of expected) {
      expect(c[k]).toBeDefined();
      expect(c[k].eventKey).toBe(k);
      expect(c[k].messages).toBeDefined();
      expect(c[k].messages.normal).toBeDefined();
    }
  });
});
