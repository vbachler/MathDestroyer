import { describe, expect, it } from 'vitest';
import {
  CORE_PLANET_ID, PLANETS, SECTORS, SKILLS, SYSTEMS, planetById, planetsOfSector, sectorById,
  sectorOfPlanet, sectorsOfSkill, systemById, systemOfPlanet,
} from '../src/core/content';
import {
  OPERAND_ONE_SHARE, TRIVIAL_SHARE, TRIVIAL_SHARE_SMALL, chunkSizes, groupSizes, isOperandOne, isTrivial,
} from '../src/core/factgen';
import { allFacts, factById, factsForPlanet } from '../src/core/facts';
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

const sectorFactsOf = (sectorId: string) => planetsOfSector(sectorId).flatMap((p) => factsForPlanet(p.id));

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

  it('has the expected size: 28 sectors, 52 systems, 153 planets, 864 facts', () => {
    expect(SECTORS).toHaveLength(28);
    expect(SYSTEMS).toHaveLength(52);
    expect(PLANETS).toHaveLength(153);
    expect(allFacts()).toHaveLength(864);
  });

  it('ids are unique and parents match', () => {
    expect(new Set(SYSTEMS.map((s) => s.id)).size).toBe(SYSTEMS.length);
    expect(new Set(PLANETS.map((p) => p.id)).size).toBe(PLANETS.length);
    for (const sector of SECTORS) {
      for (const system of sector.systems) {
        expect(system.sectorId).toBe(sector.id);
        system.planets.forEach((p, i) => {
          expect(p.systemId).toBe(system.id);
          expect(p.sectorId).toBe(sector.id);
          expect(p.orbit).toBe(i);
          expect(p.angle).toBeGreaterThanOrEqual(0);
          expect(p.angle).toBeLessThan(Math.PI * 2);
        });
      }
    }
  });

  it('planets hold 5..8 facts, all with the planet id; systems hold 3..5 planets', () => {
    for (const p of PLANETS) {
      const facts = factsForPlanet(p.id);
      if (p.id === CORE_PLANET_ID) {
        expect(facts).toEqual([]);
        continue;
      }
      expect(facts.length).toBeGreaterThanOrEqual(5);
      expect(facts.length).toBeLessThanOrEqual(8);
      for (const f of facts) expect(f.planetId).toBe(p.id);
    }
    for (const s of SYSTEMS) {
      const sector = sectorById(s.sectorId)!;
      if (sector.skill === 'multiplication' || sector.skill === 'division') {
        expect(s.planets).toHaveLength(2);
      } else if (['core', 'type-1', 'add-5', 'sub-5'].includes(sector.id)) {
        // core: one fact-less planet; type-1 (10 facts), add-5 and sub-5 (12 facts) fit only two planets.
        expect(s.planets.length).toBeLessThanOrEqual(2);
      } else {
        expect(s.planets.length).toBeGreaterThanOrEqual(3);
        expect(s.planets.length).toBeLessThanOrEqual(5);
      }
    }
  });

  it('a times-table system is one table: x1..x5 then x6..x10', () => {
    const tables = (sectorId: string) => sectorById(sectorId)!.systems.map((s) => {
      const [low, high] = s.planets.map((p) => factsForPlanet(p.id));
      return { low, high };
    });
    const mulC = tables('mul-c');
    expect(mulC).toHaveLength(2);
    expect(mulC[1].low.map((f) => f.id)).toEqual(['mul:7x1', 'mul:7x2', 'mul:7x3', 'mul:7x4', 'mul:7x5']);
    expect(mulC[1].high.map((f) => f.id)).toEqual(['mul:7x6', 'mul:7x7', 'mul:7x8', 'mul:7x9', 'mul:7x10']);
    expect(tables('mul-a').map((t) => t.low[0].a)).toEqual([2, 5, 10]);
    expect(tables('mul-b').map((t) => t.low[0].a)).toEqual([3, 4]);
    expect(tables('mul-d').map((t) => t.low[0].a)).toEqual([8, 9]);
    expect(tables('div-a').map((t) => t.low[0].b)).toEqual([2, 5, 10]);
    expect(tables('div-c')[0].high.map((f) => f.id)).toEqual(['div:36/6', 'div:42/6', 'div:48/6', 'div:54/6', 'div:60/6']);
  });

  it('the core sector is one system with one fact-less planet', () => {
    const core = sectorById('core')!;
    expect(core.skill).toBe('mixed');
    expect(core.systems).toHaveLength(1);
    expect(core.systems[0].planets.map((p) => p.id)).toEqual([CORE_PLANET_ID]);
  });

  it('addition and subtraction sectors follow the revised spec and the balance rule', () => {
    const carry = (a: number, b: number) => (a % 10) + (b % 10) >= 10;
    const borrow = (a: number, b: number) => a % 10 < b % 10;
    expect(sectorFactsOf('type-1').map((f) => f.a)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const sizes = (ids: string[]) => ids.map((id) => sectorFactsOf(id).length);
    expect(sizes(['add-5', 'add-10', 'add-15', 'add-50', 'add-100'])).toEqual([12, 29, 62, 42, 42]);
    expect(sizes(['sub-5', 'sub-10', 'sub-15', 'sub-50', 'sub-100'])).toEqual([12, 29, 62, 42, 42]);
    // Every fact that is not easy stays inside the sector's ordinary ranges.
    const all = (id: string, ok: (a: number, b: number, r: number) => boolean) =>
      expect(sectorFactsOf(id).filter((f) => !isTrivial(f) && !isOperandOne(f)).every((f) => ok(f.a, f.b, f.result)), id).toBe(true);
    all('add-5', (a, b, r) => a >= 1 && b >= 1 && r >= 2 && r <= 5);
    all('add-10', (a, b, r) => a >= 2 && b >= 2 && r >= 6 && r <= 10);
    all('add-15', (a, b, r) => a >= 2 && b >= 2 && a <= 13 && b <= 13 && r >= 11 && r <= 15);
    all('add-50', (a, b, r) => a >= 6 && a <= 44 && b >= 3 && b <= 29 && r >= 16 && r <= 50);
    all('add-100', (a, b, r) => a >= 12 && a <= 88 && b >= 6 && b <= 59 && r >= 51 && r <= 100);
    all('sub-5', (a, b) => a >= 2 && a <= 5 && b >= 1 && b < a);
    all('sub-10', (a, b) => a >= 6 && a <= 10 && b >= 2 && b <= a - 2);
    all('sub-15', (a, b) => a >= 11 && a <= 15 && b >= 2 && b <= a - 2);
    all('sub-50', (a, b) => a >= 16 && a <= 50 && b >= 3 && b <= 29 && b <= a - 3);
    all('sub-100', (a, b) => a >= 51 && a <= 100 && b >= 6 && b <= 59 && b <= a - 3);
    // Easy facts keep the sum / minuend range and the operand upper bounds.
    const sumRange: Record<string, [number, number]> = {
      'add-5': [1, 5], 'add-10': [6, 10], 'add-15': [11, 15], 'add-50': [16, 50], 'add-100': [51, 100],
      'sub-5': [2, 5], 'sub-10': [6, 10], 'sub-15': [11, 15], 'sub-50': [16, 50], 'sub-100': [51, 100],
    };
    for (const [id, [lo, hi]] of Object.entries(sumRange)) {
      for (const f of sectorFactsOf(id)) {
        const v = f.op === 'add' ? f.result : f.a;
        expect(v >= lo && v <= hi, f.id).toBe(true);
        expect(f.a >= 0 && f.b >= 0 && f.result >= 0, f.id).toBe(true);
      }
    }
    for (const id of ['add-50', 'add-100']) {
      expect(sectorFactsOf(id).filter((f) => carry(f.a, f.b)).length, id).toBeGreaterThanOrEqual(21);
    }
    for (const id of ['sub-50', 'sub-100']) {
      expect(sectorFactsOf(id).filter((f) => borrow(f.a, f.b)).length, id).toBeGreaterThanOrEqual(21);
    }
    // Shuffled before chunking: a planet mixes sums instead of holding only the smallest.
    const first = factsForPlanet(planetsOfSector('add-15')[0].id).map((f) => f.result);
    expect(new Set(first).size).toBeGreaterThan(2);
  });

  it('balance rule: caps on trivial and operand-1 facts, left/right balance, one trivial per planet', () => {
    const ids = ['add-5', 'add-10', 'add-15', 'add-50', 'add-100', 'sub-5', 'sub-10', 'sub-15', 'sub-50', 'sub-100'];
    for (const id of ids) {
      const facts = sectorFactsOf(id);
      const small = id === 'add-5' || id === 'sub-5';
      const trivial = facts.filter(isTrivial);
      expect(trivial.length, id).toBeGreaterThanOrEqual(1);
      expect(trivial.length / facts.length, id).toBeLessThanOrEqual(small ? TRIVIAL_SHARE_SMALL : TRIVIAL_SHARE);
      if (!small) expect(facts.filter(isOperandOne).length / facts.length, id).toBeLessThanOrEqual(OPERAND_ONE_SHARE);
      // Balanced: left (0 + b, a − 0) and right (a + 0, a − a) differ by at most one.
      const left = trivial.filter((f) => (f.op === 'add' ? f.a === 0 : f.b === 0)).length;
      expect(Math.abs(left - (trivial.length - left)), id).toBeLessThanOrEqual(1);
      for (const p of planetsOfSector(id)) {
        expect(factsForPlanet(p.id).filter(isTrivial).length, p.id).toBeLessThanOrEqual(1);
      }
      expect(facts.some((f) => f.a === 0 && f.b === 0)).toBe(false);
    }
    expect(factById('add:0+0')).toBeUndefined();
    expect(factById('sub:0-0')).toBeUndefined();
  });

  it('chunking and grouping sizes', () => {
    expect(chunkSizes(10)).toEqual([5, 5]);
    expect(chunkSizes(21)).toEqual([6, 5, 5, 5]);
    expect(chunkSizes(30)).toEqual([6, 6, 6, 6, 6]);
    expect(chunkSizes(40)).toEqual([6, 6, 6, 6, 6, 5, 5]);
    for (let n = 5; n <= 200; n++) {
      if (n === 9) continue;               // 9 cannot be cut into chunks of 5..8
      const sizes = chunkSizes(n);
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(n);
      expect(Math.min(...sizes)).toBeGreaterThanOrEqual(5);
      expect(Math.max(...sizes)).toBeLessThanOrEqual(8);
    }
    for (let p = 3; p <= 40; p++) {
      const sizes = groupSizes(p);
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(p);
      expect(Math.min(...sizes)).toBeGreaterThanOrEqual(3);
      expect(Math.max(...sizes)).toBeLessThanOrEqual(5);
    }
    expect(groupSizes(2)).toEqual([2]);
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
    expect(factById('mul:7x8')?.planetId).toBe('mul-c.4');
    // Ids no sector can hold any more (0 + 0, and operands below the sector ranges that are not easy facts).
    for (const gone of ['add:0+0', 'sub:0-0', 'add:86+3', 'sub:21-2', 'sub:100-2', 'add:11+89']) {
      expect(factById(gone), gone).toBeUndefined();
    }
  });
});

