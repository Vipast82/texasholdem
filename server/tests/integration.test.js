/**
 * Sprint 6 — cross-cutting SERVER integration tests (real sockets + bots).
 *
 * New coverage beyond ai.test.js / server.test.js:
 *   - a mixed human+bot hand that conserves chips and enforces hole-card
 *     privacy for the live player;
 *   - the SAME hand seen through a spectator (show-all) vs the live player:
 *     the spectator sees the bot's hole cards while the live player's view does
 *     NOT — privacy is per-viewer, not global.
 *
 * Driven entirely by action-ack snapshots (server-authorized per-viewer), with
 * no dependence on broadcast timing. A spectator is present, so auto-advance is
 * frozen: the human acts on their turn and the spectator drives each bot turn
 * via `step` (the intended spectator step-through integration).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as Client } from 'socket.io-client';
import { startServer } from '../src/index.js';

describe('server cross-view privacy + mixed hand', () => {
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

  const join = (url, tableId, name, extra = {}) =>
    new Promise((resolve, reject) => {
      const socket = Client(url, { transports: ['websocket'] });
      socket.on('connect', () =>
        socket.emit('joinTable', { tableId, name, ...extra }, (res) => {
          if (res.ok) resolve({ socket, playerId: res.playerId });
          else reject(new Error(res.error));
        })
      );
      socket.on('connect_error', reject);
    });

  const enterSpectator = (url, tableId, showAll) =>
    new Promise((resolve, reject) => {
      const socket = Client(url, { transports: ['websocket'] });
      socket.on('connect', () =>
        socket.emit('enterSpectator', { tableId, showAllCards: showAll }, (res) => {
          if (res.ok) resolve({ socket, snapshot: res.snapshot });
          else reject(new Error(res.error));
        })
      );
      socket.on('connect_error', reject);
    });

  const ack = (socket, event, payload = {}) =>
    new Promise((resolve) => socket.emit(event, payload, resolve));

  it('live player never sees the bot cards, but a spectator does — same hand; chips conserved', async () => {
    const tableId = `xview-${Date.now()}`;
    // Human + a server-seated bot (spawnBot keeps the human on a human seat).
    const human = await join(ioUrl, tableId, 'Human', { spawnBot: true, botDifficulty: 'easy' });
    const humanId = human.playerId;

    // Enter a spectator on the SAME table (show-all) so we can compare views.
    const spec = await enterSpectator(ioUrl, tableId, true);

    // Start the hand. The human's private view and the spectator's show-all
    // view are both server-authorized ack snapshots.
    const start = await ack(human.socket, 'startHand');
    expect(start.ok).toBe(true);
    expect(start.snapshot.inHand).toBe(true);
    const botId = start.snapshot.players.find((p) => p.id !== humanId).id;
    expect(botId).toBeTruthy();
    const humanPreflop = start.snapshot; // human private view (bot cards hidden)
    let specView = spec.snapshot; // spectator show-all view (bot cards revealed)

    // Drive the hand to completion (human acts; spectator steps each bot turn).
    let snap = start.snapshot;
    let guard = 0;
    while (guard < 400 && snap && snap.inHand) {
      guard += 1;
      const nextId = snap.nextActorId;
      if (!nextId) break;
      if (nextId === humanId) {
        const me = snap.players.find((p) => p.id === humanId);
        const toCall = Math.max(0, snap.currentBet - (me.contributions[snap.street] || 0));
        const action = toCall === 0 ? 'check' : 'call';
        const res = await ack(human.socket, 'playerAction', { action, amount: 0 });
        expect(res.ok).toBe(true, `human ${action} rejected: ${res.error}`);
        snap = res.snapshot;
      } else {
        const step = await ack(spec.socket, 'step', { tableId });
        expect(step.ok).toBe(true, `spectator step rejected: ${step.error}`);
        snap = step.snapshot;
        specView = step.snapshot;
      }
    }

    // The hand must be over; pot paid out; chips conserved (stacks + pot == 2*start).
    expect(snap).toBeTruthy();
    expect(snap.inHand).toBe(false);
    expect(snap.pot).toBe(0);
    const total = snap.players.reduce((sum, p) => sum + p.chips, 0) + snap.pot;
    expect(total).toBe(snap.startingStack * 2);

    // PRIVACY — the live player's view must NOT contain the bot's hole cards.
    const botInHumanView = humanPreflop.players.find((p) => p.id === botId);
    expect(botInHumanView.holeCards).toBeNull();
    // ... but the human's OWN cards are visible in their view.
    const meInHumanView = humanPreflop.players.find((p) => p.id === humanId);
    expect(meInHumanView.holeCards).toHaveLength(2);

    // CROSS-VIEW — the spectator (show-all) DOES see the bot's hole cards, in
    // the very same hand where the live player could not.
    const botInSpecView = specView.players.find((p) => p.id === botId);
    expect(botInSpecView.holeCards).toHaveLength(2);

    spec.socket.close();
    human.socket.close();
  }, 45000);
});