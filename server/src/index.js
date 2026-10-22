import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameStateStore } from './gameStateStore.js';
import { decideAction } from '@saloon/shared/ai';
import {
  getProfile,
  personaFor,
  styleLabel,
  pickBotName,
  Rng,
  buildHandRecord,
  serializeHandRecord,
  recordOpponentHand,
  CPU_LINES,
  ANNOUNCER_LINES,
  ANNOUNCER_KEY,
  pickLine,
  voiceForName
} from '@saloon/shared';
import { handEndTalk, actionTalk, slowHeckler } from './tableTalk.js';
import {
  DEFAULT_SETTINGS,
  sanitizeSettings,
  publicSettings,
  blindsForLevel,
  thinkingTimeMs,
  dealDelayMs,
  IS_TEST
} from './tableRules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

/** Hard cap on consecutive bot moves before we assume something is stuck. */
const BOT_LOOP_GUARD = 150;

/** Missed turns in a row before a player is sat out automatically. */
const TIMEOUTS_BEFORE_SIT_OUT = 2;

const app = express();
app.use(cors());
app.use(express.json());

// Serve the built frontend in production
const distDir = path.resolve(__dirname, '../../frontend/dist');
app.use(express.static(distDir));
app.get('/health', (req, res) => res.json({ ok: true, name: 'saloon-server' }));

// ----------------------------------------------------------------- avatars
// Uploaded pictures are shared through a small in-memory store keyed by
// avatarId: the uploader POSTs the bytes, other seats GET them. Per-process
// and best-effort; a missing picture falls back to the generated character.
const avatarBlobs = new Map(); // avatarId -> { blob, mime }
const MAX_AVATAR_UPLOAD = 20 * 1024 * 1024; // 20 MB, matches the client cap
const MAX_AVATARS = 64; // oldest uploads are evicted past this

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
  const mime =
    String(req.get('content-type') || '')
      .split(';')[0]
      .trim() || 'application/octet-stream';
  if (!mime.startsWith('image/')) {
    res.status(415).json({ ok: false, error: 'avatars must be images' });
    return;
  }
  // Keep memory bounded: Map preserves insertion order, so evict the oldest.
  avatarBlobs.delete(id);
  while (avatarBlobs.size >= MAX_AVATARS) avatarBlobs.delete(avatarBlobs.keys().next().value);
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

const store = new GameStateStore(DEFAULT_SETTINGS);

// ----------------------------------------------------------------- helpers

function tableRoom(tableId) {
  return `table:${tableId}`;
}

function assignSeat(table) {
  const taken = new Set(table.players.map((p) => p.seat));
  for (let s = 0; s < 10; s += 1) {
    if (!taken.has(s)) return s;
  }
  return -1;
}

/** Tell everyone at a table about something (shown as a toast). */
function notice(tableId, key, vars = {}) {
  io.to(tableRoom(tableId)).emit('notice', { key, vars, ts: Date.now() });
}

/** Minimum gaps between spoken lines, so the table never gets too chatty. */
const CPU_TALK_GAP_MS = 5000;
const ANNOUNCER_GAP_MS = 2500;

/**
 * Say a line out loud: pick one for the situation (avoiding an immediate
 * repeat), rate-limit, and broadcast it so every seat plays the same clip.
 * Clients play /assets/voice/<voice>/<id>.mp3 and show the text.
 */
function talk(tableId, decision, { force = false } = {}) {
  const entry = store.get(tableId);
  if (!entry || !decision) return;
  const memo = entry.talk || (entry.talk = { cpuAt: 0, announcerAt: 0, last: {} });
  const now = Date.now();
  const isCpu = decision.speaker === 'cpu';
  const lastAt = isCpu ? memo.cpuAt : memo.announcerAt;
  if (!force && now - lastAt < (isCpu ? CPU_TALK_GAP_MS : ANNOUNCER_GAP_MS)) return;
  let speakerName = null;
  let voice = ANNOUNCER_KEY;
  if (isCpu) {
    const p = entry.table.playerById(decision.playerId);
    if (!p) return;
    speakerName = p.name;
    voice = voiceForName(p.name);
  }
  const line = pickLine(
    isCpu ? CPU_LINES : ANNOUNCER_LINES,
    decision.category,
    Math.random,
    memo.last[decision.category]
  );
  if (!line) return;
  memo.last[decision.category] = line.id;
  if (isCpu) memo.cpuAt = now;
  else memo.announcerAt = now;
  io.to(tableRoom(tableId)).emit('voiceLine', {
    speaker: decision.speaker,
    playerId: decision.playerId || null,
    name: speakerName,
    voice,
    id: line.id,
    category: decision.category,
    text: line.text,
    sfx: decision.sfx || null,
    ts: now
  });
}

