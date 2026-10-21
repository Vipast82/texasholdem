import { t } from '../i18n.js';

/** The dealer button: a small white disc marked "D" beside the dealer's seat. */
export default function DealerButton({ active = true, seat = null }) {
  if (!active) return null;
  return (
    <span className="dealerbtn" role="img" aria-label={t('dealer.label', { seat })} title={t('dealer.title')}>
      <span className="dealerbtn__disc" aria-hidden="true">
        <span className="dealerbtn__text">{t('dealer.text')}</span>
      </span>
    </span>
  );
}
