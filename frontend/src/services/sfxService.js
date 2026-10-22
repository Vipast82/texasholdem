/**
 * sfxService (Sprint 5) — the single funnel for all game sound effects.
 *
 * - Pure sound *mapping* (action -> sfx name) is split out so it is trivially
 *   unit-testable under Node (no AudioContext / fetch needed).
 * - `SfxService` is the decision surface (mute/volume/last-played marker) used
 *   by the store and the tests. It does NOT touch the browser.
 * - `browserSound` (exported for the browser bundle) does the actual playback:
 *   it prefers the real card/chip sample MP3s shipped in
 *   `public/assets/sfx/` (Kenney CC0 art + community samples) and falls back to
 *   tiny synthesized blips when a sample is missing or the audio stack is
 *   unavailable. Playback is always best-effort and never throws.
 * - Mute + volume gate the actual playback. When muted, `play()` does nothing
 *   (and clears the last-played marker) — that is what the tests assert.
 */

import { getProfile } from '@saloon/shared/ai/aiProfiles';

export const SFX_NAMES = ['chip', 'flick', 'cheer', 'grunt', 'shuffle', 'deal', 'flip', 'chips'];

/**
 * Real audio samples (shipped in `public/assets/sfx/`, resolved relative to the
 * app base URL). Names that have no sample here fall back to the synth presets
 * below. Kept as pure data so it is trivially unit-testable.
 */
export const SAMPLES = {
  shuffle: { file: 'shuffle.mp3', volume: 0.9 },
  deal: { file: 'deal.mp3', volume: 1.0 },
  flip: { file: 'card-flip.mp3', volume: 0.9 },
  chips: { file: 'chips.mp3', volume: 1.0 },
  chip: { file: 'poker-chip.mp3', volume: 0.8 }
};

/** Default (human) action -> sfx map. Mirrors the aiProfiles SHARED_SFX intent. */
export const DEFAULT_SFX_MAP = {
  bet: 'chip',
  call: 'chip',
  raise: 'chip',
  allin: 'chip',
  check: 'flick',
  fold: 'flick',
  win: 'cheer',
  lose: 'grunt'
};

export function soundForAction(action) {
  return DEFAULT_SFX_MAP[action] || null;
}

/** Use the bot difficulty's own sfxMap (from aiProfiles), falling back to default. */
export function soundForBotAction(action, difficulty) {
  const profile = getProfile(difficulty);
  const map = (profile && profile.personality && profile.personality.sfxMap) || {};
  return map[action] || DEFAULT_SFX_MAP[action] || null;
}

/** Resolve the sound for an `actionTaken` game event (bot or human actor). */
export function resolveActionSound(payload) {
  if (!payload || !payload.action) return null;
  const snap = payload.snapshot;
  const actor =
    snap && Array.isArray(snap.players)
      ? snap.players.find((p) => p.id === payload.playerId)
      : null;
  if (actor && actor.isBot) {
    return soundForBotAction(payload.action, actor.bot && actor.bot.difficulty);
  }
  return soundForAction(payload.action);
}

/** Resolve a win/lose sound for the local player when a hand ends. */
export function resolveHandEndSound(payload, playerId) {
  if (!payload || !playerId) return null;
  const winners = Array.isArray(payload.winnerIds)
    ? payload.winnerIds
    : payload.winnerId
      ? [payload.winnerId]
      : [];
  const won = winners.includes(playerId);
  return won ? 'cheer' : 'grunt';
}

export class SfxService {
  constructor() {
    this._muted = false;
    this._volume = 0.8;
    this._last = null; // { name, volume, at } — observability + tests
    this._player = null; // optional fn(name, volume) supplied by the browser
  }

  get lastPlayed() {
    return this._last;
  }

  isMuted() {
    return this._muted;
  }

  getVolume() {
    return this._volume;
  }

  setMuted(muted) {
    this._muted = !!muted;
  }

  setVolume(volume) {
    const n = Number(volume);
    this._volume = Number.isFinite(n) ? clamp01(n) : 0.8;
    return this._volume;
  }

  /**
   * Install a real playback backend (browser `browserSound`). When present it is
   * preferred for sounds it handles; otherwise we fall back to the synth blips.
   * A `null`/undefined argument clears it (back to pure synth). Tests may use
   * this to spy on playback without touching the browser.
   * @param {(name: string, volume: number) => boolean|null|undefined} [player]
   */
  setPlayer(player) {
    this._player = typeof player === 'function' ? player : null;
    return this;
  }

