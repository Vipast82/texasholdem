/**
 * Minimal in-memory IndexedDB stand-in for Node tests (vitest env is `node`,
 * no jsdom dependency). It implements just the surface `src/services/idb.js`
 * uses: `open()` (with `onupgradeneeded` + `onsuccess`), `transaction().
 * objectStore(name)`, and store ops `put/get/delete/getAllKeys/clear` — each
 * returning a request whose `onsuccess` fires asynchronously with `result` set.
 *
 * Not a general IDB implementation: enough for the put/get/delete/keys
 * round-trip tests and the avatar/autosave services that sit on top of it.
 */

class MockRequest {
  constructor() {
    this.result = undefined;
    this.error = undefined;
    this.onsuccess = null;
    this.onerror = null;
  }

  _succeed(value) {
    this.result = value;
    queueMicrotask(() => {
      if (this.onsuccess) this.onsuccess({ target: this });
    });
  }

  _fail(err) {
    this.error = err;
    queueMicrotask(() => {
      if (this.onerror) this.onerror({ target: this });
    });
  }
}

class MockObjectStore {
  constructor(name) {
    this.name = name;
    this._data = new Map();
  }

  put(value) {
    if (value == null || value.avatarId == null) {
      throw new Error('put() requires a record with an avatarId key');
    }
    this._data.set(value.avatarId, value);
    const req = new MockRequest();
    req._succeed(value.avatarId);
    return req;
  }

  get(key) {
    const req = new MockRequest();
    req._succeed(this._data.has(key) ? this._data.get(key) : undefined);
    return req;
  }

  delete(key) {
    this._data.delete(key);
    const req = new MockRequest();
    req._succeed(undefined);
    return req;
  }

  clear() {
    this._data.clear();
    const req = new MockRequest();
    req._succeed(undefined);
    return req;
  }

  getAllKeys() {
    const req = new MockRequest();
    req._succeed([...this._data.keys()]);
    return req;
  }
}

class MockTransaction {
  constructor(db, storeName) {
    this._db = db;
    this._storeName = storeName;
  }

  objectStore(name) {
    if (name !== this._storeName) throw new Error(`unknown store: ${name}`);
    return this._db._stores.get(name);
  }
}

class MockDatabase {
  constructor(name) {
    this.name = name;
    this._stores = new Map();
  }

  get objectStoreNames() {
    const names = [...this._stores.keys()];
    return {
      contains: (n) => names.includes(n)
    };
  }

  createObjectStore(name) {
    if (!this._stores.has(name)) this._stores.set(name, new MockObjectStore(name));
    return this._stores.get(name);
  }

  transaction(storeName) {
    if (!this._stores.has(storeName)) throw new Error(`no such store: ${storeName}`);
    return new MockTransaction(this, storeName);
  }
}

export class MockIndexedDB {
  constructor() {
    this._dbs = new Map();
  }

  open(name) {
    let db = this._dbs.get(name);
    if (!db) {
      db = new MockDatabase(name);
      this._dbs.set(name, db);
    }
    const req = new MockRequest();
    queueMicrotask(() => {
      if (req.onupgradeneeded) {
        try {
          req.onupgradeneeded({ target: { result: db } });
        } catch (err) {
          req._fail(err);
          return;
        }
      }
      req._succeed(db);
    });
    return req;
  }
}

/** Install a fresh mock as the global `indexedDB` (returns a reset factory). */
export function installMockIndexedDB() {
  const mock = new MockIndexedDB();
  globalThis.indexedDB = mock;
  return mock;
}
