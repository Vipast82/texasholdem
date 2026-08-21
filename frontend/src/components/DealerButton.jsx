import { t } from '../i18n.js';

/**
 * DealerButton — the animated "dealer" disc. In the saloon the button is the
 * token that rotates to each seat in turn; here it renders next to the current
 * dealer's seat and gently pulses to draw the eye.
 *
 * Motion is gated by `prefers-reduced-motion` (the `.dealerbtn--pulse`
 * animation is disabled in styles.css when the user opts out), so this component
 * stays purely presentational.
 */
export default function DealerButton({ active = true, seat = null }) {
  if (!active) return null;
  return (
    <span className="dealerbtn dealerbtn--pulse" role="img" aria-label={t('dealer.label', { seat })} title={t('dealer.title')}>
      <span className="dealerbtn__disc" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="70%" height="70%" focusable="false">
          <path
            d="M12 2.5 14.4 8.2 20.5 8.6 15.9 12.4 17.4 18.3 12 15 6.6 18.3 8.1 12.4 3.5 8.6 9.6 8.2Z"
            fill="currentColor"
          />
        </svg>
        <span className="dealerbtn__text">{t('dealer.text')}</span>
      </span>
    </span>
  );
}