/**
 * The view one player (or spectator) gets: the engine snapshot plus the
 * server's table state — settings, shot clock, next-deal countdown,
 * tournament status and session results.
 */
function viewFor(entry, viewerId, options = {}) {
  const now = Date.now();
  const table = entry.table;
  const snap = table.snapshotFor(viewerId, options);
  // "Away" (tournament sit-out) shows the same as sitting out.
  snap.players = snap.players.map((p) => {
    const meta = entry.players.get(p.id);
    return meta && meta.away ? { ...p, sittingOut: true } : p;
  });
  const session = {};
  for (const p of table.players) {
    const meta = entry.players.get(p.id) || {};
    const s = entry.session[p.id] || { handsWon: 0, biggestPot: 0 };
    session[p.id] = {
      handsWon: s.handsWon,
      biggestPot: s.biggestPot,
      net: p.chips - (meta.buyIns || 1) * table.startingStack
    };
  }
  const tour = entry.tour;
  return {
    ...snap,
    settings: publicSettings(entry.settings),
    turn: entry.turn
      ? {
          playerId: entry.turn.playerId,
          remainingMs: Math.max(0, entry.turn.deadline - now),
          totalMs: entry.turn.totalMs
        }
      : null,
    nextHandIn: entry.nextHandAt ? Math.max(0, entry.nextHandAt - now) : null,
    tournament: tour
      ? {
          level: tour.level,
          handsLeftInLevel: Math.max(0, entry.settings.levelHands - tour.handsAtLevel),
          nextBlinds: blindsForLevel(tour.level + 1, entry.settings.smallBlind, entry.settings.bigBlind),
          finished: tour.finished,
          standings: tour.standings
        }
      : null,
    session
  };
}

/** Push a fresh, per-viewer view to every seated player (own hole cards only). */
function broadcast(tableId) {
  const entry = store.get(tableId);
  if (!entry) return;
  for (const [playerId, meta] of entry.players.entries()) {
    const socket = meta.socketId && io.sockets.sockets.get(meta.socketId);
    if (socket) socket.emit('state', viewFor(entry, playerId));
  }
  notifySpectators(tableId);
}

/**
 * Everything that has to happen after the table changes, in order: arm the
 * shot clock, schedule the next deal, push the new state, let CPUs act.
 */
function sync(tableId) {
  armTurnTimer(tableId);
  scheduleNextHand(tableId);
  broadcast(tableId);
  driveBots(tableId);
}

// ----------------------------------------------------------------- spectators

/** tableId -> Map<socketId, { showAllCards }> */
const spectators = new Map();

/**
 * Auto-advance (CPU turns, shot clock, auto-deal) is paused while anyone is
 * spectating, so the step-through control can move the hand one action at a time.
 */
function autoAdvancePaused(tableId) {
  const set = spectators.get(tableId);
  return !!(set && set.size > 0);
}

function broadcastSpectators(tableId) {
  const set = spectators.get(tableId);
  if (!set || set.size === 0) return;
  const entry = store.get(tableId);
  if (!entry) return;
  for (const [socketId] of set.entries()) {
    const socket = io.sockets.sockets.get(socketId);
    if (socket) socket.emit('state', spectatorSnapshot(entry, socketId));
  }
}

function notifySpectators(tableId) {
  if (autoAdvancePaused(tableId)) broadcastSpectators(tableId);
}

/** Spectator view; revealing every hole card is authorised here, server-side. */
function spectatorSnapshot(entry, socketId) {
  const map = spectators.get(entry.table.tableId) || new Map();
  const meta = map.get(socketId) || { showAllCards: true };
  return {
    ...viewFor(entry, null, { revealAllHoles: !!meta.showAllCards }),
    playerId: null,
    spectator: true
  };
}

// ----------------------------------------------------------------- avatars meta

const LOOK_KEYS = [
  'backdrop',
  'skin',
  'hat',
  'hatColor',
  'hair',
  'hairColor',
  'facial',
  'shirt',
  'bandana',
  'eyes'
];

/**
 * Only small, whitelisted avatar metadata may ride along with a player: an
 * uploaded picture's id + crop, or a character-creator look (small integers).
 * No binary data ever goes over the socket.
 */
