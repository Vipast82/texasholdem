/**
 * autosave (Sprint 5) — persist the player's small profile + last-session
 * state after every hand, and rehydrate it on load.
 *
 *   - Small data (profile, settings, sfx, last session) → localStorage (KV).
 *   - Binaries (avatar blob) → IndexedDB via avatarStore (NEVER here).
 *   - Avatar *metadata* (avatarId) → localStorage profile; only the id.
 *
 * Everything serializable is PURE (serializeProfile / deserializeProfile /
 * buildSessionSnapshot) so it is unit-testable under Node. The I/O layer is a
 * small, injectable service so tests can supply an in-memory KV store.
 */

export const PROFILE_KEY = 'saloon.profile';

export const PROFILE_DEFAULTS = {
  name: 'Gunslinger',
  language: 'en',
  settings: {
    hud: false,
    autoPersist: false
  },
  sfx: {
    muted: false,
    volume: 0.8
  },
  avatarId: null,
  lastSession: null,
  handCount: 0
};

/** Deep-merge a stored raw profile over the defaults (pure). */
export function mergeProfile(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const def = PROFILE_DEFAULTS;
  return {
    name: typeof src.name === 'string' && src.name ? src.name : def.name,
    language: src.language === 'es' || src.language === 'en' ? src.language : def.language,
    settings: {
      hud: !!(src.settings && src.settings.hud),
      autoPersist: !!(src.settings && src.settings.autoPersist)
    },
    sfx: {
      muted: !!(src.sfx && src.sfx.muted),
      volume:
        src.sfx && Number.isFinite(Number(src.sfx.volume))
          ? Math.max(0, Math.min(1, Number(src.sfx.volume)))
          : def.sfx.volume
    },
    avatarId: typeof src.avatarId === 'string' && src.avatarId ? src.avatarId : null,
    lastSession: src.lastSession && typeof src.lastSession === 'object' ? src.lastSession : null,
    handCount: Number.isFinite(Number(src.handCount)) && Number(src.handCount) > 0 ? Number(src.handCount) : 0
  };
}

/** Serialize a profile to a JSON-safe plain object (pure). */
export function serializeProfile(profile) {
  return mergeProfile(profile);
}

/** Deserialize a raw stored value into a full profile (pure; tolerant). */
export function deserializeProfile(raw) {
  if (raw == null) return mergeProfile(null);
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch (err) {
      return mergeProfile(null);
    }
  }
  return mergeProfile(raw);
}

/**
 * Reduce a hand-end event payload to a tiny last-session snapshot (pure).
 * Never includes hole cards or other players' private data — just the local
 * player's outcome, for a "welcome back" hint on reconnect.
 */
export function buildSessionSnapshot(payload, playerId, tableId) {
  if (!payload) return null;
  const winners = Array.isArray(payload.winnerIds)
    ? payload.winnerIds
    : payload.winnerId
      ? [payload.winnerId]
      : [];
  const won = playerId ? winners.includes(playerId) : false;
  const myPayout = playerId && payload.payouts ? payload.payouts[playerId] || 0 : 0;
  const snap = payload.snapshot || {};
  return {
    tableId: tableId || snap.tableId || null,
    handNumber: snap.handNumber != null ? snap.handNumber : null,
    reason: payload.reason || null,
    won: !!won,
    myPayout,
    at: Date.now()
  };
}

/**
 * AutosaveService — the I/O funnel (KV + optional IDB). Pure helpers above
 * are the testable core; this class just wires them to storage.
 */
export class AutosaveService {
  /**
   * @param {{ kv?: object, idb?: object }} [deps] kv: { getItem, setItem, removeItem }
   */
  constructor({ kv = null, idb = null } = {}) {
    this._kv = kv || (typeof localStorage !== 'undefined' ? localStorage : memoryKV());
    this._idb = idb;
  }

  /** Persist the profile (small data only). @returns {Promise<object>} the saved profile */
  async saveProfile(profile) {
    const out = serializeProfile(profile);
    this._kv.setItem(PROFILE_KEY, JSON.stringify(out));
    return out;
  }

  /** Load + merge the stored profile (defaults applied). @returns {Promise<object>} */
  async loadProfile() {
    const raw = this._kv.getItem(PROFILE_KEY);
    return deserializeProfile(raw);
  }

  /**
   * After a hand ends: record the last-session snapshot + bump handCount, then
   * persist. Pure snapshot building + KV write.
   * @returns {Promise<object>} the updated profile
   */
  async recordHandEnd(profile, payload, playerId, tableId) {
    // Accumulate handCount from the STORED profile (so repeated calls over a
    // session keep counting up), then layer the caller's profile fields over it
    // and stamp the new last-session snapshot.
    const stored = await this.loadProfile();
    const base = serializeProfile({ ...stored, ...profile });
    base.handCount = (stored.handCount || 0) + 1;
    base.lastSession = buildSessionSnapshot(payload, playerId, tableId);
    return this.saveProfile(base);
  }

  /** Drop the stored profile. */
  async clear() {
    this._kv.removeItem(PROFILE_KEY);
  }

  /**
   * Rehydrate on load: resolve profile + (if it references an avatar) the
   * avatar's object URL from IndexedDB. Binary is resolved client-side only.
   * @returns {Promise<object>} { profile, avatar }
   */
  async hydrate() {
    const profile = await this.loadProfile();
    let avatar = null;
    if (profile.avatarId && this._idb && typeof this._idb.loadAvatar === 'function') {
      try {
        avatar = await this._idb.loadAvatar(profile.avatarId);
      } catch (err) {
        avatar = null;
      }
    }
    return { profile, avatar };
  }
}

/** Minimal in-memory KV (default for Node tests / no-DOM environments). */
function memoryKV() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => {
      data.set(k, String(v));
    },
    removeItem: (k) => {
      data.delete(k);
    }
  };
}

/** Default singleton (localStorage + avatarStore idb). */
export const autosaveService = new AutosaveService();
