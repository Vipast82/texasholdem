/**
 * sfxService.js (Sprint 5) — pure sound mapping + mute/volume gating.
 * No AudioContext is needed: playback is best-effort and the tests only assert
 * the decision surface (which sound, and whether it's gated by mute).
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  SFX_NAMES,
  soundForAction,
  soundForBotAction,
  resolveActionSound,
  resolveHandEndSound,
  SfxService,
  SAMPLES,
  sampleFile
} from '../src/services/sfxService.js';

describe('soundForAction (default map)', () => {
  it('maps known actions to their sounds', () => {
    expect(soundForAction('bet')).toBe('chip');
    expect(soundForAction('check')).toBe('knock');
    expect(soundForAction('win')).toBe('cheer');
  });

  it('returns null for unknown actions', () => {
    expect(soundForAction('nonsense')).toBeNull();
  });
});

describe('soundForBotAction (aiProfiles tie-in)', () => {
  it('uses the difficulty profile sfxMap', () => {
    // All profiles currently share the SHARED_SFX set; assert the canonical keys.
    for (const d of ['easy', 'normal', 'hard']) {
      expect(soundForBotAction('bet', d)).toBe('chip');
      expect(soundForBotAction('fold', d)).toBe('flick');
      expect(soundForBotAction('win', d)).toBe('cheer');
    }
  });

  it('falls back to the default map for actions the profile omits', () => {
    expect(soundForBotAction('raise', 'easy')).toBe('chip');
    expect(soundForBotAction('lose', 'hard')).toBe('grunt');
  });
});

describe('resolveActionSound (event payload)', () => {
  it('routes a bot actor through its difficulty sfxMap', () => {
    const payload = {
      action: 'bet',
      playerId: 'bot-1',
      snapshot: { players: [{ id: 'bot-1', isBot: true, bot: { difficulty: 'hard' } }] }
    };
    expect(resolveActionSound(payload)).toBe('chip');
  });

  it('routes a human actor through the default map', () => {
    const payload = {
      action: 'check',
      playerId: 'me',
      snapshot: { players: [{ id: 'me', isBot: false }] }
    };
    expect(resolveActionSound(payload)).toBe('knock');
  });

  it('returns null with no action', () => {
    expect(resolveActionSound({})).toBeNull();
    expect(resolveActionSound(null)).toBeNull();
  });
});

describe('resolveHandEndSound', () => {
  it('returns cheer when the local player won (winnerIds array)', () => {
    expect(resolveHandEndSound({ winnerIds: ['me', 'other'] }, 'me')).toBe('cheer');
  });

  it('returns grunt when the local player lost', () => {
    expect(resolveHandEndSound({ winnerIds: ['other'] }, 'me')).toBe('grunt');
  });

  it('supports the singular winnerId shape', () => {
    expect(resolveHandEndSound({ winnerId: 'me' }, 'me')).toBe('cheer');
    expect(resolveHandEndSound({ winnerId: 'other' }, 'me')).toBe('grunt');
  });

  it('returns null without a playerId', () => {
    expect(resolveHandEndSound({ winnerIds: ['me'] }, null)).toBeNull();
  });
});

describe('SfxService', () => {
  it('defaults to unmuted at volume 0.8', () => {
    const s = new SfxService();
    expect(s.isMuted()).toBe(false);
    expect(s.getVolume()).toBeCloseTo(0.8);
  });

  it('clamps volume to [0, 1]', () => {
    const s = new SfxService();
    expect(s.setVolume(5)).toBe(1);
    expect(s.setVolume(-1)).toBe(0);
    expect(s.setVolume('bad')).toBe(0.8);
  });

  it('plays a valid sound when unmuted', () => {
    const s = new SfxService();
    const r = s.play('chip');
    expect(r.played).toBe(true);
    expect(r.name).toBe('chip');
    expect(s.lastPlayed.name).toBe('chip');
  });

  it('does not play when muted (and clears the last marker)', () => {
    const s = new SfxService();
    s.setMuted(true);
    const r = s.play('chip');
    expect(r.played).toBe(false);
    expect(r.reason).toBe('muted');
    expect(s.lastPlayed).toBeNull();
  });

  it('rejects unknown sounds', () => {
    const s = new SfxService();
    const r = s.play('nope');
    expect(r.played).toBe(false);
    expect(r.reason).toBe('unknown-sound');
  });

  it('exposes the canonical sound names', () => {
    for (const name of ['chip', 'flick', 'cheer', 'grunt', 'shuffle', 'deal', 'flip', 'chips']) {
      expect(SFX_NAMES).toContain(name);
    }
    // The turn chime and clock tick must be playable (they were once missing).
    expect(SFX_NAMES).toContain('turn');
    expect(SFX_NAMES).toContain('tick');
  });

  it('every sample a sound can use is a known sound name', () => {
    for (const name of Object.keys(SAMPLES)) expect(SFX_NAMES).toContain(name);
  });

  it('picks between variants for sounds that have several', () => {
    const picks = new Set();
    for (let i = 0; i < 30; i += 1) picks.add(sampleFile('cheer', () => (i % 3) / 3));
    expect(picks.size).toBe(3);
    expect(sampleFile('chip', () => 0)).toBe('bet-1.mp3');
  });

  it('every sample file is actually shipped', () => {
    const dir = fileURLToPath(new URL('../public/assets/sfx/', import.meta.url));
    for (const sample of Object.values(SAMPLES)) {
      for (const file of sample.files || [sample.file]) expect(existsSync(dir + file), file).toBe(true);
    }
  });

  it('delegates to a real sample backend when installed', () => {
    const s = new SfxService();
    const calls = [];
    s.setPlayer((name, vol) => {
      calls.push([name, vol]);
      return true;
    });
    s.play('shuffle');
    expect(calls).toEqual([['shuffle', 0.8]]);
  });

  it('falls back to the synth backend when the player does not handle a name', () => {
    const s = new SfxService();
    let synthCalled = false;
    s.setPlayer(() => undefined); // browserSound: no sample for this name
    s._synth = () => {
      synthCalled = true;
    };
    s.play('chips'); // has a sample in browserSound, but our stub does not handle it
    expect(synthCalled).toBe(true);
    expect(s.lastPlayed.name).toBe('chips');
  });

  it('never falls back to a synth tone for win sounds', () => {
    const s = new SfxService();
    let synthCalls = 0;
    s.setPlayer(() => undefined); // the clip could not play
    s._synth = () => {
      synthCalls += 1;
    };
    for (const name of ['cheer', 'bigWin', 'victory']) s.play(name);
    expect(synthCalls).toBe(0);
  });

  it('clears the sample backend when setPlayer(null) is called', () => {
    const s = new SfxService();
    let handled = false;
    s.setPlayer(() => {
      handled = true;
      return true;
    });
    s.setPlayer(null);
    s.play('shuffle');
    expect(handled).toBe(false);
  });
});
