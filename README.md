# 🤠 Saloon Hold'em

Local-network Texas Hold'em in an npm-workspaces monorepo:

| Workspace  | What it is                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------- |
| `shared/`  | Pure, deterministic domain logic + AI (no I/O) — cards, seeded RNG, hand evaluator, pots, betting rules, `GameTable`, AI profiles/Monte-Carlo/decision engine |
| `server/`  | Express + Socket.IO authoritative game server. Auto-drives AI seats. Serves `frontend/dist` in prod |
| `frontend/`| React + Vite client (Zustand store, i18n helper, join/table/controls/chat UI)                |

Ranks use `"T"` for ten (never `"10"`); suits are `s`/`h`/`d`/`c`. All randomness flows
through the seeded `Rng` (`createShuffledDeck(seed)`) — same seed + same action sequence ⇒ identical hand.

## Requirements

Node.js **22.12 or newer** (Vite 8 and Vitest 5 require it).

## Environment (Windows)

`node`/`npm` may not be on the default PATH. Prefix shell commands with:

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User');
```

## Commands

```bash
npm install            # install all workspaces

# Quality gate (must stay green)
npm run lint           # eslint . --max-warnings=0
npm test               # vitest run (shared + server + frontend tests)
npm run build          # vite build (frontend)

# Development
npm run dev:server     # node --watch src/index.js  → :3000
npm run dev:client     # vite dev server             → :5173 (proxies /socket.io → :3000)

# Production
npm run start          # serves frontend/dist + sockets on :3000

# CI / automation (also run by GitHub Actions — see .github/workflows/)
node scripts/ci-e2e-smoke.mjs   # boot prod server + HTTP/Socket.IO smoke (manual E2E)
```

## Continuous Integration

- **`CI` (`.github/workflows/ci.yml`)** — runs on every push/PR. Installs once,
  then runs `lint` → `test` (shared + server + frontend, including the jsdom
  a11y render assertions and the EN↔ES i18n parity suite) → `build`. The frontend
  build is uploaded as an artifact. It is deliberately fast and dependency-light so
  the always-on gate stays green.
- **`E2E (manual)` (`.github/workflows/e2e.yml`)** — `workflow_dispatch`-only.
  Builds the frontend, boots the *production* server, and drives it over real
  HTTP + Socket.IO via `scripts/ci-e2e-smoke.mjs` (health, served index.html,
  two-player join → startHand → per-viewer hole-card privacy). Kept out of the
  main gate so browser/network flakiness can't fail a push.

## Playing

### Mixed human + AI table ("Play vs AI")

1. Start the server: `npm run dev:server` (or `npm run start` for prod).
2. Open the UI (`http://localhost:5173` in dev, `http://localhost:3000` in prod).
3. On the join screen:
   - enter a **Name** and a **Table** id (e.g. `main`),
   - tick **"Let an AI play this seat"**,
   - pick a **Bot Difficulty** — Easy / Normal / Hard,
   - click **Take a Seat**.
4. The server seats a server-side AI opponent (named from the difficulty's name pool,
   shown with a 🤖 badge + difficulty tooltip) and you keep a human seat.
5. Click **Start Hand** — the bot auto-acts whenever it's its turn, with a short
   "thinking" delay and a visible last-move note (action + confidence, full `reason` on hover).
6. Act with the Check/Bet/Call/Raise/Fold buttons (min/max are computed by `@saloon/shared/bettingRules`).

### AI-only table (auto-plays; good for spectating/testing)

1. In a browser console (or any Socket.IO client), connect to `http://localhost:3000`
   and emit `joinTable` for a bot seat, twice — the table becomes all-bots and starts
   hands by itself:

   ```js
   const { io } = window; // or import 'socket.io-client'
   const s1 = io('http://localhost:3000');
   s1.emit('joinTable', { tableId: 'ai-only', name: 'Bot A', isBot: true, bot: { difficulty: 'hard' } });
   const s2 = io('http://localhost:3000');
   s2.emit('joinTable', { tableId: 'ai-only', name: 'Bot B', isBot: true, bot: { difficulty: 'normal' } });
   ```
2. Once ≥2 bot seats are filled, the server auto-deals the next hand and the bots
   play it out autonomously (blinds, betting rounds, showdown) — no human needed.
   A browser tab joined to the same table (even a human seat added before the last
   bot) can watch; the hand only runs to completion when every seat is a bot.
