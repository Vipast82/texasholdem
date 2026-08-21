/**
 * emoteService.js (Sprint 6) — pure emote decision logic.
 * No DOM needed: the tests assert which emote fires for which event.
 */
import { describe, it, expect } from 'vitest';
import {
  EMOTES,
  EMOTE_CODES,
  autoEmoteForEvent,
  validateEmote,
  emoteGlyph
} from '../src/services/emoteService.js';

describe('EMOTES catalog', () => {
  it('has at least 8 emotes', () => {
    expect(EMOTES.length).toBeGreaterThanOrEqual(8);
  });

  it('every emote has a unique code, a glyph, and a label_key', () => {
    const codes = EMOTES.map((e) => e.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const e of EMOTES) {
      expect(typeof e.code).toBe('string');
      expect(e.code.length).toBeGreaterThan(0);
      expect(e.glyph.length).toBeGreaterThan(0);
      expect(e.label_key).toMatch(/^emote\./);
    }
  });

  it('EMOTE_CODES mirrors the EMOTES array', () => {
    expect(EMOTE_CODES).toEqual(EMOTES.map((e) => e.code));
  });
});

describe('autoEmoteForEvent', () => {
  it('returns "cheer" when the local player wins a hand', () => {
    expect(autoEmoteForEvent('handEnded', { isWinner: true })).toBe('cheer');
  });

  it('returns "sad" when an all-in player loses', () => {
    expect(autoEmoteForEvent('handEnded', { isAllIn: true, isLoser: true })).toBe('sad');
  });

  it('returns null when the local player neither won nor was all-in-losing', () => {
    expect(autoEmoteForEvent('handEnded', { isWinner: false, isAllIn: false, isLoser: false })).toBeNull();
    expect(autoEmoteForEvent('handEnded', {})).toBeNull();
  });

  it('maps actionTaken → correct emotes', () => {
    expect(autoEmoteForEvent('actionTaken', { action: 'fold' })).toBe('whiskey');
    expect(autoEmoteForEvent('actionTaken', { action: 'allin' })).toBe('fire');
    expect(autoEmoteForEvent('actionTaken', { action: 'check' })).toBe('tip_hat');
    expect(autoEmoteForEvent('actionTaken', { action: 'bet' })).toBe('coins');
    expect(autoEmoteForEvent('actionTaken', { action: 'raise' })).toBe('coins');
    expect(autoEmoteForEvent('actionTaken', { action: 'call' })).toBe('coins');
  });

  it('returns null for unknown actions', () => {
    expect(autoEmoteForEvent('actionTaken', { action: 'nonsense' })).toBeNull();
  });

  it('returns "cards" on the flop street start', () => {
    expect(autoEmoteForEvent('streetStarted', { street: 'flop' })).toBe('cards');
  });

  it('returns null for turn/river street starts', () => {
    expect(autoEmoteForEvent('streetStarted', { street: 'turn' })).toBeNull();
    expect(autoEmoteForEvent('streetStarted', { street: 'river' })).toBeNull();
  });

  it('returns null for unknown events', () => {
    expect(autoEmoteForEvent('unknownEvent', {})).toBeNull();
    expect(autoEmoteForEvent('', {})).toBeNull();
    expect(autoEmoteForEvent(null)).toBeNull();
  });
});

describe('validateEmote', () => {
  it('accepts a valid emote code', () => {
    expect(validateEmote('whiskey')).toBe('whiskey');
    expect(validateEmote('cheer')).toBe('cheer');
  });

  it('rejects invalid codes', () => {
    expect(validateEmote('nonexistent')).toBeNull();
    expect(validateEmote('')).toBeNull();
    expect(validateEmote(null)).toBeNull();
    expect(validateEmote(42)).toBeNull();
  });
});

describe('emoteGlyph', () => {
  it('returns the correct glyph for known codes', () => {
    expect(emoteGlyph('whiskey')).toBe('🥃');
    expect(emoteGlyph('cheer')).toBe('🎉');
    expect(emoteGlyph('fire')).toBe('🔥');
  });

  it('returns a fallback for unknown codes', () => {
    expect(emoteGlyph('nope')).toBe('❓');
    expect(emoteGlyph(null)).toBe('❓');
  });
});