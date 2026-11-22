import { planetsOfSector, systemById } from './content';
import { MAX_PLANET_LEVEL, planetMastery, planetProgress } from './mastery';
import type { PlanetDef, ProgressHolder } from './types';

/**
 * Galaxy map v3: layout (computed in `layout.ts`, baked into SECTORS / SYSTEMS / PLANETS by
 * `content.ts`) and territory from planet progress (ARCHITECTURE.md "Random problems v4").
 * Pure and deterministic.
 */
export {
  MAX_SECTOR_OVERLAP, MIN_SYSTEM_SPACING, SKILL_HUE, WORLD_H, WORLD_MARGIN, WORLD_W,
  discOverlap, hueDistance, sectorRadius,
} from './layout';

export type Hold = 'hostile' | 'contested' | 'secured';

/** Lowest planet level that counts as secured (levels 1..2 are contested, 0 hostile). */
export const SECURED_LEVEL = 3;

/** Level 0 hostile (held by the Static), 1..2 contested, 3+ secured. */
export function planetHold(planetId: string, save: ProgressHolder): Hold {
  const { level } = planetProgress(save, planetId);
  if (level === 0) return 'hostile';
  return level < SECURED_LEVEL ? 'contested' : 'secured';
}

/** A planet is under attack when its level is >= 1 and it is due (now >= dueAt). */
export function underAttack(planetId: string, save: ProgressHolder, now: number): boolean {
  const p = planetProgress(save, planetId);
  return p.level >= 1 && now >= p.dueAt;
}

function meanMastery(planets: readonly PlanetDef[], save: ProgressHolder): number {
  if (planets.length === 0) return 0;
  let levels = 0;
  for (const p of planets) levels += planetMastery(p.id, save) * MAX_PLANET_LEVEL;
  return levels / (MAX_PLANET_LEVEL * planets.length);
}

/** Mean planet mastery over the system's planets (0 for an unknown id). */
export function systemMastery(systemId: string, save: ProgressHolder): number {
  return meanMastery(systemById(systemId)?.planets ?? [], save);
}

/** Mean planet mastery over the sector's planets (0 for an unknown id). */
export function sectorMastery(sectorId: string, save: ProgressHolder): number {
  return meanMastery(planetsOfSector(sectorId), save);
}
