import { describe, expect, it } from 'vitest';
import { CORE_PLANET_ID } from '../src/core/content';
import { sectorCategories, sectorFacts } from '../src/core/facts';
import { createRng } from '../src/core/rng';
import {
  CORE_FALLBACK_SECTOR, FIRST_WAVE_NEW_FACTS, NEW_FACTS_PER_WAVE, categoryShares, createMissionScheduler, missionSectors,
  pickCategory, playedSectors,
} from '../src/core/scheduler';
import type { MissionScheduler } from '../src/core/scheduler';
import type { FactStats, PlanetProgress } from '../src/core/types';
import { NOW, planetIds, progress, stat, statsFor } from './helpers';

const scheduler = (planetId: string, stats: Record<string, FactStats> = {}, seed = 1,
  planets: Record<string, PlanetProgress> = {}): MissionScheduler =>
  createMissionScheduler({ planetId, stats, planets, now: NOW, rng: createRng(seed) });

/** A whole 3-wave mission of 8, 10, 12 problems. */
const mission = (s: MissionScheduler) => [0, 1, 2].map((w) => s.wave(w, 8 + 2 * w));

const MUL_C = planetIds('mul-c');
const ADD_100 = planetIds('add-100');
const share = (names: string[], name: string) => names.filter((n) => n === name).length / names.length;

describe('enumerated sectors', () => {
  it('draws from the whole sector, whatever the planet', () => {
    const pool = new Set(sectorFacts('mul-c').map((f) => f.id));
    const stats = statsFor(['mul-c'], 2);
    for (const pid of MUL_C) {
      const ids = new Set(scheduler(pid, stats, 3).wave(0, 300).map((f) => f.id));
      for (const id of ids) expect(pool.has(id)).toBe(true);
      expect(ids.size).toBe(pool.size);
    }
  });

  it('never repeats a problem twice in a row, also across waves', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const q = mission(scheduler(planetIds('add-10')[0], statsFor(['add-10'], 1), seed)).flat();
      for (let i = 1; i < q.length; i++) expect(q[i].id).not.toBe(q[i - 1].id);
    }
  });

  it('introduces at most 6 new facts in the first wave and 3 more per later wave, in a random order', () => {
    const firstSets = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const s = scheduler(planetIds('add-15')[0], {}, seed);
      const opened = new Set<string>();
      for (let w = 0; w < 3; w++) {
        const ids = s.wave(w, 30).map((f) => f.id);
        if (w === 0) firstSets.add([...new Set(ids)].sort().join());
        ids.forEach((id) => opened.add(id));
        // Everything seen in waves 0..w together: at most 6 + 3w different new facts.
        expect(opened.size).toBeLessThanOrEqual(FIRST_WAVE_NEW_FACTS + NEW_FACTS_PER_WAVE * w);
      }
    }
    expect(firstSets.size).toBeGreaterThan(5);   // not a fixed prefix: different missions start differently
  });

  it('first mission at type-1 (fresh save, 30 spawns): at least 9 of the 10 digits, no immediate repeats', () => {
    expect([FIRST_WAVE_NEW_FACTS, NEW_FACTS_PER_WAVE]).toEqual([6, 3]);
    for (let seed = 1; seed <= 200; seed++) {
      const q = mission(scheduler(planetIds('type-1')[0], {}, seed)).flat();
      expect(q).toHaveLength(30);
      expect(new Set(q.map((f) => f.id)).size, `seed ${seed}`).toBeGreaterThanOrEqual(9);
      for (let i = 1; i < q.length; i++) expect(q[i].id).not.toBe(q[i - 1].id);
    }
  });

  it('limits only never-seen facts; seen facts are always eligible', () => {
    const stats = statsFor(['add-10'], 2);
    delete stats[sectorFacts('add-10')[0].id];
    const ids = new Set(scheduler(planetIds('add-10')[1], stats).wave(0, 600).map((f) => f.id));
    expect(ids.size).toBe(sectorFacts('add-10').length);
  });

  it('weights due facts above well-known ones', () => {
    const stats: Record<string, FactStats> = {};
    for (const f of sectorFacts('mul-c')) stats[f.id] = f.b <= 5 ? stat(2, { dueAt: NOW - 1 }) : stat(5);
    const q = scheduler(MUL_C[0], stats).wave(0, 4000);
    const due = q.filter((f) => f.b <= 5).length;
    expect(due / (q.length - due)).toBeGreaterThan(3);   // weights 4 : 1
  });
});