3. The server-side E2E test `server/tests/ai.test.js` exercises the same flow
   (AI-only full hand to completion, chip conservation, mixed-table privacy).

### Two-tab human vs human (Sprint 1 mode)

Open two tabs of the UI, join the same table id with different names,
and click **Start Hand** — then take turns with the betting controls.

## AI (Sprint 2)

- **Difficulty profiles** (`shared/src/ai/aiProfiles.js`): EASY (loose/passive,
  bluffs often), NORMAL (hand strength + pot odds, sane patterns), HARD
  (Monte-Carlo equity via `estimateWinTieLose`, position-aware, opponent-model
  weights). Each has `personality.namePool`, `personality.avatarId`, and
  `personality.sfxMap` (bet→chip, fold→flick, win→cheer, lose→grunt) for later sprints.
- **Server-driven** (`server/src/index.js`): when the current actor is a bot, the server
  calls `decideAction(game, botId, { seed, rng })` and applies it through the same
  `applyAction` entry as humans — a per-table pump (one `setTimeout` tick per bot move,
  coalesced) with a `BOT_LOOP_GUARD` cap. Humans are never auto-acted.
- **Determinism**: every AI decision is seeded (per-table seed + hand/street/actor/
  raiseCount/pot/currentBet/moveCount), so the same game line replays identically.
- **Transparency**: each bot decision carries a human-readable `reason` and
  `confidence` (broadcast via the `botAction` socket event) — the foundation of
  Sprint 3's tutorial.

## i18n

Frontend strings route through `frontend/src/i18n.js` (`t(key, vars)`, `setLocale`,
`getLocale`) with catalogs in `frontend/src/i18n/en.json` + `es.json` (~85 keys each,
full EN/ES coverage: join, table, controls, chat, settings, tutorial, hand-ranking
guide, and the 9 hand ranks). A key is looked up in the active locale, falls back to
English, then to the key itself — a missing translation can never crash the UI.
Language can be switched on the join screen and, once at a table, in the Settings
panel. **The locale is persisted** — `setLocale` autosaves the profile (IndexedDB,
via `autosave`) and `hydrate()` restores it on the next load, so a player's language
choice survives a refresh with no backend. `App` also mirrors the active locale into
`document.documentElement.lang` so assistive tech announces the right language.
Parity (every EN key has an ES key and vice-versa, non-empty values, and matching
`{placeholder}` token sets) is enforced by `frontend/tests/i18nParity.test.js`.

## Accessibility

The table is built to be usable without a mouse and to respect OS-level
preferences:

- **Screen-reader semantics** — every interactive control is a real
  `<button>` / `<input>` / `<select>` with an accessible name
  (`aria-label` / labelled `for`), so no `div`-clicks are needed. Live
  regions announce state without stealing focus: the chat log
  (`ChatPanel`), the hand narration (`TutorialPanel`), and the current bet +
  min/max (`Controls`) are each an `aria-live` region.
- **`<html lang>` stays in sync** — `App` sets
  `document.documentElement.lang` from the active locale on mount and on change,
  so assistive tech announces the correct language (EN/ES).
- **Visible focus** — `:focus-visible` gives buttons, inputs, the language
  `<select>`, and the chip slider a high-contrast `--gold` outline that stays
  legible on the dark felt. Mouse clicks stay clean.
- **`prefers-reduced-motion: reduce`** disables the card deal/flip, table
  shake, pot glow, and dealer-button pulse (see `styles.css`).
- **`prefers-contrast: more`** (Windows High Contrast and friends) strengthens
  text and border contrast on chips, the felt, and controls so low-vision
  players can still read names, amounts, and the pot.
- **`forced-colors: active`** lets the OS re-theme buttons, chat, settings, and
  the tutorial instead of the saloon palette fighting the system palette.
- **Skip link** — `App` renders a visually-hidden `a.skip-link` as the first
  focusable element that jumps straight to the table, so keyboard users don't
  have to tab through every control.
- **AvatarCropper is a real dialog** — `role="dialog"`, `aria-modal`, a labelled
  title, Escape-to-close, focus moved into the dialog on open and restored on
  close. Cropping is fully keyboard-driven (arrow keys to pan, a slider to
  zoom, **Preview** to WYSIWYG, **Use this** to commit).
