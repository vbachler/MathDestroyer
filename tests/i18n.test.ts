import { describe, expect, it, vi } from 'vitest';
import { SECTORS } from '../src/core/content';
import { MODULES } from '../src/core/economy';
import { createI18n, formatNumber, opSymbol, pluralCategory } from '../src/core/i18n';
import { UPGRADES } from '../src/core/upgrades';
import enBattle from '../src/locales/en/battle.json';
import enCommon from '../src/locales/en/common.json';
import enMeta from '../src/locales/en/meta.json';
import enStory from '../src/locales/en/story.json';
import hrBattle from '../src/locales/hr/battle.json';
import hrCommon from '../src/locales/hr/common.json';
import hrMeta from '../src/locales/hr/meta.json';
import hrStory from '../src/locales/hr/story.json';

const files: Record<string, { hr: Record<string, string>; en: Record<string, string> }> = {
  common: { hr: hrCommon, en: enCommon },
  battle: { hr: hrBattle, en: enBattle },
  meta: { hr: hrMeta, en: enMeta },
  story: { hr: hrStory, en: enStory },
};
const dicts = {
  hr: { ...hrCommon, ...hrBattle, ...hrMeta, ...hrStory } as Record<string, string>,
  en: { ...enCommon, ...enBattle, ...enMeta, ...enStory } as Record<string, string>,
};

describe('i18n', () => {
  it('translates and interpolates params', () => {
    const i = createI18n({ hr: { 'a.b': 'Val {n} od {total}' }, en: { 'a.b': 'Wave {n} of {total}' } }, 'hr');
    expect(i.t('a.b', { n: 2, total: 5 })).toBe('Val 2 od 5');
    i.setLocale('en');
    expect(i.locale).toBe('en');
    expect(i.t('a.b', { n: 2, total: 5 })).toBe('Wave 2 of 5');
    expect(i.t('a.b', { n: 1 })).toBe('Wave 1 of {total}');
  });

  it('missing key returns the key and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const i = createI18n({ hr: {}, en: {} }, 'hr');
    expect(i.t('nope.key')).toBe('nope.key');
    expect(i.t('nope.key')).toBe('nope.key');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('Croatian plural categories', () => {
    expect([1, 21, 101].map((n) => pluralCategory('hr', n))).toEqual(['one', 'one', 'one']);
    expect([2, 3, 4, 22, 34].map((n) => pluralCategory('hr', n))).toEqual(['few', 'few', 'few', 'few', 'few']);
    expect([0, 5, 11, 12, 14, 15, 111].map((n) => pluralCategory('hr', n))).toEqual(Array(7).fill('many'));
    expect([1, 2, 5].map((n) => pluralCategory('en', n))).toEqual(['one', 'many', 'many']);
  });

  it('tp picks the plural form and passes count', () => {
    const i = createI18n({
      hr: { 'x.ship.one': '{count} brod', 'x.ship.few': '{count} broda', 'x.ship.many': '{count} brodova' },
      en: { 'x.ship.one': '{count} ship', 'x.ship.many': '{count} ships' },
    }, 'hr');
    expect([1, 3, 7].map((n) => i.tp('x.ship', n))).toEqual(['1 brod', '3 broda', '7 brodova']);
    i.setLocale('en');
    expect([1, 3].map((n) => i.tp('x.ship', n))).toEqual(['1 ship', '3 ships']);
  });

  it('formats numbers and operators per locale', () => {
    expect(formatNumber(-7, 'hr')).toBe('−7');
    expect(formatNumber(12, 'en')).toBe('12');
    expect(opSymbol('mul', 'hr')).toBe('·');
    expect(opSymbol('mul', 'en')).toBe('×');
    expect(opSymbol('div', 'hr')).toBe(':');
    expect(opSymbol('div', 'en')).toBe('÷');
    expect(opSymbol('sub', 'en')).toBe('−');
  });
});

describe('locale files', () => {
  for (const [name, { hr, en }] of Object.entries(files)) {
    it(`${name}.json has identical key sets in hr and en`, () => {
      expect(Object.keys(hr).sort()).toEqual(Object.keys(en).sort());
    });

    it(`${name}.json keys are prefixed with "${name}." and values are non-empty`, () => {
      for (const [k, v] of Object.entries({ ...hr, ...en })) {
        expect(k.startsWith(`${name}.`)).toBe(true);
        expect(typeof v).toBe('string');
        expect(v.trim().length).toBeGreaterThan(0);
      }
    });
  }

  it('contains every content, upgrade and module key in both locales', () => {
    const keys = [
      ...SECTORS.map((s) => s.nameKey),
      ...UPGRADES.map((u) => u.nameKey),
      ...MODULES.flatMap((m) => [m.nameKey, m.descKey]),
    ];
    for (const k of keys) {
      expect(dicts.hr[k], k).toBeTruthy();
      expect(dicts.en[k], k).toBeTruthy();
    }
  });

  it('upgrade and module names have at most two words; module lines at most six', () => {
    const words = (v: string): number => v.trim().split(/\s+/).length;
    for (const d of [dicts.hr, dicts.en]) {
      for (const u of UPGRADES) expect(words(d[u.nameKey]), d[u.nameKey]).toBeLessThanOrEqual(2);
      for (const m of MODULES) {
        expect(words(d[m.nameKey]), d[m.nameKey]).toBeLessThanOrEqual(2);
        expect(words(d[m.descKey]), d[m.descKey]).toBeLessThanOrEqual(6);
      }
    }
  });

  it('has no keys of removed features (energy, upgrade descriptions, collector, reactor)', () => {
    for (const d of [dicts.hr, dicts.en]) {
      const stale = Object.keys(d).filter((k) =>
        /energy|collector|reactor/i.test(k) || /^battle\.upgrade\.[^.]+\.desc$/.test(k));
      expect(stale).toEqual([]);
    }
  });

  it('has no keys of the old content model (meta.system.*, meta.planet.*)', () => {
    for (const d of [dicts.hr, dicts.en]) {
      expect(Object.keys(d).filter((k) => /^meta\.(system|planet)\./.test(k))).toEqual([]);
      expect(Object.keys(d).filter((k) => k.startsWith('meta.sector.')).sort()).toEqual(SECTORS.map((s) => s.nameKey).sort());
    }
  });

  it('sector names are short', () => {
    for (const d of [dicts.hr, dicts.en]) {
      for (const s of SECTORS) expect(d[s.nameKey].length, d[s.nameKey]).toBeLessThanOrEqual(24);
    }
  });

  it('Croatian text uses Croatian diacritics', () => {
    expect(Object.values(dicts.hr).join(' ')).toMatch(/[čćđšž]/);
  });
});
