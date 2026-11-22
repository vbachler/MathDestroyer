import { planetsOfSector, systemById } from './content';
import { dueFacts, planetMastery } from './mastery';
import type { FactStats } from './types';

/**
 * Galaxy map v3: layout (computed in `layout.ts`, baked into SECTORS / SYSTEMS / PLANETS by
 * `content.ts`) and territory. Pure and deterministic.
 */
export {
  MAX_SECTOR_OVERLAP, MIN_SYSTEM_SPACING, SKILL_HUE, WORLD_H, WORLD_MARGIN, WORLD_W,
  discOverlap, hueDistance, sectorRadius,
} from './layout';

export type Hold = 'hostile' | 'contested' | 'secured';

export const HOSTILE_BELOW = 0.2;
export const CONTESTED_BELOW = 0.6;
export const ATTACK_MIN_DUE = 2;

/** Threshold comparison tolerant to floating-point rounding of means. */
const below = (x: number, threshold: number): boolean => x < threshold - 1e-9;

/** planetMastery < 0.2 hostile (held by the Static), < 0.6 contested, else secured. */
export function planetHold(planetId: string, stats: Record<string, FactStats>): Hold {
  const m = planetMastery(planetId, stats);
  if (below(m, HOSTILE_BELOW)) return 'hostile';
  if (below(m, CONTESTED_BELOW)) return 'contested';
  return 'secured';
}

/** A planet is under attack when it is not hostile and has >= 2 due facts. */
export function underAttack(planetId: string, stats: Record<string, FactStats>, now: number): boolean {
  return planetHold(planetId, stats) !== 'hostile' && dueFacts(planetId, stats, now).length >= ATTACK_MIN_DUE;
}

function meanMastery(planetIds: string[], stats: Record<string, FactStats>): number {
  if (planetIds.length === 0) return 0;
  let sum = 0;
  for (const id of planetIds) sum += planetMastery(id, stats);
  return sum / planetIds.length;
}

/** Mean planetMastery of the system's planets (0 for an unknown id). */
export function systemMastery(systemId: string, stats: Record<string, FactStats>): number {
  return meanMastery(systemById(systemId)?.planets.map((p) => p.id) ?? [], stats);
}

/** Mean planetMastery of every planet in the sector, each planet weighing the same (0 for an unknown id). */
export function sectorMastery(sectorId: string, stats: Record<string, FactStats>): number {
  return meanMastery(planetsOfSector(sectorId).map((p) => p.id), stats);
}
