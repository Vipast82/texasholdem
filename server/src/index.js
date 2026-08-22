import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameStateStore } from './gameStateStore.js';
import { decideAction } from '@saloon/shared/ai';
import { getProfile, pickBotName, Rng, buildHandRecord, serializeHandRecord } from '@saloon/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Bot "thinking" delay (ms). In tests this is tiny so the whole hand resolves
// quickly; in production it gives the table a human-feel cadence.
const BOT_DELAY_MS =
  process.env.VITEST || process.env.VITEST_WORKER_ID || process.env.NODE_ENV === 'test'
    ? 15
    : 450;

/** Hard cap on consecutive bot moves before we assume something is stuck. */
const BOT_LOOP_GUARD = 150;

/**
 * Delay before an all-bot (or bot-dealer) table auto-starts the NEXT hand.
 * In production this is a human-readable pause (≥3 s) so the result of the
 * finished hand is actually visible before the deck reshuffles. In tests it is
 * tiny so AI-only hands resolve quickly.
 */
const HAND_RESTART_DELAY_MS =
  process.env.VITEST || process.env.VITEST_WORKER_ID || process.env.NODE_ENV === 'test'
    ? 15
    : 3000;

const app = express();
app.use(cors());
app.use(express.json());

// Serve the built frontend in production
const distDir = path.resolve(__dirname, '../../frontend/dist');
app.use(express.static(distDir));
app.get('/health', (req, res) => res.json({ ok: true, name: 'saloon-server' }));

// ----------------------------------------------------------------- avatars
// Sprint 7: avatar SHARING. The avatar binary still never lives in IndexedDB
// on the wire for OTHER players — each client keeps its own in IndexedDB. To
// let the other seats actually SEE your avatar (the Sprint 7 requirement), the
// server holds an in-memory blob store keyed by avatarId. On upload the client
// POSTs the raw bytes here; other clients then fetch the same bytes from
// GET /avatars/:id. This is per-process (resets on restart) and best-effort:
// a missing blob just falls back to the neutral default seat avatar.
const avatarBlobs = new Map(); // avatarId -> { blob, mime }
const MAX_AVATAR_UPLOAD = 20 * 1024 * 1024; // 20 MB, matches the client cap

app.post('/avatars/:id', express.raw({ type: () => true, limit: MAX_AVATAR_UPLOAD }), (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(id)) {
    res.status(400).json({ ok: false, error: 'bad avatar id' });
    return;
  }
  const body = req.body; // Buffer (express.raw)
  if (!body || typeof body.length !== 'number' || body.length === 0) {
    res.status(400).json({ ok: false, error: 'empty body' });
    return;
  }
  if (body.length > MAX_AVATAR_UPLOAD) {
    res.status(413).json({ ok: false, error: 'too large' });
    return;
  }
  const mime = String(req.get('content-type') || '').split(';')[0].trim() || 'application/octet-stream';
  avatarBlobs.set(id, { blob: body, mime });
  res.json({ ok: true });
});

