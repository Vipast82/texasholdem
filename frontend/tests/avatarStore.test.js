/**
 * avatarStore.js (Sprint 5) — validation, stable id generation, cowboy art,
 * upload→IDB (blob stays local), loadAvatar URL resolution, AI avatar tie-in
 * to aiProfiles. Runs against the in-memory IDB mock under Node.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  MAX_AVATAR_BYTES,
  ACCEPTED_TYPES,
  validateAvatarFile,
  makeAvatarId,
  cowboySvg,
  AvatarStore
} from '../src/services/avatarStore.js';
import { installMockIndexedDB } from './helpers/mockIndexedDB.js';
import * as idb from '../src/services/idb.js';

function fakeGif(size, name = 'avatar.gif') {
  return { name, type: 'image/gif', size };
}

beforeEach(() => {
  installMockIndexedDB();
  idb.resetConnection();
});

describe('validateAvatarFile', () => {
  it('accepts a GIF under the cap', () => {
    const r = validateAvatarFile(fakeGif(1024));
    expect(r.ok).toBe(true);
    expect(r.type).toBe('image/gif');
    expect(r.size).toBe(1024);
  });

  it('rejects a missing file', () => {
    expect(validateAvatarFile(null).code).toBe('missing');
  });

  it('rejects a non-GIF type', () => {
    const r = validateAvatarFile({ type: 'image/png', size: 10 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('type');
  });

  it('rejects a GIF over the 20 MB cap', () => {
    const r = validateAvatarFile(fakeGif(MAX_AVATAR_BYTES + 1));
    expect(r.ok).toBe(false);
    expect(r.code).toBe('size');
  });

  it('only accepts image/gif', () => {
    expect(ACCEPTED_TYPES).toEqual(['image/gif']);
  });
});

describe('makeAvatarId', () => {
  it('is deterministic for a seed', () => {
    expect(makeAvatarId('My Cow  Girl!')).toBe('user-my-cow-girl');
    expect(makeAvatarId('Alice')).toBe(makeAvatarId('Alice'));
  });

  it('is unique-ish without a seed', () => {
    const a = makeAvatarId();
    expect(a.startsWith('user-')).toBe(true);
  });
});

describe('cowboySvg', () => {
  it('returns an SVG data URI that varies by difficulty', () => {
    const e = cowboySvg('easy');
    const h = cowboySvg('hard');
    expect(e.startsWith('data:image/svg+xml')).toBe(true);
    expect(e).not.toBe(h);
  });

  it('falls back to normal for unknown difficulty', () => {
    expect(cowboySvg('bogus')).toBe(cowboySvg('normal'));
  });
});

describe('AvatarStore', () => {
  const store = () => new AvatarStore({ createObjectURL: (b) => `blob:mock-${b.size}` });

  it('uploadAvatar stores the blob locally and returns only metadata', async () => {
    const s = store();
    const out = await s.uploadAvatar(fakeGif(2048), { name: 'Luna' });
    // No blob/size-only metadata leaks; avatarId is stable for the seed.
    expect(out.avatarId).toBeTruthy();
    expect(out).not.toHaveProperty('blob');
    expect(out.size).toBe(2048);
    // The blob IS persisted in IDB (verified via idb.get).
    const raw = await idb.get(out.avatarId);
    expect(raw.blob.size).toBe(2048);
    expect(raw.meta.name).toBe('Luna');
  });

  it('uploadAvatar rejects invalid files', async () => {
    const s = store();
    await expect(s.uploadAvatar({ type: 'image/png', size: 10 })).rejects.toThrow(/invalid/);
    await expect(s.uploadAvatar(fakeGif(MAX_AVATAR_BYTES + 1))).rejects.toThrow(/invalid/);
  });

  it('loadAvatar resolves a stored blob to a URL', async () => {
    const s = store();
    const up = await s.uploadAvatar(fakeGif(512), { avatarId: 'seed-1' });
    const loaded = await s.loadAvatar(up.avatarId);
    expect(loaded.url).toBe('blob:mock-512');
    expect(loaded.kind).toBe('upload');
    expect(loaded.meta.size).toBe(512);
  });

  it('loadAvatar returns null for unknown ids', async () => {
    const s = store();
    expect(await s.loadAvatar('nope')).toBeNull();
    expect(await s.loadAvatar(null)).toBeNull();
  });

  it('removeAvatar + listAvatars behave correctly', async () => {
    const s = store();
    await s.uploadAvatar(fakeGif(1), { avatarId: 'x' });
    expect(await s.listAvatars()).toEqual(['user-x']);
    await s.removeAvatar('user-x');
    expect(await s.listAvatars()).toEqual([]);
  });

  it('generateAvatarsForAI ties to aiProfiles avatarId', async () => {
    const s = store();
    for (const d of ['easy', 'normal', 'hard']) {
      const bot = s.generateAvatarsForAI(d);
      expect(bot.kind).toBe('cowboy');
      expect(bot.avatarId).toBe(`bot-${d}`);
      expect(bot.src.startsWith('data:image/svg+xml')).toBe(true);
    }
  });
});
