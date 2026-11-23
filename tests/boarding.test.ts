import { describe, expect, it } from 'vitest';
import {
  APPROACH_MS, BOARDING_CRAWLERS, BOARDING_FIRST_SPAWN_MS, BOARDING_MAX_ALIVE, BOARDING_MAX_BITES,
  BOARDING_SPAWN_MS, BoardingSim, CRAWLER_KINDS, CRAWLER_SPEED, LANE_GAP_Z, boardingMaxAlive,
} from '../src/core/boarding';
import type { BoardingEvent, Crawler } from '../src/core/boarding';
import { makeFact } from '../src/core/factgen';
import { sectorFacts } from '../src/core/facts';
import type { Fact } from '../src/core/types';

/** Digits 0..7: eight problems with distinct answers. */
const DIGITS: Fact[] = sectorFacts('type-1').slice(0, BOARDING_CRAWLERS);

const make = (over: { facts?: Fact[]; seed?: number; speedScale?: number; density?: number } = {}): BoardingSim =>
  new BoardingSim({ facts: DIGITS, seed: 1, speedScale: 1, ...over });

function answer(sim: BoardingSim, n: number): BoardingEvent[] {
  for (const ch of String(Math.abs(n))) sim.typeDigit(Number(ch));
  if (n < 0) sim.toggleSign();
  return sim.submit();
}

const nearest = (sim: BoardingSim): Crawler => [...sim.state.crawlers].sort((a, b) => a.z - b.z)[0];

function runUntil(sim: BoardingSim, pred: (ev: BoardingEvent[]) => boolean, maxMs = 120_000, step = 16): BoardingEvent[] {
  const all: BoardingEvent[] = [];
  for (let t = 0; t < maxMs; t += step) {
    const ev = sim.step(step);
    all.push(...ev);
    if (pred(ev)) return all;
  }
  throw new Error('condition not reached');
}

const firstSpawn = (sim: BoardingSim): Crawler => {
  const ev = runUntil(sim, (e) => e.some((x) => x.type === 'spawn'));
  const s = ev.find((x) => x.type === 'spawn');
  if (!s || s.type !== 'spawn') throw new Error('no spawn');
  return s.crawler;
};

function wrongDigit(sim: BoardingSim): number {
  const live = new Set(sim.state.crawlers.map((c) => c.fact.answer));
  for (let d = 0; d <= 9; d++) if (!live.has(d)) return d;
  throw new Error('no free digit');
}

