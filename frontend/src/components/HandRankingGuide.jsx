import { t } from '../i18n.js';

// Ranks in strict high-to-low order. `key` maps to the i18n keys
// `hands.<key>` (name) and `hands.<key>.example`.
const RANKS = [
  'straight_flush',
  'quads',
  'full',
  'flush',
  'straight',
  'trips',
  'twopair',
  'pair',
  'high'
];

/**
 * A static, localized reference table of the nine five-card hand ranks,
 * high to low. Purely presentational — reads everything through `t()`.
 */
export default function HandRankingGuide() {
  return (
    <section className="guide" aria-label={t('guide.title')}>
      <h2>{t('guide.title')}</h2>
      <p className="guide__sub">{t('guide.sub')}</p>
      <ol className="guide__list">
        {RANKS.map((key, i) => (
          <li key={key} className="guide__row">
            <span className="guide__rank">{i + 1}</span>
            <span className="guide__name">{t(`hands.${key}`)}</span>
            <span className="guide__example">{t(`hands.${key}.example`)}</span>
          </li>
        ))}
      </ol>
      <p className="guide__note">{t('guide.note')}</p>
    </section>
  );
}