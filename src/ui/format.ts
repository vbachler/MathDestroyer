import type { I18n } from '../core/i18n';

/** Whole percent of a 0..1 fraction, with the locale's spacing ("40 %" / "40%"). */
export function percentText(i18n: I18n, fraction: number): string {
  return i18n.t('common.percent', { value: Math.round(fraction * 100) });
}

/** Milliseconds as seconds with one decimal and the locale's decimal separator ("2,4 s"). */
export function secondsText(i18n: I18n, ms: number): string {
  const value = (ms / 1000).toFixed(1).replace('.', i18n.t('common.decimalSeparator'));
  return i18n.t('meta.mastery.seconds', { value });
}
