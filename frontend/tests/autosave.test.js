/**
 * autosave.js (Sprint 5) — pure profile (de)serialization, tolerant merging,
 * last-session snapshot, and the KV-backed AutosaveService (injectable KV).
 */
import { describe, it, expect } from 'vitest';
import {
  PROFILE_KEY,
  PROFILE_DEFAULTS,
  mergeProfile,
  serializeProfile,
  deserializeProfile,
  buildSessionSnapshot,
  AutosaveService
} from '../src/services/autosave.js';

function memoryKV() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      m.set(k, String(v));
    },
    removeItem: (k) => {
      m.delete(k);
    }
  };
}

describe('mergeProfile / serializeProfile / deserializeProfile', () => {
  it('fills defaults for an empty profile', () => {
    const p = mergeProfile(null);
    expect(p).toEqual(PROFILE_DEFAULTS);
    expect(p.sfx.volume).toBe(0.8);
    expect(p.avatarId).toBeNull();
  });

  it('keeps a provided name, language, and settings', () => {
    const p = mergeProfile({
      name: 'Luna',
      language: 'es',
      settings: { hud: true, autoPersist: true }
    });
    expect(p.name).toBe('Luna');
    expect(p.language).toBe('es');
    expect(p.settings.hud).toBe(true);
    expect(p.settings.autoPersist).toBe(true);
  });

  it('rejects an invalid language and falls back to en', () => {
    expect(mergeProfile({ language: 'zz' }).language).toBe('en');
  });

  it('clamps volume and normalizes mute flag', () => {
    expect(mergeProfile({ sfx: { volume: 9, muted: 1 } }).sfx.volume).toBe(1);
    expect(mergeProfile({ sfx: { muted: 1 } }).sfx.muted).toBe(true);
    expect(mergeProfile({ sfx: { volume: -3 } }).sfx.volume).toBe(0);
  });

  it('accepts a string avatarId and normalizes a missing one to null', () => {
    expect(mergeProfile({ avatarId: 'user-a' }).avatarId).toBe('user-a');
    expect(mergeProfile({ avatarId: 123 }).avatarId).toBeNull();
  });

  it('parses a JSON string and tolerates bad JSON', () => {
    expect(deserializeProfile('{"name":"Bo"}').name).toBe('Bo');
    expect(deserializeProfile('{bad json').name).toBe('Gunslinger');
  });

  it('is idempotent', () => {
    const a = serializeProfile({ name: 'Bo', sfx: { volume: 0.5 } });
    expect(serializeProfile(a)).toEqual(a);
  });
});

describe('buildSessionSnapshot', () => {
  it('records a win with the local payout', () => {
    const s = buildSessionSnapshot(
      { winnerIds: ['me'], payouts: { me: 420 }, reason: 'showdown', snapshot: { handNumber: 7, tableId: 't1' } },
      'me',
      't1'
    );
    expect(s.won).toBe(true);
    expect(s.myPayout).toBe(420);
    expect(s.handNumber).toBe(7);
    expect(s.tableId).toBe('t1');
    expect(s.at).toEqual(expect.any(Number));
  });

  it('records a loss with zero payout', () => {
    const s = buildSessionSnapshot({ winnerIds: ['other'], payouts: { other: 100 } }, 'me', 't1');
    expect(s.won).toBe(false);
    expect(s.myPayout).toBe(0);
  });

  it('supports singular winnerId', () => {
    expect(buildSessionSnapshot({ winnerId: 'me' }, 'me', null).won).toBe(true);
  });

  it('returns null for a null payload', () => {
    expect(buildSessionSnapshot(null, 'me', 't1')).toBeNull();
  });
});

describe('AutosaveService', () => {
  it('saves and loads a profile via KV', async () => {
    const kv = memoryKV();
    const svc = new AutosaveService({ kv });
    await svc.saveProfile({ name: 'Luna', language: 'es', sfx: { muted: true } });
    expect(kv.getItem(PROFILE_KEY)).toBeTruthy();
    const loaded = await svc.loadProfile();
    expect(loaded.name).toBe('Luna');
    expect(loaded.language).toBe('es');
    expect(loaded.sfx.muted).toBe(true);
  });

  it('returns defaults when nothing is stored', async () => {
    const svc = new AutosaveService({ kv: memoryKV() });
    const loaded = await svc.loadProfile();
    expect(loaded).toEqual(PROFILE_DEFAULTS);
  });

  it('recordHandEnd bumps handCount and stores lastSession', async () => {
    const svc = new AutosaveService({ kv: memoryKV() });
    const p = await svc.recordHandEnd(
      { name: 'Bo' },
      { winnerIds: ['Bo'], payouts: { Bo: 55 } },
      'Bo',
      't9'
    );
    expect(p.handCount).toBe(1);
    expect(p.lastSession.won).toBe(true);
    expect(p.lastSession.myPayout).toBe(55);
    expect(p.lastSession.tableId).toBe('t9');
  });

  it('recordHandEnd accumulates the hand count', async () => {
    const svc = new AutosaveService({ kv: memoryKV() });
    await svc.recordHandEnd({}, { winnerIds: ['Bo'] }, 'Bo', 't');
    const p2 = await svc.recordHandEnd({}, { winnerIds: ['x'] }, 'Bo', 't');
    expect(p2.handCount).toBe(2);
  });

  it('clear() removes the stored profile', async () => {
    const kv = memoryKV();
    const svc = new AutosaveService({ kv });
    await svc.saveProfile({ name: 'Luna' });
    await svc.clear();
    expect(kv.getItem(PROFILE_KEY)).toBeNull();
    expect((await svc.loadProfile()).name).toBe('Gunslinger');
  });

  it('hydrate() resolves profile + avatar from idb (client-side blob only)', async () => {
    const idbStub = {
      loadAvatar: async (id) => (id === 'user-a' ? { avatarId: id, url: 'blob:a' } : null)
    };
    const svc = new AutosaveService({ kv: memoryKV(), idb: idbStub });
    await svc.saveProfile({ avatarId: 'user-a' });
    const { profile, avatar } = await svc.hydrate();
    expect(profile.avatarId).toBe('user-a');
    expect(avatar.url).toBe('blob:a');
  });

  it('hydrate() tolerates a missing avatar', async () => {
    const svc = new AutosaveService({ kv: memoryKV(), idb: { loadAvatar: async () => null } });
    await svc.saveProfile({ avatarId: 'user-x' });
    const { avatar } = await svc.hydrate();
    expect(avatar).toBeNull();
  });
});