describe('BoardingSim setup and pacing', () => {
  it('constants', () => {
    expect(CRAWLER_SPEED).toEqual({
      scorpion: 1, spider: 1.2, crab: 0.85, beetle: 1, stalker: 1.15, drifter: 0.9, wraith: 0.8,
    });
    expect([BOARDING_CRAWLERS, BOARDING_MAX_ALIVE, BOARDING_MAX_BITES]).toEqual([8, 3, 3]);
    expect([APPROACH_MS, BOARDING_SPAWN_MS, BOARDING_FIRST_SPAWN_MS]).toEqual([11000, 2600, 1200]);
  });

  it('starts fighting with every problem waiting', () => {
    const sim = make();
    expect(sim.state).toEqual({
      phase: 'fighting', timeMs: 0, crawlers: [], input: '', bites: 0, maxBites: 3, remaining: 8, kills: 0,
    });
    expect(sim.records).toEqual([]);
  });

  for (const scale of [0.5, 0.75, 1, 1.25]) {
    it(`first crawler after 1200 ms at the far door, then every 2600 / ${scale} ms, speed by kind`, () => {
      const sim = make({ speedScale: scale });
      expect(sim.step(BOARDING_FIRST_SPAWN_MS - 1)).toEqual([]);
      const ev = sim.step(1);
      expect(ev).toHaveLength(1);
      const c = (ev[0] as { crawler: Crawler }).crawler;
      expect(c).toMatchObject({ id: 1, fact: DIGITS[0], spawnedAt: BOARDING_FIRST_SPAWN_MS });
      expect(c.z).toBeCloseTo(1 - c.speed / 1000, 9);   // spawned at 1, then moved for 1 ms
      expect([-1, 0, 1]).toContain(c.lane);
      expect(c.speed).toBeCloseTo((CRAWLER_SPEED[c.kind] * scale * 1000) / APPROACH_MS, 9);
      expect(sim.state.remaining).toBe(7);
      const interval = BOARDING_SPAWN_MS / scale;
      expect(sim.step(interval - 10).some((x) => x.type === 'spawn')).toBe(false);
      const next = sim.step(10).find((x) => x.type === 'spawn');
      expect(next).toMatchObject({ crawler: { id: 2, fact: DIGITS[1] } });
    });
  }

  it('never more than 3 alive; spawning waits at the cap', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const sim = make({ seed });
      let maxAlive = 0;
      let spawns = 0;
      for (let i = 0; i < 5000 && sim.state.phase === 'fighting'; i++) {
        for (const e of sim.step(16)) if (e.type === 'spawn') spawns++;
        maxAlive = Math.max(maxAlive, sim.state.crawlers.length);
        expect(sim.state.crawlers.length).toBeLessThanOrEqual(BOARDING_MAX_ALIVE);
        expect(spawns + sim.state.remaining).toBe(BOARDING_CRAWLERS);
        // answer slowly: only at the cap
        if (sim.state.crawlers.length === BOARDING_MAX_ALIVE) answer(sim, nearest(sim).fact.answer);
      }
      expect(maxAlive).toBe(BOARDING_MAX_ALIVE);
      expect(spawns).toBe(BOARDING_CRAWLERS);
      expect(sim.state.phase).toBe('repelled');
    }
  });

  it('density: max alive 2 below 1, otherwise 3', () => {
    expect([0.5, 0.75, 1, 1.25].map((d) => boardingMaxAlive(d))).toEqual([2, 2, 3, 3]);
    expect(boardingMaxAlive()).toBe(BOARDING_MAX_ALIVE);
  });

  for (const density of [0.5, 0.75, 1, 1.25]) {
    for (const scale of [0.5, 1]) {
      it(`density ${density}, speed ${scale}: spawn every 2600 / (speed * density) ms`, () => {
        const sim = make({ density, speedScale: scale });
        expect(sim.step(BOARDING_FIRST_SPAWN_MS).some((x) => x.type === 'spawn')).toBe(true);
        const interval = BOARDING_SPAWN_MS / scale / density;
        expect(sim.step(interval - 10).some((x) => x.type === 'spawn')).toBe(false);
        expect(sim.step(10).find((x) => x.type === 'spawn')).toMatchObject({ crawler: { id: 2 } });
      });
    }

    it(`density ${density}: never more than ${boardingMaxAlive(density)} alive, all 8 crawlers come`, () => {
      const cap = boardingMaxAlive(density);
      for (let seed = 1; seed <= 10; seed++) {
        const sim = make({ seed, density });
        let peak = 0;
        let spawns = 0;
        for (let i = 0; i < 10000 && sim.state.phase === 'fighting'; i++) {
          for (const e of sim.step(16)) if (e.type === 'spawn') spawns++;
          expect(sim.state.crawlers.length).toBeLessThanOrEqual(cap);
          peak = Math.max(peak, sim.state.crawlers.length);
          if (sim.state.crawlers.length === cap) answer(sim, nearest(sim).fact.answer);
        }
        expect(peak).toBe(cap);
        expect(spawns).toBe(BOARDING_CRAWLERS);
        expect(sim.state.phase).toBe('repelled');
      }
    });
  }

  it('density: an invalid value falls back to 1', () => {
    for (const density of [Number.NaN, 0, -2]) {
      const sim = make({ density });
      sim.step(BOARDING_FIRST_SPAWN_MS);
      expect(sim.step(BOARDING_SPAWN_MS).some((x) => x.type === 'spawn')).toBe(true);
    }
  });

  it('uses every kind and every lane over a few seeds', () => {
    const kinds = new Map<string, number>();
    const lanes = new Set<number>();
    for (let seed = 1; seed <= 60; seed++) {
      const sim = make({ seed });
      for (let i = 0; i < 5000 && sim.state.phase === 'fighting'; i++) {
        for (const e of sim.step(16)) {
          if (e.type !== 'spawn') continue;
          kinds.set(e.crawler.kind, (kinds.get(e.crawler.kind) ?? 0) + 1);
          lanes.add(e.crawler.lane);
        }
        if (sim.state.crawlers.length === BOARDING_MAX_ALIVE) answer(sim, nearest(sim).fact.answer);
      }
    }
    expect([...kinds.keys()].sort()).toEqual([...CRAWLER_KINDS].sort());
    expect(lanes.size).toBe(3);
    // Equally likely: every kind near 1/7 of the spawns.
    const total = [...kinds.values()].reduce((a, b) => a + b, 0);
    for (const n of kinds.values()) expect(Math.abs(n / total - 1 / CRAWLER_KINDS.length)).toBeLessThan(0.06);
  });

  it('has seven kinds', () => {
    expect(CRAWLER_KINDS).toEqual(['scorpion', 'spider', 'crab', 'beetle', 'stalker', 'drifter', 'wraith']);
  });

  it('lane spacing: two crawlers on one lane are never closer than 0.25 in z', () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const scale of [0.75, 1.25]) {
        // more problems than a boarding has, and nobody answers until the cap, to crowd the lanes
        const sim = make({ seed, speedScale: scale, facts: [...DIGITS, ...DIGITS] });
        for (let i = 0; i < 8000 && sim.state.phase === 'fighting'; i++) {
          sim.step(16);
          const cs = sim.state.crawlers;
          for (const a of cs) for (const b of cs) {
            if (a.id < b.id && a.lane === b.lane) expect(Math.abs(a.z - b.z)).toBeGreaterThanOrEqual(LANE_GAP_Z - 1e-9);
          }
          if (i % 200 === 0 && cs.length > 0) answer(sim, nearest(sim).fact.answer);
        }
      }
    }
  });
});

