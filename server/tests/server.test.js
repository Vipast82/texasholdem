import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as Client } from 'socket.io-client';
import { startServer } from '../src/index.js';

describe('server end-to-end', () => {
  let server;
  let ioUrl;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const started = await startServer();
    server = started.server;
    ioUrl = started.url;
  });

  afterAll(async () => {
    server.close();
  });

  const join = (url, tableId, name) =>
    new Promise((resolve, reject) => {
      const socket = Client(url, { transports: ['websocket'] });
      socket.on('connect', () =>
        socket.emit('joinTable', { tableId, name }, (res) => {
          if (res.ok) resolve({ socket, playerId: res.playerId });
          else reject(new Error(res.error));
        })
      );
      socket.on('connect_error', reject);
    });

  const ack = (socket, event, payload = {}) => new Promise((resolve) => socket.emit(event, payload, resolve));

  it('two clients complete a full hand to showdown and chips are conserved', async () => {
    const tableId = `t-${Date.now()}`;
    const [a, b] = await Promise.all([join(ioUrl, tableId, 'Alice'), join(ioUrl, tableId, 'Bob')]);
    const alice = a.socket;
    const bob = b.socket;
    const aliceId = a.playerId;
    const bobId = b.playerId;
    // Two distinct sockets must be two distinct players.
    expect(aliceId).not.toBe(bobId);

    // Track each player's own broadcast view (their private hole-card perspective).
    const states = new Map();
    alice.on('state', (s) => states.set('alice', s));
    bob.on('state', (s) => states.set('bob', s));

    const startRes = await ack(alice, 'startHand');
    expect(startRes.ok).toBe(true);
    expect(startRes.snapshot.inHand).toBe(true);

    // Drive the hand with the cheapest legal action (check/call) until it ends.
    // We advance off the authoritative per-action ack snapshot, whose betting
    // state (nextActorId / currentBet / street / contributions) is shared by
    // every viewer - only hole cards are per-viewer.
    let snapshot = startRes.snapshot;
    let guard = 0;
    while (guard < 400) {
      guard += 1;
      if (!snapshot.inHand) break;
      const nextId = snapshot.nextActorId;
      expect(nextId).toBeTruthy();
      const me = snapshot.players.find((p) => p.id === nextId);
      const toCall = Math.max(0, snapshot.currentBet - me.contributions[snapshot.street]);
      const action = toCall === 0 ? 'check' : 'call';
      const socket = nextId === aliceId ? alice : bob;
      const res = await ack(socket, 'playerAction', { action, amount: 0 });
      expect(res.ok).toBe(true, `action ${action} rejected: ${res.error}`);
      snapshot = res.snapshot;
    }

    // Read Alice's final private view (her hole cards visible, Bob's not).
    let finalA = states.get('alice');
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && finalA && finalA.inHand) {
      await new Promise((r) => setTimeout(r, 10));
      finalA = states.get('alice');
    }
    expect(finalA).toBeTruthy();
    expect(finalA.inHand).toBe(false);
    expect(finalA.community).toHaveLength(5);

    // Chips conserved: both players' stacks + pot = starting total.
    const total = finalA.players.reduce((sum, p) => sum + p.chips, 0) + finalA.pot;
    expect(total).toBe(finalA.startingStack * 2);

    // Both players checked it down to showdown, so Bob's hand is now turned
    // face up for Alice (during the hand it was hidden).
    const bobInAlice = finalA.players.find((p) => p.name === 'Bob');
    expect(bobInAlice.holeCards).toHaveLength(2);
    expect(startRes.snapshot.players.find((p) => p.name === 'Bob').holeCards).toBeNull();
    // ... and her own hole cards ARE visible to her.
    const aliceInAlice = finalA.players.find((p) => p.name === 'Alice');
    expect(aliceInAlice.holeCards).toHaveLength(2);

    alice.close();
    bob.close();
  });
});

// -----------------------------------------------------------------------------
// Sprint 4: spectator mode (show-all + step-through) and hand-history export.
// -----------------------------------------------------------------------------

