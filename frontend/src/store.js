import { create } from 'zustand';
import { socket, emitAck } from './socket.js';
import { avatarStore } from './services/avatarStore.js';
import { AutosaveService, PROFILE_DEFAULTS } from './services/autosave.js';
import { sfxService, resolveActionSound } from './services/sfxService.js';
import { autoEmoteForEvent, validateEmote, emoteGlyph } from './services/emoteService.js';
import { setLocale as applyModuleLocale } from './i18n.js';

// Wire autosave to the avatar store so hydrate() can resolve MY avatar's object
// URL client-side (the binary never leaves IndexedDB). Kept as a module-level
// singleton so every store action shares the same KV + idb backend.
const autosave = new AutosaveService({ idb: avatarStore });

// Tutorial settings live in their own slice (persisted in sessionStorage so a
// refresh keeps the player's choices) and are applied to the TutorialEngine by
// the UI. The engine itself stays out of the store to keep it unit-testable.
const TUTORIAL_DEFAULTS = {
  mode: 'off',
  verbosity: 'normal',
  hintsEnabled: false,
  locale: 'en'
};

const HUD_DEFAULTS = {
  enabled: false,
  seed: 'hud',
  iterations: 300
};

const SPECTATOR_DEFAULTS = {
  active: false,
  showAll: true,
  tableId: null
};

const HISTORY_DEFAULTS = {
  records: [],
  autoPersist: false
};

const HISTORY_CAP = 200;

const initialState = {
  connected: false,
  tableId: null,
  playerId: null,
  name: null,
  snapshot: null,
  chat: [],
  error: null,
  botActions: {}, // playerId -> { action, reason, confidence, ts }
  tutorial: { ...TUTORIAL_DEFAULTS },
  hud: { ...HUD_DEFAULTS },
  spectator: { ...SPECTATOR_DEFAULTS },
  history: { ...HISTORY_DEFAULTS },

  // Sprint 5 — profile / avatars / sound (all client-side; see services/)
  profile: { ...PROFILE_DEFAULTS }, // autosaved profile (name, botDifficulty, tutorialSeen)
  sfx: { muted: false, volume: 0.8 }, // mirrors sfxService; persisted inside profile
  // My own uploaded avatar (I am the only client that holds the binary).
  avatar: { id: null, url: null, crop: null, srcW: null, srcH: null },
  avatarBusy: false,
  avatarError: null,

  // Sprint 6 — emote bubbles (local-only, no server round-trip)
  emotes: {}, // { [playerId]: { code, glyph, ts } }
  _emoteTimers: {}
};

/**
 * Sprint 5 — decide the win/lose SFX for the LOCAL player from a `handEnded`
 * payload. We only play a sound if you actually took part in the hand (you were
 * dealt in / contributed), so a mere spectator watching bots play does not hear
 * a fake "lose" grunt. Resolves through the shared sfxService so a bot actor
 * would use its own sfxMap (kept here for parity; hand-end is player-scoped).
 * @returns {string|null} 'cheer' | 'grunt' | null
 */
function handEndSoundForMe(payload, playerId) {
  const winners = Array.isArray(payload.winnerIds)
    ? payload.winnerIds
    : payload.winnerId
      ? [payload.winnerId]
      : [];
  const me =
    payload.snapshot &&
    Array.isArray(payload.snapshot.players)
      ? payload.snapshot.players.find((p) => p.id === playerId)
      : null;
  const participated = me && (me.hasFolded || me.holeCards || me.contributions);
  if (!participated) return null; // not in this hand — stay silent
  return winners.includes(playerId) ? 'cheer' : 'grunt';
}