describe('fact ids are stable (saved stats are keyed by them)', () => {
  it('pins a representative list of ids', () => {
    const pinned: Array<[string, number]> = [
      ['type:7', 7], ['type:0', 0],
      ['add:1+1', 2], ['add:2+3', 5], ['add:6+3', 9], ['add:6+7', 13], ['add:26+8', 34], ['add:24+28', 52],
      ['sub:5-4', 1], ['sub:9-4', 5], ['sub:15-8', 7], ['sub:36-9', 27], ['sub:51-19', 32],
      ['mul:7x8', 56], ['mul:2x1', 2], ['mul:10x10', 100],
      ['div:56/7', 8], ['div:100/10', 10], ['div:18/9', 2],
    ];
    for (const [id, answer] of pinned) expect(factById(id)?.answer, id).toBe(answer);
  });

  it('pins the seeded samples (the unchanged ones keep the ids they had before the galaxy rework)', () => {
    const ids = (sectorId: string) => {
      const l = sectorFactsOf(sectorId).map((f) => f.id);
      return [l[0], l[7], l[l.length - 1]];
    };
    expect(ids('type-2')).toEqual(['type:11', 'type:31', 'type:99']);
    expect(ids('type-3')).toEqual(['type:124', 'type:290', 'type:985']);
    expect(ids('add-50')).toEqual(['add:36+9', 'add:41+0', 'add:12+27']);
    expect(ids('add-100')).toEqual(['add:44+38', 'add:19+53', 'add:13+39']);
    expect(ids('sub-50')).toEqual(['sub:21-7', 'sub:33-29', 'sub:34-7']);
    expect(ids('sub-100')).toEqual(['sub:96-38', 'sub:56-49', 'sub:81-9']);
    expect(ids('neg-10')).toEqual(['add:-10+8', 'add:-5+5', 'sub:5-6']);
    expect(ids('neg-20')).toEqual(['add:-16+17', 'add:-6+19', 'sub:13--1']);
    expect(ids('miss-add')).toEqual(['miss:add:?+9=10', 'miss:add:?+6=11', 'miss:add:12+?=20']);
    expect(ids('miss-sub')).toEqual(['miss:sub:2-?=0', 'miss:sub:11-?=10', 'miss:sub:20-?=0']);
    expect(ids('miss-mul')).toEqual(['miss:mul:2x?=2', 'miss:mul:3x?=12', 'miss:mul:10x?=100']);
    expect(ids('miss-div')).toEqual(['miss:div:2/?=1', 'miss:div:18/?=6', 'miss:div:100/?=10']);
    expect(factById('add:-10+8')?.answer).toBe(-2);
    expect(factById('miss:mul:3x?=12')?.answer).toBe(4);
  });

  it('every fact id is unique across the galaxy', () => {
    const ids = allFacts().map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
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