describe('BoardingSim answers', () => {
  it('a fast correct answer kills the crawler and records fast by statId', () => {
    const sim = make();
    const c = firstSpawn(sim);
    sim.step(500);
    const ev = answer(sim, c.fact.answer);
    expect(ev).toEqual([{ type: 'kill', crawler: c, fast: true }]);
    expect(sim.state).toMatchObject({ kills: 1, crawlers: [], input: '' });
    expect(sim.records).toEqual([{ factId: c.fact.statId, outcome: 'fast', responseMs: 500 }]);
  });

  it('a slow correct answer is recorded slow', () => {
    const sim = make();
    const c = firstSpawn(sim);
    sim.step(3500);
    expect(answer(sim, c.fact.answer)[0]).toMatchObject({ type: 'kill', fast: false });
    expect(sim.records[0]).toMatchObject({ outcome: 'slow' });
  });

  it('kills the nearest (smallest z) crawler whose answer matches', () => {
    const sim = make();
    firstSpawn(sim);
    runUntil(sim, () => sim.state.crawlers.length === 2);
    const [older, newer] = sim.state.crawlers;
    newer.fact = makeFact('add', 0, older.fact.answer);
    expect(older.z).toBeLessThan(newer.z);
    expect(answer(sim, older.fact.answer)[0]).toMatchObject({ type: 'kill', crawler: { id: older.id } });

    const sim2 = make();
    firstSpawn(sim2);
    runUntil(sim2, () => sim2.state.crawlers.length === 2);
    const [a, b] = sim2.state.crawlers;
    b.fact = makeFact('add', 0, a.fact.answer);
    b.z = a.z - 0.1;
    expect(answer(sim2, a.fact.answer)[0]).toMatchObject({ type: 'kill', crawler: { id: b.id } });
  });

  it('a wrong answer misses: nothing else changes; recorded once against the nearest; a later kill is slow', () => {
    const sim = make();
    const c = firstSpawn(sim);
    const before = JSON.stringify(sim.state.crawlers);
    const typed = wrongDigit(sim);
    expect(answer(sim, typed)).toEqual([{ type: 'wrong', typed }]);
    expect(JSON.stringify(sim.state.crawlers)).toBe(before);
    expect(sim.state).toMatchObject({ kills: 0, bites: 0, input: '' });
    answer(sim, wrongDigit(sim));
    expect(sim.records).toEqual([{ factId: c.fact.statId, outcome: 'wrong', responseMs: 0 }]);
    expect(answer(sim, c.fact.answer)[0]).toMatchObject({ type: 'kill', fast: false });
    expect(sim.records.map((r) => r.outcome)).toEqual(['wrong', 'slow']);
  });

  it('input: up to 4 digits, backspace, empty submit is a no-op, sign only with a negative answer', () => {
    const sim = make();
    expect(sim.submit()).toEqual([]);
    [1, 2, 3, 4, 5].forEach((d) => sim.typeDigit(d));
    expect(sim.state.input).toBe('1234');
    sim.backspace();
    expect(sim.state.input).toBe('123');
    sim.toggleSign();
    expect(sim.state.input).toBe('123');
    const c = firstSpawn(sim);
    c.fact = makeFact('sub', 3, 7);
    sim.toggleSign();
    expect(sim.state.input).toBe('-123');
    sim.backspace(); sim.backspace(); sim.backspace();
    sim.typeDigit(4);
    expect(sim.submit()[0]).toMatchObject({ type: 'kill', crawler: { id: c.id } });
  });
});

