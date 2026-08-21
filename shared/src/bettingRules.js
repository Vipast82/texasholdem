/**
 * Betting-rule helpers for no-limit, limit and pot-limit Hold'em.
 * Pure functions: gameEngine owns the mutable state and calls these.
 *
 * Terminology:
 *   currentBet  - the amount to match to act (0 = nothing to call)
 *   minRaise    - the minimum *total* bet a raise must reach (increment = minRaise - currentBet)
 *   maxBet      - null for no-limit (unbounded, stack-limited); a number otherwise
 */

/** The fixed bet size for a street in limit hold'em: BB preflop, 2x BB postflop. */
export function limitBetSize(street, bigBlind) {
  return street === 'preflop' ? bigBlind : bigBlind * 2;
}

/** Number of raises allowed per street in limit hold'em (standard house rule). */
export function maxRaisesPerStreet(gameType, street) {
  if (gameType !== 'limit') return Infinity;
  return street === 'preflop' ? 4 : 6; // preflop: raise/re-raise/2x; postflop: raise + 3
}

/**
 * Maximum bet for a street under a game type.
 * @param gameType 'no-limit' | 'limit' | 'pot-limit'
 * @param pot     current pot size (including all current-street bets)
 * @param street  'preflop' | 'flop' | 'turn' | 'river'
 * @param bigBlind
 * @param currentBet
 */
export function maxBet(gameType, pot, street, bigBlind, currentBet) {
  if (gameType === 'no-limit') return null;
  if (gameType === 'limit') return currentBet + limitBetSize(street, bigBlind);
  // pot-limit: pot + max(currentBet, min raise)
  const min = minRaise(currentBet, bigBlind, 0);
  return pot + Math.max(currentBet, min);
}

/**
 * Minimum raise target (total bet level a raise must reach).
 * Preflop: currentBet + max(lastRaiseIncrement, bigBlind).
 * Postflop: currentBet + max(lastRaiseIncrement, bigBlind).
 * (Identical formula; the street parameter is retained for API symmetry.)
 */
export function minRaise(currentBet, bigBlind, lastRaiseIncrement) {
  if (currentBet === 0) return bigBlind; // opening bet
  const base = Math.max(lastRaiseIncrement || 0, bigBlind);
  return currentBet + base;
}

/**
 * Validate one player action against the current betting state.
 * Returns { ok: true } or { ok: false, error }.
 *
 * state: { street, currentBet, maxBet, minRaiseTarget, raiseCount, maxRaises,
 *          player: { chips, committedThisStreet, isAllIn, hasFolded } }
 * action: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin' with optional amount
 */
export function validateAction(state, action, amount = 0) {
  const { currentBet, maxBet, minRaiseTarget, raiseCount, maxRaises, player } = state;
  const toCall = Math.max(0, currentBet - player.committedThisStreet);

  if (player.hasFolded) return err('already folded');
  if (player.isAllIn) return err('already all in');

  switch (action) {
    case 'fold':
      return ok();
    case 'check':
      if (toCall !== 0) return err('must call');
      return ok();
    case 'call': {
      if (toCall === 0) return err('nothing to call, check instead');
      return ok();
    }
    case 'bet': {
      const total = amount;
      if (total < minRaiseTarget) return err('bet below minimum');
      if (maxBet !== null && total > maxBet) return err('bet above maximum');
      if (total > player.chips) return err('bet exceeds stack, use all-in');
      return ok();
    }
    case 'raise': {
      const total = amount;
      if (raiseCount >= maxRaises) return err('maximum raises reached');
      if (total < minRaiseTarget) return err(`raise must be at least ${minRaiseTarget}`);
      if (maxBet !== null && total > maxBet) return err('raise above maximum');
      if (total > player.chips) return err('raise exceeds stack, use all-in');
      return ok();
    }
    case 'allin': {
      const total = player.committedThisStreet + player.chips;
      if (total <= currentBet) return ok(); // short all-in = call
      if (total < minRaiseTarget) return ok(); // short all-in below min raise is legal (all-in)
      if (maxBet !== null && total > maxBet) return err('all-in above pot-limit maximum');
      if (raiseCount >= maxRaises) return err('maximum raises reached');
      return ok();
    }
    default:
      return err(`unknown action: ${action}`);
  }
}

const ok = (data = {}) => ({ ok: true, ...data });
const err = (error) => ({ ok: false, error });

/**
 * Build the validation state the server needs for a player about to act.
 */
export function actionStateFor(game, playerId) {
  const player = game.players.find((p) => p.id === playerId);
  if (!player) throw new Error(`unknown player ${playerId}`);
  return {
    street: game.street,
    currentBet: game.currentBet,
    maxBet: maxBet(game.gameType, game.pot, game.street, game.bigBlind, game.currentBet),
    minRaiseTarget: minRaise(game.currentBet, game.bigBlind, game.lastRaiseIncrement),
    raiseCount: game.raiseCount,
    maxRaises: maxRaisesPerStreet(game.gameType, game.street),
    player: {
      chips: player.chips,
      committedThisStreet: player.contributions[game.street] || 0,
      isAllIn: player.isAllIn,
      hasFolded: player.hasFolded
    }
  };
}
