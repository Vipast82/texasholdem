import { useEffect, useRef, useState } from 'react';
import { betChips } from '../chipUtils.js';
import { t } from '../i18n.js';

/**
 * BetChips (Sprint 7) — a player's CURRENT-STREET bet rendered as a physical
 * stack of colored chip discs above their seat, so the amount is visible AT A
 * GLANCE, not just as a number.
 *
 *   - The bet is decomposed into denomination discs (chipUtils.betChips), so a
 *     300 bet shows six green 50-chips, a 100 bet one blue 100-chip, etc.
 *   - The pile GROWS: each disc is a real (stacked) element, and a higher
 *     denomination disc is drawn larger, so both the COUNT and the SIZE scale
 *     with the bet.
 *   - Color denotes denomination (canonical poker chip colors).
 *   - A quick "push" animation re-triggers whenever the posted amount increases,
 *     mirroring a player slapping new chips into the middle.
 *
 * Presentational only — the pure math lives in chipUtils.js (unit-tested).
 * Renders nothing when there is no bet posted (amount === 0).
 */
const MAX_DISCS = 14;
const BASE_PX = 16; // pixel size of the smallest denomination disc

export default function BetChips({ amount = 0, denominations = [1, 5, 25, 100, 500] }) {
  const groups = betChips(amount, denominations, MAX_DISCS);

  // Total number of discs (sum of each group's count) drives the pile height.
  let discList = [];
  for (const g of groups) {
    for (let i = 0; i < g.count; i += 1) discList.push({ value: g.value, color: g.color });
  }
  if (discList.length > MAX_DISCS) discList = discList.slice(0, MAX_DISCS);

  // Re-trigger the push animation whenever the posted amount grows.
  const [pushKey, setPushKey] = useState(0);
  const prevAmount = useRef(amount);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      prevAmount.current = amount;
      return undefined;
    }
    if (amount > prevAmount.current) setPushKey((k) => k + 1);
    prevAmount.current = amount;
    return undefined;
  }, [amount]);

  if (!discList.length) return null;

  const maxDenom = Math.max(...denominations, 1);
  const label = `${amount} ${t('seat.chipPile')}`;

  return (
    <div
      key={pushKey}
      className={`betchips${amount > 0 ? ' betchips--push' : ''}`}
      role="group"
      aria-label={t('seat.betChips', { n: amount })}
      title={label}
    >
      {/* Render largest denomination first (left) so the disc sizes step down. */}
      {discList
        .slice()
        .sort((a, b) => b.value - a.value)
        .map((d, i) => {
          // Disc size scales with its denomination (bigger chip = bigger value).
          const discSize = Math.max(12, Math.min(30, Math.round(BASE_PX * (0.8 + d.value / maxDenom))));
          return (
            <span
              key={`${d.value}-${i}`}
              className="betchips__disc"
              role="img"
              aria-label={t('a11y.chipCount', { count: 1, value: d.value })}
              style={{ backgroundColor: d.color, width: discSize, height: discSize, zIndex: i }}
            />
          );
        })}
      <span className="betchips__total">{amount.toLocaleString()}</span>
    </div>
  );
}