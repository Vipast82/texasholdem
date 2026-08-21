/**
 * Sprint 6 — CI e2e smoke (production build).
 *
 * Boots the REAL production server (`npm run start`) on a scratch port, then
 * exercises it exactly like a client would:
 *   1. GET  /health  -> { ok: true }
 *   2. GET  /        -> the built React index.html
 *   3. Socket.IO join -> startHand -> assert a private snapshot is returned
 *
 * This validates the *production* build is served and the socket protocol works
 * end-to-end over real HTTP (distinct from the in-process vitest suite). It is
 * deliberately browser-free and dependency-light (uses Node 18+ global fetch +
 * the server's socket.io-client) so the manual e2e workflow stays fast and
 * reliable without installing Playwright browsers.
 *
 * Exit code 0 = pass, non-zero = fail. Node >= 18 required (global fetch).
 */
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { io } from 'socket.io-client';

const PORT = Number(process.env.SMOKE_PORT || 3105);
const BASE = `http://127.0.0.1:${PORT}`;

function log(msg) {
  process.stdout.write(`[e2e] ${msg}\n`);
}

function fail(msg) {
  process.stdout.write(`[e2e][FAIL] ${msg}\n`);
  process.exit(1);
}

async function waitHealthy(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.ok) return true;
    } catch (err) {
      lastErr = err;
    }
    await delay(150);
  }
  fail(`server never became healthy: ${lastErr && lastErr.message}`);
}

async function checkIndexHtml() {
  const res = await fetch(`${BASE}/`);
  if (!res.ok) fail(`GET / -> HTTP ${res.status}`);
  const html = await res.text();
  if (!/<div\s+id=["']?root["']?>/i.test(html) && !html.includes('<div')) {
    fail('GET / did not return the React index.html shell');
  }
  // The app must reference a JS bundle (the built client is actually served).
  if (!/src=["'][^"']+\.js["']/.test(html)) {
    fail('index.html does not reference a JS bundle (frontend may not be built)');
  }
  log('GET / returned the built index.html with a JS bundle');
}

async function checkSocketProtocol() {
  const opts = { transports: ['websocket'], reconnection: false };
  const s1 = io(BASE, opts);
  const s2 = io(BASE, opts);
  const connected1 = await new Promise((resolve) => {
    const to = setTimeout(() => resolve(false), 8000);
    s1.on('connect', () => { clearTimeout(to); resolve(true); });
    s1.on('connect_error', () => { clearTimeout(to); resolve(false); });
  });
  if (!connected1) fail('socket.io client #1 could not connect to the production server');
  await new Promise((resolve) => {
    const to = setTimeout(() => resolve(false), 8000);
    s2.on('connect', () => { clearTimeout(to); resolve(true); });
    s2.on('connect_error', () => { clearTimeout(to); resolve(false); });
  });

  const tableId = `smoke-${Date.now()}`;
  const ack = (socket, event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));

  const join = await ack(s1, 'joinTable', { tableId, name: 'Smoke1' });
  if (!join.ok) fail(`joinTable failed: ${join.error}`);
  const join2 = await ack(s2, 'joinTable', { tableId, name: 'Smoke2' });
  if (!join2.ok) fail(`joinTable #2 failed: ${join2.error}`);
  // Two distinct sockets must be two distinct players.
  if (join.playerId === join2.playerId) fail('two sockets mapped to the same player id');

  const start = await ack(s1, 'startHand', {});
  if (!start.ok) fail(`startHand failed: ${start.error}`);
  if (!start.snapshot || !start.snapshot.inHand) fail('startHand snapshot is not an in-hand state');
  if (!Array.isArray(start.snapshot.players) || start.snapshot.players.length < 2) {
    fail('startHand snapshot does not contain both players');
  }
  // Privacy contract (snapshotFor(viewerId)): a live player sees their OWN hole
  // cards but NEVER another player's. Enforced per-viewer, server-side.
  const me = start.snapshot.players.find((p) => p.id === join.playerId);
  const them = start.snapshot.players.find((p) => p.id === join2.playerId);
  if (!Array.isArray(me.holeCards) || me.holeCards.length !== 2) {
    fail('the acting player should see their own hole cards');
  }
  if (them.holeCards != null) fail('PRIVACY VIOLATION: snapshot leaked another player\'s hole cards');

  s1.close();
  s2.close();
  log('socket protocol OK (two players -> startHand -> private snapshot)');
}

async function main() {
  log(`starting production server on ${BASE}`);
  // Spawn node directly on the server entry point (no npm shim / shell needed)
  // so we control the exact child process and can terminate it portably.
  const serverProc = spawn('node', ['server/src/index.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverOutput = '';
  serverProc.stdout.on('data', (d) => { serverOutput += d.toString(); });
  serverProc.stderr.on('data', (d) => { serverOutput += d.toString(); });

  const kill = () => {
    if (serverProc.killed) return;
    // Portable termination: the default signal uses TerminateProcess on Windows
    // and SIGTERM on POSIX. We avoid SIGKILL here because it aborts under
    // Windows libuv ("handle->flags & UV_HANDLE_CLOSING").
    try {
      serverProc.kill();
    } catch (err) {
      /* already gone */
    }
  };
  process.on('SIGINT', () => {
    kill();
    process.exit(130);
  });

  try {
    await waitHealthy(30000);
    log('health check OK');
    await checkIndexHtml();
    await checkSocketProtocol();
    log('ALL CHECKS PASSED');
  } catch (err) {
    fail(err && err.message ? err.message : String(err));
  } finally {
    try {
      if (serverOutput) log(`server output tail:\n${serverOutput.slice(-400)}`);
    } catch (e) { /* ignore */ }
    kill();
  }
}

main();