describe('server spectator + history (Sprint 4)', () => {
  let server;
  let ioUrl;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const started = await startServer();
    server = started.server;
    ioUrl = started.url;
  });

  afterAll(async () => {
    server.close();
  });

  const join = (url, tableId, name) =>
    new Promise((resolve, reject) => {
      const socket = Client(url, { transports: ['websocket'] });
      socket.on('connect', () =>
        socket.emit('joinTable', { tableId, name }, (res) => {
          if (res.ok) resolve({ socket, playerId: res.playerId });
          else reject(new Error(res.error));
        })
      );
      socket.on('connect_error', reject);
    });

  const enterSpectator = (url, tableId, showAllCards) =>
    new Promise((resolve, reject) => {
      const socket = Client(url, { transports: ['websocket'] });
      socket.on('connect', () =>
        socket.emit('enterSpectator', { tableId, showAllCards }, (res) => {
          if (res.ok) resolve({ socket, snapshot: res.snapshot });
          else reject(new Error(res.error));
        })
      );
      socket.on('connect_error', reject);
    });

  const ack = (socket, event, payload = {}) => new Promise((resolve) => socket.emit(event, payload, resolve));

  it('spectator sees all hole cards; a live player never does', async () => {
    const tableId = `spec-${Date.now()}`;
    const [a, b] = await Promise.all([join(ioUrl, tableId, 'P1'), join(ioUrl, tableId, 'P2')]);
    // A live player starts a hand so hole cards get dealt.
    const start = await ack(a.socket, 'startHand');
    expect(start.ok).toBe(true);
    expect(start.snapshot.inHand).toBe(true);

    // A spectator joins with show-all ON and sees BOTH players' hole cards.
    const { socket: spec, snapshot } = await enterSpectator(ioUrl, tableId, true);
    expect(snapshot.spectator).toBe(true);
    expect(snapshot.playerId).toBeNull();
    expect(snapshot.players.find((p) => p.name === 'P1').holeCards).toHaveLength(2);
    expect(snapshot.players.find((p) => p.name === 'P2').holeCards).toHaveLength(2);

    // Toggling show-all OFF hides every other seat's hole cards (no own seat).
    const off = await ack(spec, 'setShowAllCards', { tableId, on: false });
    expect(off.ok).toBe(true);
    expect(off.snapshot.players.find((p) => p.name === 'P2').holeCards).toBeNull();
    expect(off.snapshot.players.find((p) => p.name === 'P1').holeCards).toBeNull();

    spec.close();
    a.socket.close();
    b.socket.close();
  });

  it('auto-advance pauses while a spectator is present; `step` advances the hand', async () => {
    const tableId = `step-${Date.now()}`;
    // A human host + a server-side bot opponent (no socket for the bot).
    const host = await new Promise((resolve, reject) => {
      const socket = Client(ioUrl, { transports: ['websocket'] });
      socket.on('connect', () =>
        socket.emit('joinTable', { tableId, name: 'Host', spawnBot: true, botDifficulty: 'easy' }, (res) => {
          if (res.ok) resolve({ socket, playerId: res.playerId });
          else reject(new Error(res.error));
        })
      );
      socket.on('connect_error', reject);
    });
    // Enter a spectator: this FREEZES the table (auto-advance paused).
    const { socket: spec } = await enterSpectator(ioUrl, tableId, true);

    // Start a hand as the host, then step through it as the spectator.
    const start = await ack(host.socket, 'startHand');
    expect(start.ok).toBe(true);
    expect(start.snapshot.inHand).toBe(true);

    // Step through the hand to completion via `step`.
    let snap = start.snapshot;
    let guard = 0;
    while (snap.inHand && guard < 400) {
      guard += 1;
      const res = await ack(spec, 'step', { tableId });
      expect(res.ok).toBe(true, `step failed: ${res.error}`);
      snap = res.snapshot;
    }
    expect(snap.inHand).toBe(false);

    spec.close();
    host.socket.close();
  });

  it('records a hand record and serves it via getHistory / exportHistory', async () => {
    const tableId = `hist-${Date.now()}`;
    const [a, b] = await Promise.all([join(ioUrl, tableId, 'H1'), join(ioUrl, tableId, 'H2')]);

    // Complete one hand.
    const start = await ack(a.socket, 'startHand');
    let snap = start.snapshot;
    let guard = 0;
    while (snap.inHand && guard < 400) {
      guard += 1;
      const nextId = snap.nextActorId;
      const me = snap.players.find((p) => p.id === nextId);
      const toCall = Math.max(0, snap.currentBet - me.contributions[snap.street]);
      const action = toCall === 0 ? 'check' : 'call';
      const socket = nextId === a.playerId ? a.socket : b.socket;
      const res = await ack(socket, 'playerAction', { action, amount: 0 });
      snap = res.snapshot;
    }

    // Allow the handEnded -> recordHand broadcast to land.
    await new Promise((r) => setTimeout(r, 50));

    const hist = await ack(a.socket, 'getHistory', { tableId });
    expect(hist.ok).toBe(true);
    const mine = hist.hands.filter((h) => h.tableId === tableId);
    expect(mine.length).toBeGreaterThan(0);
    const rec = mine[mine.length - 1];
    expect(rec.schema).toBe('saloon.hand-record/v1');
    expect(Array.isArray(rec.board)).toBe(true);
    expect(Array.isArray(rec.players)).toBe(true);

    const exp = await ack(a.socket, 'exportHistory', { tableId });
    expect(exp.ok).toBe(true);
    const parsed = JSON.parse(exp.json);
    expect(parsed.hands.length).toBeGreaterThan(0);

    a.socket.close();
    b.socket.close();
  });
});

