import { possibleProblems, sectorFacts, sectorKind } from './factgen';
import {
  hasNameBand, placeSectors, planetAngleFor, scatterSystems, sectorHue, sectorRadius, sunHueFor,
} from './layout';
import type { Disc, Point } from './layout';
import { createNameRegistry, stableHash } from './names';
import type { PlanetDef, SectorDef, SkillId, SystemDef } from './types';

/**
 * Galaxy content: Skill -> Sector -> System -> Planet (ARCHITECTURE.md "Galaxy map v3" and
 * "Random problems v4"). Planets own no facts: every mission draws from the whole sector.
 * Built once at module load, deterministic. Data only.
 */

/** Sectors in galaxy order, grouped by skill. */
const SECTOR_LIST: ReadonlyArray<readonly [string, SkillId]> = [
  ['type-1', 'typing'], ['type-2', 'typing'], ['type-3', 'typing'],
  ['add-5', 'addition'], ['add-10', 'addition'], ['add-15', 'addition'], ['add-50', 'addition'], ['add-100', 'addition'],
  ['sub-5', 'subtraction'], ['sub-10', 'subtraction'], ['sub-15', 'subtraction'], ['sub-50', 'subtraction'],
  ['sub-100', 'subtraction'],
  ['mul-a', 'multiplication'], ['mul-b', 'multiplication'], ['mul-c', 'multiplication'], ['mul-d', 'multiplication'],
  ['div-a', 'division'], ['div-b', 'division'], ['div-c', 'division'], ['div-d', 'division'],
  ['neg-10', 'negatives'], ['neg-20', 'negatives'],
  ['miss-add', 'missing'], ['miss-sub', 'missing'], ['miss-mul', 'missing'], ['miss-div', 'missing'],
  ['core', 'mixed'],
];

export const CORE_SECTOR_ID = 'core';
export const CORE_PLANET_ID = 'core.1';

/** Every sector except the core has 3..5 systems of 3..5 planets (ARCHITECTURE.md "Density rule"). */
export const MIN_SYSTEMS_PER_SECTOR = 3;
export const MAX_SYSTEMS_PER_SECTOR = 5;
export const MIN_PLANETS_PER_SYSTEM = 3;
export const MAX_PLANETS_PER_SYSTEM = 5;
/** Enemy speed grows by this much per system tier (system index in its sector, 0-based). */
export const TIER_SPEED_STEP = 0.08;

/** Size of a sector's problem space: the pool of an enumerated sector, the possible problems of
 *  a generated one. */
export function sectorSize(sectorId: string): number {
  return sectorKind(sectorId) === 'enumerated' ? sectorFacts(sectorId).length : possibleProblems(sectorId);
}

/** Systems of a sector from its size: 3 up to 40 problems, 4 up to 150, else 5. */
export function systemCountFor(size: number): number {
  if (size <= 40) return MIN_SYSTEMS_PER_SECTOR;
  if (size <= 150) return 4;
  return MAX_SYSTEMS_PER_SECTOR;
}

/** Planets of a system, 3..5, stable per system id. */
function planetCountFor(systemId: string): number {
  return MIN_PLANETS_PER_SYSTEM + (stableHash(`planets:${systemId}`) % (MAX_PLANETS_PER_SYSTEM - MIN_PLANETS_PER_SYSTEM + 1));
}

interface Shape { sectorId: string; skill: SkillId; planetsPerSystem: number[]; }

function shapeOf(sectorId: string, skill: SkillId): Shape {
  if (sectorId === CORE_SECTOR_ID) return { sectorId, skill, planetsPerSystem: [1] };
  const systems = systemCountFor(sectorSize(sectorId));
  return { sectorId, skill, planetsPerSystem: Array.from({ length: systems }, (_, i) => planetCountFor(`${sectorId}.s${i + 1}`)) };
}

/** Attempts at scattering a sector's systems so that a band for its name stays free. */
const NAME_BAND_TRIES = 40;

/** System positions of a sector: the first seeded scatter that leaves a name band free. */
function placeSystems(shape: Shape, disc: Disc, others: readonly Point[]): Point[] {
  let points: Point[] = [];
  for (let attempt = 0; attempt < NAME_BAND_TRIES; attempt++) {
    const key = attempt === 0 ? `pos:${shape.sectorId}` : `pos:${shape.sectorId}:${attempt}`;
    points = scatterSystems(disc, shape.planetsPerSystem.length, others, stableHash(key));
    if (hasNameBand(disc, points)) break;
  }
  return points;
}