  /**
   * Play a named sound. Returns a descriptor for tests/UI.
   * @returns {{ played: boolean, name?: string, reason?: string }}
   */
  play(name) {
    if (!SFX_NAMES.includes(name)) {
      this._last = null;
      return { played: false, reason: 'unknown-sound' };
    }
    if (this._muted) {
      this._last = null;
      return { played: false, reason: 'muted' };
    }
    this._last = { name, volume: this._volume, at: Date.now() };
    // Prefer the real sample backend; fall back to the synth blip if it does
    // not handle this name (or no backend is installed, e.g. under Node).
    let handled = false;
    if (this._player) {
      try {
        handled = this._player(name, this._volume) === true;
      } catch (err) {
        handled = false; // never let audio break the game
      }
    }
    if (!handled) this._synth(name);
    return { played: true, name };
  }

  /** Best-effort synthesized blip. No-op when no AudioContext is available. */
  _synth(name) {
    const Ctor =
      (typeof window !== 'undefined' && window.AudioContext) ||
      (typeof AudioContext !== 'undefined' ? AudioContext : null);
    if (!Ctor) return;
    try {
      const ctx = new Ctor();
      const now = ctx.currentTime;
      const preset = SYNTH_PRESETS[name] || SYNTH_PRESETS.chip;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = preset.wave;
      osc.frequency.setValueAtTime(preset.from, now);
      osc.frequency.exponentialRampToValueAtTime(preset.to, now + preset.dur);
      const peak = Math.max(0.0001, this._volume * preset.amp);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(peak, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + preset.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + preset.dur + 0.02);
      // Let the short blip finish, then release the context.
      setTimeout(() => {
        if (ctx.state !== 'closed') ctx.close().catch(() => {});
      }, Math.round(preset.dur * 1000) + 60);
    } catch (err) {
      // Audio is strictly best-effort; never break the game.
    }
  }
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

const SYNTH_PRESETS = {
  chip: { wave: 'square', from: 660, to: 990, dur: 0.08, amp: 0.5 },
  flick: { wave: 'triangle', from: 320, to: 180, dur: 0.06, amp: 0.4 },
  cheer: { wave: 'sawtooth', from: 392, to: 784, dur: 0.3, amp: 0.6 },
  grunt: { wave: 'sawtooth', from: 150, to: 70, dur: 0.25, amp: 0.5 },
  shuffle: { wave: 'square', from: 180, to: 120, dur: 0.2, amp: 0.35 },
  deal: { wave: 'triangle', from: 500, to: 240, dur: 0.1, amp: 0.45 },
  flip: { wave: 'triangle', from: 700, to: 300, dur: 0.12, amp: 0.45 },
  chips: { wave: 'square', from: 880, to: 1320, dur: 0.28, amp: 0.6 },
  // A soft two-note chime when the action reaches you, and the clock tick.
  turn: { wave: 'sine', from: 660, to: 880, dur: 0.18, amp: 0.35 },
  tick: { wave: 'sine', from: 1200, to: 1100, dur: 0.04, amp: 0.25 }
};

/**
 * Browser playback backend. Plays the real sample MP3 for a given sound name
 * (see `SAMPLES`) and returns `true` when a sample actually started. Returns
 * `undefined` when there is no sample (so the caller falls back to the synth)
 * or when audio is unavailable. Safe to call outside a browser (no-op).
 *
 * Samples are cached as `<audio>` elements keyed by name so repeats are cheap
 * and (once decoded) near-instant.
 */
const _audioCache = new Map();

export function browserSound(name, volume) {
  const sample = SAMPLES[name];
  if (!sample) return undefined; // no sample -> let the synth handle it
  if (typeof Audio === 'undefined') return undefined;
  const vol = clamp01(volume || 0.8) * (sample.volume || 1);
  if (vol <= 0) return true; // muted-by-volume: count as "handled" (silence)
  let audio = _audioCache.get(name);
  if (!audio) {
    audio = new Audio(`/assets/sfx/${sample.file}`);
    audio.preload = 'auto';
    _audioCache.set(name, audio);
  }
  try {
    audio.volume = vol;
    // Restart from the top for a consistent one-shot gesture.
    audio.currentTime = 0;
    const p = audio.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {}); // autoplay/other rejections are fine — synth still silent
    }
    return true;
  } catch (err) {
    return undefined; // let the synth fallback kick in
  }
}

/**
 * Wire the real sample backend into a service (defaults to the shared
 * singleton). Idempotent and safe under Node (browserSound becomes a no-op
 * there, so the synth remains the fallback). Call once on app start.
 */
export function installRealSound(service = sfxService) {
  service.setPlayer(browserSound);
  return service;
}

/** Default singleton used across the app. Tests may create fresh instances. */
export const sfxService = new SfxService();
