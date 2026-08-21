/**
 * idb.js — put/get/delete/keys round-trip against the in-memory IndexedDB
 * mock (Sprint 5). Confirms the wrapper's promise surface + keyPath behavior.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as idb from '../src/services/idb.js';
import { installMockIndexedDB } from './helpers/mockIndexedDB.js';

beforeEach(() => {
  installMockIndexedDB();
  idb.resetConnection();
});

describe('idb wrapper', () => {
  it('throws a helpful error when no IDB is available', () => {
    idb.setIDBFactory(null);
    // Point the global at "undefined" by removing it (Node has no indexedDB).
    delete globalThis.indexedDB;
    expect(() => idb.put({ avatarId: 'x' })).rejects.toThrow(/IndexedDB/);
  });

  it('puts a record and gets it back by avatarId', async () => {
    const record = { avatarId: 'a1', blob: { bytes: 1 }, meta: { type: 'image/gif' } };
    await idb.put(record);
    const got = await idb.get('a1');
    expect(got).toEqual(record);
  });

  it('returns undefined for a missing key', async () => {
    expect(await idb.get('nope')).toBeUndefined();
  });

  it('keys() lists all stored avatarIds', async () => {
    await idb.put({ avatarId: 'a1' });
    await idb.put({ avatarId: 'a2' });
    const keys = await idb.keys();
    expect(keys.sort()).toEqual(['a1', 'a2']);
  });

  it('del() removes a record', async () => {
    await idb.put({ avatarId: 'a1' });
    await idb.del('a1');
    expect(await idb.get('a1')).toBeUndefined();
    expect(await idb.keys()).toEqual([]);
  });

  it('put() rejects a record without an avatarId', async () => {
    await expect(idb.put({ blob: 'x' })).rejects.toThrow(/avatarId/);
  });

  it('overwrites an existing record with the same id', async () => {
    await idb.put({ avatarId: 'a1', v: 1 });
    await idb.put({ avatarId: 'a1', v: 2 });
    expect((await idb.get('a1')).v).toBe(2);
    expect((await idb.keys()).length).toBe(1);
  });
});