app.get('/avatars/:id', (req, res) => {
  const id = String(req.params.id || '');
  const rec = avatarBlobs.get(id);
  if (!rec) {
    res.status(404).json({ ok: false, error: 'not found' });
    return;
  }
  res.set('Content-Type', rec.mime);
  res.set('Content-Length', String(rec.blob.length));
  res.set('Cache-Control', 'private, max-age=3600');
  res.end(rec.blob);
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

const store = new GameStateStore();

// ----------------------------------------------------------------- helpers

function tableRoom(tableId) {
  return `table:${tableId}`;
}

/**
 * Push a fresh, per-viewer snapshot to every seated player in a table.
 * Each player only ever sees their own hole cards (server authority).
 */
function broadcast(tableId) {
  const entry = store.get(tableId);
  if (!entry) return;
  for (const playerId of entry.players.keys()) {
    const sid = entry.players.get(playerId).socketId;
    const socket = io.sockets.sockets.get(sid);
    if (socket) socket.emit('state', entry.table.snapshotFor(playerId));
  }
  // Spectators (if any) get their own, server-authorized snapshot too.
  notifySpectators(tableId);
}

function assignSeat(table, _playerId) {
  const taken = new Set(table.players.map((p) => p.seat));
  for (let s = 0; s < 10; s += 1) {
    if (!taken.has(s)) return s;
  }
  return -1;
}

// ----------------------------------------------------------------- spectators

/**
 * Spectator capability (Sprint 4): per-table, per-socket.
 * Keyed by socket id (one socket = one client). Each spectator gets a
 * personal view flag: whether they requested "show all hole cards".
 */
const spectators = new Map(); // tableId -> Map<socketId, { showAllCards: boolean }>

/**
 * Auto-advance (bot turns + auto-start) is paused while ANY spectator is
 * watching. This is what makes step-through usable: the table freezes at the
 * current point and advances only when a spectator explicitly steps.
 */
function autoAdvancePaused(tableId) {
  const set = spectators.get(tableId);
  return !!(set && set.size > 0);
}

/**
 * Push each spectator a FRESH snapshot of their table. `revealAllHoles` is
 * authorized here, server-side, from the spectator's personal flag — the only
 * code path that ever sets it. Live players are NOT touched by this function.
 */
function broadcastSpectators(tableId) {
  const set = spectators.get(tableId);
  if (!set || set.size === 0) return;
  const entry = store.get(tableId);
  if (!entry) return;
  for (const [socketId] of set.entries()) {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) continue;
    socket.emit('state', spectatorSnapshot(entry, socketId));
  }
}

/** Re-broadcast to every spectator after any table mutation. */
function notifySpectators(tableId) {
  if (autoAdvancePaused(tableId)) broadcastSpectators(tableId);
}

/** Build a server-authorized spectator snapshot (reveal-all holes) for one socket. */
function spectatorSnapshot(entry, socketId) {
  const tableId = entry.table.tableId;
  const map = spectators.get(tableId) || new Map();
  const meta = map.get(socketId) || { showAllCards: true };
  return {
    ...entry.table.snapshotFor(null, { revealAllHoles: !!meta.showAllCards }),
    playerId: null,
    spectator: true
  };
}

// ----------------------------------------------------------------- bots

/**
 * Sprint 5 avatar privacy: only a small, whitelisted metadata object may be
 * stored on a player and broadcast in the snapshot. We explicitly copy only the
 * allowed keys (all small, JSON-safe scalars) so a client can never smuggle a
 * Blob/base64 blob or nested object over the wire. `crop` is a plain rect the
 * server does not interpret — it only describes how the CLIENT should display
 * its own avatar.
 */
function sanitizeAvatarMeta(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const out = {};
  const pickStr = (v) => (typeof v === 'string' ? v : null);
  const pickNum = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const id = pickStr(meta.avatarId);
  const kind = pickStr(meta.kind);
  if (id != null) out.avatarId = id;
  if (kind != null) out.kind = kind;
  if (pickStr(meta.name) != null) out.name = pickStr(meta.name);
  if (typeof meta.crop === 'object' && meta.crop != null) {
    const c = meta.crop;
    const crop = {};
    if (pickNum(c.x) != null) crop.x = c.x;
    if (pickNum(c.y) != null) crop.y = c.y;
    if (pickNum(c.size) != null) crop.size = c.size;
    if (pickNum(c.w) != null) crop.w = c.w;
    if (pickNum(c.h) != null) crop.h = c.h;
    if (Object.keys(crop).length > 0) out.crop = crop;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Normalize the bot's stored metadata to a difficulty string. */
function normalizeDifficulty(bot) {
  if (!bot) return 'normal';
  if (typeof bot === 'string') return bot;
  return bot.difficulty || bot.level || 'normal';
}

/**
 * If the table should auto-deal the next hand (AI-only table, or the dealer
 * button is a bot), start it after a human-readable pause so the result of the
 * finished hand is visible before reshuffle. A human dealer always has to click
 * "Start Hand" themselves (the requirement: human dealer controls the deal).
 */
function autoStartIfAllBots(tableId) {
  const entry = store.get(tableId);
  if (!entry) return;
  const table = entry.table;
  if (table.inHand) return;
  const seated = table.players.filter((p) => p.status === 'seated' && p.chips > 0);
  if (seated.length < 2) return;
  const allBots = table.players.every((p) => p.isBot);
  const dealerIsBot =
    !allBots && table.players.some((p) => p.seat === table.dealerSeat && p.isBot);
  if (!allBots && !dealerIsBot) return;
  setTimeout(() => {
    const t = store.get(tableId)?.table;
    if (!t || t.inHand) return;
    if (t.players.filter((p) => p.status === 'seated' && p.chips > 0).length < 2) return;
    try {
      t.startHand();
      broadcast(tableId);
      driveBots(tableId);
    } catch (err) {
      // Hand could not start (chips, etc.) — ignore for this round.
    }
  }, HAND_RESTART_DELAY_MS);
}

/**
 * Per-table pump state. `timer` is the pending bot step (null when idle),
 * `moveCount` caps consecutive bot moves within a hand so a buggy decision
 * can never loop forever; `handNum` detects hand transitions.
 */
const pumps = new Map(); // tableId -> { timer, moveCount, handNum }

/**
 * Fire one bot move (after BOT_DELAY_MS) if it is a bot's turn, then
 * re-schedule itself. Non-blocking: repeated pumpTable() calls on the same
 * table coalesce into one pending timer, so a human action arriving while a
 * bot is "thinking" never starves the bot's turn.
 *
 * Every bot decision is deterministic: the seed is derived from the current
 * game state plus the move counter, so the same hand always replays the same.
 */
function driveBots(tableId) {
  let pump = pumps.get(tableId);
  if (!pump) {
    pump = { timer: null, moveCount: 0, handNum: -1 };
    pumps.set(tableId, pump);
  }
  if (pump.timer) return; // a pending step already covers this table
  pump.timer = setTimeout(() => {
    pump.timer = null;
    const entry = store.get(tableId);
    const table = entry && entry.table;
    if (!table) {
      pumps.delete(tableId);
      return;
    }
    // New hand started: reset the move budget.
    if (table.handNumber !== pump.handNum) {
      pump.handNum = table.handNumber;
      pump.moveCount = 0;
    }
    if (table.inHand) {
      const nextId = table.nextActorId();
      const actor = nextId && table.playerById(nextId);
      if (
        actor &&
        actor.isBot &&
        !actor.hasFolded &&
        actor.chips > 0 &&
        pump.moveCount < BOT_LOOP_GUARD
      ) {
        pump.moveCount += 1;
        const difficulty = normalizeDifficulty(actor.bot);
        const seed = [
          tableId,
          table.handNumber,
          table.street,
          nextId,
          table.raiseCount,
          table.currentBet,
          table.pot,
          pump.moveCount // unique per pump-table loop iteration
        ].join(':');
        let decision;
        try {
          decision = decideAction(table, nextId, { difficulty, seed });
        } catch (err) {
          // Surface AI errors so a stuck bot never silently freezes the table.
          if (typeof console !== 'undefined' && console.error) {
            console.error(`[bot ${actor.name}@${tableId}] decideAction failed:`, err && err.message);
          }
          return;
        }
        try {
          table.applyAction(nextId, decision.action, decision.amount || 0);
        } catch (err) {
          if (typeof console !== 'undefined' && console.error) {
            console.error(`[bot ${actor.name}@${tableId}] applyAction failed (${decision.action}/${decision.amount}):`, err && err.message);
          }
          return;
        }
        broadcast(tableId);
        // Let the UI show the bot's "thinking" / reason line.
        io.to(tableRoom(tableId)).emit('botAction', {
          playerId: nextId,
          action: decision.action,
          reason: decision.reason,
          confidence: decision.confidence
        });
      }
    }
    // Only re-schedule if we actually moved a bot, or a bot is still to act.
    // If a human is next (or the hand ended), stop and wait for input.
    // Spectators pause auto-advance, so no auto re-schedule in that case.
    if (table.inHand && !autoAdvancePaused(tableId)) {
      const next = table.nextActorId();
      const na = next && table.playerById(next);
      if (na && na.isBot && !na.hasFolded && na.chips > 0) {
        driveBots(tableId);
      } else {
        pumps.delete(tableId);
      }
    } else {
      pumps.delete(tableId);
      if (!autoAdvancePaused(tableId)) autoStartIfAllBots(tableId);
      // Spectators see the frozen state; they drive the hand via `step`.
    }
    notifySpectators(tableId);
  }, BOT_DELAY_MS);
}

/** Fire-and-forget: auto-start (if all bots) and then drive any bot turns. */
function pumpTable(tableId) {
  autoStartIfAllBots(tableId);
  driveBots(tableId);
}

// ----------------------------------------------------------------- tutorial

/**
 * The raw events a live GameTable can emit. The server mirrors each one to the
 * table room as `gameEvent { event, payload }` so the client tutorial engine can
 * subscribe to a single, stable channel instead of N individual sockets.
 */
const TUTORIAL_EVENTS = [
  'handStarted',
  'blindsPosted',
  'holeDealt',
  'streetStarted',
  'flopRevealed',
  'turnRevealed',
  'riverRevealed',
  'actionTaken',
  'showdown',
  'handEnded'
];

/** Tables whose event stream has already been mirrored (avoid double-subscribe). */
const mirrored = new Set();

// ----------------------------------------------------------------- hand history

/**
 * Hand history (Sprint 4): an in-memory ring of finished hands, newest last.
 * Each record is built by the PURE `buildHandRecord` (shared) so the server and
 * any future importer share one definition. Capped to keep memory bounded.
 */
const handHistory = []; // array of hand records
const HAND_HISTORY_CAP = 100;

function recordHand(tableId, table) {
  let rec;
  try {
    rec = buildHandRecord(table, { ts: Date.now() });
  } catch (err) {
    return null;
  }
  if (!rec) return null;
  handHistory.push(rec);
  if (handHistory.length > HAND_HISTORY_CAP) {
    handHistory.splice(0, handHistory.length - HAND_HISTORY_CAP);
  }
  // Broadcast the fresh record to everyone currently at the table.
  io.to(tableRoom(tableId)).emit('handRecord', rec);
  return rec;
}

/**
 * Subscribe to a table's GameTable events (once) and re-broadcast each as
 * `gameEvent` to the whole room. Client-side (tutorial engine) only.
 */
function mirrorTableEvents(tableId) {
  if (mirrored.has(tableId)) return;
  mirrored.add(tableId);
  const entry = store.get(tableId);
  if (!entry) return;
  const table = entry.table;
  for (const eventName of TUTORIAL_EVENTS) {
    table.on(eventName, (payload) => {
      io.to(tableRoom(tableId)).emit('gameEvent', { event: eventName, payload });
      if (eventName === 'handEnded') recordHand(tableId, table);
    });
  }
}

/**
 * Set the seeded walkthrough for the next hand. The GameTable reads `_handSeed`
 * when `startHand()` shuffles, so the same seed reproduces the same cards/deck
 * order (determinism requirement). Returns the seed actually stored.
 */
function setHandSeed(table, seed) {
  table._handSeed = seed;
  return seed;
}

// ----------------------------------------------------------------- sockets

io.on('connection', (socket) => {
  let binding = null; // { tableId, playerId }

  const unbind = () => {
    if (binding) {
      const { tableId, playerId } = binding;
      binding = null;
      socket.leave(tableRoom(tableId));
      const entry = store.get(tableId);
      if (entry) {
        entry.players.delete(playerId);
        entry.table.removePlayer(playerId);
        // Remove any AI opponents (server-side bots with no socket) so we don't
        // leave an orphaned bot at an otherwise empty table.
        const humansLeft = [...entry.players.values()].some((p) => p.socketId !== null);
        if (!humansLeft) {
          for (const [pid, meta] of [...entry.players.entries()]) {
            if (meta.socketId === null) {
              entry.players.delete(pid);
              entry.table.removePlayer(pid);
            }
          }
        }
        broadcast(tableId);
      }
    }
    // Drop any spectator session for this socket so auto-advance can resume.
    for (const [tableId, set] of [...spectators.entries()]) {
      if (set.delete(socket.id)) {
        const empty = set.size === 0;
        if (empty) spectators.delete(tableId);
        if (empty) pumpTable(tableId); // last watcher left — resume auto-advance
      }
    }
  };

  socket.on('listTables', (ack) => {
    if (typeof ack === 'function') ack(store.listTables());
  });

  socket.on('joinTable', ({ tableId, name, isBot, bot, spawnBot, botDifficulty, avatarMeta }, ack) => {
    try {
      const entry = store.getOrCreate(tableId);
      // One socket = one player (local game). Use the socket id as the player id
      // so two browser tabs are two distinct players.
      const playerId = socket.id;
      if (entry.players.has(playerId)) {
        throw new Error('you already have a seat at this table');
      }
      const seat = assignSeat(entry.table, playerId);
      if (seat < 0) throw new Error('table full');
      // Sprint 5: avatarMeta is SMALL metadata only (avatarId + crop + kind).
      // The binary NEVER crosses the wire — see sanitizeAvatarMeta + the client
      // avatarStore. We defensively strip anything that looks like binary data.
      entry.table.addPlayer({
        id: playerId,
        name: name || 'Player',
        seat,
        isBot,
        bot,
        avatarMeta: sanitizeAvatarMeta(avatarMeta)
      });
      entry.players.set(playerId, { name: name || 'Player', socketId: socket.id });
      binding = { tableId, playerId };
      socket.join(tableRoom(tableId));
      // Make sure this table's GameTable events are mirrored to the room so
      // any connected tutorial engine can receive gameEvent broadcasts.
      mirrorTableEvents(tableId);

      // "Play vs AI": the human just joined — seat an AI opponent so they have
      // someone to play against. The bot is a server-side player (no socket of
      // its own); the bot loop drives it.
      if (spawnBot && !isBot) {
        const botSeat = assignSeat(entry.table, 'ai-opponent');
        if (botSeat >= 0) {
          const diff = botDifficulty || 'normal';
          const profile = getProfile(diff);
          const botId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const botName = pickBotName(profile, new Rng(`name:${botId}`));
          entry.table.addPlayer({ id: botId, name: botName, seat: botSeat, isBot: true, bot: { difficulty: diff } });
          // The bot has no socket — the broadcast loop just skips it.
          entry.players.set(botId, { name: botName, socketId: null });
        }
      }

      if (typeof ack === 'function') ack({ ok: true, playerId });
      broadcast(tableId);
      // An AI-only table should start playing on its own.
      pumpTable(tableId);
    } catch (err) {
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
    }
  });

  socket.on('startHand', (payload, ack) => {
    try {
      if (!binding) throw new Error('join a table first');
      const entry = store.get(binding.tableId);
      // Optional seeded walkthrough (tutorial): set the deck seed BEFORE the
      // hand starts so the shuffle reproduces the same hand.
      if (payload && payload.seed != null) setHandSeed(entry.table, payload.seed);
      mirrorTableEvents(binding.tableId);
      entry.table.startHand();
      if (typeof ack === 'function') ack({ ok: true, snapshot: entry.table.snapshotFor(binding.playerId) });
      broadcast(binding.tableId);
      // If the first actor to act is a bot (e.g. the dealer is a bot), play it now.
      pumpTable(binding.tableId);
    } catch (err) {
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
    }
  });

  socket.on('playerAction', ({ action, amount }, ack) => {
    try {
      if (!binding) throw new Error('join a table first');
      const entry = store.get(binding.tableId);
      entry.table.applyAction(binding.playerId, action, amount || 0);
      if (typeof ack === 'function') ack({ ok: true, snapshot: entry.table.snapshotFor(binding.playerId) });
      broadcast(binding.tableId);
      // If a bot is now to act, let it play (and chain on subsequent bots).
      pumpTable(binding.tableId);
    } catch (err) {
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
    }
  });

  socket.on('chatMessage', ({ text }) => {
    if (!binding) return;
    const entry = store.get(binding.tableId);
    const name = (entry.players.get(binding.playerId) || {}).name || 'Player';
    io.to(tableRoom(binding.tableId)).emit('chatMessage', {
      from: name,
      text: String(text).slice(0, 400),
      ts: Date.now()
    });
  });

  /**
   * Sprint 7 — emote RELAY. Previously emotes were local-only (only the sender
   * saw the bubble). Now the sender emits `emote { playerId, code }` and the
   * server re-broadcasts it to the whole table room, so every other seat renders
   * the bubble above the sender's stick figure. The code is validated against
   * the shared palette on the client; the server just relays the small payload.
   * Emotes require no game state — they work for players (and are safe even if
   * `binding` is missing, in which case we simply drop them).
   */
  socket.on('emote', ({ playerId, code }, ack) => {
    if (!binding) {
      if (typeof ack === 'function') ack({ ok: false, error: 'join a table first' });
      return;
    }
    const entry = store.get(binding.tableId);
    const targetId = String(playerId || binding.playerId);
    // Only allow emotes for a player actually seated at this table.
    if (!entry || !entry.table.players.some((p) => p.id === targetId)) {
      if (typeof ack === 'function') ack({ ok: false, error: 'unknown player' });
      return;
    }
    const safeCode = typeof code === 'string' ? code.slice(0, 32) : '';
    io.to(tableRoom(binding.tableId)).emit('emote', { playerId: targetId, code: safeCode, ts: Date.now() });
    if (typeof ack === 'function') ack({ ok: true, playerId: targetId, code: safeCode });
  });

  /**
   * Sprint 7 — live avatar update. `avatarMeta` is set only ONCE, at
   * `joinTable`. When the player picks a NEW avatar (or clears it) afterwards,
   * the blob is POSTed to `/avatars/:id`, but the server never learns the new
   * id — so every OTHER seat keeps resolving the stale/missing id and renders
   * the default stick figure. This handler attaches the current (sanitized)
   * avatarMeta to the caller's own player and re-broadcasts the snapshot so
   * the other seats re-fetch the shared blob and show the new avatar
   * immediately — no re-join required.
   */
  socket.on('updateAvatar', ({ avatarMeta }, ack) => {
    try {
      if (!binding) throw new Error('join a table first');
      const entry = store.get(binding.tableId);
      if (!entry) throw new Error('table not found');
      const me = entry.table.players.find((p) => p.id === binding.playerId);
      if (!me) throw new Error('no seat at this table');
      me.avatarMeta = sanitizeAvatarMeta(avatarMeta); // null when clearing
      broadcast(binding.tableId);
      if (typeof ack === 'function') ack({ ok: true, avatarMeta: me.avatarMeta });
    } catch (err) {
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
    }
  });

  socket.on('leaveTable', (ack) => {
    if (binding) unbind();
    // Spectators have no `binding` — the fix for "Leave does nothing while
    // spectating": drop this socket's spectator session(s) so it stops
    // watching (and auto-advance can resume if it was the last watcher).
    if (!binding) {
      for (const [tableId, set] of [...spectators.entries()]) {
        if (set.delete(socket.id)) {
          if (set.size === 0) spectators.delete(tableId);
          pumpTable(tableId);
        }
      }
    }
    if (typeof ack === 'function') ack({ ok: true });
  });

  /**
   * Add an AI opponent to a table at-will (Sprint 7). Usable by a seated
   * player (binding) or a spectator. This is the "dealer adds AI players"
   * and "spectate N AI play" capability.
   */
  socket.on('addBot', ({ tableId, botDifficulty }, ack) => {
    try {
      if (!tableId) throw new Error('tableId required');
      const entry = store.get(tableId);
      if (!entry) throw new Error('table not found');
      const diff = normalizeDifficulty(botDifficulty || 'normal');
      const botSeat = assignSeat(entry.table, 'ai');
      if (botSeat < 0) throw new Error('table full');
      const profile = getProfile(diff);
      const botId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const botName = pickBotName(profile, new Rng(`name:${botId}`));
      entry.table.addPlayer({ id: botId, name: botName, seat: botSeat, isBot: true, bot: { difficulty: diff } });
      entry.players.set(botId, { name: botName, socketId: null });
      mirrorTableEvents(tableId);
      if (typeof ack === 'function') ack({ ok: true, botId });
      broadcast(tableId);
      pumpTable(tableId);
    } catch (err) {
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
    }
  });

  /**
   * Remove a specific AI player from a table at-will (Sprint 7). Only bots can
   * be removed (never a human seat). If the table becomes empty it is torn down.
   */
  socket.on('removeBot', ({ tableId, botId }, ack) => {
    try {
      if (!tableId) throw new Error('tableId required');
      const entry = store.get(tableId);
      if (!entry) throw new Error('table not found');
      const meta = entry.players.get(botId);
      const player = entry.table.playerById(botId);
      if (!meta || !player || !player.isBot) throw new Error('that seat is not a removable AI player');
      if (entry.table.inHand) throw new Error('wait for the hand to end before removing a player');
      entry.players.delete(botId);
      entry.table.removePlayer(botId);
      if (typeof ack === 'function') ack({ ok: true });
      broadcast(tableId);
      pumpTable(tableId);
    } catch (err) {
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
    }
  });

  // ------------------------------------------------------------- spectators
  // A socket is either a live player (binding) or a spectator — never both.
  // Spectators hold no seat and can see every hole card (server-authorized).

  socket.on('enterSpectator', ({ tableId, showAllCards }, ack) => {
    try {
      if (!tableId) throw new Error('tableId required');
      const entry = store.get(tableId);
      if (!entry) throw new Error('table not found');
      if (binding) throw new Error('you already have a seat here — leave first');
      let set = spectators.get(tableId);
      if (!set) {
        set = new Map();
        spectators.set(tableId, set);
      }
      set.set(socket.id, { showAllCards: !!showAllCards });
      socket.join(tableRoom(tableId));
      mirrorTableEvents(tableId);
      if (typeof ack === 'function') {
        ack({ ok: true, snapshot: spectatorSnapshot(entry, socket.id) });
      }
      // Presence changes: broadcast the (possibly frozen) state to all watchers.
      notifySpectators(tableId);
    } catch (err) {
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
    }
  });

  socket.on('setShowAllCards', ({ tableId, on }, ack) => {
    try {
      const set = spectators.get(tableId);
      const meta = set && set.get(socket.id);
      if (!meta) throw new Error('not a spectator on this table');
      meta.showAllCards = on === true;
      if (typeof ack === 'function') {
        const entry = store.get(tableId);
        ack({ ok: true, snapshot: entry ? spectatorSnapshot(entry, socket.id) : null });
      }
      notifySpectators(tableId);
    } catch (err) {
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
    }
  });

  /**
   * Advance the hand exactly one step (one legal actor move, or start the next
   * hand). This is the spectator's substitute for the auto-pump: while a
   * spectator is present, auto-advance is paused and `step` is the only way
   * the table moves forward.
   */
  socket.on('step', ({ tableId }, ack) => {
    try {
      if (!tableId) throw new Error('tableId required');
      const set = spectators.get(tableId);
      const meta = set && set.get(socket.id);
      if (!meta) throw new Error('not a spectator on this table');
      const entry = store.get(tableId);
      if (!entry) throw new Error('table not found');
      const table = entry.table;
      if (!table.inHand) {
        table.startHand();
      } else {
        const next = table.nextActorId();
        if (next) {
          // Advance exactly one legal move. `check` is fastest when no bet is
          // to act on; otherwise fall back to a deterministic, legal action
          // via the (seeded) AI so step-through is always valid.
          try {
            table.applyAction(next, 'check', 0);
          } catch (err) {
            const d = decideAction(table, next, {
              difficulty: 'easy',
              seed: `${table.handNumber}-${table.street}`
            });
            table.applyAction(next, d.action, d.amount || 0);
          }
        }
      }
      if (typeof ack === 'function') {
        ack({ ok: true, snapshot: spectatorSnapshot(entry, socket.id) });
      }
      broadcast(tableId); // also pushes the fresh spectator state via notifySpectators
    } catch (err) {
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
    }
  });

  // ----------------------------------------------------------------- history

  socket.on('getHistory', ({ tableId }, ack) => {
    if (typeof ack !== 'function') return;
    if (tableId) {
      ack({ ok: true, hands: handHistory.filter((h) => h.tableId === tableId) });
    } else {
      ack({ ok: true, hands: [...handHistory] });
    }
  });

  socket.on('exportHistory', ({ tableId }, ack) => {
    if (typeof ack !== 'function') return;
    const hands = tableId
      ? handHistory.filter((h) => h.tableId === tableId)
      : [...handHistory];
    ack({ ok: true, json: serializeHandRecord(hands) });
  });

  socket.on('disconnect', () => {
    unbind();
  });
});

export function startServer(port = 0) {
  return new Promise((resolve) => {
    const s = server.listen(port, () => {
      const addr = s.address();
      resolve({ server: s, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

if (
  process.env.NODE_ENV !== 'test' &&
  !process.env.VITEST &&
  !process.env.VITEST_WORKER_ID
) {
  server.listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`[saloon] server listening on http://${HOST}:${PORT}`);
  });
}

export { app, server, io, store };