// -----------------------------------------------------------------------------
// Sprint 7: live avatar sharing — changing the avatar after joining must
// propagate to the OTHER seats (no re-join), via the `updateAvatar` event.
// -----------------------------------------------------------------------------
describe('server avatar sharing (Sprint 7)', () => {
  let server;
  let ioUrl;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const started = await startServer();
    server = started.server;
    ioUrl = started.url;
  });

  afterAll(async () => {
    server.close();
  });

  // Capture every state push from the moment of joining (a push can arrive
  // before the join reply), so tests always have the latest view.
  const join = (url, tableId, name) =>
    new Promise((resolve, reject) => {
      const socket = Client(url, { transports: ['websocket'] });
      const seat = { socket, playerId: null, view: null };
      socket.on('state', (v) => (seat.view = v));
      socket.on('connect', () =>
        socket.emit('joinTable', { tableId, name }, (res) => {
          if (!res.ok) return reject(new Error(res.error));
          seat.playerId = res.playerId;
          resolve(seat);
        })
      );
      socket.on('connect_error', reject);
    });

  const ack = (socket, event, payload = {}) => new Promise((resolve) => socket.emit(event, payload, resolve));

  it('updating the avatar after joining updates the OTHER seat snapshot; clearing resets it', async () => {
    const tableId = `av-${Date.now()}`;
    const alice = await join(ioUrl, tableId, 'Alice');
    const bob = await join(ioUrl, tableId, 'Bob');

    // Each client captures the latest server push (state is per-viewer; the
    // avatarMeta of the OPPOSITE seat is shared by every viewer).
    const view = (seat) => seat.view;

    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    // Baseline: nobody joined with an avatar, so both seats are null.
    await wait(50);
    const aliceBaseline = view(alice).players.find((p) => p.id === alice.playerId);
    expect(aliceBaseline.avatarMeta || null).toBeNull();

    // Alice picks a NEW avatar after joining. The blob lives in /avatars/:id
    // (already POSTed in the app); here we exercise the metadata hand-off.
    const newId = `user-avtest-${Date.now()}`;
    const up = await ack(alice.socket, 'updateAvatar', {
      avatarMeta: { avatarId: newId, kind: 'upload', crop: { x: 0, y: 0, size: 40 } }
    });
    expect(up.ok).toBe(true);

    // Give the broadcast a beat to reach both viewers.
    await wait(50);

    // BOB (the other seat) must now see Alice's new avatarMeta on her player.
    const aliceInBob = view(bob).players.find((p) => p.id === alice.playerId);
    expect(aliceInBob.avatarMeta).toBeTruthy();
    expect(aliceInBob.avatarMeta.avatarId).toBe(newId);
    expect(aliceInBob.avatarMeta.kind).toBe('upload');

    // And Alice's own view is consistent with what the server stored.
    const aliceInAlice = view(alice).players.find((p) => p.id === alice.playerId);
    expect(aliceInAlice.avatarMeta.avatarId).toBe(newId);

    // Reset (clear) must propagate to the other seat too.
    const clr = await ack(alice.socket, 'updateAvatar', { avatarMeta: null });
    expect(clr.ok).toBe(true);
    await wait(50);
    const clearedInBob = view(bob).players.find((p) => p.id === alice.playerId);
    expect(clearedInBob.avatarMeta || null).toBeNull();

    alice.socket.close();
    bob.socket.close();
  });

  it('a non-seated socket cannot update an avatar', async () => {
    const stray = Client(ioUrl, { transports: ['websocket'] });
    await new Promise((r) => stray.on('connect', r));
    const res = await ack(stray, 'updateAvatar', { avatarMeta: { avatarId: 'x' } });
    expect(res.ok).toBe(false);
    stray.close();
  });
  it('leaveTable replies even when the client sends an empty payload', async () => {
    const a = await join(ioUrl, `leave-${Date.now()}`, 'Alice');
    const res = await ack(a.socket, 'leaveTable');
    expect(res).toEqual({ ok: true });
    a.socket.close();
  });

  it('a malformed message is rejected instead of crashing the server', async () => {
    const stray = Client(ioUrl, { transports: ['websocket'] });
    await new Promise((r) => stray.on('connect', r));
    stray.emit('playerAction'); // no payload, no callback
    stray.emit('chatMessage', null);
    const res = await new Promise((resolve) => stray.emit('playerAction', resolve));
    expect(res.ok).toBe(false);
    // The server is still alive and answering.
    const tables = await new Promise((resolve) => stray.emit('listTables', resolve));
    expect(Array.isArray(tables)).toBe(true);
    stray.close();
  });

  it('hand records never reveal hole cards that were not shown down', async () => {
    const tableId = `priv-${Date.now()}`;
    const a = await join(ioUrl, tableId, 'Alice');
    const b = await join(ioUrl, tableId, 'Bob');
    const records = [];
    b.socket.on('handRecord', (r) => records.push(r));
    const start = await ack(a.socket, 'startHand');
    const first = start.snapshot.nextActorId;
    const actor = first === a.playerId ? a : b;
    await ack(actor.socket, 'playerAction', { action: 'fold' });
    await new Promise((r) => setTimeout(r, 50));
    expect(records).toHaveLength(1);
    for (const p of records[0].players) expect(p.holeCards).toBeNull();
    a.socket.close();
    b.socket.close();
  });
});
