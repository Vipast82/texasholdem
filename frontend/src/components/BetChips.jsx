import { betChips } from '../chipUtils.js';
import { t } from '../i18n.js';

const MAX_DISCS = 8;

/**
 * A player's bet on this street, drawn as a small stack of chips coloured by
 * denomination, with the amount beside it. The stack re-plays its "slide in"
 * animation whenever the amount changes (keyed on the amount).
 */
export default function BetChips({ amount = 0, denominations = [1, 5, 25, 100, 500] }) {
  if (!amount) return null;
  const discs = [];
  for (const g of betChips(amount, denominations, MAX_DISCS)) {
    for (let i = 0; i < g.count && discs.length < MAX_DISCS; i += 1) discs.push(g.color);
  }
  return (
    <div className="betchips" role="img" aria-label={t('seat.betChips', { n: amount })}>
      <span key={amount} className="betchips__stack" aria-hidden="true">
        {discs.reverse().map((color, i) => (
          <span key={i} className="betchips__disc" style={{ '--chip': color }} />
        ))}
      </span>
      <span className="betchips__total">{amount.toLocaleString()}</span>
    </div>
  );
}
