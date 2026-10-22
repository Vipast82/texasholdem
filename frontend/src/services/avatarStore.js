/**
 * avatarStore (Sprint 5) — upload, key, and resolve player avatars; generate
 * the per-difficulty western/cowboy avatar for AI seats.
 *
 * HARD PRIVACY RULE: the binary (Blob/File) NEVER leaves the client. It is
 * stored in IndexedDB only. What travels over the socket is an `avatarId` +
 * plain metadata object — that is all the server ever sees.
 *
 * Testable under Node: the IDB backend and `createObjectURL` are injectable,
 * and all the decision logic (validation, id generation, cowboy art) is pure
 * and split out for unit tests.
 */

import * as idb from './idb.js';
import { getProfile } from '@saloon/shared/ai/aiProfiles';

/**
 * Avatars accept any common browser image type (GIF, PNG, JPEG, WebP, AVIF,
 * BMP, SVG). Hard cap 20 MB (per spec). Animated formats (GIF/WebP) are
 * rendered as the first frame via CSS `background-image` — the browser
 * handles the animation natively when the source is a data URL / <img>.
 */
export const MAX_AVATAR_BYTES = 20 * 1024 * 1024;
export const ACCEPTED_TYPES = [
  'image/gif',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/svg+xml'
];

/**
 * Validate an uploaded avatar file (pure).
 * @returns {{ ok: boolean, code?: string, type?: string, size?: number }}
 */
export function validateAvatarFile(file) {
  if (!file) return { ok: false, code: 'missing' };
  const type = String(file.type || '').toLowerCase();
  if (!ACCEPTED_TYPES.includes(type)) return { ok: false, code: 'type' };
  const size = Number(file.size || 0);
  if (size > MAX_AVATAR_BYTES) return { ok: false, code: 'size' };
  return { ok: true, type, size };
}

/**
 * Generate a stable avatarId. If a `seed` (string) is given the id is
 * deterministic (good for tests + for re-uploads of the same identity);
 * otherwise a unique id is produced.
 * @param {string|null} [seed]
 */
export function makeAvatarId(seed) {
  if (seed != null && String(seed).length > 0) {
    const slug = String(seed)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return `user-${slug || 'default'}`;
  }
  const rand =
    typeof crypto !== 'undefined' && crypto.getRandomValues
      ? Array.from(crypto.getRandomValues(new Uint8Array(4)))
          .map((b) => (b % 36).toString(36))
          .join('')
      : Math.random().toString(36).slice(2, 8);
  return `user-${Date.now().toString(36)}-${rand}`;
}

const COWBOY_TONES = {
  easy: '#f2c98a',
  normal: '#e6b98d',
  hard: '#d9a878'
};

/** Per-difficulty facial expression fragments (easy=goofy, normal=calm, hard=stoic). */
const COWBOY_EXPRESSIONS = {
  easy: {
    brows:
      '<path d="M40 42 Q46 38 52 42" stroke="#5a3a24" fill="none" stroke-width="2"/><path d="M52 42 Q58 38 64 42" stroke="#5a3a24" fill="none" stroke-width="2"/>',
    eyes: '<circle cx="46" cy="52" r="6" fill="#fff"/><circle cx="54" cy="52" r="6" fill="#fff"/><circle cx="47" cy="53" r="2.5" fill="#2b1c12"/><circle cx="55" cy="53" r="2.5" fill="#2b1c12"/>',
    mouth: '<path d="M44 70 Q50 82 56 70" fill="#7a2e20" stroke="#5a3a24" stroke-width="1.5"/>'
  },
  normal: {
    brows:
      '<line x1="41" y1="44" x2="51" y2="44" stroke="#5a3a24" stroke-width="2"/><line x1="53" y1="44" x2="63" y2="44" stroke="#5a3a24" stroke-width="2"/>',
    eyes: '<circle cx="46" cy="52" r="3.5" fill="#2b1c12"/><circle cx="54" cy="52" r="3.5" fill="#2b1c12"/>',
    mouth: '<line x1="45" y1="72" x2="55" y2="72" stroke="#5a3a24" stroke-width="2"/>'
  },
  hard: {
    brows:
      '<line x1="41" y1="46" x2="51" y2="44" stroke="#5a3a24" stroke-width="2.5"/><line x1="59" y1="46" x2="51" y2="44" stroke="#5a3a24" stroke-width="2.5"/>',
    eyes: '<path d="M42 51 L50 53" stroke="#2b1c12" stroke-width="2.5"/><path d="M58 51 L50 53" stroke="#2b1c12" stroke-width="2.5"/>',
    mouth: '<line x1="44" y1="72" x2="56" y2="72" stroke="#5a3a24" stroke-width="2.5"/>'
  }
};

