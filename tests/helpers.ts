import { planetsOfSector } from '../src/core/content';
import { factById, sectorStatIds } from '../src/core/facts';
import type { Fact, FactStats, PlanetProgress } from '../src/core/types';

export const DAY = 24 * 3600e3;
export const NOW = 1_700_000_000_000;

export function stat(box: number, over: Partial<FactStats> = {}): FactStats {
  return { box, attempts: 3, correct: 2, avgMs: 2000, lastSeen: NOW - DAY, dueAt: NOW + DAY, ...over };
}

/** Every stat id of the given sectors at one box (not due unless dueAt is overridden). */
export function statsFor(sectorIds: string[], box: number, over: Partial<FactStats> = {}): Record<string, FactStats> {
  const out: Record<string, FactStats> = {};
  for (const id of sectorIds) for (const s of sectorStatIds(id)) out[s] = stat(box, over);
  return out;
}

/** Planet progress at a level (not due unless dueAt is overridden). */
export function progress(level: number, over: Partial<PlanetProgress> = {}): PlanetProgress {
  return { level, dueAt: NOW + DAY, wins: level, ...over };
}

/** Planet ids of a sector, in sector order. */
export function planetIds(sectorId: string): string[] {
  return planetsOfSector(sectorId).map((p) => p.id);
}

/** An enumerated fact by id (throws when unknown). */
export function fact(id: string): Fact {
  const f = factById(id);
  if (!f) throw new Error(`unknown fact ${id}`);
  return f;
}
