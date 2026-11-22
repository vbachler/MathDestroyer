import { CORE_PLANET_ID, CORE_SECTOR_ID, SECTORS, planetById } from './content';
import { categoryDefs, categoryStatId, generateFact, sectorFacts, sectorKind, sectorOfStat } from './facts';
import type { CategoryDef } from './facts';
import type { Rng } from './rng';
import type { Fact, FactStats, PlanetProgress } from './types';

/**
 * Which problems a mission asks (ARCHITECTURE.md "Random problems v4"): adaptive selection over
 * the whole sector. Enumerated sectors weight their facts (due and weak first) and introduce
 * never-seen facts gradually; generated sectors pick a category weighted toward weak / due ones
 * (within the Balance rule's bounds) and then random numbers inside it. Pure: randomness comes
 * from the given Rng, so a mission is deterministic for a seed and different for another.
 */

/** Never-seen facts allowed in the first wave, and extra per later wave (enumerated sectors). */
export const FIRST_WAVE_NEW_FACTS = 6;
export const NEW_FACTS_PER_WAVE = 3;
/** Weight multiplier of an enumerated fact not yet asked in this mission (spreads a mission
 *  over the eligible facts instead of repeating a few). */
export const UNASKED_BONUS = 3;
/** The core draws from this sector until the player has played any sector. */
export const CORE_FALLBACK_SECTOR = 'type-1';
/** Attempts to generate a problem that differs from the excluded ones. */
const GENERATE_TRIES = 24;

/** Weight of a fact or category: due and seen 4, never seen 3, box 0-1 3, box 2-3 2, box 4-5 1. */
export function statWeight(s: FactStats | undefined, now: number): number {
  if (!s || s.attempts === 0) return 3;
  if (s.dueAt <= now) return 4;
  if (s.box <= 1) return 3;
  if (s.box <= 3) return 2;
  return 1;
}

/**
 * Probabilities of the categories of a generated sector: base share x statWeight, normalised,
 * then held inside each category's min / max (easy at most 10%, carry / borrow at least half);
 * the remaining mass is spread over the other categories in proportion to their weights.
 */
export function categoryShares(sectorId: string, stats: Record<string, FactStats>, now: number): Array<{ name: string; p: number }> {
  const defs: CategoryDef[] = categoryDefs(sectorId);
  const raw = defs.map((d) => d.share * statWeight(stats[categoryStatId(sectorId, d.name)], now));
  const fixed: Array<number | null> = defs.map(() => null);
  let p: number[] = [];
  for (let round = 0; round <= defs.length; round++) {
    const fixedMass = fixed.reduce<number>((sum, x) => sum + (x ?? 0), 0);
    const freeRaw = raw.reduce((sum, x, i) => sum + (fixed[i] === null ? x : 0), 0);
    p = defs.map((_, i) => fixed[i] ?? (freeRaw > 0 ? (raw[i] / freeRaw) * (1 - fixedMass) : 0));
    let changed = false;
    defs.forEach((d, i) => {
      if (fixed[i] !== null) return;
      if (d.max !== undefined && p[i] > d.max) { fixed[i] = d.max; changed = true; }
      else if (d.min !== undefined && p[i] < d.min) { fixed[i] = d.min; changed = true; }
    });
    if (!changed) break;
  }
  return defs.map((d, i) => ({ name: d.name, p: p[i] }));
}

/** One category of a generated sector, drawn by `categoryShares`. */
export function pickCategory(sectorId: string, stats: Record<string, FactStats>, now: number, rng: Rng): string {
  const shares = categoryShares(sectorId, stats, now);
  let r = rng.next();
  for (const s of shares) {
    r -= s.p;
    if (r < 0) return s.name;
  }
  return shares[shares.length - 1].name;
}

/**
 * Sectors the player has played, in galaxy order: any stat present for the sector, or any of
 * its planets won at least once. The core itself never counts.
 */
export function playedSectors(save: { stats: Record<string, FactStats>; planets: Readonly<Record<string, PlanetProgress>> }): string[] {
  const played = new Set<string>();
  for (const id of Object.keys(save.stats)) {
    const sector = sectorOfStat(id);
    if (sector) played.add(sector);
  }
  for (const [planetId, p] of Object.entries(save.planets)) {
    const sector = planetById(planetId)?.sectorId;
    if (sector && p.wins > 0) played.add(sector);
  }
  return SECTORS.filter((s) => s.id !== CORE_SECTOR_ID && played.has(s.id)).map((s) => s.id);
}

/** Sectors a mission at the planet draws from: its own sector; for the core every played sector
 *  (`type-1` when none); [] for an unknown planet. */
export function missionSectors(
  planetId: string,
  save: { stats: Record<string, FactStats>; planets: Readonly<Record<string, PlanetProgress>> },
): string[] {
  if (planetId === CORE_PLANET_ID) {
    const played = playedSectors(save);
    return played.length > 0 ? played : [CORE_FALLBACK_SECTOR];
  }
  const sector = planetById(planetId)?.sectorId;
  return sector ? [sector] : [];
}

