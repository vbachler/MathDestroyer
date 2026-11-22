import { Sfx } from './audio/Sfx';
import { createI18n } from './core/i18n';
import type { I18n } from './core/i18n';
import { loadSave, writeSave } from './core/save';
import type { SaveData, StorageAdapter } from './core/save';
import type { Locale } from './core/types';
import enBattle from './locales/en/battle.json';
import enCommon from './locales/en/common.json';
import enMeta from './locales/en/meta.json';
import enStory from './locales/en/story.json';
import hrBattle from './locales/hr/battle.json';
import hrCommon from './locales/hr/common.json';
import hrMeta from './locales/hr/meta.json';
import hrStory from './locales/hr/story.json';

export interface App {
  save: SaveData;                    // loaded at boot; call app.persist() after changing
  i18n: I18n;
  sfx: Sfx;
  persist(): void;
  now(): number;                     // Date.now(), the only place it is called
}

/** All locale strings, the four JSON files merged per locale. */
export const DICTS: Record<Locale, Record<string, string>> = {
  hr: { ...hrCommon, ...hrBattle, ...hrMeta, ...hrStory },
  en: { ...enCommon, ...enBattle, ...enMeta, ...enStory },
};

/** window.localStorage when usable, otherwise an in-memory store (private mode, blocked storage). */
function browserStorage(): StorageAdapter {
  try {
    const ls = window.localStorage;
    const probe = '__mathdestroyer_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    const mem = new Map<string, string>();
    return {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => { mem.set(k, v); },
    };
  }
}

const storage = browserStorage();
const initialSave = loadSave(storage);

export const app: App = {
  save: initialSave,
  i18n: createI18n(DICTS, initialSave.locale),
  // Ambience follows the music volume live (read from the current save on every poll).
  sfx: new Sfx(initialSave.settings.sfxVolume, () => app.save.settings.musicVolume),
  persist() {
    try {
      writeSave(storage, app.save);
    } catch (err) {
      console.warn('[save] could not write save data', err);
    }
  },
  now() {
    return Date.now();
  },
};

/** Switches the language immediately and stores it in the save. */
export function setLocale(locale: Locale): void {
  app.i18n.setLocale(locale);
  app.save = { ...app.save, locale };
  app.persist();
}
