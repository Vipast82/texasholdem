/**
 * Voices and the radio. Sound effects stay in sfxService; this file handles
 * the longer audio: CPU / announcer / dealer voice lines and KSAL, the
 * saloon radio that plays the background music. Everything is best-effort and silent outside a browser.
 */

import { ANNOUNCER_LINES, ANNOUNCER_KEY, lineId } from '@saloon/shared/voiceLines';

const hasAudio = () => typeof Audio !== 'undefined';
const clamp01 = (n) => Math.max(0, Math.min(1, Number.isFinite(Number(n)) ? Number(n) : 0));

export const voicePath = (voice, id) => `/assets/voice/${voice}/${id}.mp3`;

/**
 * Plays voice lines one at a time so speakers never talk over each other.
 * At most a couple of lines wait in line; anything beyond that is dropped
 * (stale heckles are worse than none).
 */
export class VoicePlayer {
  constructor() {
    this.volume = 0.9;
    this.muted = false;
    this.queue = [];
    this.current = null;
    this.onSpeaking = null; // (speaking: boolean) => void, used to duck the music
  }

  setVolume(v) {
    this.volume = clamp01(v);
  }

  setMuted(m) {
    this.muted = !!m;
    if (this.muted) this.stop();
  }

  stop() {
    this.queue = [];
    if (this.current) {
      try {
        this.current.pause();
      } catch (err) {
        // ignore
      }
    }
    this.current = null;
    if (this.onSpeaking) this.onSpeaking(false);
  }

  /** Queue a clip. `skipIfBusy` drops it instead of waiting (dealer callouts). */
  say(src, { skipIfBusy = false } = {}) {
    if (!hasAudio() || this.muted || this.volume <= 0) return false;
    if (this.current) {
      if (skipIfBusy || this.queue.length >= 2) return false;
      this.queue.push(src);
      return true;
    }
    this._start(src);
    return true;
  }

  _start(src) {
    const audio = new Audio(src);
    audio.volume = this.volume;
    this.current = audio;
    if (this.onSpeaking) this.onSpeaking(true);
    const next = () => {
      if (this.current !== audio) return;
      this.current = null;
      const following = this.queue.shift();
      if (following) this._start(following);
      else if (this.onSpeaking) this.onSpeaking(false);
    };
    audio.addEventListener('ended', next);
    audio.addEventListener('error', next);
    const p = audio.play();
    if (p && typeof p.catch === 'function') p.catch(next);
  }
}

/** Where the radio's playlist lives (built from whatever tracks are installed). */
export const RADIO_MANIFEST = '/assets/music/radio.json';

/** Shuffle a copy of a list (Fisher-Yates). */
function shuffled(list, random = Math.random) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * KSAL saloon radio. Shuffles through the playlist, now and then plays a
 * station ID from the announcer between songs, switches to the tense track
 * for a heads-up tournament finish, and ducks under table talk.
 * `onChange(state)` reports { station, track, playing, enabled } for the UI.
 */
export class RadioPlayer {
  constructor() {
    this.enabled = true;
    this.volume = 0.35;
    this.mood = 'saloon';
    this.station = 'KSAL Saloon Radio';
    this.tracks = [];
    this.queue = [];
    this.current = null; // track object
    this.audio = null;
    this.playing = false; // the player wants to be playing (after start())
    this.paused = false; // the listener paused it
    this.ducked = false;
    this.songsSinceBreak = 0;
    this.djLines = []; // [{ voice, id }] station IDs
    this.onChange = null;
    this._fade = null;
    this._loading = null;
  }

  state() {
    return {
      station: this.station,
      track: this.current,
      playing: this.playing && this.enabled && !this.paused && !!this.audio,
      enabled: this.enabled
    };
  }

  _emit() {
    if (this.onChange) this.onChange(this.state());
  }

  _target() {
    return this.volume * (this.ducked ? 0.4 : 1);
  }

  async load() {
    if (this._loading) return this._loading;
    this._loading = (async () => {
      try {
        if (typeof fetch !== 'function') return;
        const res = await fetch(RADIO_MANIFEST);
        if (!res.ok) return;
        const data = await res.json();
        this.station = data.station || this.station;
        this.tracks = Array.isArray(data.tracks) ? data.tracks.filter((tr) => tr && tr.file) : [];
      } catch (err) {
        this.tracks = [];
      }
    })();
    return this._loading;
  }

  setVolume(v) {
    this.volume = clamp01(v);
    if (this.audio) this.audio.volume = this._target();
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (!this.enabled) this._halt();
    else if (this.playing && !this.paused && !this.audio) this._next();
    this._emit();
  }

  duck(on) {
    this.ducked = !!on;
    if (this.audio) this._rampTo(this._target(), 300);
  }