interface Source {
  /** A problem whose id is not excluded, chosen adaptively; null when none fits. */
  pick(waveIndex: number, exclude: ReadonlySet<string>): Fact | null;
  /** Like pick, but may fall back to anything of the sector (never-seen facts beyond the budget). */
  any(exclude: ReadonlySet<string>): Fact | null;
}

function weightedPick<T>(items: ReadonlyArray<{ item: T; w: number }>, rng: Rng): T | null {
  const total = items.reduce((sum, e) => sum + e.w, 0);
  if (items.length === 0 || total <= 0) return null;
  let r = rng.next() * total;
  for (const e of items) {
    r -= e.w;
    if (r < 0) return e.item;
  }
  return items[items.length - 1].item;
}

/** Enumerated sector: weighted facts; the never-seen facts open up in a mission order drawn once,
 *  6 in the first wave and at most 3 more per later wave. A fact not yet asked in this mission
 *  weighs UNASKED_BONUS times more. */
function enumeratedSource(sectorId: string, stats: Record<string, FactStats>, now: number, rng: Rng): Source {
  const pool = sectorFacts(sectorId);
  const isNew = (f: Fact): boolean => !stats[f.statId] || stats[f.statId].attempts === 0;
  const seen = pool.filter((f) => !isNew(f));
  const fresh = rng.shuffle(pool.filter(isNew));
  const asked = new Set<string>();
  const mark = (f: Fact | null): Fact | null => {
    if (f) asked.add(f.id);
    return f;
  };
  return {
    pick(waveIndex, exclude) {
      const budget = FIRST_WAVE_NEW_FACTS + NEW_FACTS_PER_WAVE * Math.max(0, waveIndex);
      const eligible = [...seen, ...fresh.slice(0, budget)].filter((f) => !exclude.has(f.id));
      return mark(weightedPick(eligible.map((f) => ({
        item: f, w: statWeight(stats[f.statId], now) * (asked.has(f.id) ? 1 : UNASKED_BONUS),
      })), rng));
    },
    any(exclude) {
      const rest = pool.filter((f) => !exclude.has(f.id));
      return mark(rest.length > 0 ? rng.pick(rest) : null);
    },
  };
}

/** Generated sector: a weighted category, then random numbers inside it. */
function generatedSource(sectorId: string, stats: Record<string, FactStats>, now: number, rng: Rng): Source {
  const attempt = (category: () => string, exclude: ReadonlySet<string>): Fact | null => {
    for (let i = 0; i < GENERATE_TRIES; i++) {
      const f = generateFact(sectorId, category(), rng);
      if (!exclude.has(f.id)) return f;
    }
    return null;
  };
  const names = categoryDefs(sectorId).map((d) => d.name);
  return {
    pick: (_waveIndex, exclude) => attempt(() => pickCategory(sectorId, stats, now, rng), exclude),
    any: (exclude) => attempt(() => rng.pick(names), exclude),
  };
}

export interface MissionScheduler {
  /** The sectors this mission draws from. */
  readonly sectors: readonly string[];
  /** Queue of `count` problems for wave `waveIndex` (0-based); no problem twice in a row. */
  wave(waveIndex: number, count: number): Fact[];
  /** A problem whose id is not in `exclude` (used when the queued one is already on screen),
   *  or null when none can be found. */
  replacement(waveIndex: number, exclude: ReadonlySet<string>): Fact | null;
}

/**
 * The problem source of one mission. Stats are the mission-start snapshot. Creating it draws
 * the order in which never-seen facts are introduced, so creation consumes the Rng too.
 */
export function createMissionScheduler(args: {
  planetId: string; stats: Record<string, FactStats>; planets: Readonly<Record<string, PlanetProgress>>;
  now: number; rng: Rng;
}): MissionScheduler {
  const { planetId, stats, planets, now, rng } = args;
  const sectors = missionSectors(planetId, { stats, planets });
  const sources = sectors.map((id) => (sectorKind(id) === 'generated'
    ? generatedSource(id, stats, now, rng) : enumeratedSource(id, stats, now, rng)));
  const source = (): Source | undefined => (sources.length > 1 ? rng.pick(sources) : sources[0]);
  let last: string | null = null;

  return {
    sectors,
    wave(waveIndex, count) {
      const queue: Fact[] = [];
      for (let i = 0; i < count; i++) {
        const from = source();
        if (!from) break;
        const f = from.pick(waveIndex, new Set(last ? [last] : [])) ?? from.pick(waveIndex, new Set()) ?? from.any(new Set());
        if (!f) break;
        queue.push(f);
        last = f.id;
      }
      return queue;
    },
    replacement(waveIndex, exclude) {
      const first = source();
      if (!first) return null;
      const f = first.pick(waveIndex, exclude);
      if (f) return f;
      for (const s of sources) {
        const g = s.pick(waveIndex, exclude) ?? s.any(exclude);
        if (g) return g;
      }
      return null;
    },
  };
}