- **Real-DOM regression coverage** — `frontend/tests/a11y.test.jsx` (27 tests)
  renders the live components under jsdom and asserts the contract above: the
  skip link, ARIA roles/labels/live-regions, dialog semantics + focus + Esc,
  keyboard-activatable controls, and that every a11y i18n key exists in both
  locales. This is the guard that keeps the a11y work from silently
  regressing.

## Tutorial (Sprint 3)

An interactive, content-driven coaching layer over any table:

- **Engine** (`frontend/src/engine/tutorialEngine.js`): a pure state machine that
  maps the server's game-event stream to localized messages. No I/O, no sockets —
  easy to test. `resolveEventKey` maps raw events (handStarted, blindsPosted,
  holeDealt, flop/turn/river, actionTaken, showdown, handEnded) onto 8 canonical
  tutorial keys; `selectMessage` picks a verbosity variant; `shouldPause` drives
  guided-mode stops.
- **Modes**: `off` (silent), `passive` (side-panel log only, never blocks),
  `guided` (pauses at `pause: true` entries — e.g. bets — until you press **Continue**).
- **Verbosity**: `concise` / `normal` / `detailed` narration per event.
- **Strategy hints**: optional "Suggested play" reuses the same AI `decideAction`
  the server uses for bots (via `shared/src/tutorialHint.js`) — the AI logic is
  never duplicated. Toggle on/off in the panel.
