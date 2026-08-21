/**
 * Main + side pot construction from player commitments.
 *
 * Classic algorithm: repeatedly pay out the smallest unmet commitment to every
 * player who committed at least that much. This correctly handles every
 * all-in / partial all-in combination.
 *
 * Odd chips: when a pot is split, the indivisible remainder goes to the
 * earliest eligible seat after the dealer button (standard house rule).
 */

/**
 * Compute pots from per-player contributions.
 *
 * @param {Array<{id: string, committed: number}>} players - every player in the
 *   hand, including folded players (their money is still in the pot).
 * @returns {Array<{amount: number, eligible: string[]}>} pots ordered from
 *   main (lowest level) to last side pot.
 */
export function computePots(players) {
  const active = players.filter((p) => p.committed > 0);
  const pots = [];
  let remaining = active.map((p) => ({ id: p.id, remaining: p.committed }));

  while (remaining.length) {
    const lowest = Math.min(...remaining.map((p) => p.remaining));
    if (lowest <= 0) {
      remaining = remaining.filter((p) => p.remaining > 0);
      continue;
    }
    const eligible = remaining.filter((p) => p.remaining >= lowest).map((p) => p.id);
    const amount = lowest * remaining.length;
    pots.push({ amount, eligible });
    remaining = remaining
      .map((p) => ({ id: p.id, remaining: p.remaining - lowest }))
      .filter((p) => p.remaining > 0);
  }
  return pots;
}

/**
 * Distribute a pot amount among winners with integer chips.
 * The remainder (pot % winnerCount) goes to the winner listed first
 * (callers must order winners by "earliest seat after dealer").
 *
 * @param {number} amount
 * @param {string[]} winnerIds ordered, first = receives the odd chips
 * @returns {Object<string, number>}
 */
export function distributePot(amount, winnerIds) {
  if (!winnerIds.length) throw new Error('distributePot requires winners');
  const base = Math.floor(amount / winnerIds.length);
  const payout = {};
  winnerIds.forEach((id, i) => {
    payout[id] = base + (i === 0 ? amount - base * winnerIds.length : 0);
  });
  return payout;
}

/**
 * Resolve all pots for a single hand.
 *
 * @param {Array<{id: string, committed: number}>} players
 * @param {(winnerIds: string[]) => string[]} resolveWinners - given the
 *   eligible players for one pot, returns the winners of THAT pot, ordered so
 *   the first element receives odd chips.
 * @returns {{pots: Array, payouts: Object<string, number>}}
 */
export function resolveHand(players, resolveWinners) {
  const pots = computePots(players);
  const payouts = {};
  const awarded = [];
  for (const pot of pots) {
    const winners = resolveWinners(pot.eligible);
    if (!winners.length) throw new Error('no winners for a pot');
    const payout = distributePot(pot.amount, winners);
    for (const [id, amount] of Object.entries(payout)) {
      payouts[id] = (payouts[id] || 0) + amount;
    }
    awarded.push({ amount: pot.amount, winners });
  }
  return { pots, payouts, awarded };
}
