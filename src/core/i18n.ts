import type { Locale, Op } from './types';

export interface I18n {
  locale: Locale;
  setLocale(l: Locale): void;
  /** Flat dotted key, params as `{name}`. Missing key: returns the key and warns once. */
  t(key: string, params?: Record<string, string | number>): string;
  /**
   * Plural-aware lookup: reads `${key}.${pluralCategory(locale, count)}` and passes
   * `count` as a param in addition to `params`. Croatian uses one/few/many, English one/many.
   */
  tp(key: string, count: number, params?: Record<string, string | number>): string;
}

export type PluralCategory = 'one' | 'few' | 'many';

export const LOCALES: Locale[] = ['hr', 'en'];
export const DEFAULT_LOCALE: Locale = 'hr';

/** The real minus sign used for display. */
export const MINUS = '−';

/** Croatian: 1, 21, 31… one; 2–4, 22–24… few; everything else many. English: 1 one, else many. */
export function pluralCategory(locale: Locale, n: number): PluralCategory {
  const abs = Math.abs(Math.trunc(n));
  if (locale === 'en') return abs === 1 ? 'one' : 'many';
  const m10 = abs % 10;
  const m100 = abs % 100;
  if (m10 === 1 && m100 !== 11) return 'one';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'few';
  return 'many';
}

/** Integer formatting for display: real minus sign, no grouping (all game numbers are small). */
export function formatNumber(n: number, _locale: Locale): string {
  return n < 0 ? `${MINUS}${Math.abs(n)}` : String(n);
}

/** Operator glyph per locale: hr uses `·` and `:`, en uses `×` and `÷`. */
export function opSymbol(op: Exclude<Op, 'type'>, locale: Locale): string {
  switch (op) {
    case 'add': return '+';
    case 'sub': return MINUS;
    case 'mul': return locale === 'hr' ? '·' : '×';
    case 'div': return locale === 'hr' ? ':' : '÷';
  }
}

function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : m);
}

export function createI18n(dicts: Record<Locale, Record<string, string>>, locale: Locale): I18n {
  const warned = new Set<string>();
  const i18n: I18n = {
    locale,
    setLocale(l: Locale) {
      i18n.locale = l;
    },
    t(key, params) {
      const text = dicts[i18n.locale]?.[key];
      if (text === undefined) {
        const tag = `${i18n.locale}:${key}`;
        if (!warned.has(tag)) {
          warned.add(tag);
          console.warn(`[i18n] missing key "${key}" for locale "${i18n.locale}"`);
        }
        return key;
      }
      return interpolate(text, params);
    },
    tp(key, count, params) {
      return i18n.t(`${key}.${pluralCategory(i18n.locale, count)}`, { ...params, count });
    },
  };
  return i18n;
}