function buildGalaxy(): SectorDef[] {
  const shapes = SECTOR_LIST.map(([id, skill]) => shapeOf(id, skill));
  // The core sits at the centre of the galaxy; the skills spiral outward around it.
  const placeOrder = [...shapes.filter((s) => s.sectorId === CORE_SECTOR_ID), ...shapes.filter((s) => s.sectorId !== CORE_SECTOR_ID)];
  const placedDiscs = placeSectors(placeOrder.map((s) => ({ radius: sectorRadius(s.planetsPerSystem.length), group: s.skill })));
  const discs = shapes.map((s) => placedDiscs[placeOrder.indexOf(s)]);
  const names = createNameRegistry();
  const allPoints: Point[] = [];
  const skillCount = (skill: SkillId): number => shapes.filter((s) => s.skill === skill).length;
  const skillIndex = new Map<SkillId, number>();

  return shapes.map((shape, order): SectorDef => {
    const disc = discs[order];
    const idx = skillIndex.get(shape.skill) ?? 0;
    skillIndex.set(shape.skill, idx + 1);
    const points = placeSystems(shape, disc, allPoints);
    allPoints.push(...points);
    let planetNo = 0;
    const systems = shape.planetsPerSystem.map((count, si): SystemDef => {
      const systemId = `${shape.sectorId}.s${si + 1}`;
      const planets = Array.from({ length: count }, (_, orbit): PlanetDef => {
        const id = `${shape.sectorId}.${++planetNo}`;
        return {
          id, systemId, sectorId: shape.sectorId, name: names.nameFor(`planet:${id}`),
          orbit, angle: planetAngleFor(stableHash(`angle:${id}`)),
        };
      });
      return {
        id: systemId, sectorId: shape.sectorId, name: names.nameFor(`system:${systemId}`),
        x: points[si].x, y: points[si].y, sunHue: sunHueFor(stableHash(`sun:${systemId}`)), planets,
      };
    });
    return {
      id: shape.sectorId, skill: shape.skill, nameKey: `meta.sector.${shape.sectorId}`,
      hue: sectorHue(shape.skill, idx, skillCount(shape.skill)), order,
      x: disc.x, y: disc.y, radius: disc.radius, systems,
    };
  });
}

/** Every sector in galaxy order. */
export const SECTORS: readonly SectorDef[] = buildGalaxy();
/** Every star system, in galaxy order. */
export const SYSTEMS: readonly SystemDef[] = SECTORS.flatMap((s) => s.systems);
/** Every planet, in galaxy order. */
export const PLANETS: readonly PlanetDef[] = SYSTEMS.flatMap((s) => s.planets);
/** The skills in galaxy order. */
export const SKILLS: readonly SkillId[] = [...new Set(SECTORS.map((s) => s.skill))];

const sectorIndex = new Map(SECTORS.map((s) => [s.id, s]));
const systemIndex = new Map(SYSTEMS.map((s) => [s.id, s]));
const planetIndex = new Map(PLANETS.map((p) => [p.id, p]));

export function sectorById(sectorId: string): SectorDef | undefined {
  return sectorIndex.get(sectorId);
}

export function systemById(systemId: string): SystemDef | undefined {
  return systemIndex.get(systemId);
}

export function planetById(planetId: string): PlanetDef | undefined {
  return planetIndex.get(planetId);
}

/** Sector that owns the planet, or undefined for an unknown planet id. */
export function sectorOfPlanet(planetId: string): SectorDef | undefined {
  const p = planetById(planetId);
  return p ? sectorById(p.sectorId) : undefined;
}

/** System that owns the planet, or undefined for an unknown planet id. */
export function systemOfPlanet(planetId: string): SystemDef | undefined {
  const p = planetById(planetId);
  return p ? systemById(p.systemId) : undefined;
}

/** Planets of a sector in sector order ([] for an unknown id). */
export function planetsOfSector(sectorId: string): PlanetDef[] {
  return sectorById(sectorId)?.systems.flatMap((s) => s.planets) ?? [];
}

/** Sectors of one skill, in galaxy order. */
export function sectorsOfSkill(skill: SkillId): SectorDef[] {
  return SECTORS.filter((s) => s.skill === skill);
}

/** Difficulty tier of a planet: the index of its system in its sector (0-based; 0 for unknown ids). */
export function systemTier(planetId: string): number {
  const p = planetById(planetId);
  const sector = p ? sectorById(p.sectorId) : undefined;
  return Math.max(0, sector?.systems.findIndex((s) => s.id === p?.systemId) ?? 0);
}

/** Enemy speed factor of a planet's tier: 1 + 0.08 * tier (BattleConfig.speedScale multiplies it
 *  with the game-speed setting). */
export function tierSpeedFactor(planetId: string): number {
  return 1 + TIER_SPEED_STEP * systemTier(planetId);
}
