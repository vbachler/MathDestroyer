import { describe, expect, it } from 'vitest';
import { CORE_PLANET_ID, PLANETS, planetsOfSector } from '../src/core/content';
import { factsForPlanet } from '../src/core/facts';
import { createRng } from '../src/core/rng';
import { MAX_REVIEW_FACTS, buildWaveQueue, missionPool, reviewFacts } from '../src/core/scheduler';
import type { FactStats } from '../src/core/types';
import { NOW, stat, statsFor } from './helpers';

const queue = (planetId: string, stats: Record<string, FactStats>, opts: { count?: number; seed?: number; waveIndex?: number } = {}) =>
  buildWaveQueue({
    planetId,
    count: opts.count ?? 9,
    stats,
    now: NOW,
    rng: createRng(opts.seed ?? 1),
    waveIndex: opts.waveIndex ?? 0,
  });

/** 7 x 1..5 and 7 x 6..10. */
const MUL7_LOW = 'mul-c.3';
const MUL7_HIGH = 'mul-c.4';
/** 6 x 1..5, the other planets of the mul-c sector. */
const MUL6_LOW = 'mul-c.1';
const MUL6_HIGH = 'mul-c.2';
const ADD10 = planetsOfSector('add-10').map((p) => p.id);

describe('buildWaveQueue', () => {
  it('returns `count` facts of the planet when nothing else in the sector was seen', () => {
    const q = queue(MUL7_HIGH, statsFor([MUL7_HIGH], 2), { count: 13 });
    expect(q).toHaveLength(13);
    expect(q.every((f) => f.planetId === MUL7_HIGH)).toBe(true);
  });

  it('never repeats a fact twice in a row', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const q = queue(ADD10[0], statsFor([ADD10[0]], 1), { count: 40, seed });
      for (let i = 1; i < q.length; i++) expect(q[i].id).not.toBe(q[i - 1].id);
    }
  });

  it('is deterministic for the same rng seed', () => {
    const stats = statsFor([MUL6_LOW, MUL7_LOW], 3);
    expect(queue(MUL7_LOW, stats, { seed: 9 }).map((f) => f.id)).toEqual(queue(MUL7_LOW, stats, { seed: 9 }).map((f) => f.id));
  });

  it('introduces at most 4 new facts in the first wave and 2 more per later wave', () => {
    const pid = planetsOfSector('add-50')[0].id;          // 6 facts
    const order = factsForPlanet(pid).map((f) => f.id);
    for (let seed = 1; seed <= 20; seed++) {
      for (let w = 0; w < 3; w++) {
        const ids = new Set(queue(pid, {}, { count: 15, seed, waveIndex: w }).map((f) => f.id));
        const allowed = new Set(order.slice(0, 4 + 2 * w));
        expect(ids.size).toBeLessThanOrEqual(4 + 2 * w);
        for (const id of ids) expect(allowed.has(id)).toBe(true);
      }
    }
  });

  it('limits only never-seen facts; seen facts are always eligible', () => {
    const pid = ADD10[1];
    const stats = statsFor([pid], 2);
    const facts = factsForPlanet(pid);
    delete stats[facts[0].id];
    const ids = new Set(queue(pid, stats, { count: 200 }).map((f) => f.id));
    expect(ids.size).toBe(facts.length);
  });

  it('weights due facts above well-known ones', () => {
    const stats: Record<string, FactStats> = {};
    for (const pid of [MUL7_LOW, MUL7_HIGH]) {
      factsForPlanet(pid).forEach((f, i) => { stats[f.id] = i < 2 ? stat(2, { dueAt: NOW - 1 }) : stat(5); });
    }
    const q = queue(MUL7_HIGH, stats, { count: 3000 }).filter((f) => f.planetId === MUL7_HIGH);
    const due = q.filter((f) => f.b <= 7).length;     // 7x6, 7x7 are due; 7x8..7x10 are box 5
    expect(due / (q.length - due)).toBeGreaterThan(1.8);
  });
});

describe('missionPool', () => {
  it('is the planet facts plus up to 4 review facts from other planets of the sector', () => {
    expect(missionPool(MUL7_HIGH, {}, NOW).map((f) => f.id)).toEqual(factsForPlanet(MUL7_HIGH).map((f) => f.id));
    const stats = statsFor([MUL6_LOW, MUL6_HIGH, MUL7_LOW], 3);
    const pool = missionPool(MUL7_HIGH, stats, NOW);
    expect(pool.slice(0, 5)).toEqual(factsForPlanet(MUL7_HIGH));
    expect(pool).toHaveLength(5 + MAX_REVIEW_FACTS);
    for (const f of pool.slice(5)) expect([MUL6_LOW, MUL6_HIGH, MUL7_LOW]).toContain(f.planetId);
    // Other sectors never contribute.
    const other = statsFor([...planetsOfSector('mul-b').map((p) => p.id)], 0, { dueAt: NOW - 1 });
    expect(missionPool(MUL7_HIGH, other, NOW)).toHaveLength(5);
  });

  it('review picks due facts first (earliest first), then the weakest', () => {
    const stats: Record<string, FactStats> = {
      ...statsFor([MUL6_LOW, MUL6_HIGH, MUL7_LOW], 4),
      'mul:6x9': stat(4, { dueAt: NOW - 10 }),
      'mul:7x2': stat(5, { dueAt: NOW - 50 }),
      'mul:6x3': stat(1),
      'mul:7x4': stat(0),
      'mul:6x1': stat(2),
    };
    expect(reviewFacts(MUL7_HIGH, stats, NOW).map((f) => f.id)).toEqual(['mul:7x2', 'mul:6x9', 'mul:7x4', 'mul:6x3']);
    expect(reviewFacts('nope', stats, NOW)).toEqual([]);
  });

  it('review never includes never-seen facts', () => {
    const stats = { 'mul:6x2': stat(0, { attempts: 0 }) };
    expect(reviewFacts(MUL7_HIGH, stats, NOW)).toEqual([]);
  });

  it('core: every fact of every planet at mastery >= 0.4, else the first typing planet', () => {
    const first = planetsOfSector('type-1')[0].id;
    expect(missionPool(CORE_PLANET_ID, {}, NOW)).toEqual(factsForPlanet(first));
    const stats = { ...statsFor([ADD10[0]], 2), ...statsFor([MUL7_LOW], 1) };   // 0.4 and 0.2
    const pool = missionPool(CORE_PLANET_ID, stats, NOW);
    expect(new Set(pool.map((f) => f.planetId))).toEqual(new Set([ADD10[0]]));
    const q = queue(CORE_PLANET_ID, stats, { count: 50 });
    expect(q.every((f) => f.planetId === ADD10[0])).toBe(true);
    expect(PLANETS.some((p) => p.id === CORE_PLANET_ID)).toBe(true);
  });
});
