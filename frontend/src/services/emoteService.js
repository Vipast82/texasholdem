/**
 * emoteService (Sprint 6) — PURE decision logic for "which emote auto-triggers
 * on which game event?".  Split out from the React component so it is
 * unit-testable under Node with no DOM involved.
 *
 * The emote palette is intentionally small (saloon-appropriate) and shared
 * between the player picker (EmoteBar) and the auto-trigger map so both
 * sides agree on valid emote codes.
 */

/** The full set of emotes a player can send or receive. */
export const EMOTES = [
  { code: 'tip_hat',    glyph: '🎩', label_key: 'emote.tip_hat' },
  { code: 'thumbs_up',  glyph: '👍', label_key: 'emote.thumbs_up' },
  { code: 'fist_bump',  glyph: '👊', label_key: 'emote.fist_bump' },
  { code: 'whiskey',    glyph: '🥃', label_key: 'emote.whiskey' },
  { code: 'coins',      glyph: '💰', label_key: 'emote.coins' },
  { code: 'cards',      glyph: '🃏', label_key: 'emote.cards' },
  { code: 'fire',       glyph: '🔥', label_key: 'emote.fire' },
  { code: 'cool',       glyph: '😎', label_key: 'emote.cool' },
  { code: 'sad',        glyph: '😢', label_key: 'emote.sad' },
  { code: 'cheer',      glyph: '🎉', label_key: 'emote.cheer' },
];

/** Valid emote codes (useful for validation). */
export const EMOTE_CODES = EMOTES.map((e) => e.code);

/**
 * Map a game event + actor context to an auto-emote code.
 *
 * Returns the emote `code` (string) or `null` when no auto-emote is
 * appropriate for the given event.  The function is PURE: it does not
 * mutate, does not touch the DOM, and is deterministic given the same
 * inputs.
 *
 * @param {string} event  the game event name ('handEnded', 'actionTaken', 'streetStarted', …)
 * @param {object} [ctx]  context: { action, isWinner, folded, allIn, … }
 * @returns {string|null} an emote code from EMOTES, or null
 */
export function autoEmoteForEvent(event, ctx = {}) {
  switch (event) {
    case 'handEnded': {
      if (ctx.isWinner) return 'cheer';
      if (ctx.isAllIn && ctx.isLoser) return 'sad';
      return null;
    }
    case 'actionTaken': {
      if (ctx.action === 'fold') return 'whiskey';
      if (ctx.action === 'allin') return 'fire';
      if (ctx.action === 'check') return 'tip_hat';
      if (ctx.action === 'bet' || ctx.action === 'raise' || ctx.action === 'call') return 'coins';
      return null;
    }
    case 'streetStarted': {
      // A new street is dealt — a subtle "cards" emote on the flop (most exciting)
      if (ctx.street === 'flop') return 'cards';
      return null;
    }
    default:
      return null;
  }
}

/**
 * Validate an emote code from user input.
 * @param {string} code
 * @returns {string|null} the valid code, or null
 */
export function validateEmote(code) {
  if (typeof code !== 'string') return null;
  const found = EMOTES.find((e) => e.code === code);
  return found ? found.code : null;
}

/**
 * Get the glyph for an emote code.
 * @param {string} code
 * @returns {string} the emoji glyph, or '❓' for unknown
 */
export function emoteGlyph(code) {
  const found = EMOTES.find((e) => e.code === code);
  return found ? found.glyph : '❓';
}