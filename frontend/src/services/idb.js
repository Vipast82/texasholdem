/**
 * IndexedDB wrapper (Sprint 5) — the ONLY place binary avatar data touches
 * storage. Binaries stay client-side: an `avatarId` + metadata may travel over
 * the socket, but the blob never does.
 *
 * Design goals:
 *  - Small, promise-based surface: `put` / `get` / `del` / `keys`.
 *  - Testable under Node: the IDB factory is injectable via `setIDBFactory`,
 *    so tests run against the in-memory mock (see tests/helpers) without any
 *    browser or jsdom dependency.
 *  - Records are keyed by `avatarId` (objectStore keyPath) so `put` needs no
 *    separate key argument (matches real IndexedDB semantics).
 */

const DB_NAME = 'saloon';
const DB_VERSION = 1;
const STORE = 'avatars';

let _factory = null; // injectable IDB-like factory (default: globalThis.indexedDB)
let _dbPromise = null; // open-connection cache, reset when the factory changes

/** Inject an IDB factory (or null to fall back to the browser global). */
export function setIDBFactory(factory) {
  _factory = factory || null;
  _dbPromise = null;
}

/** Drop the cached connection (used by tests after swapping the factory). */
export function resetConnection() {
  _dbPromise = null;
}

function currentFactory() {
  const f = _factory || (typeof indexedDB !== 'undefined' ? indexedDB : null);
  if (!f) throw new Error('IndexedDB is not available in this environment');
  return f;
}

function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = currentFactory().open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e && e.target && e.target.result;
      if (db && db.objectStoreNames && !db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'avatarId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('failed to open IndexedDB'));
  });
  // If the factory rejects, allow a later retry by clearing the cache.
  _dbPromise.catch(() => {
    _dbPromise = null;
  });
  return _dbPromise;
}

function objectStore(mode) {
  return openDb().then((db) => db.transaction(STORE, mode).objectStore(STORE));
}

function wrapRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB request failed'));
  });
}

/**
 * Store an avatar record. The record MUST carry `avatarId` (the key).
 * @param {{ avatarId: string, blob?: any, meta?: object }} record
 */
export function put(record) {
  if (!record || record.avatarId == null) {
    return Promise.reject(new Error('put() requires record.avatarId'));
  }
  return objectStore('readwrite').then((os) => wrapRequest(os.put(record)));
}

/** @returns {Promise<object|undefined>} the stored record (or undefined). */
export function get(avatarId) {
  return objectStore('readonly').then((os) => wrapRequest(os.get(avatarId)));
}

/** Delete an avatar record by id. */
export function del(avatarId) {
  return objectStore('readwrite').then((os) => wrapRequest(os.delete(avatarId)));
}

/** @returns {Promise<string[]>} all stored avatarIds. */
export function keys() {
  return objectStore('readonly').then((os) => wrapRequest(os.getAllKeys()));
}
