/**
 * NarrationService - the single funnel every spoken line goes through
 * (tutorial messages + strategy hints).
 *
 * Sprint 3 is TEXT-ONLY: there is no audio yet. But the service already
 * exposes the Web Speech API surface so Sprint 5 can wire real voices without
 * touching any caller:
 *
 *   narrationService.speak(text)      // queue a line to "speak"
 *   narrationService.setVoice(voice)  // pick a voice (name or SpeechSynthesisVoice)
 *   narrationService.getVoice()
 *   narrationService.on(event, cb)    // 'speak' | 'cancel'  -> unsubscribe fn
 *   narrationService.off(event, cb)
 *   narrationService.cancel()         // stop pending speech
 *   narrationService.enabled          // toggles the text-only echo
 *
 * When `typeof window !== 'undefined' && window.speechSynthesis` exists, the
 * service transparently delegates real speech to the browser while still
 * emitting the same `'speak'` events it always did. When it doesn't (Node,
 * tests, or a browser without the API) it is a pure no-op event bus, so the
 * rest of the tutorial engine stays fully testable without a DOM.
 */

const EVENTS = ['speak', 'cancel'];

export class NarrationService {
  constructor() {
    this._listeners = new Map(); // event -> [cb]
    this._voice = null;
    this._queue = [];
    this.enabled = true;
  }

  on(event, cb) {
    if (!EVENTS.includes(event)) throw new Error(`unknown narration event: ${event}`);
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    const list = this._listeners.get(event);
    list.push(cb);
    return () => this.off(event, cb);
  }

  off(event, cb) {
    const list = this._listeners.get(event);
    if (!list) return;
    const i = list.indexOf(cb);
    if (i >= 0) list.splice(i, 1);
  }

  _emit(event, payload) {
    for (const cb of this._listeners.get(event) || []) cb(payload);
  }

  setVoice(voice) {
    this._voice = voice || null;
  }

  getVoice() {
    return this._voice;
  }

  /**
   * Speak a line. Resolves immediately (synchronous) so callers never block
   * on audio; the 'speak' event fires synchronously for observability.
   *
   * If a real speechSynthesis is available AND enabled, the line is also
   * handed to the browser. Otherwise it is a text-only pass-through (still
   * emitted + stored) so the UI can render the narration as text now.
   */
  speak(text) {
    if (!this.enabled) return { queued: false };
    const line = String(text ?? '');
    this._queue.push(line);
    this._emit('speak', { text: line });
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      try {
        const u = new window.SpeechSynthesisUtterance(line);
        if (this._voice && this._voice.name) {
          const voice =
            typeof this._voice === 'string'
              ? window.speechSynthesis.getVoices().find((v) => v.name === this._voice)
              : this._voice;
          if (voice) u.voice = voice;
        }
        window.speechSynthesis.speak(u);
      } catch (err) {
        // Audio is best-effort; text-only remains the source of truth.
      }
    }
    return { queued: true };
  }

  cancel() {
    this._emit('cancel', {});
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch (err) {
        // ignore
      }
    }
  }

  /** Pending (not yet consumed) lines — for UI text rendering + tests. */
  peek() {
    return this._queue.slice();
  }

  clear() {
    this._queue = [];
  }
}

/** Default singleton used across the app. A fresh instance is available for tests. */
export const narrationService = new NarrationService();