- **Content** (`frontend/src/tutorial/events/*.json`): 8 event files storing i18n
  **keys** (not hardcoded strings), so one content set serves EN and ES. The engine
  localizes at `handleEvent` time via an injected `resolveText` (the app's `t`).
- **Seeded walkthrough**: `frontend/src/tutorial/tutorialSeed.json` holds a fixed
  seed (`sprint3-tutorial-v1`) whose shuffle is deterministic — the **Run tutorial
  (seeded)** button deals that exact hand every time (verified: A=Ks7d, B=9dAs,
  flop 4c6c3s, turn Qs, river 9s).
- **UI** (`frontend/src/components/TutorialPanel.jsx`): settings grid (mode,
  verbosity, hints, language), the seeded-run button, the live event log with
  current-item highlight + strategy-hint block, and a Continue control while paused.
  A **Hand-Ranking guide** (`HandRankingGuide.jsx`) lists the 9 ranks high→low.
- **Server**: `mirrorTableEvents()` mirrors 10 `GameTable` events to a `gameEvent`
  socket message (idempotent, activated on join) so every connected client gets the
  stream; `startHand` accepts an optional `{seed}` for the deterministic hand.

### How to enable

1. Join a table (as above).
2. In the **Tutorial** panel, set a **mode** (Passive to watch, Guided to be
   coached) and a **verbosity**.
3. Optionally turn on **Strategy hints** and pick your **Language**.
4. Click **Run tutorial (seeded)** to play the fixed, replayable hand — or just
   **Start Hand** for a normal (unseeded) deal and follow along.

## Sprint 4 — Odds HUD, Spectator & Hand History

Three client-facing layers on top of the existing server, all built on the single
shared, deterministic domain logic (no AI or hand-evaluation code is duplicated):

- **Odds HUD** (`frontend/src/components/HudOdds.jsx`): a per-seat win/tie/lose
  estimate. Toggle it on in the table topline (**"Odds HUD"**). The numbers come
  from the shared `equityForPlayer(snapshot, playerId, seed, iterations)`
  (`shared/src/equity.js`), a thin wrapper over the *one* Monte-Carlo
  (`aiMonteCarlo.estimateWinTieLose`) the HARD AI already uses. The seed is derived
  from `tableId + handNumber + street + seat`, so the estimate is stable and
  reproducible for a given view. Privacy is enforced by the snapshot itself: a
  seat renders **nothing** when its hole cards aren't in the current viewer's
  snapshot (a live player only ever sees their own cards; a spectator sees all).
- **Spectator mode** (`frontend/src/components/SpectatorBar.jsx` + server
  `enterSpectator` / `setShowAllCards` / `step` socket handlers): tick **"Spectate
  instead of playing"** on the join screen to watch a table with **every hole card
  revealed**. While a spectator is present, the server pauses auto-advance and the
  hand is driven by the **Step ▸** button — one legal move at a time (the server
  tries `check`, falling back to a deterministic `decideAction` so stepping is
  always valid). The show-all toggle lives in the spectator bar and is
  server-authorised; `revealAllHoles` is only ever set by the spectator snapshot,
  never by a live player's view.
- **Hand history** (`frontend/src/components/HistoryPanel.jsx` + shared
  `buildHandRecord` / `serializeHandRecord` in `shared/src/history.js`): the server
  records every finished hand into an in-memory ring (cap 100), broadcasts the fresh
  record to the table (`handRecord`), and serves it via `getHistory` /
  `exportHistory`. The side panel lists hands (newest first), toggles auto-record,
  and **Export JSON** triggers a browser Blob download of the server-serialized
  record (schema `saloon.hand-record/v1`).

### How to use

1. **Odds:** join a normal table, tick **Odds HUD** in the topline. Your seat shows
   live Win/Tie/Lose; opponent seats stay blank (their cards are private to you).
2. **Spectate:** on the join screen tick **"Spectate instead of playing"** and click
   **Take a Seat**. All cards are revealed; press **Step ▸** to advance the hand, and
   use **Show all hole cards** to hide them again.
3. **History:** the **Hand History** panel (right column) fills as hands finish.
   Click **Export JSON** to download the ring as a `.json` file.

## Sprint 5 — Avatars, dealer button & saloon polish

- **Avatars** (`frontend/src/services/avatarStore.js`, `avatarView.js`,
  `cropUtils.js` + `components/AvatarCropper.jsx`, `SeatAvatar.jsx`,
  `SettingsPanel.jsx`): pick a **GIF or still image (≤ 20 MB)** on the join
  screen or in the **Settings** panel, frame it in a square cropper
  (drag to pan, wheel/slider to zoom — magnification 1×–8×), and save. The
  original file lives only in your browser's **IndexedDB**; other players get a
  reference, not your data. **Privacy model:** the socket payload carries only
  `{avatarId, kind, crop}` — never the blob. `SeatAvatar` resolves each seat's
  image locally: your seat reads your IndexedDB entry; other seats render their
  own `avatarMeta` the same way; a bot with no avatar falls back to the
  built-in cowboy. Framing is computed once by `cropCss(crop, srcW, srcH)` in
  `avatarView.js` and used identically in the cropper preview and the seat
  render, so what you crop is exactly what the table sees (WYSIWYG).
  `computeSquareCrop` in `cropUtils.js` holds the zoom/pan → crop-window math.
- **Animated dealer button** (`components/DealerButton.jsx`): a gold star disc
  with a **D** gently rocks beside the dealer's name. The
  `.dealerbtn--pulse` animation is disabled under
  `@media (prefers-reduced-motion: reduce)` (see `styles.css`), so the component
  is static for users who opt out.
- **SFX settings** (`components/SettingsPanel.jsx` + `services/sfxService.js`):
  mute toggle and volume slider, wired to the shared audio service used by
  card/deal sounds. Settings (mute, volume, avatar choice) are autosaved to
  **IndexedDB** and restored on load (`store.hydrate()`), so they survive a
  refresh with no backend.
- **Real card & chip sound effects** (`frontend/public/assets/sfx/` +
  `services/sfxService.js`): six real royalty-free MP3s (shuffle, deal,
  card-flip, chip, chips, poker-chip) play on the engine's lifecycle events —
  `handStarted → shuffle`, `holeDealt → deal`, `streetStarted → flip` (flop/
  turn/river), `actionTaken → chip/flick`, `handEnded → cheer/grunt`. The
  browser backend (`browserSound`) prefers the real sample and falls back to
  the synthesized blips if a sample or the audio stack is missing, so sound is
  always best-effort and never breaks the game. Mute + volume gate both paths;
  `setPlayer()` is the injection seam the unit tests use to assert delegation
  and fallback without a browser.
- **Western art pass — animated cards** (`components/Table.jsx` +
  `frontend/src/styles.css`): the table now plays a real card game. Community
  cards are **keyed by slot** so each newly-dealt card mounts and animates in;
  `card--deal` makes cards fly in from the deck with a stagger, `card--flip`
  does a 3D Y-axis turn when the flop/turn/river are revealed, the whole
  **table shakes** (`table--shuffling`) and the **pot glows** (`table__pot--glow`)
  once at the start of each hand. The card **back** uses a CC0 pixel-art card
  from Kenney's Playing Cards Pack (`frontend/public/assets/cards/card_back.png`).
  Card animations fire via **React remount** (community slots are keyed by
  position, so each new card mounts once with `card--deal` and then flips in
  place with `card--flip`); the table shake + pot glow use a small
  `useTransientFlag` hook so they fire exactly once per hand and do not replay
  on unrelated re-renders (bot actions, chat, chip changes). All motion is
  disabled under `@media (prefers-reduced-motion: reduce)`.
- **Western art pass — theme chrome** (`frontend/src/styles.css`):
  bounty-badge avatar rings, glowing pot text, cropper/settings chrome, and the
  dealer-button + card keyframes are all defined in one block at the end of the
  stylesheet; every rule uses the existing `:root` palette (`--gold`,
  `--wood-light`, `--shadow`, `--felt-dark`) so the theme stays consistent.

## Testing

The gate (`npm run lint && npm test && npm run build`) runs across all three
workspaces. Total: **291 tests**, all passing.

- `shared/tests/` — domain logic + AI + cross-cutting integration:
  - `handEvaluator.test.js` (rank evaluation, tie-breaks, EN/ES names),
    `gameEngine.test.js` / `bettingRules.test.js` / `potSplit.test.js`
    (pot, min-raise, max-bet, all-in / short-stack edge cases), `equity.test.js`
    (Monte-Carlo equity), `history.test.js` (hand-record round-trip),
    `rng.test.js` (seeded determinism).
  - `aiEngine.test.js` (22 tests: per-difficulty determinism, legal-action
    guarantee, pot-odds folds, bluff frequency, Monte-Carlo sanity,
    short-stack/multiway/all-in).
  - `integration.test.js` — **Sprint 6 integration**: AI-only hand is fully
    deterministic for a fixed seed; chip conservation (no chips created/lost);
    equity privacy (a viewer never receives another player's hole cards) and
    equity determinism; hand-record round-trip.
- `server/tests/` — authoritative-server behavior:
  - `server.test.js` (Socket.IO E2E: join, startHand, actions, hand end) and
    `ai.test.js` (AI-only autonomous hand with chip conservation; mixed
    human+bot with hole-card privacy; `spawnBot` "Play vs AI" flow).
  - `integration.test.js` — **Sprint 6 cross-view privacy**: a spectator sees
    the bot's hole cards while a live player sees only their own, on the *same*
    hand; chip conservation across the full hand. Driven via `ack` snapshots
    and a spectator `step` that un-freezes the auto-advance.
- `frontend/tests/` — client behavior + a11y + i18n:
  - `tutorialEngine.test.js` (36 tests: `resolveEventKey` mapping for all raw
    events, `selectMessage`/`shouldPause`/`mapEvent` across verbosities,
    `handleEvent` + narration + pause/resume in guided mode, strategy-hint
    toggle + error-swallowing, `resolveText` localization, seeded-deck
    determinism, and content bundling).
  - `a11y.test.jsx` — **Sprint 6 accessibility** (27 tests): renders real
    components under jsdom and asserts screen-reader semantics, ARIA
    roles/labels/live-regions, the skip link, `AvatarCropper` dialog semantics
    + focus + Esc, keyboard-activatable controls, `<html lang>` sync, and that
    every a11y i18n key exists in both EN and ES.
  - `i18nParity.test.js` — **Sprint 6 i18n** (6 tests): EN/ES key-set equality,
    no empty values, and matching `{placeholder}` token sets across every key.

## CI / E2E smoke

- `scripts/ci-e2e-smoke.mjs` boots the **production** server, checks
  `/health`, verifies `GET /` returns the built `index.html` with a JS bundle,
  then drives a two-player Socket.IO session (join → `startHand`) and asserts
  the per-viewer hole-card privacy contract. Wired to the manual
  **E2E** GitHub workflow (`.github/workflows/e2e.yml`) and runnable locally
  (`node scripts/ci-e2e-smoke.mjs`).
