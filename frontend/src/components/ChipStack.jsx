import { useEffect, useRef, useState } from 'react';
import { decomposeStack } from '../chipUtils.js';
import { t } from '../i18n.js';

/**
 * ChipStack (Sprint 7) — renders a player's chip total as a small stack of
 * colored denomination discs (pure math in chipUtils.js), and plays a quick
 * "push" animation when the amount in front of them (their street contribution)
 * increases. Presentational + transient-animation only.
 */
export default function ChipStack({ chips, posted = 0, denominations = [1, 5, 25, 100, 500] }) {
  const discs = decomposeStack(chips, denominations, 7);

  // Re-trigger the push animation whenever `posted` grows (a new bet is made).
  const [pushKey, setPushKey] = useState(0);
  const prevPosted = useRef(posted);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      prevPosted.current = posted;
      return;
    }
    if (posted > prevPosted.current) setPushKey((k) => k + 1);
    prevPosted.current = posted;
  }, [posted]);

  return (
    <div className="chipstack" role="group" aria-label={t('seat.chips', { n: chips })}>
      <div key={pushKey} className={`chipstack__pile${posted > 0 ? ' chipstack__pile--push' : ''}`}>
        {discs.map((d, i) => (
          <span
            key={`${d.value}-${i}`}
            className="chip"
            role="img"
            aria-label={t('a11y.chipCount', { count: d.count, value: d.value })}
            style={{ backgroundColor: d.color, zIndex: i }}
            title={`${d.count} × ${d.value}`}
          />
        ))}
        {discs.length === 0 && <span className="chip chip--empty" />}
      </div>
      <span className="chipstack__label">{chips.toLocaleString()}</span>
    </div>
  );
}