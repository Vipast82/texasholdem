/**
 * Sprint 6 — i18n parity + placeholder tests (EN ↔ ES).
 *
 * Guarantees:
 *   - the en.json and es.json key sets are IDENTICAL (no key missing in either);
 *   - every value is a non-empty string (no empty translations);
 *   - for every key, the set of {placeholder} tokens is the SAME in both
 *     locales (so a translation can't silently drop a {var}).
 *
 * Pure / no DOM — runs under the default Node environment.
 */
import { describe, it, expect } from 'vitest';
import en from '../src/i18n/en.json';
import es from '../src/i18n/es.json';

const placeholders = (str) => {
  const out = new Set();
  const re = /\{([a-zA-Z0-9_]+)\}/g;
  let m;
  while ((m = re.exec(String(str))) !== null) out.add(m[1]);
  return out;
};

const sameSet = (a, b) => a.size === b.size && [...a].every((k) => b.has(k));

describe('i18n parity (en.json vs es.json)', () => {
  const enKeys = Object.keys(en);
  const esKeys = Object.keys(es);

  it('has a non-trivial catalog', () => {
    expect(enKeys.length).toBeGreaterThan(50);
  });

  it('every en key exists in es', () => {
    const missing = enKeys.filter((k) => !(k in es));
    expect(missing).toEqual([]);
  });

  it('every es key exists in en', () => {
    const missing = esKeys.filter((k) => !(k in en));
    expect(missing).toEqual([]);
  });

  it('key sets are exactly identical', () => {
    expect(enKeys.sort()).toEqual(esKeys.sort());
  });

  it('every value is a non-empty string in both locales', () => {
    for (const k of enKeys) {
      expect(typeof en[k], `en.${k}`).toBe('string');
      expect(en[k].length, `en.${k}`).toBeGreaterThan(0);
      expect(typeof es[k], `es.${k}`).toBe('string');
      expect(es[k].length, `es.${k}`).toBeGreaterThan(0);
    }
  });

  it('placeholder token sets match for every key (no dropped {var})', () => {
    for (const k of enKeys) {
      expect(
        sameSet(placeholders(en[k]), placeholders(es[k])),
        `placeholders mismatch for ${k}: en=[${[...placeholders(en[k])]}] es=[${[...placeholders(es[k])]}]`
      ).toBe(true);
    }
  });
});
