import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as Client } from 'socket.io-client';
import { startServer } from '../src/index.js';
import { sanitizeSettings, blindsForLevel } from '../src/tableRules.js';

describe('table rules', () => {
  it('sanitizes table options', () => {
    const s = sanitizeSettings({ smallBlind: 50, bigBlind: 20, startingStack: 5, turnSeconds: 7, mode: 'x' });
    expect(s.smallBlind).toBeLessThan(s.bigBlind);
    expect(s.startingStack).toBeGreaterThanOrEqual(s.bigBlind * 10);
    expect(s.turnSeconds).toBe(0);
    expect(s.mode).toBe('cash');
    expect(sanitizeSettings({ mode: 'tournament', turnSeconds: 30 })).toMatchObject({
      mode: 'tournament',
      turnSeconds: 30
    });
  });

  it('raises tournament blinds level by level', () => {
    expect(blindsForLevel(1, 10, 20)).toEqual([10, 20]);
    let prev = 20;
    for (let level = 2; level < 12; level += 1) {
      const [sb, bb] = blindsForLevel(level, 10, 20);
      expect(bb).toBeGreaterThan(prev);
      expect(sb).toBeLessThan(bb);
      prev = bb;
    }
  });
});

describe('table flow over sockets', () => {
  let server;
  let url;
  beforeAll(async () => {
    ({ server, url } = await startServer());
  });
  afterAll(() => server.close());

  const join = (tableId, payload) =>
    new Promise((resolve, reject) => {
      const socket = Client(url, { transports: ['websocket'] });
      const seat = { socket, view: null, notices: [] };
      socket.on('state', (v) => (seat.view = v));
      socket.on('notice', (n) => seat.notices.push(n));
      socket.on('connect', () =>
        socket.emit('joinTable', { tableId, name: 'Human', ...payload }, (res) => {
          if (!res.ok) return reject(new Error(res.error));
          seat.playerId = res.playerId;
          resolve(seat);
        })
      );
    });

  const waitFor = async (pred, ms = 20000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (pred()) return true;
      await new Promise((r) => setTimeout(r, 20));
    }
    return pred();
  };

  it('auto-deals, runs the shot clock, and sits out a player who keeps timing out', async () => {
    const me = await join(`clock-${Date.now()}`, {
      options: { autoDeal: true, turnSeconds: 15, cpuCount: 1 }
    });
    // Never act: the clock acts for us, and after two misses we are sat out.
    const satOut = await waitFor(
      () => me.view && me.view.players.find((p) => p.id === me.playerId).sittingOut
    );
    expect(satOut).toBe(true);
    expect(me.view.handNumber).toBeGreaterThanOrEqual(1);
    expect(me.notices.some((n) => n.key === 'notice.satOut')).toBe(true);
    const total = me.view.players.reduce((s, p) => s + p.chips, 0) + me.view.pot;
    expect(total).toBe(me.view.settings.startingStack * 2);
    me.socket.close();
  }, 30000);

  it('plays a CPU tournament with rising blinds to a winner', async () => {
    const me = await join(`tourney-${Date.now()}`, {
      options: {
        mode: 'tournament',
        autoDeal: true,
        cpuCount: 3,
        levelHands: 3,
        startingStack: 200,
        smallBlind: 10,
        bigBlind: 20
      }
    });
    // Sit out: in a tournament we stay dealt in and fold automatically.
    await new Promise((r) => me.socket.emit('sitOut', { out: true }, r));
    const done = await waitFor(() => me.view && me.view.tournament && me.view.tournament.finished, 60000);
    expect(done).toBe(true);
    const { standings, level } = me.view.tournament;
    expect(standings).toHaveLength(4);
    expect(standings.map((s) => s.place)).toEqual([1, 2, 3, 4]);
    expect(level).toBeGreaterThan(1);
    const total = me.view.players.reduce((s, p) => s + p.chips, 0);
    expect(total).toBe(800);
    // Someone has all the chips.
    expect(me.view.players.filter((p) => p.chips > 0)).toHaveLength(1);
    me.socket.close();
  }, 70000);
});
