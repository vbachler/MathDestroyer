import { describe, expect, it } from 'vitest';
import {
  CORE_PLANET_ID, MAX_SYSTEMS_PER_SECTOR, MIN_SYSTEMS_PER_SECTOR, PLANETS, SECTORS, SKILLS, SYSTEMS, TIER_SPEED_STEP,
  planetById, planetsOfSector, sectorById, sectorOfPlanet, sectorSize, sectorsOfSkill, systemById, systemCountFor,
  systemOfPlanet, systemTier, tierSpeedFactor,
} from '../src/core/content';
import { createNameRegistry, nameFromSeed } from '../src/core/names';

const SECTOR_IDS = [
  'type-1', 'type-2', 'type-3',
  'add-5', 'add-10', 'add-15', 'add-50', 'add-100',
  'sub-5', 'sub-10', 'sub-15', 'sub-50', 'sub-100',
  'mul-a', 'mul-b', 'mul-c', 'mul-d',
  'div-a', 'div-b', 'div-c', 'div-d',
  'neg-10', 'neg-20',
  'miss-add', 'miss-sub', 'miss-mul', 'miss-div',
  'core',
];

describe('content structure', () => {
  it('has the sectors of ARCHITECTURE.md in order, grouped by skill', () => {
    expect(SECTORS.map((s) => s.id)).toEqual(SECTOR_IDS);
    SECTORS.forEach((s, i) => {
      expect(s.order).toBe(i);
      expect(s.nameKey).toBe(`meta.sector.${s.id}`);
    });
    expect(SKILLS).toEqual(['typing', 'addition', 'subtraction', 'multiplication', 'division', 'negatives', 'missing', 'mixed']);
    expect(sectorsOfSkill('multiplication').map((s) => s.id)).toEqual(['mul-a', 'mul-b', 'mul-c', 'mul-d']);
  });

  it('has the expected size: 28 sectors, 105 systems, 405 planets', () => {
    expect(SECTORS).toHaveLength(28);
    expect(SYSTEMS).toHaveLength(105);
    expect(PLANETS).toHaveLength(405);
  });

  it('ids are unique and parents match', () => {
    expect(new Set(SYSTEMS.map((s) => s.id)).size).toBe(SYSTEMS.length);
    expect(new Set(PLANETS.map((p) => p.id)).size).toBe(PLANETS.length);
    for (const sector of SECTORS) {
      let n = 0;
      sector.systems.forEach((system, si) => {
        expect(system.id).toBe(`${sector.id}.s${si + 1}`);
        expect(system.sectorId).toBe(sector.id);
        system.planets.forEach((p, i) => {
          expect(p.id).toBe(`${sector.id}.${++n}`);
          expect(p.systemId).toBe(system.id);
          expect(p.sectorId).toBe(sector.id);
          expect(p.orbit).toBe(i);
          expect(p.angle).toBeGreaterThanOrEqual(0);
          expect(p.angle).toBeLessThan(Math.PI * 2);
        });
      });
    }
  });

  it('density: 3..5 systems per sector (more for larger sectors), 3..5 planets per system', () => {
    expect([10, 40, 41, 150, 151, 5000].map(systemCountFor)).toEqual([3, 3, 4, 4, 5, 5]);
    for (const sector of SECTORS) {
      if (sector.id === 'core') continue;
      expect(sector.systems.length, sector.id).toBe(systemCountFor(sectorSize(sector.id)));
      expect(sector.systems.length).toBeGreaterThanOrEqual(MIN_SYSTEMS_PER_SECTOR);
      expect(sector.systems.length).toBeLessThanOrEqual(MAX_SYSTEMS_PER_SECTOR);
      for (const s of sector.systems) {
        expect(s.planets.length, s.id).toBeGreaterThanOrEqual(3);
        expect(s.planets.length, s.id).toBeLessThanOrEqual(5);
      }
    }
    const counts = new Set(SECTORS.map((s) => s.systems.length));
    expect(counts).toEqual(new Set([1, 3, 4, 5]));
    expect(new Set(SYSTEMS.filter((s) => s.sectorId !== 'core').map((s) => s.planets.length))).toEqual(new Set([3, 4, 5]));
  });

  it('the core sector is one system with one planet', () => {
    const core = sectorById('core')!;
    expect(core.skill).toBe('mixed');
    expect(core.systems).toHaveLength(1);
    expect(core.systems[0].planets.map((p) => p.id)).toEqual([CORE_PLANET_ID]);
  });

  it('system tier: index of the system in its sector, speeding enemies up by 8% per tier', () => {
    expect(TIER_SPEED_STEP).toBe(0.08);
    for (const sector of SECTORS) {
      sector.systems.forEach((system, tier) => {
        for (const p of system.planets) {
          expect(systemTier(p.id)).toBe(tier);
          expect(tierSpeedFactor(p.id)).toBeCloseTo(1 + 0.08 * tier);
        }
      });
    }
    const last = sectorById('add-100')!.systems[4].planets[0].id;
    expect(tierSpeedFactor(last)).toBeCloseTo(1.32);
    expect(tierSpeedFactor(CORE_PLANET_ID)).toBe(1);
    expect(systemTier('nope')).toBe(0);
    expect(tierSpeedFactor('nope')).toBe(1);
  });

  it('lookups work', () => {
    const p = PLANETS[40];
    expect(planetById(p.id)).toBe(p);
    expect(systemOfPlanet(p.id)?.planets).toContain(p);
    expect(sectorOfPlanet(p.id)?.id).toBe(p.sectorId);
    expect(systemById(p.systemId)?.id).toBe(p.systemId);
    expect(planetById('mul-7')).toBeUndefined();
    expect(sectorOfPlanet('nope')).toBeUndefined();
    expect(systemById('nope')).toBeUndefined();
    expect(sectorById('nope')).toBeUndefined();
    expect(planetsOfSector('nope')).toEqual([]);
    expect(planetsOfSector('mul-c').length).toBeGreaterThanOrEqual(9);
  });
});

describe('generated names', () => {
  it('are pronounceable, 2..3 syllables, capitalised, unique and stable', () => {
    const names = [...SYSTEMS.map((s) => s.name), ...PLANETS.map((p) => p.name)];
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) {
      expect(n).toMatch(/^[A-Z][a-z]{3,8}$/);
      expect(n).not.toMatch(/[aeiouy]{3}|[^aeiouy]{4}/i);
    }
    const again = createNameRegistry();
    expect(again.nameFor('system:x')).toBe(createNameRegistry().nameFor('system:x'));
    expect(nameFromSeed(42)).toBe(nameFromSeed(42));
  });

  it('avoids a list of well-known names', () => {
    const names = new Set([...SYSTEMS.map((s) => s.name.toLowerCase()), ...PLANETS.map((p) => p.name.toLowerCase())]);
    for (const known of ['vulcan', 'tatooine', 'arrakis', 'hoth', 'endor', 'vega', 'rigel', 'sirius', 'kobol', 'naboo']) {
      expect(names.has(known)).toBe(false);
    }
  });
});
