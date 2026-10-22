import en from './i18n/en.json';
import es from './i18n/es.json';

/**
 * Minimal i18n helper (Sprint 2 seed catalog: en + es).
 * Sprint 3 will expand the JSON catalogs and add locale switching UI;
 * the API here (t/setLocale/getLocale) is the stable contract.
 *
 * Unknown keys fall back to the English catalog, then to the key itself,
 * so a missing translation can never crash the UI.
 */
const LOCALES = { en, es };
let current = 'en';

export function setLocale(locale) {
  if (LOCALES[locale]) current = locale;
}

export function getLocale() {
  return current;
}

/**
 * Translate a key, substituting {var} placeholders.
 * @example t('controls.call', { n: 50 }) -> 'Call 50'
 */
export function t(key, vars = {}) {
  const loc = LOCALES[current] || en;
  let raw = loc[key];
  if (raw === undefined) raw = en[key];
  if (raw === undefined) raw = key;
  return Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), raw);
}
