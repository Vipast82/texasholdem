/**
 * TutorialEngine - pure, content-driven state machine that maps the live
 * game event stream to localized tutorial messages.
 *
 * Design goals:
 *   - PURE mapping: no I/O, no sockets, no timers. I/O lives in the app layer.
 *   - Testable: `mapEvent`, `selectMessage`, `shouldPause`, `resolveEventKey`
 *     are exported pure functions; the class is a thin stateful wrapper.
 *   - Content-driven: messages come from `frontend/src/tutorial/events/*.json`
 *     (one file per eventKey), each with {concise, normal, detailed} variants.
 *   - Localized: the engine stores raw `eventKey` + `title` + `highlight`;
 *     localization happens in the UI layer (which has access to `t()`).
 *
 * Modes: 'off' | 'passive' | 'guided'
 *   - off:     engine ignores all events, never pauses.
 *   - passive: engine pushes messages, never pauses (side-panel only).
 *   - guided:  engine pauses at entries marked `pause: true`, waits for
 *              `continue()` before the next event is considered "handled".
 *
 * Verbosity: 'concise' | 'normal' | 'detailed'
 *
 * Strategy hints:
 *   - The engine does NOT compute the hint itself. It delegates to an
 *     injected `hintProvider` (see shared/src/tutorialHint.js) so the AI
 *     logic stays in the shared domain layer (no duplication).
 *
 * Narration:
 *   - Every pushed message is routed through `narrationService.speak()` so
 *     Sprint 5 can wire real Web Speech voices without changing this module.
 */

import { narrationService } from './narrationService.js';

// ---------------------------------------------------------------- pure API

// The tutorial content files use the canonical eventKeys named in the spec:
//   shuffle, deal, flop, turn, river, bet, fold, showdown
// The engine (GameTable) emits different raw event names; this table maps the
// raw emitted event (+ payload) onto the closest tutorial eventKey so the
// content set stays content-driven and locale-agnostic.
const EVENT_TO_KEY = {
  handStarted: 'shuffle',
  blindsPosted: 'deal',
  holeDealt: 'deal',
  flopRevealed: 'flop',
  turnRevealed: 'turn',
  riverRevealed: 'river',
  showdown: 'showdown',
  handEnded: 'showdown'
};

/**
 * Resolve the tutorial eventKey for a raw engine event.
 *
 * @param {string} event the event name as emitted by GameTable
 * @param {object} [payload]
 * @returns {string|null} a tutorial eventKey (shuffle|deal|flop|turn|river|bet|
 *                        fold|showdown), or null when the event has no tutorial
 *                        content (e.g. streetStarted — its card reveals are the
 *                        real content moments).
 */
export function resolveEventKey(event, payload = {}) {
  if (event === 'actionTaken') {
    return payload && payload.action === 'fold' ? 'fold' : 'bet';
  }
  return EVENT_TO_KEY[event] || null;
}

/**
 * Select the localized message variant for the given verbosity.
 * Fallback chain: requested → normal → concise → detailed → first available.
 *
 * @param {{concise?:string, normal?:string, detailed?:string}} messages
 * @param {'concise'|'normal'|'detailed'} [verbosity='normal']
 * @returns {string}
 */
export function selectMessage(messages, verbosity = 'normal') {
  if (!messages) return '';
  const order = [verbosity, 'normal', 'concise', 'detailed'];
  for (const v of order) {
    if (typeof messages[v] === 'string' && messages[v].length > 0) return messages[v];
  }
  const first = Object.values(messages).find((s) => typeof s === 'string');
  return first || '';
}

/**
 * Decide whether the engine should pause after this event (guided mode only).
 *
 * @param {object} entry  the content entry for this event
 * @param {string} mode   'off' | 'passive' | 'guided'
 * @returns {boolean}
 */
export function shouldPause(entry, mode) {
  if (!entry) return false;
  if (mode !== 'guided') return false;
  return entry.pause === true;
}

/**
 * Map a raw engine event + content + settings into a "pushable" item.
 * Returns null when the event has no content or the mode is 'off'.
 *
 * Item shape (pre-localization; the UI resolves i18n where needed):
 *   { eventKey, title, message, highlight, paused,
 *     strategyHint: { enabled, action, reason, confidence }, raw, payload }
 *
 * @param {string} event
 * @param {object} [payload]
 * @param {object} content  map of eventKey → content entry
 * @param {object} settings {mode, verbosity, hintsEnabled}
 * @param {(game, actorId, opts)=>object} [hintProvider]
 * @param {object} [hintContext] { game, actorId, seed }
 * @returns {object|null}
 */