describe('BoardingSim bites, overrun and repelled', () => {
  it('a crawler reaching the turret bites and is recorded missed; 3 bites overrun', () => {
    const sim = make();
    const ev = runUntil(sim, (e) => e.some((x) => x.type === 'overrun'));
    const bites = ev.filter((x) => x.type === 'bite');
    expect(bites).toHaveLength(BOARDING_MAX_BITES);
    expect(ev.at(-1)).toEqual({ type: 'overrun' });
    expect(sim.state).toMatchObject({ phase: 'overrun', bites: 3 });
    for (const b of bites) {
      if (b.type !== 'bite') throw new Error();
      expect(b.crawler.z).toBe(0);
      expect(sim.state.crawlers).not.toContain(b.crawler);
      const expectedMs = APPROACH_MS / CRAWLER_SPEED[b.crawler.kind];
      const rec = sim.records.find((r) => r.factId === b.crawler.fact.statId);
      expect(rec?.outcome).toBe('missed');
      expect(Math.abs((rec?.responseMs ?? 0) - expectedMs)).toBeLessThanOrEqual(16);
    }
    // frozen afterwards
    const frozen = JSON.stringify(sim.state);
    expect(sim.step(10_000)).toEqual([]);
    sim.typeDigit(1);
    expect(sim.submit()).toEqual([]);
    expect(JSON.stringify(sim.state)).toBe(frozen);
  });

  it('one bite does not end the fight', () => {
    const sim = make();
    const ev = runUntil(sim, (e) => e.some((x) => x.type === 'bite'));
    expect(ev.filter((x) => x.type === 'bite')).toHaveLength(1);
    expect(sim.state).toMatchObject({ phase: 'fighting', bites: 1 });
  });

  it('every crawler destroyed: repelled (from submit), then frozen', () => {
    const sim = make();
    const all: BoardingEvent[] = [];
    for (let i = 0; i < 10_000 && sim.state.phase === 'fighting'; i++) {
      all.push(...sim.step(16));
      while (sim.state.phase === 'fighting' && sim.state.crawlers.length > 0) all.push(...answer(sim, nearest(sim).fact.answer));
    }
    expect(sim.state).toMatchObject({ phase: 'repelled', kills: 8, bites: 0, remaining: 0, crawlers: [] });
    expect(all.at(-1)).toEqual({ type: 'repelled' });
    expect(all.filter((x) => x.type === 'kill')).toHaveLength(8);
    expect(sim.records.map((r) => r.factId)).toEqual(DIGITS.map((f) => f.statId));
    expect(sim.records.every((r) => r.outcome === 'fast')).toBe(true);
    expect(sim.step(5000)).toEqual([]);
  });

  it('repelled with bites below the limit', () => {
    const sim = make({ facts: DIGITS.slice(0, 2) });
    runUntil(sim, (e) => e.some((x) => x.type === 'bite'));
    for (let i = 0; i < 10_000 && sim.state.phase === 'fighting'; i++) {
      sim.step(16);
      if (sim.state.crawlers.length > 0) answer(sim, nearest(sim).fact.answer);
    }
    expect(sim.state).toMatchObject({ phase: 'repelled', bites: 1, kills: 1 });
  });

  it('no problems: repelled at once', () => {
    const sim = make({ facts: [] });
    expect(sim.step(16)).toEqual([{ type: 'repelled' }]);
  });
});

describe('BoardingSim determinism', () => {
  function script(seed: number, speedScale = 1): string {
    const sim = make({ seed, speedScale });
    const log: BoardingEvent[] = [];
    for (let tick = 0; tick < 4000 && sim.state.phase === 'fighting'; tick++) {
      log.push(...sim.step(23 + (tick % 7) * 9));
      if (sim.state.crawlers.length === 0) continue;
      if (tick % 31 === 0) log.push(...answer(sim, wrongDigit(sim)));
      else if (tick % 47 === 0) log.push(...answer(sim, nearest(sim).fact.answer));
    }
    return JSON.stringify({ state: sim.state, records: sim.records, log });
  }

  it('same config and calls give the same result; another seed differs', () => {
    for (const scale of [0.75, 1, 1.25]) {
      const a = script(5, scale);
      expect(script(5, scale)).toBe(a);
      expect(script(6, scale)).not.toBe(a);
      expect(JSON.parse(a).state.phase).toMatch(/repelled|overrun/);
    }
  });

  it('step() clamps negative time and sub-steps long frames', () => {
    const a = make();
    expect(a.step(-500)).toEqual([]);
    expect(a.state.timeMs).toBe(0);
    const b = make();
    a.step(4000);
    for (let i = 0; i < 80; i++) b.step(50);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
  });

  it('falls back to speedScale 1 for an invalid value', () => {
    const c = firstSpawn(make({ speedScale: Number.NaN }));
    expect(c.speed).toBeCloseTo((CRAWLER_SPEED[c.kind] * 1000) / APPROACH_MS, 9);
  });
});
