import type { AnswerRecord } from './battle';
import { SECTORS, planetById, sectorById, systemById } from './content';
import { MAX_PLANET_LEVEL, applyOutcome, applyPlanetResult, emptyProgress, emptyStats } from './mastery';
import type { FactStats, Locale, PlanetProgress } from './types';

export interface SaveData {
  version: 1;
  locale: Locale;                 // default 'hr'
  credits: number;
  modules: Record<string, number>;
  stats: Record<string, FactStats>;   // keyed by Fact.statId
  planets: Record<string, PlanetProgress>;   // planet progress by planet id; missing = level 0
  settings: { sfxVolume: number; musicVolume: number; keypadAlwaysVisible: boolean;
              gameSpeed: GameSpeed; };   // default 1; loadSave fills it for older saves
  totals: { missions: number; wins: number; bestScore: Record<string, number> }; // bestScore by planetId
  story: { seen: string[] };      // skill ids whose intro has been shown; loadSave fills it for older saves
  location: Location;             // where the player's ship is; default: first system of add-5 (new players start in addition)
}
/** The player's position on the galaxy map. */
export interface Location { sectorId: string; systemId: string; }

/** Sector a new player starts in ("Review fixes v5": addition, not typing). */
export const START_SECTOR = 'add-5';

/** First system of START_SECTOR. */
export function defaultLocation(): Location {
  const sector = sectorById(START_SECTOR) ?? SECTORS[0];
  return { sectorId: sector.id, systemId: sector.systems[0].id };
}

/** A valid location from any value: a known system wins (its sector is taken from the system);
 *  a known sector alone gives its first system; anything else -> defaultLocation(). */
export function sanitizeLocation(v: unknown): Location {
  if (isObj(v)) {
    const system = typeof v.systemId === 'string' ? systemById(v.systemId) : undefined;
    if (system) return { sectorId: system.sectorId, systemId: system.id };
    const sector = typeof v.sectorId === 'string' ? sectorById(v.sectorId) : undefined;
    if (sector) return { sectorId: sector.id, systemId: sector.systems[0].id };
  }
  return defaultLocation();
}
/** Station modules that no longer exist; loadSave drops them. */
export const REMOVED_MODULES: readonly string[] = ['reactor'];
/** Game-speed setting, passed to BattleConfig.speedScale: 0.75 slow, 1 normal, 1.25 fast. */
export type GameSpeed = 0.75 | 1 | 1.25;
export const GAME_SPEEDS: readonly GameSpeed[] = [0.75, 1, 1.25];

export interface StorageAdapter { getItem(k: string): string | null; setItem(k: string, v: string): void; }
export const SAVE_KEY = 'mathdestroyer.save.v1';

export function defaultSave(): SaveData {
  return {
    version: 1,
    locale: 'hr',
    credits: 0,
    modules: {},
    stats: {},
    planets: {},
    settings: { sfxVolume: 0.8, musicVolume: 0.6, keypadAlwaysVisible: false, gameSpeed: 1 },
    totals: { missions: 0, wins: 0, bestScore: {} },
    story: { seen: [] },
    location: defaultLocation(),
  };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const gameSpeed = (v: unknown): GameSpeed => GAME_SPEEDS.find((g) => g === v) ?? 1;
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

function numberRecord(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(v)) return out;
  for (const [k, x] of Object.entries(v)) if (typeof x === 'number' && Number.isFinite(x)) out[k] = x;
  return out;
}

/** Drops keys that are not current planet ids (old saves used other planet ids). */
function currentPlanetsOnly(scores: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(scores)) if (planetById(k)) out[k] = v;
  return out;
}

/** Distinct strings of an array, in order; anything else -> []. */
function stringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) if (typeof x === 'string' && !out.includes(x)) out.push(x);
  return out;
}

function statsRecord(v: unknown): Record<string, FactStats> {
  const out: Record<string, FactStats> = {};
  if (!isObj(v)) return out;
  for (const [k, x] of Object.entries(v)) {
    if (!isObj(x)) continue;
    const e = emptyStats();
    out[k] = {
      box: Math.min(5, Math.max(0, Math.round(num(x.box, e.box)))),
      attempts: num(x.attempts, e.attempts),
      correct: num(x.correct, e.correct),
      avgMs: num(x.avgMs, e.avgMs),
      lastSeen: num(x.lastSeen, e.lastSeen),
      dueAt: num(x.dueAt, e.dueAt),
    };
  }
  return out;
}