export function mapEvent(event, payload, content, settings = {}, hintProvider = null, hintContext = null) {
  const mode = settings.mode || 'passive';
  if (mode === 'off') return null;

  const eventKey = resolveEventKey(event, payload);
  if (!eventKey) return null;
  const entry = content[eventKey];
  if (!entry) return null;

  const verbosity = settings.verbosity || 'normal';
  const message = selectMessage(entry.messages, verbosity);
  const paused = shouldPause(entry, mode);

  let strategyHint = { enabled: false, action: null, reason: null, confidence: null };
  if (entry.strategyHint && entry.strategyHint.enabled && settings.hintsEnabled && hintProvider) {
    try {
      const game = hintContext && hintContext.game;
      const actorId = hintContext && hintContext.actorId;
      if (game && actorId) {
        const result = hintProvider(game, actorId, hintContext || {});
        strategyHint = {
          enabled: true,
          action: result ? result.action : null,
          reason: result ? result.reason : null,
          confidence: result ? result.confidence : null
        };
      }
    } catch (err) {
      strategyHint = { enabled: false, action: null, reason: null, confidence: null };
    }
  }

  return {
    eventKey,
    title: entry.title || eventKey,
    message,
    highlight: entry.highlight || [],
    paused,
    strategyHint,
    raw: event,
    payload: payload || null
  };
}

// ------------------------------------------------------------- class form

export class TutorialEngine {
  /**
   * @param {object} [opts]
   * @param {object} [opts.content]      map of eventKey → content entry
   * @param {string} [opts.mode]         'off' | 'passive' | 'guided'
   * @param {string} [opts.verbosity]    'concise' | 'normal' | 'detailed'
   * @param {boolean} [opts.hintsEnabled]
   * @param {function} [opts.hintProvider]
   * @param {object} [opts.narration]    narration service instance (defaults to the singleton)
   */
  constructor(opts = {}) {
    this._content = opts.content || {};
    this._mode = opts.mode || 'off';
    this._verbosity = opts.verbosity || 'normal';
    this._hintsEnabled = !!opts.hintsEnabled;
    this._hintProvider = opts.hintProvider || null;
    this._narration = opts.narration || narrationService;
    this._resolveText = opts.resolveText || null;
    this._history = [];
    this._paused = false;
    this._current = null;
  }

  get mode() {
    return this._mode;
  }
  get verbosity() {
    return this._verbosity;
  }
  get hintsEnabled() {
    return this._hintsEnabled;
  }
  get isPaused() {
    return this._paused;
  }
  get current() {
    return this._current;
  }
  get history() {
    return this._history.slice();
  }

  setMode(mode) {
    if (!['off', 'passive', 'guided'].includes(mode)) throw new Error(`unknown mode: ${mode}`);
    this._mode = mode;
    if (mode !== 'guided') this._paused = false;
  }
  setVerbosity(v) {
    if (!['concise', 'normal', 'detailed'].includes(v)) throw new Error(`unknown verbosity: ${v}`);
    this._verbosity = v;
  }
  setHintsEnabled(on) {
    this._hintsEnabled = !!on;
  }
  setContent(content) {
    this._content = content || {};
  }
  setHintProvider(fn) {
    this._hintProvider = fn || null;
  }
  /** Set the text resolver (e.g. the i18n `t` function) used to localize content keys. */
  setResolveText(fn) {
    this._resolveText = fn || null;
  }

  /**
   * Handle a raw engine event. Routes the message through narration if one
   * is produced. Returns the pushed item (or null).
   *
   * @param {string} event
   * @param {object} [payload]
   * @param {object} [hintContext] { game, actorId, seed } for the hint provider
   * @returns {object|null}
   */
  handleEvent(event, payload, hintContext = null) {
    const item = mapEvent(
      event,
      payload,
      this._content,
      { mode: this._mode, verbosity: this._verbosity, hintsEnabled: this._hintsEnabled },
      this._hintProvider,
      hintContext
    );
    if (!item) return null;

    // Localize the message/title through the resolver (i18n `t` in the app
    // layer; an identity function in tests). Content entries store i18n KEYS,
    // never hardcoded strings, so one content set serves every locale.
    if (this._resolveText) {
      item.message = this._resolveText(item.message, item.payload || {});
      item.title = this._resolveText(item.title, {});
      if (item.strategyHint && item.strategyHint.reason) {
        item.strategyHint.reason = this._resolveText(item.strategyHint.reason, {});
      }
    }

    this._current = item;
    this._history.push(item);
    this._paused = item.paused;

    // Text-only now; Sprint 5 adds real Web Speech voices behind the same
    // narrationService interface — no change needed here.
    if (item.message) {
      this._narration.speak(item.message);
    }
    return item;
  }

  /**
   * Continue past a pause (guided mode only). No-op when not paused.
   * @returns {boolean} true if a pause was active and is now cleared.
   */
  continue() {
    if (!this._paused) return false;
    this._paused = false;
    return true;
  }

  /** Force-clear pause state (e.g. on mode change or table leave). */
  reset() {
    this._paused = false;
    this._current = null;
  }

  clearHistory() {
    this._history = [];
    this._current = null;
    this._paused = false;
  }
}