export const useGameStore = create((set, get) => ({
  ...initialState,

  // ---- socket events
  _onState: (snapshot) => set({ snapshot, error: null }),
  _onChat: (msg) => set((s) => ({ chat: [...s.chat, msg].slice(-100) })),
  _onBotAction: ({ playerId, action, reason, confidence }) =>
    set((s) => ({
      botActions: { ...s.botActions, [playerId]: { action, reason, confidence, ts: Date.now() } }
    })),
  _onGameEvent: ({ event, payload }) => {
    // Sprint 5 — SFX: map the mirrored game event to a sound and play it.
    // resolve* are pure and already pick the BOT's own sfxMap (from aiProfiles)
    // when the actor is a bot, so "the cowboy grunts, the newbie flicks" works.
    //
    // Card-flow sounds (shuffle / deal / flip) fire on the engine's lifecycle
    // events so the table feels like a real card game:
    //   handStarted  -> shuffle   (the deck is shuffled & dealt)
    //   holeDealt    -> deal      (hole cards hit the felt, one per player)
    //   streetStarted-> flip      (flop / turn / river cards turn face-up)
    // All of these are best-effort and MUST never break the game flow.
    try {
      if (event === 'actionTaken' && payload) {
        const s = resolveActionSound(payload);
        if (s) sfxService.play(s);
        // Sprint 6 — auto emote for the LOCAL player's own actions
        if (payload.playerId === get().playerId) {
          get()._autoEmote('actionTaken', { action: payload.action });
        }
      } else if (event === 'handEnded' && payload) {
        const me = get().playerId;
        if (me) {
          const s = handEndSoundForMe(payload, me);
          if (s) sfxService.play(s);
          // Sprint 6 — auto emote for the LOCAL player (cheer on win, sad on all-in loss)
          const meP =
            payload.snapshot &&
            Array.isArray(payload.snapshot.players)
              ? payload.snapshot.players.find((p) => p.id === me)
              : null;
          const winners = Array.isArray(payload.winnerIds)
            ? payload.winnerIds
            : payload.winnerId
              ? [payload.winnerId]
              : [];
          get()._autoEmote('handEnded', {
            isWinner: winners.includes(me),
            isAllIn: !!(meP && meP.isAllIn),
            isLoser: !winners.includes(me) && !!(meP && (meP.hasFolded || meP.holeCards))
          });
          get().recordHandEnd(payload); // autosave profile/stats (best-effort)
        }
      } else if (event === 'handStarted') {
        sfxService.play('shuffle');
      } else if (event === 'holeDealt') {
        sfxService.play('deal');
      } else if (event === 'streetStarted') {
        const street = payload && payload.street;
        if (street === 'flop' || street === 'turn' || street === 'river') {
          sfxService.play('flip');
        }
        // Sprint 6 — "look at these cards!" on the flop
        if (street === 'flop' && get().playerId) {
          get()._autoEmote('streetStarted', { street });
        }
      }
    } catch (err) {
      // SFX + autosave are best-effort and must NEVER break the game flow.
    }

    // The tutorial engine subscribes by setting this handler (see TutorialPanel).
    const cb = get()._tutorialEventCb;
    if (typeof cb === 'function') {
      try {
        cb(event, payload);
      } catch (err) {
        // Tutorial must never break the game.
      }
    }
  },
  _onHandRecord: (record) => {
    // A finished hand broadcast from the server. Keep it newest-first, capped.
    set((s) => ({
      history: {
        ...s.history,
        records: [record, ...s.history.records].slice(0, HISTORY_CAP)
      }
    }));
  },
  _tutorialEventCb: null,
  setTutorialEventCb(fn) {
    set({ _tutorialEventCb: fn || null });
  },
  _onConnect: () => set({ connected: true }),
  _onDisconnect: () => set({ connected: false, snapshot: null, tableId: null, playerId: null }),
  _onError: (err) => set({ error: err.message || 'Connection error' }),

  connect() {
    socket.on('connect', this._onConnect);
    socket.on('disconnect', this._onDisconnect);
    socket.on('state', this._onState);
    socket.on('chatMessage', this._onChat);
    socket.on('botAction', this._onBotAction);
    socket.on('gameEvent', this._onGameEvent);
    socket.on('handRecord', this._onHandRecord);
    socket.on('emote', this._onEmote);
    socket.on('connect_error', this._onError);
  },

  /**
   * Sprint 7 — server-relayed emote. Render the bubble for the target seat,
   * EXCEPT when it's my own emote: I already rendered my own bubble locally in
   * `sendEmote`, and socket.io also echoes the room broadcast back to me, so
   * skipping my own id here prevents a double bubble for the sender while every
   * other seat still sees the bubble it was relayed to.
   */
  _onEmote({ playerId, code }) {
    const valid = validateEmote(code);
    if (!valid || !playerId) return;
    if (playerId === get().playerId) return; // my own emote is already rendered locally
    get().showEmoteBubble(playerId, valid);
  },

  async join(tableId, name, options = {}) {
    const { isBot = false, bot = null, spawnBot = false, botDifficulty = 'normal', avatarMeta = null } = options;
    const res = await emitAck('joinTable', { tableId, name, isBot, bot, spawnBot, botDifficulty, avatarMeta });
    if (!res.ok) {
      set({ error: res.error });
      return false;
    }
    set({ tableId, name, playerId: res.playerId, error: null });
    return true;
  },

  async startHand(seed) {
    const res = await emitAck('startHand', seed != null ? { seed } : {});
    if (!res.ok) set({ error: res.error });
    return res;
  },

  /**
   * Sprint 8 — seat an AI opponent at-will (mid-session). The server already
   * supports `addBot`; this action just emits it with the current tableId so
   * a solo human can fill an empty seat without leaving and re-joining.
   */
  async addBot(botDifficulty = 'normal') {
    const tableId = get().tableId;
    if (!tableId) return { ok: false, error: 'join a table first' };
    const res = await emitAck('addBot', { tableId, botDifficulty });
    if (!res.ok) set({ error: res.error });
    return res;
  },

  /** Remove an AI player (only bots can be removed; blocked mid-hand). */
  async removeBot(botId) {
    const tableId = get().tableId;
    if (!tableId) return { ok: false, error: 'join a table first' };
    const res = await emitAck('removeBot', { tableId, botId });
    if (!res.ok) set({ error: res.error });
    return res;
  },

  // ---- tutorial settings
  setTutorial(settings = {}) {
    set((s) => ({ tutorial: { ...s.tutorial, ...settings } }));
  },
  setLocale(locale) {
    set((s) => ({ tutorial: { ...s.tutorial, locale } }));
    // Keep the i18n module's active locale in sync so the next render uses it.
    applyModuleLocale(locale);
    // Sprint 6 i18n — persist the choice so a reload keeps it (profile.language).
    try {
      autosave.saveProfile({ ...get().profile, language: locale }).catch(() => {});
    } catch (err) {
      // best-effort; a storage error must never break the UI
    }
  },

  // ---- HUD odds (Sprint 4): client-only equity toggle + settings
  setHud(settings = {}) {
    set((s) => ({ hud: { ...s.hud, ...settings } }));
  },
  toggleHud() {
    set((s) => ({ hud: { ...s.hud, enabled: !s.hud.enabled } }));
  },

  // ---- spectator (Sprint 4): show-all + step-through
  async enterSpectator(tableId, showAllCards = true) {
    const res = await emitAck('enterSpectator', { tableId, showAllCards });
    if (!res.ok) {
      set({ error: res.error });
      return false;
    }
    set((s) => ({
      error: null,
      tableId,
      spectator: { ...s.spectator, active: true, tableId, showAll: !!showAllCards }
    }));
    return true;
  },
  setShowAll(on) {
    const tableId = get().spectator.tableId;
    emitAck('setShowAllCards', { tableId, on });
    set((s) => ({ spectator: { ...s.spectator, showAll: !!on } }));
  },
  async stepTable() {
    const tableId = get().spectator.tableId;
    const res = await emitAck('step', { tableId });
    if (!res.ok) set({ error: res.error });
    return res;
  },

  // ---- hand history (Sprint 4)
  async loadHistory(tableId) {
    const res = await emitAck('getHistory', { tableId });
    if (res && res.ok && Array.isArray(res.hands)) {
      // Server stores newest-last; normalize to newest-first.
      set((s) => ({
        history: { ...s.history, records: [...res.hands].reverse().slice(0, HISTORY_CAP) }
      }));
    } else if (res && !res.ok) {
      set({ error: res.error });
    }
    return res;
  },
  async exportHistory(tableId) {
    const res = await emitAck('exportHistory', { tableId });
    if (!res || !res.ok) {
      if (res && res.error) set({ error: res.error });
      return null;
    }
    return res.json;
  },
  setAutoPersist(on) {
    set((s) => ({ history: { ...s.history, autoPersist: !!on } }));
  },

  async playerAction(action, amount = 0) {
    const res = await emitAck('playerAction', { action, amount });
    if (!res.ok) set({ error: res.error });
    return res;
  },

  // ---- Sprint 5: profile / avatar / sound ---------------------------------
  /**
   * Rehydrate on app load (called once from main.jsx). Loads the stored
   * profile, applies SFX prefs, and resolves MY avatar's object URL from
   * IndexedDB. Best-effort: a storage failure never blocks the app.
   */
  async hydrate() {
    try {
      const { profile, avatar } = await autosave.hydrate();
      const sfx = { muted: !!profile.sfx.muted, volume: Number(profile.sfx.volume) || 0.8 };
      sfxService.setMuted(sfx.muted);
      sfxService.setVolume(sfx.volume);
      const locale = profile.language === 'es' ? 'es' : 'en';
      applyModuleLocale(locale);
      set({
        profile,
        sfx,
        name: profile.name || get().name || 'Gunslinger',
        tutorial: { ...get().tutorial, locale },
        avatar: avatar
          ? {
              id: profile.avatarId,
              url: avatar.url,
              crop: (avatar.meta && avatar.meta.crop) || null,
              srcW: avatar.meta && avatar.meta.w != null ? avatar.meta.w : null,
              srcH: avatar.meta && avatar.meta.h != null ? avatar.meta.h : null
            }
          : { id: null, url: null, crop: null, srcW: null, srcH: null }
      });
    } catch (err) {
      // Never block startup on a storage/read error.
    }
  },

  /**
   * Push my current avatar reference to the server so EVERY OTHER seat at my
   * table can fetch + render it (Sprint 7 sharing). `avatarMeta` is only sent
   * once at `joinTable`; without this, a (re)upload would update only MY seat —
   * the blob is POSTed to /avatars/:id, but the server never learns the new id
   * for my seat, so the other seats keep resolving the stale/missing id and
   * fall back to the default stick figure. Best-effort + no-op when not
   * seated, so it is safe to call on every commit/reset.
   * @param {object|null} avatarMeta small `{avatarId, kind, crop}` or null to clear
   */
  updateAvatar(avatarMeta) {
    const st = get();
    if (!st.tableId || !st.playerId) return; // not joined yet — joinTable carries it
    socket.emit('updateAvatar', { avatarMeta });
  },

  /**
   * Commit an uploaded + cropped avatar. Persists the blob (IndexedDB), records
   * the avatarId in the profile, and exposes the object URL for immediate
   * render. The `avatarMeta` (small) is what later goes over the wire at join.
   * @param {File|Blob} file   the source GIF
   * @param {object}    crop   { x, y, size, w, h } crop window in source pixels
   * @param {object}    [dims] full source image { w, h } in px (for CSS crop)
   * @returns {Promise<object|null>} the small avatarMeta (or null on error)
   */
  async commitAvatar(file, crop, dims = null) {
    set({ avatarBusy: true, avatarError: null });
    try {
      // Persist crop + source dims in the record's meta so hydrate() can re-derive
      // the exact CSS framing after a reload (only small scalars are stored).
      const uploadMeta = {
        kind: 'upload',
        crop: crop || null,
        ...(dims && dims.w ? { w: dims.w, h: dims.h } : {})
      };
      const meta = await avatarStore.uploadAvatar(file, uploadMeta);
      const url = typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(file) : null;
      const avatar = {
        id: meta.avatarId,
        url,
        crop: crop || null,
        srcW: dims && dims.w ? dims.w : null,
        srcH: dims && dims.h ? dims.h : null
      };
      set((s) => ({
        avatar,
        avatarBusy: false,
        profile: { ...s.profile, avatarId: meta.avatarId }
      }));
      // Autosave the small profile (avatarId) so a reload still knows we have one.
      await autosave.saveProfile({ ...get().profile, avatarId: meta.avatarId });
      // Sprint 7 — SHARE the avatar with other seats. The blob still lives in
      // THIS client's IndexedDB, but we also POST the raw bytes to the server so
      // the other players (who do NOT have our blob) can fetch + render it.
      // Best-effort: a failure here must never block the local avatar save.
      if (typeof fetch !== 'undefined' && file && typeof file.arrayBuffer === 'function') {
        try {
          const buf = await file.arrayBuffer();
          const mime = (file.type || 'image/*').split(';')[0].trim();
          await fetch(`/avatars/${encodeURIComponent(meta.avatarId)}`, {
            method: 'POST',
            headers: { 'Content-Type': mime },
            body: buf
          });
        } catch (err) {
          // ignore — other seats just fall back to the default avatar
        }
      }
      // Sprint 7 — let the OTHER seats see it live: attach the new avatarMeta to
      // my player on the server (joinTable only carried it once). No-op if I'm
      // not seated yet, in which case the next joinTable carries it.
      get().updateAvatar({ avatarId: meta.avatarId, kind: 'upload', crop: crop || null });
      // The small metadata object is the ONLY thing allowed over the wire.
      return { avatarId: meta.avatarId, kind: 'upload', crop: crop || null };
    } catch (err) {
      set({ avatarBusy: false, avatarError: err && err.message ? err.message : 'avatar error' });
      return null;
    }
  },

  /** Drop my avatar (blob + profile ref) and reset to the default. */
  async resetAvatar() {
    try {
      const id = get().avatar.id;
      if (id) await avatarStore.removeAvatar(id);
      set((s) => ({
        avatar: { id: null, url: null, crop: null, srcW: null, srcH: null },
        profile: { ...s.profile, avatarId: null }
      }));
      await autosave.saveProfile({ ...get().profile, avatarId: null });
      // Tell the other seats to drop my avatar too (otherwise they keep
      // resolving the old avatarId against the still-cached shared blob).
      get().updateAvatar(null);
    } catch (err) {
      // best-effort
    }
  },

  /** Set SFX mute + volume, apply to the service, and persist in the profile. */
  setSfx(partial = {}) {
    const next = { ...get().sfx, ...partial };
    const muted = !!next.muted;
    const volume = Number.isFinite(Number(next.volume)) ? Math.max(0, Math.min(1, Number(next.volume))) : 0.8;
    sfxService.setMuted(muted);
    sfxService.setVolume(volume);
    const sfx = { muted, volume };
    set((s) => ({ sfx, profile: { ...s.profile, sfx } }));
    autosave.saveProfile({ ...get().profile, sfx }).catch(() => {});
  },

  /** Record a finished hand into the profile (handCount + lastSession). */
  async recordHandEnd(payload) {
    try {
      const profile = await autosave.recordHandEnd(get().profile, payload, get().playerId, get().tableId);
      set({ profile });
    } catch (err) {
      // best-effort; autosave must never break the game
    }
  },

  /** Persist a profile field (name, language, ...) immediately. */
  saveProfile(partial = {}) {
    set((s) => ({ profile: { ...s.profile, ...partial } }));
    autosave.saveProfile(get().profile).catch(() => {});
  },

  sendChat(text) {
    socket.emit('chatMessage', { text });
  },

  /**
   * Sprint 7 — fire an emote bubble above a player's stick figure AND relay it
   * to the table so every OTHER seat sees it too (previously local-only).
   * Auto-clears after 3 s. Safe to call for the local player or a remote one.
   */
  sendEmote(playerId, code) {
    const valid = validateEmote(code);
    if (!valid) return;
    get().showEmoteBubble(playerId, valid);
    // Relay to the server (best-effort; the ack is ignored). The server re-emits
    // to the room, so the other seats render their own bubble via `_onEmote`.
    try {
      socket.emit('emote', { playerId, code: valid });
    } catch (err) {
      // ignore — the local bubble already showed
    }
  },

  /**
   * Render an emote bubble for `playerId` (shared by local sends and the
   * server relay). Auto-dismisses after 3 s, re-arming a fresh timer on
   * repeated sends.
   */
  showEmoteBubble(playerId, code) {
    const glyph = emoteGlyph(code);
    const ts = Date.now();
    set((s) => ({ emotes: { ...s.emotes, [playerId]: { code, glyph, ts } } }));
    // Auto-dismiss after 3 s (guard against stale timers)
    if (globalThis.clearTimeout) {
      clearTimeout(get()._emoteTimers && get()._emoteTimers[playerId]);
    }
    const timer = setTimeout(() => {
      set((s) => {
        const emotes = { ...s.emotes };
        delete emotes[playerId];
        return { emotes };
      });
    }, 3000);
    set((s) => ({ _emoteTimers: { ...(s._emoteTimers || {}), [playerId]: timer } }));
  },

  /**
   * Sprint 6 — auto-emote: derive an emote code from a game event and fire it
   * for the LOCAL player. Called from _onHandEnded / _onActionTaken.
   */
  _autoEmote(event, ctx = {}) {
    const code = autoEmoteForEvent(event, ctx);
    const pid = get().playerId;
    if (code && pid) get().sendEmote(pid, code);
  },

  async leave() {
    await emitAck('leaveTable');
    set({ ...initialState, connected: socket.connected, _tutorialEventCb: null });
  },

  setError(error) {
    set({ error });
  },

  clearError() {
    set({ error: null });
  }
}));