  /** Turn the radio on (call from a click so the browser allows sound). */
  async start() {
    this.playing = true;
    await this.load();
    if (this.enabled && !this.paused && !this.audio) this._next();
  }

  /** Turn the radio off (leaving the table). */
  stop() {
    this.playing = false;
    this._halt();
    this._emit();
  }

  /** Listener's play/pause button. */
  toggle() {
    if (!this.audio) {
      this.paused = false;
      if (this.playing && this.enabled) this._next();
    } else if (this.paused) {
      this.paused = false;
      const p = this.audio.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } else {
      this.paused = true;
      this.audio.pause();
    }
    this._emit();
  }

  /** Listener's skip button. */
  skip() {
    this.paused = false;
    this._crossTo(() => this._next({ noBreak: true }));
  }

  /** "saloon" for normal play, "showdown" for a tense finish. */
  setMood(mood) {
    if (mood === this.mood) return;
    this.mood = mood;
    const hasShowdown = this.tracks.some((tr) => tr.mood === 'showdown');
    // Only interrupt the current song when the mood really calls for it.
    if (
      this.audio &&
      this.playing &&
      hasShowdown &&
      (mood === 'showdown' || (this.current && this.current.mood === 'showdown'))
    ) {
      this._crossTo(() => this._next({ noBreak: true }));
    }
  }

  _pickNext() {
    const pool = this.tracks.filter((tr) =>
      this.mood === 'showdown' ? tr.mood === 'showdown' : tr.mood !== 'showdown'
    );
    const list = pool.length ? pool : this.tracks;
    if (!list.length) return null;
    if (this.mood === 'showdown') return list[Math.floor(Math.random() * list.length)];
    if (!this.queue.length) {
      this.queue = shuffled(list);
      // Never play the same song twice in a row across reshuffles.
      if (this.current && this.queue.length > 1 && this.queue[0].file === this.current.file)
        this.queue.push(this.queue.shift());
    }
    return this.queue.shift();
  }

  _next({ noBreak = false } = {}) {
    if (!hasAudio() || !this.enabled || !this.playing || this.paused) return;
    // Every two or three songs, the station ID.
    if (!noBreak && this.djLines.length && this.songsSinceBreak >= 2 && Math.random() < 0.6) {
      this.songsSinceBreak = 0;
      const dj = this.djLines[Math.floor(Math.random() * this.djLines.length)];
      this._playFile(`/assets/voice/${dj.voice}/${dj.id}.mp3`, null, 0.9);
      return;
    }
    const track = this._pickNext();
    if (!track) return;
    this.songsSinceBreak += 1;
    this._playFile(track.file, track);
  }

  _playFile(src, track, gain = 1) {
    const audio = new Audio(src);
    audio.volume = 0;
    audio.loop = !!(track && this.mood === 'showdown' && track.mood === 'showdown');
    const advance = () => {
      if (this.audio !== audio) return;
      this.audio = null;
      this._next();
    };
    audio.addEventListener('ended', advance);
    audio.addEventListener('error', advance);
    this.audio = audio;
    this.current = track || this.current;
    const p = audio.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
    this._rampTo(Math.min(1, this._target() * gain), 1200);
    this._emit();
  }

  /** Fade the current audio out, then run `then`. */
  _crossTo(then) {
    const old = this.audio;
    this.audio = null;
    if (!old) {
      then();
      return;
    }
    this._rampTo(0, 900, old, () => {
      try {
        old.pause();
      } catch (err) {
        // ignore
      }
      then();
    });
  }

  _halt() {
    if (this._fade) clearInterval(this._fade);
    if (this.audio) {
      try {
        this.audio.pause();
      } catch (err) {
        // ignore
      }
    }
    this.audio = null;
  }

  _rampTo(target, ms, audio = this.audio, done = null) {
    if (!audio) return;
    if (audio === this.audio && this._fade) clearInterval(this._fade);
    const from = audio.volume;
    const t0 = Date.now();
    const id = setInterval(() => {
      const k = Math.min(1, (Date.now() - t0) / ms);
      try {
        audio.volume = clamp01(from + (target - from) * k);
      } catch (err) {
        // ignore
      }
      if (k >= 1) {
        clearInterval(id);
        if (done) done();
      }
    }, 50);
    if (audio === this.audio) this._fade = id;
  }
}

export const voicePlayer = new VoicePlayer();
export const musicPlayer = new RadioPlayer();
// Between songs: station IDs and the DJ's jokes.
musicPlayer.djLines = ['radio', 'radioJoke'].flatMap((cat) =>
  (ANNOUNCER_LINES[cat] || []).map((_, i) => ({ voice: ANNOUNCER_KEY, id: lineId(cat, i) }))
);
voicePlayer.onSpeaking = (speaking) => musicPlayer.duck(speaking);