describe('generated sectors', () => {
  it('waves hold random problems of the sector categories, statId per category', () => {
    const cats = new Set(sectorCategories('add-100').map((c) => `cat:add-100:${c}`));
    const q = mission(scheduler(ADD_100[0])).flat();
    expect(q).toHaveLength(30);
    for (const f of q) {
      expect(cats.has(f.statId)).toBe(true);
      expect(f.result >= 51 && f.result <= 100).toBe(true);
    }
    expect(new Set(q.map((f) => f.id)).size).toBeGreaterThan(25);
    for (let i = 1; i < q.length; i++) expect(q[i].id).not.toBe(q[i - 1].id);
  });

  it('category shares honour the Balance rule as probabilities (2000 draws)', () => {
    const cases: Array<[string, string]> = [['add-50', 'carry'], ['add-100', 'carry'], ['sub-50', 'borrow'], ['sub-100', 'borrow']];
    for (const [sectorId, hard] of cases) {
      const soft = hard === 'carry' ? 'nocarry' : 'noborrow';
      // Fresh player, and a player whose easy category is weak and due while the hard one is mastered.
      const adverse = {
        [`cat:${sectorId}:easy`]: stat(0, { dueAt: NOW - 1 }),
        [`cat:${sectorId}:${soft}`]: stat(0, { dueAt: NOW - 1 }),
        [`cat:${sectorId}:${hard}`]: stat(5),
      };
      for (const stats of [{}, adverse]) {
        const rng = createRng(17);
        const names = Array.from({ length: 2000 }, () => pickCategory(sectorId, stats, NOW, rng));
        expect(share(names, 'easy'), sectorId).toBeLessThanOrEqual(0.12);
        expect(share(names, hard), sectorId).toBeGreaterThanOrEqual(0.45);
        const p = categoryShares(sectorId, stats, NOW);
        expect(p.reduce((sum, x) => sum + x.p, 0)).toBeCloseTo(1, 9);
        expect(p.find((x) => x.name === 'easy')!.p).toBeLessThanOrEqual(0.1 + 1e-9);
        expect(p.find((x) => x.name === hard)!.p).toBeGreaterThanOrEqual(0.5 - 1e-9);
      }
    }
  });

  it('weak and due categories come up more often', () => {
    const rng = createRng(3);
    const draw = (stats: Record<string, FactStats>) => Array.from({ length: 3000 }, () => pickCategory('neg-10', stats, NOW, rng));
    const base = share(draw({}), 'subNeg');
    const weak = share(draw({ 'cat:neg-10:subNeg': stat(0, { dueAt: NOW - 1 }), 'cat:neg-10:addMixed': stat(5),
      'cat:neg-10:addNegNeg': stat(5), 'cat:neg-10:subCross': stat(5) }), 'subNeg');
    expect(weak).toBeGreaterThan(base * 2);
    const typing = categoryShares('type-3', {}, NOW).map((x) => x.p);
    expect(typing).toEqual([0.4, 0.2, 0.4].map((x) => expect.closeTo(x, 9)));
  });
});

describe('determinism and variety', () => {
  it('the same seed gives the same mission, other seeds other content', () => {
    for (const pid of [ADD_100[2], planetIds('sub-50')[0], MUL_C[0], CORE_PLANET_ID]) {
      const ids = (seed: number) => mission(scheduler(pid, statsFor(['mul-c', 'add-10'], 2), seed)).flat().map((f) => f.id);
      expect(ids(42)).toEqual(ids(42));
      expect(ids(42)).not.toEqual(ids(43));
    }
  });

  it('replacement avoids the excluded problems', () => {
    const s = scheduler(planetIds('type-1')[0], statsFor(['type-1'], 3));
    const exclude = new Set(['type:0', 'type:1', 'type:2', 'type:3', 'type:4', 'type:5', 'type:6', 'type:7', 'type:8']);
    for (let i = 0; i < 20; i++) expect(s.replacement(0, exclude)?.id).toBe('type:9');
    const all = new Set(sectorFacts('type-1').map((f) => f.id));
    expect(s.replacement(0, all)).toBeNull();
    const g = scheduler(ADD_100[0]);
    const first = g.wave(0, 1)[0];
    for (let i = 0; i < 50; i++) expect(g.replacement(0, new Set([first.id]))?.id).not.toBe(first.id);
  });
});

describe('mission sectors and the core pool', () => {
  it('a planet draws from its own sector; an unknown planet from nothing', () => {
    expect(missionSectors(ADD_100[3], { stats: {}, planets: {} })).toEqual(['add-100']);
    expect(missionSectors('nope', { stats: {}, planets: {} })).toEqual([]);
    expect(scheduler('nope').wave(0, 5)).toEqual([]);
  });

  it('core: every played sector (a stat present, or a planet won), else type-1', () => {
    expect(CORE_FALLBACK_SECTOR).toBe('type-1');
    expect(missionSectors(CORE_PLANET_ID, { stats: {}, planets: {} })).toEqual(['type-1']);
    const stats = { 'mul:7x8': stat(1), 'cat:neg-20:subNeg': stat(0, { attempts: 1 }), 'add:86+3': stat(4), junk: stat(2) };
    const planets = { [planetIds('sub-15')[2]]: progress(0, { wins: 1 }), [planetIds('div-a')[0]]: progress(0, { wins: 0 }),
      [CORE_PLANET_ID]: progress(2) };
    expect(playedSectors({ stats, planets })).toEqual(['sub-15', 'mul-c', 'neg-20']);
    expect(missionSectors(CORE_PLANET_ID, { stats, planets })).toEqual(['sub-15', 'mul-c', 'neg-20']);
    const q = createMissionScheduler({ planetId: CORE_PLANET_ID, stats, planets, now: NOW, rng: createRng(5) }).wave(2, 300);
    const from = new Set(q.map((f) => (f.statId.startsWith('cat:neg-20') ? 'neg-20' : f.op === 'mul' ? 'mul-c' : f.op === 'sub' ? 'sub-15' : '?')));
    expect(from).toEqual(new Set(['sub-15', 'mul-c', 'neg-20']));
    const fallback = scheduler(CORE_PLANET_ID).wave(0, 40);
    expect(fallback.every((f) => f.op === 'type' && f.a <= 9)).toBe(true);
  });
});
