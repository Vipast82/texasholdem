import { minRaise, maxBet, maxRaisesPerStreet } from '@saloon/shared/bettingRules';

/**
 * What the local player may do right now, in the same units the engine uses:
 * bet/raise amounts are the TOTAL the player's bet this street will reach
 * ("raise to"), not the number of extra chips.
 *
 * Pure — derived only from the snapshot — so it is easy to unit test and the
 * buttons can never offer an action the server would reject.
 *
 * @returns {null | {
 *   toCall: number,          chips needed to call (0 = can check)
 *   callAmount: number,      what a call actually costs (capped by the stack)
 *   canCheck: boolean,
 *   raiseAction: 'bet'|'raise'|null,  null = no full raise possible (all-in only)
 *   minTotal: number,        smallest legal bet/raise-to
 *   maxTotal: number,        largest legal bet/raise-to (stack or pot-limit cap)
 *   committed: number,       already in front of the player this street
 *   stack: number,           chips behind
 *   pot: number
 * }}
 */
export function actionOptions(snapshot, playerId) {
  if (!snapshot || !snapshot.inHand || snapshot.nextActorId !== playerId) return null;
  const me = (snapshot.players || []).find((p) => p.id === playerId);
  if (!me || me.hasFolded || me.chips <= 0) return null;

  const street = snapshot.street;
  const committed = (me.contributions && me.contributions[street]) || 0;
  const stack = me.chips;
  const currentBet = snapshot.currentBet || 0;
  const toCall = Math.max(0, currentBet - committed);
  const allInTotal = committed + stack;

  const minTotal =
    currentBet === 0
      ? snapshot.bigBlind
      : minRaise(currentBet, snapshot.bigBlind, snapshot.lastRaiseIncrement);
  const cap = maxBet(snapshot.gameType, snapshot.pot, street, snapshot.bigBlind, currentBet);
  const maxTotal = cap === null ? allInTotal : Math.min(cap, allInTotal);
  const raisesLeft = (snapshot.raiseCount || 0) < maxRaisesPerStreet(snapshot.gameType, street);

  // A full bet/raise needs chips beyond the minimum. Anything less is only
  // possible as an all-in, which has its own button.
  const canRaise = raisesLeft && allInTotal > minTotal && maxTotal >= minTotal;

  return {
    toCall,
    callAmount: Math.min(toCall, stack),
    canCheck: toCall === 0,
    raiseAction: canRaise ? (currentBet === 0 ? 'bet' : 'raise') : null,
    minTotal,
    maxTotal: canRaise ? maxTotal : minTotal,
    committed,
    stack,
    pot: snapshot.pot || 0
  };
}

/**
 * Quick bet sizes as fractions of the pot (after calling), clamped to the
 * legal range and de-duplicated. Returns [{ key, total }].
 */
export function sizingPresets(opts) {
  if (!opts || !opts.raiseAction) return [];
  const potAfterCall = opts.pot + opts.toCall;
  const base = opts.committed + opts.toCall;
  const sizes = [
    { key: 'half', total: base + Math.round(potAfterCall / 2) },
    { key: 'threeQuarter', total: base + Math.round((potAfterCall * 3) / 4) },
    { key: 'pot', total: base + potAfterCall }
  ];
  const seen = new Set();
  const out = [];
  for (const s of sizes) {
    const total = Math.max(opts.minTotal, Math.min(opts.maxTotal, s.total));
    if (seen.has(total)) continue;
    seen.add(total);
    out.push({ key: s.key, total });
  }
  return out;
}