function sanitizeAvatarMeta(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const out = {};
  const pickStr = (v) => (typeof v === 'string' ? v.slice(0, 80) : null);
  const pickNum = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const id = pickStr(meta.avatarId);
  const kind = pickStr(meta.kind);
  if (id != null) out.avatarId = id;
  if (kind != null) out.kind = kind;
  if (pickStr(meta.name) != null) out.name = pickStr(meta.name);
  if (typeof meta.crop === 'object' && meta.crop != null) {
    const c = meta.crop;
    const crop = {};
    for (const k of ['x', 'y', 'size', 'w', 'h']) if (pickNum(c[k]) != null) crop[k] = c[k];
    if (Object.keys(crop).length > 0) out.crop = crop;
  }
  if (typeof meta.look === 'object' && meta.look != null) {
    const look = {};
    for (const k of LOOK_KEYS) {
      const v = meta.look[k];
      if (Number.isInteger(v) && v >= 0 && v < 32) look[k] = v;
    }
    if (Object.keys(look).length > 0) out.look = look;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function normalizeDifficulty(bot) {
  if (!bot) return 'normal';
  if (typeof bot === 'string') return ['easy', 'normal', 'hard'].includes(bot) ? bot : 'normal';
  return normalizeDifficulty(bot.difficulty || bot.level || 'normal');
}

// ----------------------------------------------------------------- shot clock

function clearTurn(entry) {
  if (entry.turn && entry.turn.timer) clearTimeout(entry.turn.timer);
  if (entry.turn && entry.turn.heckle) clearTimeout(entry.turn.heckle);
  entry.turn = null;
}

/**
 * Start the shot clock for the human whose turn it is (if the table uses one).
 * A player who is sitting out gets acted for almost at once.
 */
function armTurnTimer(tableId) {
  const entry = store.get(tableId);
  if (!entry) return;
  const t = entry.table;
  const nextId = t.inHand ? t.nextActorId() : null;
  const actor = nextId && t.playerById(nextId);
  const key = nextId ? `${t.handNumber}:${t.actionLog.length}:${nextId}` : null;
  if (entry.turn && entry.turn.key === key) return; // already running for this decision
  clearTurn(entry);
  if (!actor || actor.isBot || autoAdvancePaused(tableId)) return;
  const meta = entry.players.get(nextId) || {};
  // Away players are acted for at once; tests run the clock 100x faster.
  const totalMs = actor.sittingOut || meta.away ? 700 : entry.settings.turnSeconds * (IS_TEST ? 10 : 1000);
  if (!totalMs) return;
  entry.turn = {
    key,
    playerId: nextId,
    deadline: Date.now() + totalMs,
    totalMs,
    timer: setTimeout(() => onTurnTimeout(tableId, key), totalMs),
    // With a few seconds left, a CPU tells the slowpoke to hurry up.
    heckle:
      totalMs >= 12000 && !IS_TEST
        ? setTimeout(() => {
            if (!entry.turn || entry.turn.key !== key || Math.random() > 0.55) return;
            talk(tableId, slowHeckler(entry.table, nextId));
          }, totalMs - 8000)
        : null
  };
}

/** Time ran out: check if possible, otherwise fold. Repeat offenders sit out. */
function onTurnTimeout(tableId, key) {
  const entry = store.get(tableId);
  if (!entry || !entry.turn || entry.turn.key !== key) return;
  const id = entry.turn.playerId;
  entry.turn = null;
  const t = entry.table;
  if (!t.inHand || t.nextActorId() !== id) return;
  const p = t.playerById(id);
  const owes = t.currentBet > p.contributions[t.street];
  t.applyAction(id, owes ? 'fold' : 'check');
  const meta = entry.players.get(id);
  if (meta && !p.sittingOut && !meta.away) {
    meta.timeouts = (meta.timeouts || 0) + 1;
    if (meta.timeouts >= TIMEOUTS_BEFORE_SIT_OUT) {
      setAway(entry, id, true);
      notice(tableId, 'notice.satOut', { name: p.name });
    }
  }
  sync(tableId);
}

/**
 * Sit a player out (or back in). In a cash game they are simply not dealt in;
 * in a tournament they stay dealt in and fold automatically, as in a real one.
 */
function setAway(entry, id, away) {
  const meta = entry.players.get(id);
  if (meta) {
    meta.away = !!away;
    meta.timeouts = 0;
  }
  if (!entry.tour) entry.table.setSittingOut(id, !!away);
  return !!away;
}

// ----------------------------------------------------------------- dealing

function eligibleCount(entry) {
  const rebuys = entry.settings.cpuRebuy && entry.settings.mode === 'cash';
  return entry.table.players.filter((p) => !p.sittingOut && (p.chips > 0 || (rebuys && p.isBot))).length;
}

/**
 * Deal the next hand after a pause when the table runs itself: auto-deal is
 * on, every seat is a CPU, or a CPU has the button.
 */
function scheduleNextHand(tableId) {
  const entry = store.get(tableId);
  if (!entry) return;
  const t = entry.table;
  if (t.inHand || entry.dealTimer || autoAdvancePaused(tableId)) return;
  if (entry.tour && entry.tour.finished) return;
  if (eligibleCount(entry) < 2) return;
  const allBots = t.players.length > 0 && t.players.every((p) => p.isBot);
  const dealerIsBot = t.handNumber > 0 && t.players.some((p) => p.seat === t.dealerSeat && p.isBot);
  if (!entry.settings.autoDeal && !allBots && !dealerIsBot) return;
  const delay = dealDelayMs({
    speed: entry.settings.speed,
    showdown: !!t.lastShowdown,
    first: t.handNumber === 0
  });
  entry.nextHandAt = Date.now() + delay;
  entry.dealTimer = setTimeout(() => {
    entry.dealTimer = null;
    entry.nextHandAt = null;
    if (store.get(tableId) !== entry || entry.table.inHand) return;
    dealHand(tableId);
  }, delay);
}

function cancelScheduledDeal(entry) {
  if (entry.dealTimer) clearTimeout(entry.dealTimer);
  entry.dealTimer = null;
  entry.nextHandAt = null;
}

/** Start a hand now: CPU rebuys, tournament blind levels, then deal. */
function dealHand(tableId, seed = null) {
  const entry = store.get(tableId);
  if (!entry) return false;
  cancelScheduledDeal(entry);
  const t = entry.table;
  if (entry.settings.cpuRebuy && entry.settings.mode === 'cash') {
    for (const p of t.players) {
      if (p.isBot && p.chips === 0) {
        t.rebuy(p.id);
        const meta = entry.players.get(p.id);
        if (meta) meta.buyIns = (meta.buyIns || 1) + 1;
      }
    }
  }
  if (entry.tour) {
    const tour = entry.tour;
    if (tour.handsAtLevel >= entry.settings.levelHands) {
      tour.level += 1;
      tour.handsAtLevel = 0;
      const [sb, bb] = blindsForLevel(tour.level, entry.settings.smallBlind, entry.settings.bigBlind);
      t.setBlinds(sb, bb);
      notice(tableId, 'notice.blindsUp', { sb, bb, level: tour.level });
      talk(tableId, { speaker: 'announcer', category: 'blindsUp' }, { force: true });
    }
  }
  if (seed != null) t._handSeed = seed;
  const firstHand =
    t.handNumber === 0 || (entry.tour && entry.tour.level === 1 && entry.tour.handsAtLevel === 0);
  t.startHand();
  if (firstHand) talk(tableId, { speaker: 'announcer', category: 'shuffle' }, { force: true });
  if (entry.tour) entry.tour.handsAtLevel += 1;
  sync(tableId);
  return true;
}

/** Bookkeeping when a hand ends: CPU memory, session results, tournament places, table talk. */
function onHandEnded(tableId) {
  const entry = store.get(tableId);
  if (!entry) return;
  const t = entry.table;
  recordOpponentHand(entry.reads, t);
  const payouts = t.payouts || {};
  for (const [id, amount] of Object.entries(payouts)) {
    if (!(amount > 0)) continue;
    const s = entry.session[id] || (entry.session[id] = { handsWon: 0, biggestPot: 0 });
    s.handsWon += 1;
    s.biggestPot = Math.max(s.biggestPot, t.lastPot || amount);
  }

  // Table talk: brags, bad beats, busts, and the announcer for big hands.
  // Wait for an all-in runout to finish on screen before anyone gloats.
  const decisions = handEndTalk(t);
  const handNo = t.handNumber;
  if (decisions.length) {
    setTimeout(
      () => {
        const live = store.get(tableId);
        if (!live || live.table.handNumber !== handNo) return;
        for (const d of decisions) talk(tableId, d);
      },
      t.runoutFrom !== null ? 3200 : 700
    );
  }

  // Tournament: anyone who just ran out of chips is out; last one standing wins.
  if (entry.tour && !entry.tour.finished) {
    const tour = entry.tour;
    const busted = t.players.filter((p) => p.chips === 0 && !tour.out.includes(p.id));
    const aliveBefore = t.players.length - tour.out.length;
    busted.forEach((p, i) => {
      tour.out.push(p.id);
      const place = aliveBefore - (busted.length - 1 - i);
      notice(tableId, 'notice.eliminated', { name: p.name, place });
      if (!p.isBot) talk(tableId, { speaker: 'announcer', category: 'endOfTrail' }, { force: true });
    });
    const alive = t.players.filter((p) => p.chips > 0);
    if (alive.length <= 1) {
      tour.finished = true;
      const order = [...alive.map((p) => p.id), ...[...tour.out].reverse()];
      tour.standings = order.map((id, i) => {
        const p = t.playerById(id);
        return { id, name: p ? p.name : '?', place: i + 1 };
      });
      if (alive[0]) {
        notice(tableId, 'notice.tournamentWon', { name: alive[0].name });
        setTimeout(
          () => talk(tableId, { speaker: 'announcer', category: 'tournamentWin' }, { force: true }),
          1500
        );
      }
    }
  }
}

// ----------------------------------------------------------------- bots

/** tableId -> { timer, moveCount, handNum } */
const pumps = new Map();

/**
 * If a CPU is to act, let it think for a human-like moment, decide, act, and
 * repeat while CPUs keep having the turn. Repeated calls coalesce into one
 * pending step per table.
 */
function driveBots(tableId) {
  const entry = store.get(tableId);
  if (!entry || autoAdvancePaused(tableId)) return;
  const t = entry.table;
  if (!t.inHand) return;
  const nextId = t.nextActorId();
  const actor = nextId && t.playerById(nextId);
  if (!actor || !actor.isBot) return;

  let pump = pumps.get(tableId);
  if (!pump) {
    pump = { timer: null, moveCount: 0, handNum: -1 };
    pumps.set(tableId, pump);
  }
  if (pump.timer) return;
  const owes = Math.max(0, t.currentBet - actor.contributions[t.street]);
  const delay = thinkingTimeMs({ speed: entry.settings.speed, toCall: owes, pot: t.pot, chips: actor.chips });

  pump.timer = setTimeout(() => {
    pump.timer = null;
    const live = store.get(tableId);
    if (!live || live !== entry) {
      pumps.delete(tableId);
      return;
    }
    const table = entry.table;
    if (table.handNumber !== pump.handNum) {
      pump.handNum = table.handNumber;
      pump.moveCount = 0;
    }
    const id = table.inHand ? table.nextActorId() : null;
    const bot = id && table.playerById(id);
    if (!bot || !bot.isBot || autoAdvancePaused(tableId) || pump.moveCount >= BOT_LOOP_GUARD) return;
    pump.moveCount += 1;
    const seed = [tableId, table.handNumber, table.street, id, table.actionLog.length, pump.moveCount].join(
      ':'
    );
    let decision;
    try {
      decision = decideAction(table, id, {
        difficulty: normalizeDifficulty(bot.bot),
        persona: bot.name,
        reads: entry.reads,
        seed
      });
      table.applyAction(id, decision.action, decision.amount || 0);
    } catch (err) {
      // Never let a CPU stall the table: fall back to the safest legal move.
      console.error(`[bot ${bot.name}@${tableId}] ${err && err.message}`);
      const fallback = table.currentBet > bot.contributions[table.street] ? 'fold' : 'check';
      table.applyAction(id, fallback);
      decision = { action: fallback, reason: 'fallback', confidence: 0 };
    }
    io.to(tableRoom(tableId)).emit('botAction', {
      playerId: id,
      action: decision.action,
      reason: decision.reason,
      confidence: decision.confidence
    });
    sync(tableId);
  }, delay);
}

// ----------------------------------------------------------------- events + history

/** Raw GameTable events mirrored to the room as `gameEvent` (tutorial, sounds). */
const TABLE_EVENTS = [
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

/** Tables whose events are already wired up. */
const attached = new Set();

/** In-memory ring of finished hands (newest last), shared by every table. */
const handHistory = [];
const HAND_HISTORY_CAP = 100;

function recordHand(tableId, table) {
  let rec;
  try {
    rec = buildHandRecord(table, { ts: Date.now() });
  } catch (err) {
    return null;
  }
  if (!rec) return null;
  // Records go to everyone at the table, so only reveal hands that were
  // actually shown down — never folded or uncalled hole cards.
  for (const p of rec.players) {
    if (!p.bestHand) p.holeCards = null;
  }
  handHistory.push(rec);
  if (handHistory.length > HAND_HISTORY_CAP) handHistory.splice(0, handHistory.length - HAND_HISTORY_CAP);
  io.to(tableRoom(tableId)).emit('handRecord', rec);
  return rec;
}

/** Wire a table's events to the room, the history and the hand-end bookkeeping (once). */
function attachTable(tableId) {
  if (attached.has(tableId)) return;
  const entry = store.get(tableId);
  if (!entry) return;
  attached.add(tableId);
  const table = entry.table;
  for (const eventName of TABLE_EVENTS) {
    table.on(eventName, (payload) => {
      io.to(tableRoom(tableId)).emit('gameEvent', { event: eventName, payload });
      if (eventName === 'handEnded') {
        recordHand(tableId, table);
        onHandEnded(tableId);
      }
    });
  }
  // CPUs react to all-ins and needle players who fold to their bets.
  table.on('actionTaken', (payload) => talk(tableId, actionTalk(table, payload)));
}

// ----------------------------------------------------------------- sockets

/** Drop a table once nobody is seated at it or watching it. */
function teardownIfEmpty(tableId) {
  const entry = store.get(tableId);
  if (!entry || entry.players.size > 0 || autoAdvancePaused(tableId)) return;
  const pump = pumps.get(tableId);
  if (pump && pump.timer) clearTimeout(pump.timer);
  pumps.delete(tableId);
  clearTurn(entry);
  cancelScheduledDeal(entry);
  attached.delete(tableId);
  store.delete(tableId);
}

/** Stop watching every table this socket is spectating. */
function dropSpectator(socketId) {
  for (const [tableId, set] of [...spectators.entries()]) {
    if (!set.delete(socketId)) continue;
    if (set.size === 0) spectators.delete(tableId);
    sync(tableId); // the last watcher left — resume auto-advance
    teardownIfEmpty(tableId);
  }
}

/** Seat a server-driven CPU player (no socket of its own). */
function seatBot(entry, difficulty) {
  const seat = assignSeat(entry.table);
  if (seat < 0) throw new Error('table full');
  const profile = getProfile(difficulty);
  const botId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const taken = entry.table.players.map((p) => p.name);
  const botName = pickBotName(profile, new Rng(`name:${botId}`), taken);
  const style = styleLabel(personaFor(profile, botName));
  entry.table.addPlayer({ id: botId, name: botName, seat, isBot: true, bot: { difficulty, style } });
  entry.players.set(botId, { name: botName, socketId: null, timeouts: 0, buyIns: 1 });
  return botId;
}

io.on('connection', (socket) => {
  let binding = null; // { tableId, playerId }

  /**
   * Register a socket handler. The handler always receives a plain-object
   * payload and a `reply` function (a no-op if the client sent no callback).
   * A thrown error becomes `{ ok: false, error }` instead of crashing the
   * server, so a malformed message can never take the game down.
   */
  const on = (event, handler) => {
    socket.on(event, (...args) => {
      const ack = typeof args[args.length - 1] === 'function' ? args.pop() : null;
      const payload = args[0] && typeof args[0] === 'object' ? args[0] : {};
      const reply = (res) => {
        if (ack) ack(res);
      };
      try {
        handler(payload, reply);
      } catch (err) {
        reply({ ok: false, error: (err && err.message) || 'server error' });
      }
    });
  };

  /** The table this socket is seated at (throws if it is not seated). */
  const seatedEntry = () => {
    if (!binding) throw new Error('join a table first');
    const entry = store.get(binding.tableId);
    if (!entry) throw new Error('table not found');
    return entry;
  };

  const unbind = () => {
    if (binding) {
      const { tableId, playerId } = binding;
      binding = null;
      socket.leave(tableRoom(tableId));
      const entry = store.get(tableId);
      if (entry) {
        const leaving = entry.table.playerById(playerId);
        entry.players.delete(playerId);
        entry.table.removePlayer(playerId);
        if (leaving) notice(tableId, 'notice.left', { name: leaving.name });
        // CPUs do not stay at a table with no humans left.
        const humansLeft = [...entry.players.values()].some((p) => p.socketId !== null);
        if (!humansLeft) {
          for (const [pid, meta] of [...entry.players.entries()]) {
            if (meta.socketId === null) {
              entry.players.delete(pid);
              entry.table.removePlayer(pid);
            }
          }
        }
        sync(tableId);
        teardownIfEmpty(tableId);
      }
    }
    dropSpectator(socket.id);
  };

  on('listTables', (_payload, reply) => {
    reply(
      store.listTables().map((tbl) => {
        const entry = store.get(tbl.tableId);
        return { ...tbl, mode: entry.settings.mode, startingStack: entry.settings.startingStack };
      })
    );
  });

  on('joinTable', (payload, reply) => {
    const { tableId, name, isBot, bot, spawnBot, botDifficulty, avatarMeta, options } = payload;
    if (typeof tableId !== 'string' || !tableId.trim()) throw new Error('table name required');
    if (binding) throw new Error('you already have a seat — leave first');
    const id = tableId.trim().slice(0, 64);
    const playerName = (typeof name === 'string' && name.trim().slice(0, 32)) || 'Player';
    const isNew = !store.get(id);
    const entry = store.getOrCreate(id, options ? sanitizeSettings(options) : DEFAULT_SETTINGS);
    if (isNew && entry.settings.mode === 'tournament') {
      entry.tour = { level: 1, handsAtLevel: 0, out: [], finished: false, standings: null };
    }
    if (entry.tour && entry.table.handNumber > 0 && !entry.tour.finished) {
      throw new Error('this tournament has already started');
    }
    // One socket = one player: the socket id is the player id, so two browser
    // tabs are two distinct players.
    const playerId = socket.id;
    if (entry.players.has(playerId)) throw new Error('you already have a seat at this table');
    const seat = assignSeat(entry.table);
    if (seat < 0) throw new Error('table full');
    entry.table.addPlayer({
      id: playerId,
      name: playerName,
      seat,
      isBot: !!isBot,
      bot: isBot ? { difficulty: normalizeDifficulty(bot) } : null,
      avatarMeta: sanitizeAvatarMeta(avatarMeta)
    });
    entry.players.set(playerId, { name: playerName, socketId: socket.id, timeouts: 0, buyIns: 1 });
    binding = { tableId: id, playerId };
    socket.join(tableRoom(id));
    attachTable(id);
    if (!isNew) notice(id, 'notice.joined', { name: playerName });

    // CPU opponents: the classic single "play vs AI" bot, or several from the
    // table setup screen.
    const cpuCount = Math.max(0, Math.min(9, Number(options && options.cpuCount) || 0));
    const wanted = spawnBot && !isBot ? Math.max(1, cpuCount) : cpuCount;
    const MIXED = ['easy', 'normal', 'hard'];
    for (let i = 0; i < wanted && assignSeat(entry.table) >= 0; i += 1) {
      // "mixed" seats a spread of easy, normal and hard CPUs.
      const diff = botDifficulty === 'mixed' ? MIXED[i % MIXED.length] : normalizeDifficulty(botDifficulty);
      const botId = seatBot(entry, diff);
      if (i === 0 && Math.random() < 0.6)
        talk(id, { speaker: 'cpu', playerId: botId, category: 'greet' }, { force: true });
    }

    reply({ ok: true, playerId, tableId: id });
    sync(id);
  });

  on('startHand', (payload, reply) => {
    const entry = seatedEntry();
    if (entry.tour && entry.tour.finished) throw new Error('the tournament is over — start a new one');
    dealHand(binding.tableId, payload.seed != null ? payload.seed : null);
    reply({ ok: true, snapshot: viewFor(entry, binding.playerId) });
  });

  on('playerAction', ({ action, amount }, reply) => {
    const entry = seatedEntry();
    entry.table.applyAction(binding.playerId, action, amount || 0);
    const meta = entry.players.get(binding.playerId);
    if (meta) meta.timeouts = 0;
    clearTurn(entry);
    reply({ ok: true, snapshot: viewFor(entry, binding.playerId) });
    sync(binding.tableId);
  });

  on('sitOut', ({ out }, reply) => {
    const entry = seatedEntry();
    const sitting = setAway(entry, binding.playerId, !!out);
    reply({ ok: true, sittingOut: sitting });
    sync(binding.tableId);
  });

  on('rebuy', (_payload, reply) => {
    const entry = seatedEntry();
    if (entry.tour) throw new Error('no rebuys in a tournament');
    const chips = entry.table.rebuy(binding.playerId);
    const meta = entry.players.get(binding.playerId);
    if (meta) meta.buyIns = (meta.buyIns || 1) + 1;
    reply({ ok: true, chips });
    sync(binding.tableId);
  });

  /** After a tournament ends, anyone at the table can start another. */
  on('restartTournament', (_payload, reply) => {
    const entry = seatedEntry();
    if (!entry.tour || !entry.tour.finished) throw new Error('no finished tournament to restart');
    const t = entry.table;
    for (const p of t.players) {
      p.chips = t.startingStack;
      p.sittingOut = false;
      const meta = entry.players.get(p.id);
      if (meta) meta.away = false;
    }
    t.setBlinds(entry.settings.smallBlind, entry.settings.bigBlind);
    entry.tour = { level: 1, handsAtLevel: 0, out: [], finished: false, standings: null };
    entry.session = {};
    reply({ ok: true });
    notice(binding.tableId, 'notice.tournamentStart', {});
    sync(binding.tableId);
  });

  on('chatMessage', ({ text }) => {
    const entry = seatedEntry();
    const clean = String(text ?? '')
      .trim()
      .slice(0, 400);
    if (!clean) return;
    const name = (entry.players.get(binding.playerId) || {}).name || 'Player';
    io.to(tableRoom(binding.tableId)).emit('chatMessage', { from: name, text: clean, ts: Date.now() });
  });

  /** Emote relay: re-broadcast `{ playerId, code }` to the whole table. */
  on('emote', ({ playerId, code }, reply) => {
    const entry = seatedEntry();
    const targetId = String(playerId || binding.playerId);
    if (!entry.table.players.some((p) => p.id === targetId)) throw new Error('unknown player');
    const safeCode = typeof code === 'string' ? code.slice(0, 32) : '';
    io.to(tableRoom(binding.tableId)).emit('emote', { playerId: targetId, code: safeCode, ts: Date.now() });
    reply({ ok: true, playerId: targetId, code: safeCode });
  });

  /** Change your picture or character mid-session; `avatarMeta: null` clears it. */
  on('updateAvatar', ({ avatarMeta }, reply) => {
    const entry = seatedEntry();
    const me = entry.table.playerById(binding.playerId);
    if (!me) throw new Error('no seat at this table');
    me.avatarMeta = sanitizeAvatarMeta(avatarMeta);
    broadcast(binding.tableId);
    reply({ ok: true, avatarMeta: me.avatarMeta });
  });

  on('leaveTable', (_payload, reply) => {
    unbind();
    reply({ ok: true });
  });

  /** Add a CPU at any time (it is dealt in from the next hand). */
  on('addBot', ({ tableId, botDifficulty }, reply) => {
    if (!tableId) throw new Error('tableId required');
    const entry = store.get(tableId);
    if (!entry) throw new Error('table not found');
    if (entry.tour && entry.table.handNumber > 0) throw new Error('the tournament has already started');
    const botId = seatBot(entry, normalizeDifficulty(botDifficulty));
    attachTable(tableId);
    reply({ ok: true, botId });
    notice(tableId, 'notice.joined', { name: entry.table.playerById(botId).name });
    if (Math.random() < 0.4)
      talk(tableId, { speaker: 'cpu', playerId: botId, category: 'greet' }, { force: true });
    sync(tableId);
  });

  /** Remove a CPU between hands (never a human seat). */
  on('removeBot', ({ tableId, botId }, reply) => {
    if (!tableId) throw new Error('tableId required');
    const entry = store.get(tableId);
    if (!entry) throw new Error('table not found');
    const meta = entry.players.get(botId);
    const player = entry.table.playerById(botId);
    if (!meta || !player || !player.isBot) throw new Error('that seat is not a removable AI player');
    if (entry.table.inHand) throw new Error('wait for the hand to end before removing a player');
    entry.players.delete(botId);
    entry.table.removePlayer(botId);
    reply({ ok: true });
    sync(tableId);
  });

  // ------------------------------------------------------------- spectators

  on('enterSpectator', ({ tableId, showAllCards }, reply) => {
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
    attachTable(tableId);
    // Spectating pauses the table: stop the clocks.
    clearTurn(entry);
    cancelScheduledDeal(entry);
    reply({ ok: true, snapshot: spectatorSnapshot(entry, socket.id) });
    notifySpectators(tableId);
  });

  on('setShowAllCards', ({ tableId, on: showAll }, reply) => {
    const set = spectators.get(tableId);
    const meta = set && set.get(socket.id);
    if (!meta) throw new Error('not a spectator on this table');
    meta.showAllCards = showAll === true;
    const entry = store.get(tableId);
    reply({ ok: true, snapshot: entry ? spectatorSnapshot(entry, socket.id) : null });
    notifySpectators(tableId);
  });

  /** Advance the paused table exactly one action (or deal the next hand). */
  on('step', ({ tableId }, reply) => {
    if (!tableId) throw new Error('tableId required');
    const set = spectators.get(tableId);
    if (!set || !set.has(socket.id)) throw new Error('not a spectator on this table');
    const entry = store.get(tableId);
    if (!entry) throw new Error('table not found');
    const table = entry.table;
    if (!table.inHand) {
      table.startHand();
    } else {
      const next = table.nextActorId();
      if (next) {
        const actor = table.playerById(next);
        const d = decideAction(table, next, {
          difficulty: normalizeDifficulty(actor.bot || 'easy'),
          persona: actor.name,
          reads: entry.reads,
          seed: `${table.handNumber}-${table.street}-${table.actionLog.length}`
        });
        table.applyAction(next, d.action, d.amount || 0);
      }
    }
    reply({ ok: true, snapshot: spectatorSnapshot(entry, socket.id) });
    broadcast(tableId);
  });

  // ----------------------------------------------------------------- history

  const historyFor = (tableId) =>
    tableId ? handHistory.filter((h) => h.tableId === tableId) : [...handHistory];

  on('getHistory', ({ tableId }, reply) => {
    reply({ ok: true, hands: historyFor(tableId) });
  });

  on('exportHistory', ({ tableId }, reply) => {
    reply({ ok: true, json: serializeHandRecord(historyFor(tableId)) });
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

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST && !process.env.VITEST_WORKER_ID) {
  server.listen(PORT, HOST, () => {
    console.log(`[saloon] server listening on http://${HOST}:${PORT}`);
  });
}

export { app, server, io, store };
