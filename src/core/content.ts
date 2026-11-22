import { TABLES, chunkSizes, groupSizes, sectorFacts, tableFacts } from './factgen';
import {
  placeSectors, planetAngleFor, scatterSystems, sectorHue, sectorRadius, sunHueFor,
} from './layout';
import type { Point } from './layout';
import { createNameRegistry, stableHash } from './names';
import type { Fact, PlanetDef, SectorDef, SkillId, SystemDef } from './types';

/**
 * Galaxy content: Skill -> Sector -> System -> Planet (ARCHITECTURE.md "Galaxy map v3").
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

interface Shape { sectorId: string; skill: SkillId; systems: Fact[][][]; }   // systems -> planets -> facts

/** Fact chunks of a sector grouped into systems (before layout and names). */
function shapeOf(sectorId: string, skill: SkillId): Shape {
  if (sectorId === CORE_SECTOR_ID) return { sectorId, skill, systems: [[[]]] };
  const tables = TABLES[sectorId];
  if (tables) {
    // One system per times table, two planets: x1..x5 and x6..x10.
    const op = sectorId.startsWith('mul') ? 'mul' : 'div';
    return {
      sectorId, skill,
      systems: tables.map((n) => {
        const facts = tableFacts(sectorId, op, n);
        return [facts.slice(0, 5), facts.slice(5)];
      }),
    };
  }
  const facts = sectorFacts(sectorId);
  const planets: Fact[][] = [];
  let at = 0;
  for (const size of chunkSizes(facts.length)) {
    planets.push(facts.slice(at, at + size));
    at += size;
  }
  const systems: Fact[][][] = [];
  at = 0;
  for (const size of groupSizes(planets.length)) {
    systems.push(planets.slice(at, at + size));
    at += size;
  }
  return { sectorId, skill, systems };
}

const planetFacts = new Map<string, readonly Fact[]>();

function buildGalaxy(): SectorDef[] {
  const shapes = SECTOR_LIST.map(([id, skill]) => shapeOf(id, skill));
  // The core sits at the centre of the galaxy; the skills spiral outward around it.
  const placeOrder = [...shapes.filter((s) => s.sectorId === CORE_SECTOR_ID), ...shapes.filter((s) => s.sectorId !== CORE_SECTOR_ID)];
  const placedDiscs = placeSectors(placeOrder.map((s) => ({ radius: sectorRadius(s.systems.length), group: s.skill })));
  const discs = shapes.map((s) => placedDiscs[placeOrder.indexOf(s)]);
  const names = createNameRegistry();
  const allPoints: Point[] = [];
  const skillCount = (skill: SkillId): number => shapes.filter((s) => s.skill === skill).length;
  const skillIndex = new Map<SkillId, number>();

  return shapes.map((shape, order): SectorDef => {
    const disc = discs[order];
    const idx = skillIndex.get(shape.skill) ?? 0;
    skillIndex.set(shape.skill, idx + 1);
    const points = scatterSystems(disc, shape.systems.length, allPoints, stableHash(`pos:${shape.sectorId}`));
    allPoints.push(...points);
    let planetNo = 0;
    const systems = shape.systems.map((planetChunks, si): SystemDef => {
      const systemId = `${shape.sectorId}.s${si + 1}`;
      const planets = planetChunks.map((facts, orbit): PlanetDef => {
        planetNo++;
        const id = `${shape.sectorId}.${planetNo}`;
        planetFacts.set(id, Object.freeze(facts.map((f) => Object.freeze({ ...f, planetId: id }))));
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

/** Facts of a planet as built (frozen); [] for the core planet and unknown ids. Used by facts.ts. */
export function planetFactList(planetId: string): readonly Fact[] {
  return planetFacts.get(planetId) ?? [];
}
