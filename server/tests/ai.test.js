import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as Client } from 'socket.io-client';
import { startServer } from '../src/index.js';

describe('server AI bots end-to-end', () => {
  let server;
  let ioUrl;

  beforeAll(async () => {
    const started = await startServer();
    server = started.server;
    ioUrl = started.url;
  });

  afterAll(async () => {
    server.close();
  });

  const join = (url, tableId, name, isBot = false, bot = null) =>
    new Promise((resolve, reject) => {
      const socket = Client(url, { transports: ['websocket'] });
      socket.on('connect', () =>
        socket.emit('joinTable', { tableId, name, isBot, bot }, (res) => {
          if (res.ok) resolve({ socket, playerId: res.playerId });
          else reject(new Error(res.error));
        })
      );
      socket.on('connect_error', reject);
    });

  const waitFor = async (predicate, timeoutMs = 15000, tick = 20) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return true;
      await new Promise((r) => setTimeout(r, tick));
    }
    return predicate();
  };

  it('AI-only table plays a full hand to completion and conserves chips', async () => {
    const tableId = `bot-${Date.now()}`;
    // Bots must stay connected (their socket IS their seat).
    const a = await join(ioUrl, tableId, 'BotA', true, { difficulty: 'normal' });
    const b = await join(ioUrl, tableId, 'BotB', true, { difficulty: 'hard' });

    // Listen on the bots' own sockets for the hand to finish.
    let final = null;
    const onState = (s) => {
      if (!final && !s.inHand && s.players.length >= 2) final = s;
    };
    a.socket.on('state', onState);
    b.socket.on('state', onState);

    // Allow up to 30s for the whole AI-only hand to resolve.
    await waitFor(() => final !== null, 30000);
    expect(final).toBeTruthy();
    expect(final.inHand).toBe(false);
    // The pot is fully paid out whether the hand ends by showdown or fold-out.
    expect(final.pot).toBe(0);
    // Chips conserved: stacks + pot == starting total.
    const total = final.players.reduce((sum, p) => sum + p.chips, 0) + final.pot;
    expect(total).toBe(final.startingStack * 2);

    a.socket.off('state', onState);
    b.socket.off('state', onState);
    // Close the bots now (removes their seats so the table stops auto-dealing).
    a.socket.close();
    b.socket.close();
  }, 40000);

  it('mixed human + bot table: bot auto-acts, human never does, chips conserved', async () => {
    const tableId = `mix-${Date.now()}`;
    const human = await join(ioUrl, tableId, 'Human');
    const bot = await join(ioUrl, tableId, 'Bot', true, { difficulty: 'easy' });
    const humanId = human.playerId;
    const botId = bot.playerId;
    expect(humanId).not.toBe(botId);

    // Track the human's own broadcast view (Alice-seats-perspective).
    let last = null;
    human.socket.on('state', (s) => { last = s; });

    // Start the hand as the human.
    const startRes = await new Promise((resolve) =>
      human.socket.emit('startHand', {}, (res) => resolve(res))
    );
    expect(startRes.ok).toBe(true);
    // Use the authoritative ack snapshot as the starting view.
    if (startRes.snapshot) last = startRes.snapshot;

    // Helper: the cheapest legal action for the human (call when facing a bet).
    const humanAction = (snap) => {
      const me = snap.players.find((p) => p.id === humanId);
      const toCall = Math.max(0, snap.currentBet - (me.contributions[snap.street] || 0));
      return toCall === 0 ? 'check' : 'call';
    };

    // Drive the hand: whenever it is the human's turn, act; otherwise wait
    // for the bot's broadcast to arrive.
    let guard = 0;
    let lastRef = last;
    while (guard < 400 && last && last.inHand) {
      guard += 1;
      const nextId = last.nextActorId;
      if (!nextId) break;
      if (nextId === humanId) {
        const action = humanAction(last);
        const res = await new Promise((resolve) =>
          human.socket.emit('playerAction', { action, amount: 0 }, (r) => resolve(r))
        );
        expect(res.ok).toBe(true, `human ${action} rejected: ${res.error}`);
        last = res.snapshot;
        lastRef = last;
      } else {
        // Wait for the bot to auto-act and the server to re-broadcast a new view.
        const advanced = await waitFor(() => last !== lastRef, 3000);
        if (!advanced) break; // avoid spinning forever if no bot update arrives
      }
    }

    // The hand must have ended (human actions + bot auto-acts resolve it).
    expect(last).toBeTruthy();
    expect(last.inHand).toBe(false);
    // Pot is fully paid out and chips are conserved (stacks + pot == start).
    expect(last.pot).toBe(0);
    const total = last.players.reduce((sum, p) => sum + p.chips, 0) + last.pot;
    expect(total).toBe(last.startingStack * 2);

    // Privacy: the human never sees the bot's hole cards.
    const botInHumanView = last.players.find((p) => p.id === botId);
    expect(botInHumanView).toBeTruthy();
    expect(botInHumanView.isBot).toBe(true);
    expect(botInHumanView.holeCards).toBeNull();

    human.socket.close();
    bot.socket.close();
  }, 40000);

  it('Play vs AI: human joins with spawnBot, bot is seated and auto-acts', async () => {
    const tableId = `spawn-${Date.now()}`;
    // Attach the state listener BEFORE joining so we catch the initial broadcast.
    const socket = Client(ioUrl, { transports: ['websocket'] });
    let last = null;
    socket.on('state', (s) => { last = s; });
    const human = await new Promise((resolve, reject) => {
      socket.on('connect', () =>
        socket.emit('joinTable', { tableId, name: 'Human', spawnBot: true, botDifficulty: 'easy' }, (res) => {
          if (res.ok) resolve({ socket, playerId: res.playerId });
          else reject(new Error(res.error));
        })
      );
      socket.on('connect_error', reject);
    });
    const humanId = human.playerId;

    // The table must now have exactly one bot opponent.
    await waitFor(() => last && last.players.length === 2, 3000);
    const bot = last.players.find((p) => p.id !== humanId);
    expect(bot).toBeTruthy();
    expect(bot.isBot).toBe(true);
    expect(bot.bot.difficulty).toBe('easy');
    // The human never sees the bot's hole cards (server authority).
    expect(bot.holeCards).toBeNull();

    // Start a hand and drive it: human check/calls, bot auto-acts.
    const startRes = await new Promise((resolve) =>
      human.socket.emit('startHand', {}, (res) => resolve(res))
    );
    expect(startRes.ok).toBe(true);
    if (startRes.snapshot) last = startRes.snapshot;

    const humanAction = (snap) => {
      const me = snap.players.find((p) => p.id === humanId);
      const toCall = Math.max(0, snap.currentBet - (me.contributions[snap.street] || 0));
      return toCall === 0 ? 'check' : 'call';
    };

    let guard = 0;
    let lastRef = last;
    while (guard < 400 && last && last.inHand) {
      guard += 1;
      const nextId = last.nextActorId;
      if (!nextId) break;
      if (nextId === humanId) {
        const action = humanAction(last);
        const res = await new Promise((resolve) =>
          human.socket.emit('playerAction', { action, amount: 0 }, (r) => resolve(r))
        );
        expect(res.ok).toBe(true, `human ${action} rejected: ${res.error}`);
        last = res.snapshot;
        lastRef = last;
      } else {
        const advanced = await waitFor(() => last !== lastRef, 3000);
        if (!advanced) break;
      }
    }

    expect(last).toBeTruthy();
    expect(last.inHand).toBe(false);
    expect(last.pot).toBe(0);
    const total = last.players.reduce((sum, p) => sum + p.chips, 0) + last.pot;
    expect(total).toBe(last.startingStack * 2);

    human.socket.close();
  }, 40000);
});