/**
 * Generate the western/cowboy avatar for an AI difficulty as an inline-SVG
 * data URI. Easy = goofy, normal = calm, hard = stoic. Pure + deterministic,
 * so the art can be swapped for a real asset later without touching callers.
 * @param {string} difficulty 'easy' | 'normal' | 'hard'
 * @returns {string} a `data:image/svg+xml` URI
 */
export function cowboySvg(difficulty) {
  const raw = String(difficulty || 'normal').toLowerCase();
  // Unknown difficulties fall back to "normal" for EVERYTHING (skin, face AND
  // label), so an unrecognized difficulty renders exactly like normal.
  const diff = COWBOY_TONES[raw] ? raw : 'normal';
  const skin = COWBOY_TONES[diff];
  const face = COWBOY_EXPRESSIONS[diff];
  const label = diff.toUpperCase();
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">` +
    `<circle cx="50" cy="55" r="34" fill="${skin}"/>` +
    `<path d="M18 40 Q50 20 82 40 L78 48 Q50 34 22 48 Z" fill="#5a3a24"/>` +
    `<path d="M34 40 Q34 14 50 14 Q66 14 66 40 Z" fill="#6d4526"/>` +
    `<rect x="46" y="28" width="8" height="8" rx="1" fill="#e0b34a"/>` +
    `${face.brows}${face.eyes}${face.mouth}` +
    `<text x="50" y="96" font-size="8" text-anchor="middle" fill="#5a3a24">${label}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,` + encodeURIComponent(svg);
}

export class AvatarStore {
  /**
   * @param {{ idb?: object, createObjectURL?: Function }} [deps]
   */
  constructor({ idb: idbApi = idb, createObjectURL = null } = {}) {
    this._idb = idbApi;
    this._createObjectURL = createObjectURL;
  }

  /**
   * Validate + store an uploaded avatar. The BLOB is stored in IndexedDB only;
   * the returned value is the small `{ avatarId, ...meta }` that MAY go over
   * the wire.
   * @param {File|Blob} file
   * @param {object} [meta] optional metadata (e.g. { name })
   * @returns {Promise<{ avatarId: string, type: string, size: number }>}
   */
  async uploadAvatar(file, meta = {}) {
    const v = validateAvatarFile(file);
    if (!v.ok) throw new Error(`avatar invalid: ${v.code}`);
    const avatarId = makeAvatarId(meta.avatarId != null ? String(meta.avatarId) : null);
    const record = {
      avatarId,
      blob: file,
      meta: { ...meta, type: v.type, size: v.size, updatedAt: Date.now() }
    };
    await this._idb.put(record);
    // Never echo the blob back across the wire: return metadata only.
    // Spread meta FIRST so the canonical `avatarId` always wins (the caller's
    // `meta.avatarId` seed is a raw id like "seed-1", not the stored key).
    return { ...record.meta, avatarId };
  }

  /**
   * Resolve an avatarId to a display object URL (from the stored blob).
   * @returns {Promise<{ avatarId, url, meta } | null>}
   */
  async loadAvatar(avatarId) {
    if (!avatarId) return null;
    const record = await this._idb.get(avatarId);
    if (!record || !record.blob) return null;
    const makeUrl = this._createObjectURL || ((b) => URL.createObjectURL(b));
    const url = makeUrl(record.blob);
    return { avatarId, url, kind: record.kind || 'upload', meta: record.meta || {} };
  }

  /** Remove a stored avatar (blob + metadata). */
  async removeAvatar(avatarId) {
    await this._idb.del(avatarId);
  }

  /** List stored avatarIds. */
  async listAvatars() {
    return this._idb.keys();
  }

  /**
   * Describe the AI avatar for a difficulty. No binary involved — it's inline
   * SVG (data URI), so this is safe for both rendering and (if ever needed)
   * the wire. Ties to the aiProfiles `avatarId`.
   * @param {string} difficulty
   */
  avatarForBot(difficulty) {
    const profile = getProfile(difficulty);
    return {
      avatarId: profile.personality.avatarId,
      kind: 'cowboy',
      difficulty: profile.difficulty,
      src: cowboySvg(profile.difficulty)
    };
  }

  /**
   * "Generate" the western avatar(s) for a difficulty (Sprint 5 spec). Pure
   * descriptor — no storage needed because the art is inline SVG.
   * @param {string} difficulty
   */
  generateAvatarsForAI(difficulty) {
    return this.avatarForBot(difficulty);
  }
}

/** Default singleton (uses the browser IndexedDB + URL.createObjectURL). */
export const avatarStore = new AvatarStore();
