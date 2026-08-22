/**
 * chipUtils (Sprint 7) — PURE helpers to render a player's chip stack as a
 * small set of colored denomination discs. No DOM, no state, fully unit-testable.
 *
 * The table's denominations (see GameTable) are [1, 5, 25, 100, 500]. We map
 * each to a canonical poker chip colour and break the player's stack into the
 * fewest possible discs (largest first), capped so a 1500 stack still shows a
 * tidy little pile rather than 300 white chips.
 */

// Canonical chip colours per denomination (stable, readable on the felt).
export const CHIP_COLORS = {
  1: '#e9e2d0', // white
  5: '#3f6fb0', // blue
  25: '#2e8b57' // green
};
const FALLBACK_COLOR = '#c98a2e'; // gold, for any unknown denomination

/**
 * Break a stack (chips) into the denominations that compose it, largest first.
 * @param {number} total   the player's chip total
 * @param {number[]} denominations e.g. [1, 5, 25, 100, 500]
 * @param {number} [maxDiscs=7] cap on the number of discs to render
 * @returns {Array<{ value: number, count: number, color: string }>}
 *   e.g. total=1500, denoms=[1,5,25,100,500] -> [{500,3,gold}]
 */
export function decomposeStack(total, denominations = [1, 5, 25, 100, 500], maxDiscs = 7) {
  const t = Math.max(0, Math.floor(Number(total) || 0));
  const denoms = [...denominations].sort((a, b) => b - a);
  const out = [];
  let remaining = t;
  for (const value of denoms) {
    if (value <= 0) continue;
    const count = Math.floor(remaining / value);
    if (count > 0) {
      out.push({ value, count, color: CHIP_COLORS[value] || FALLBACK_COLOR });
      remaining -= count * value;
    }
    if (remaining <= 0) break;
  }
  // If we still have a remainder that no denomination covers (e.g. a value
  // smaller than the smallest chip), represent it as a single "odd" chip so the
  // visual total is honest.
  if (remaining > 0) out.push({ value: remaining, count: 1, color: FALLBACK_COLOR });
  // Enforce the render cap: keep the largest discs, fold the rest into the
  // smallest shown one so the sum still equals the total.
  if (out.length > maxDiscs) {
    const kept = out.slice(0, maxDiscs - 1);
    const folded = out.slice(maxDiscs - 1);
    const foldedCount = folded.reduce((n, d) => n + d.count, 0);
    kept[kept.length - 1] = { ...kept[kept.length - 1], count: kept[kept.length - 1].count + foldedCount };
    return kept;
  }
  return out;
}

/**
 * A flat, stable array of individual discs (for stacked rendering), each with
 * its colour. Capped by `maxDiscs`; the last disc carries any overflow count.
 * @returns {Array<{ color: string, overflow?: number }>}
 */
export function chipDiscs(total, denominations = [1, 5, 25, 100, 500], maxDiscs = 7) {
  return decomposeStack(total, denominations, maxDiscs);
}

/**
 * Sprint 7 — chip DISCS for a single BET (the amount posted this street).
 * Decomposes the bet into its component denomination discs, largest first, so a
 * 300-chip bet renders as six green 50-chip discs (or a 500 + 25 + 25, etc.),
 * each disc colored by its denomination. The pile grows taller as the bet
 * grows. Capped at `maxDiscs` to keep a full-street max bet a tidy stack.
 *
 * @param {number} amount the bet amount to visualize
 * @param {number[]} denominations e.g. [1, 5, 25, 100, 500]
 * @param {number} [maxDiscs=12] cap on discs rendered for one bet
 * @returns {Array<{ value: number, count: number, color: string }>}
 */
export function betChips(amount, denominations = [1, 5, 25, 100, 500], maxDiscs = 12) {
  return decomposeStack(amount, denominations, maxDiscs);
}
