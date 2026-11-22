import { factsForPlanet } from '../src/core/facts';
import type { FactStats } from '../src/core/types';

export const DAY = 24 * 3600e3;
export const NOW = 1_700_000_000_000;

export function stat(box: number, over: Partial<FactStats> = {}): FactStats {
  return { box, attempts: 3, correct: 2, avgMs: 2000, lastSeen: NOW - DAY, dueAt: NOW + DAY, ...over };
}

/** Every fact of the given planets at one box (not due unless dueAt is overridden). */
export function statsFor(planetIds: string[], box: number, over: Partial<FactStats> = {}): Record<string, FactStats> {
  const out: Record<string, FactStats> = {};
  for (const pid of planetIds) for (const f of factsForPlanet(pid)) out[f.id] = stat(box, over);
  return out;
}