/** Planet progress of known planets only; level 0..5, finite numbers. Old saves without the key -> {}. */
function planetsRecord(v: unknown): Record<string, PlanetProgress> {
  const out: Record<string, PlanetProgress> = {};
  if (!isObj(v)) return out;
  for (const [k, x] of Object.entries(v)) {
    if (!isObj(x) || !planetById(k)) continue;
    const e = emptyProgress();
    out[k] = {
      level: Math.min(MAX_PLANET_LEVEL, Math.max(0, Math.round(num(x.level, e.level)))),
      dueAt: num(x.dueAt, e.dueAt),
      wins: Math.max(0, Math.round(num(x.wins, e.wins))),
    };
  }
  return out;
}

/** Brings any parsed value to a valid SaveData, keeping every valid field and defaulting the rest.
 *  Fields of removed features (settings.unlockAll) are ignored. */
export function migrate(raw: unknown): SaveData {
  const d = defaultSave();
  if (!isObj(raw) || raw.version !== 1) return d;
  const settings = isObj(raw.settings) ? raw.settings : {};
  const totals = isObj(raw.totals) ? raw.totals : {};
  const story = isObj(raw.story) ? raw.story : {};
  const modules = numberRecord(raw.modules);
  for (const id of REMOVED_MODULES) delete modules[id];
  return {
    version: 1,
    locale: raw.locale === 'en' || raw.locale === 'hr' ? raw.locale : d.locale,
    credits: Math.max(0, num(raw.credits, d.credits)),
    modules,
    stats: statsRecord(raw.stats),
    planets: planetsRecord(raw.planets),
    settings: {
      sfxVolume: clamp01(num(settings.sfxVolume, d.settings.sfxVolume)),
      musicVolume: clamp01(num(settings.musicVolume, d.settings.musicVolume)),
      keypadAlwaysVisible: bool(settings.keypadAlwaysVisible, d.settings.keypadAlwaysVisible),
      gameSpeed: gameSpeed(settings.gameSpeed),
    },
    totals: {
      missions: num(totals.missions, 0),
      wins: num(totals.wins, 0),
      bestScore: currentPlanetsOnly(numberRecord(totals.bestScore)),
    },
    story: { seen: stringList(story.seen) },
    location: sanitizeLocation(raw.location),
  };
}

export function serialize(save: SaveData): string {
  return JSON.stringify(save);
}

/** Tolerant: missing data, bad JSON or a throwing storage -> defaultSave(). */
export function loadSave(storage: StorageAdapter): SaveData {
  try {
    const text = storage.getItem(SAVE_KEY);
    if (text === null) return defaultSave();
    return migrate(JSON.parse(text));
  } catch {
    return defaultSave();
  }
}

export function writeSave(storage: StorageAdapter, save: SaveData): void {
  storage.setItem(SAVE_KEY, serialize(save));
}

/** Applies mission results: mastery records (by statId), planet progress (needs the mission's
 *  accuracy), credits, totals. Pure. */
export function applyMission(save: SaveData, args: { planetId: string; records: AnswerRecord[];
  credits: number; score: number; won: boolean; accuracy: number; now: number }): SaveData {
  const { planetId, records, credits, score, won, accuracy, now } = args;
  const stats = { ...save.stats };
  for (const r of records) {
    stats[r.factId] = applyOutcome(stats[r.factId] ?? emptyStats(), r.outcome, r.responseMs, now);
  }
  const planets = { ...save.planets };
  if (planetById(planetId)) {
    planets[planetId] = applyPlanetResult(planets[planetId] ?? emptyProgress(), { won, accuracy, now });
  }
  const prevBest = save.totals.bestScore[planetId] ?? 0;
  return {
    ...save,
    credits: save.credits + credits,
    stats,
    planets,
    settings: { ...save.settings },
    modules: { ...save.modules },
    story: { seen: [...save.story.seen] },
    location: { ...save.location },
    totals: {
      missions: save.totals.missions + 1,
      wins: save.totals.wins + (won ? 1 : 0),
      bestScore: { ...save.totals.bestScore, [planetId]: Math.max(prevBest, score) },
    },
  };
}
