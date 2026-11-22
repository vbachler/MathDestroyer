import { describe, expect, it } from 'vitest';
import {
  BattleSim, DOME_X, EXPLAIN_MS, IMPACT_Y, LANE_X, MAX_ALIVE, MISSION_WAVES, SPAWN_Y, WAVE_START_DELAY_MS,
  baseSpeed, enemiesInWave, spawnIntervalMs,
} from '../src/core/battle';
import type { BattleConfig, BattleEvent, Enemy } from '../src/core/battle';
import { allFacts, factById, factsForPlanet } from '../src/core/facts';
import { isMastered } from '../src/core/mastery';
import type { FactStats } from '../src/core/types';
import { NOW, stat } from './helpers';

/** Digits 5..9 (the second planet of the type-1 sector). */
const DIGITS = 'type-1.2';

const cfg = (over: Partial<BattleConfig> = {}): BattleConfig => ({
  planetId: DIGITS,
  totalWaves: MISSION_WAVES,
  stats: {},
  modules: {},
  now: NOW,
  seed: 1,
  speedScale: 1,
  ...over,
});

function typeNumber(sim: BattleSim, n: number): void {
  for (const ch of String(Math.abs(n))) sim.typeDigit(Number(ch));
  if (n < 0) sim.toggleSign();
}

function answer(sim: BattleSim, n: number): BattleEvent[] {
  typeNumber(sim, n);
  return sim.submit();
}

function lowestEnemy(sim: BattleSim): Enemy {
  return [...sim.state.enemies].sort((a, b) => b.y - a.y)[0];
}

/** Steps until the predicate holds; returns all events. */
function runUntil(sim: BattleSim, pred: (ev: BattleEvent[]) => boolean, maxMs = 120_000, step = 16): BattleEvent[] {
  const all: BattleEvent[] = [];
  for (let t = 0; t < maxMs; t += step) {
    const ev = sim.update(step);
    all.push(...ev);
    if (pred(ev)) return all;
  }
  throw new Error('condition not reached');
}

const firstSpawn = (sim: BattleSim): Enemy => {
  const ev = runUntil(sim, (e) => e.some((x) => x.type === 'spawn'));
  const spawn = ev.find((x) => x.type === 'spawn');
  if (!spawn || spawn.type !== 'spawn') throw new Error('no spawn');
  return spawn.enemy;
};

/** Answers every enemy as soon as it appears until the wave ends. */
function clearWave(sim: BattleSim): BattleEvent[] {
  const all: BattleEvent[] = [];
  for (let i = 0; i < 20000 && sim.state.phase === 'spawning'; i++) {
    all.push(...sim.update(16));
    while (sim.state.phase === 'spawning' && sim.state.enemies.length > 0) {
      all.push(...answer(sim, lowestEnemy(sim).fact.answer));
    }
  }
  return all;
}

function wrongDigit(sim: BattleSim): number {
  const live = new Set(sim.state.enemies.map((e) => e.fact.answer));
  for (let d = 0; d <= 9; d++) if (!live.has(d)) return d;
  throw new Error('no free digit');
}

/** A sim (seed searched deterministically) whose first between-wave shop offers `upgradeId`. */
function simOffering(upgradeId: string, over: Partial<BattleConfig> = {}): BattleSim {
  for (let seed = 1; seed < 500; seed++) {
    const sim = new BattleSim(cfg({ ...over, seed }));
    clearWave(sim);
    if (sim.offers().some((o) => o.def.id === upgradeId)) return sim;
  }
  throw new Error(`no seed offers ${upgradeId}`);
}

describe('BattleSim setup', () => {
  it('starts in wave 1 with 4 domes of 2 hp, no upgrades and no shield', () => {
    const sim = new BattleSim(cfg());
    expect(sim.state.phase).toBe('spawning');
    expect(sim.state.wave).toBe(1);
    expect(sim.state.domes).toEqual([{ hp: 2, maxHp: 2 }, { hp: 2, maxHp: 2 }, { hp: 2, maxHp: 2 }, { hp: 2, maxHp: 2 }]);
    expect(sim.state.ownedUpgrades).toEqual({});
    expect(sim.state.shieldCharges).toBe(0);
    expect('energy' in sim.state).toBe(false);
  });

  it('applies the hull module', () => {
    const sim = new BattleSim(cfg({ modules: { hull: 2 } }));
    expect(sim.state.domes.every((d) => d.hp === 4 && d.maxHp === 4)).toBe(true);
  });

  it('headStart gives 1 / 2 / 3 distinct random upgrades at tier 1, chosen by the mission RNG', () => {
    for (const tier of [1, 2, 3]) {
      const seen = new Set<string>();
      for (let seed = 1; seed <= 30; seed++) {
        const sim = new BattleSim(cfg({ seed, modules: { headStart: tier } }));
        const owned = sim.state.ownedUpgrades;
        expect(Object.keys(owned)).toHaveLength(tier);
        expect(Object.values(owned).every((t) => t === 1)).toBe(true);
        expect(new BattleSim(cfg({ seed, modules: { headStart: tier } })).state.ownedUpgrades).toEqual(owned);
        Object.keys(owned).forEach((id) => seen.add(id));
      }
      expect(seen.size).toBeGreaterThan(tier);   // varies with the seed
    }
  });

  it('a head-start shield is charged in wave 1 and a head-start turret starts on cooldown', () => {
    let shieldSim: BattleSim | null = null;
    let turretSim: BattleSim | null = null;
    for (let seed = 1; seed < 200 && (!shieldSim || !turretSim); seed++) {
      const sim = new BattleSim(cfg({ seed, modules: { headStart: 1 } }));
      if (sim.state.ownedUpgrades.shield) shieldSim ??= sim;
      if (sim.state.ownedUpgrades.autoTurret) turretSim ??= sim;
    }
    expect(shieldSim?.state.shieldCharges).toBe(1);
    expect(turretSim?.state.autoTurretCooldownMs).toBe(7000);
  });

  it('spawns the first enemy after the start delay, at the top of a lane, with wave speed', () => {
    const sim = new BattleSim(cfg());
    expect(sim.update(WAVE_START_DELAY_MS - 1)).toEqual([]);
    const ev = sim.update(1);
    expect(ev).toHaveLength(1);
    const e = (ev[0] as { enemy: Enemy }).enemy;
    expect(LANE_X).toContain(e.x);
    expect(e.y).toBeCloseTo(SPAWN_Y, 0);
    expect(e.speed).toBeGreaterThanOrEqual(23 * 0.9);
    expect(e.speed).toBeLessThanOrEqual(23 * 1.1);
  });

  it('spawns 6 + 2w enemies per wave, never more than 4 alive, lanes not overlapping', () => {
    const sim = new BattleSim(cfg({ stats: Object.fromEntries(factsForPlanet(DIGITS).map((f) => [f.id, stat(2)])) }));
    let spawns = 0;
    let maxAlive = 0;
    for (let i = 0; i < 10000 && sim.state.phase !== 'waveCleared'; i++) {
      const ev = sim.update(16);
      for (const x of ev) {
        if (x.type !== 'spawn') continue;
        spawns++;
        const others = sim.state.enemies.filter((e) => e.lane === x.enemy.lane && e.id !== x.enemy.id);
        expect(others.every((o) => o.y > 200)).toBe(true);
      }
      maxAlive = Math.max(maxAlive, sim.state.enemies.length);
      if (sim.state.phase === 'explaining') sim.update(EXPLAIN_MS);
      // answer slowly: only when the cap is reached, to exercise it
      if (sim.state.enemies.length >= MAX_ALIVE) answer(sim, lowestEnemy(sim).fact.answer);
      if (sim.state.phase === 'lost') break;
    }
    expect(maxAlive).toBeLessThanOrEqual(4);
    expect(spawns).toBe(8);
  });
});

describe('BattleSim pacing', () => {
  it('wave formulas: 6 + 2w enemies, interval max(1800, 3600 - 250w) / scale, speed (20 + 3w) * scale', () => {
    expect([1, 2, 3].map((w) => enemiesInWave(w))).toEqual([8, 10, 12]);
    expect(spawnIntervalMs(1)).toBe(3350);
    expect(spawnIntervalMs(8)).toBe(1800);
    expect(spawnIntervalMs(1, 1.25)).toBe(2680);
    expect(spawnIntervalMs(1, 0.75)).toBeCloseTo(3350 / 0.75);
    expect(baseSpeed(1)).toBe(23);
    expect(baseSpeed(2, 0.75)).toBeCloseTo(19.5);
    expect(baseSpeed(1, 1.25)).toBeCloseTo(28.75);
    expect(MAX_ALIVE).toBe(4);
  });

  for (const scale of [0.75, 1, 1.25]) {
    it(`speedScale ${scale} scales enemy speed and spawn interval`, () => {
      const sim = new BattleSim(cfg({ speedScale: scale }));
      const spawns: Enemy[] = [];
      for (let i = 0; i < 2000 && spawns.length < 2; i++) {
        for (const e of sim.update(10)) if (e.type === 'spawn') spawns.push(e.enemy);
      }
      expect(spawns).toHaveLength(2);
      for (const e of spawns) {
        expect(e.speed).toBeGreaterThanOrEqual(23 * scale * 0.9 - 1e-9);
        expect(e.speed).toBeLessThanOrEqual(23 * scale * 1.1 + 1e-9);
      }
      const gap = spawns[1].spawnedAt - spawns[0].spawnedAt;
      expect(gap).toBeGreaterThanOrEqual(3350 / scale - 1e-6);
      expect(gap).toBeLessThan(3350 / scale + 10);
    });
  }

  it('pauses spawning while 4 enemies are alive', () => {
    const sim = new BattleSim(cfg({ totalWaves: 5 }));
    clearWave(sim);
    sim.nextWave();
    clearWave(sim);
    sim.nextWave();                       // wave 3: 12 enemies
    expect(sim.remainingToSpawn()).toBe(12);
    let sawCap = false;
    for (let i = 0; i < 3000 && sim.state.phase === 'spawning'; i++) {
      sim.update(16);
      expect(sim.state.enemies.length).toBeLessThanOrEqual(MAX_ALIVE);
      if (sim.state.enemies.length === MAX_ALIVE) {
        sawCap = true;
        const pending = sim.remainingToSpawn();
        sim.update(5000);                  // long enough for several intervals
        expect(sim.state.enemies.length).toBeLessThanOrEqual(MAX_ALIVE);
        if (sim.state.phase === 'spawning' && sim.state.enemies.length === MAX_ALIVE) {
          expect(sim.remainingToSpawn()).toBe(pending);
        }
        break;
      }
    }
    expect(sawCap).toBe(true);
  });

  it('falls back to speedScale 1 for a missing or invalid value', () => {
    const sim = new BattleSim(cfg({ speedScale: Number.NaN }));
    const e = firstSpawn(sim);
    expect(e.speed).toBeGreaterThanOrEqual(23 * 0.9);
    expect(e.speed).toBeLessThanOrEqual(23 * 1.1);
  });
});

describe('BattleSim answers', () => {
  it('correct fast answer: kill, 15 points, streak, recorded fast', () => {
    const sim = new BattleSim(cfg());
    const e = firstSpawn(sim);
    const ev = answer(sim, e.fact.answer);
    expect(ev[0]).toMatchObject({ type: 'kill', fast: true, byTurret: false, points: 15 });
    expect(sim.state).toMatchObject({ score: 15, streak: 1, bestStreak: 1, kills: 1, input: '' });
    expect(sim.records).toEqual([{ factId: e.fact.id, outcome: 'fast', responseMs: expect.any(Number) }]);
    expect(sim.state.enemies).toHaveLength(0);
  });

  it('correct slow answer: 10 points, recorded slow', () => {
    const sim = new BattleSim(cfg());
    const e = firstSpawn(sim);
    sim.update(3500);
    const ev = answer(sim, e.fact.answer);
    expect(ev[0]).toMatchObject({ type: 'kill', fast: false, points: 10 });
    expect(sim.records[0]).toMatchObject({ factId: e.fact.id, outcome: 'slow' });
  });

  it('adds min(streak, 20) to points and multiplies by overcharge', () => {
    const sim = new BattleSim(cfg());
    const e = firstSpawn(sim);
    sim.state.streak = 25;
    const ev = answer(sim, e.fact.answer);
    expect(ev[0]).toMatchObject({ type: 'kill', points: 35 });
  });

  it('wrong answer: streak reset, -5 score (min 0), recorded once against the lowest enemy', () => {
    const sim = new BattleSim(cfg());
    const first = firstSpawn(sim);
    answer(sim, first.fact.answer);       // +15
    const e = firstSpawn(sim);
    const ev = answer(sim, wrongDigit(sim));
    expect(ev[0]).toMatchObject({ type: 'wrong' });
    expect(sim.state).toMatchObject({ streak: 0, score: 10, wrongAnswers: 1, input: '' });
    expect(sim.records[1]).toMatchObject({ factId: e.fact.id, outcome: 'wrong' });
    answer(sim, wrongDigit(sim));
    answer(sim, wrongDigit(sim));
    expect(sim.state.score).toBe(0);
    expect(sim.state.wrongAnswers).toBe(3);
    expect(sim.records).toHaveLength(2);
  });

  it('an enemy answered wrongly and later correctly records slow, never fast', () => {
    const sim = new BattleSim(cfg());
    const e = firstSpawn(sim);
    answer(sim, wrongDigit(sim));
    const ev = answer(sim, e.fact.answer);
    expect(ev[0]).toMatchObject({ type: 'kill', fast: false, points: 10 });
    expect(sim.records.map((r) => r.outcome)).toEqual(['wrong', 'slow']);
  });

  it('FR-03: destroys the matching enemy with the greatest y', () => {
    const sim = new BattleSim(cfg());
    firstSpawn(sim);
    runUntil(sim, () => sim.state.enemies.length === 2);
    const [older, newer] = sim.state.enemies;
    newer.fact = older.fact;
    expect(older.y).toBeGreaterThan(newer.y);
    let ev = answer(sim, older.fact.answer);
    expect(ev[0]).toMatchObject({ type: 'kill', enemy: { id: older.id } });
    // and when the newer one is lower, the newer one goes first
    const sim2 = new BattleSim(cfg());
    firstSpawn(sim2);
    runUntil(sim2, () => sim2.state.enemies.length === 2);
    const [a, b] = sim2.state.enemies;
    b.fact = a.fact;
    b.y = a.y + 50;
    ev = answer(sim2, a.fact.answer);
    expect(ev[0]).toMatchObject({ type: 'kill', enemy: { id: b.id } });
  });

  it('targeting module makes more answers fast for scoring, but not for mastery', () => {
    const sim = new BattleSim(cfg({ modules: { targeting: 1 } }));
    const e = firstSpawn(sim);
    sim.update(3200);
    const ev = answer(sim, e.fact.answer);
    expect(ev[0]).toMatchObject({ type: 'kill', fast: true, points: 15 });
    expect(sim.records[0].outcome).toBe('slow');
  });
});

describe('BattleSim input', () => {
  it('accepts up to 4 digits, backspace, and ignores empty submit', () => {
    const sim = new BattleSim(cfg());
    expect(sim.submit()).toEqual([]);
    [1, 2, 3, 4, 5].forEach((d) => sim.typeDigit(d));
    expect(sim.state.input).toBe('1234');
    sim.backspace();
    expect(sim.state.input).toBe('123');
    sim.backspace(); sim.backspace(); sim.backspace(); sim.backspace();
    expect(sim.state.input).toBe('');
    sim.typeDigit(0);
    sim.typeDigit(7);
    expect(sim.state.input).toBe('7');
  });

  it('toggleSign only matters when a live enemy has a negative answer', () => {
    const sim = new BattleSim(cfg());
    const e = firstSpawn(sim);
    sim.typeDigit(5);
    sim.toggleSign();
    expect(sim.state.input).toBe('5');
    const neg = allFacts().find((f) => f.planetId.startsWith('neg-10') && f.answer < 0)!;
    e.fact = neg;
    sim.state.enemies[0].fact = neg;
    sim.toggleSign();
    expect(sim.state.input).toBe('-5');
    sim.toggleSign();
    expect(sim.state.input).toBe('5');
    sim.backspace();
    const ev = answer(sim, neg.answer);
    expect(ev[0]).toMatchObject({ type: 'kill' });
  });
});

describe('BattleSim impacts', () => {
  it('impact damages the nearest dome, resets streak, records missed and explains', () => {
    const sim = new BattleSim(cfg());
    sim.state.streak = 4;
    const ev = runUntil(sim, (e) => e.some((x) => x.type === 'impact'), 60_000, 50);
    const impact = ev.find((x) => x.type === 'impact')!;
    if (impact.type !== 'impact') throw new Error();
    const nearest = DOME_X.map((x, i) => ({ i, d: Math.abs(x - impact.enemy.x) })).sort((a, b) => a.d - b.d)[0].i;
    expect(impact.domeIndex).toBe(nearest);
    expect(impact.destroyed).toBe(false);
    expect(sim.state.domes[nearest].hp).toBe(1);
    expect(sim.state.streak).toBe(0);
    expect(sim.state.missed.map((f) => f.id)).toEqual([impact.enemy.fact.id]);
    expect(sim.records.at(-1)).toMatchObject({ factId: impact.enemy.fact.id, outcome: 'missed' });
    expect(sim.state.phase).toBe('explaining');
    expect(sim.state.explaining?.id).toBe(impact.enemy.fact.id);
    expect(ev.some((x) => x.type === 'explainStart')).toBe(true);
    expect(impact.enemy.y).toBe(IMPACT_Y);

    // frozen during the explanation: no movement, no spawns, no input
    const ys = sim.state.enemies.map((e) => e.y);
    const count = sim.state.enemies.length;
    sim.typeDigit(3);
    expect(sim.state.input).toBe('');
    expect(sim.submit()).toEqual([]);
    expect(sim.update(EXPLAIN_MS - 100)).toEqual([]);
    expect(sim.state.enemies.map((e) => e.y)).toEqual(ys);
    expect(sim.state.enemies).toHaveLength(count);
    const end = sim.update(100);
    expect(end).toContainEqual({ type: 'explainEnd' });
    expect(sim.state.phase).toBe('spawning');
    expect(sim.state.explaining).toBeNull();
  });

  it('hits the next nearest standing dome when the nearest is destroyed', () => {
    const sim = new BattleSim(cfg());
    const e = firstSpawn(sim);
    const order = DOME_X.map((x, i) => ({ i, d: Math.abs(x - e.x) })).sort((a, b) => a.d - b.d).map((o) => o.i);
    sim.state.domes[order[0]].hp = 0;
    const ev = runUntil(sim, (x) => x.some((y) => y.type === 'impact' && y.enemy.id === e.id), 60_000, 50);
    const impact = ev.find((x) => x.type === 'impact' && x.enemy.id === e.id);
    expect(impact).toMatchObject({ domeIndex: order[1] });
  });

  it('loses when no dome is standing after an impact (no explanation)', () => {
    const sim = new BattleSim(cfg());
    sim.state.domes.forEach((d) => { d.hp = 0; });
    sim.state.domes[3].hp = 1;
    const ev = runUntil(sim, (e) => e.some((x) => x.type === 'impact'), 60_000, 50);
    expect(ev).toContainEqual({ type: 'lost' });
    expect(ev.some((x) => x.type === 'explainStart')).toBe(false);
    expect(sim.state.phase).toBe('lost');
    expect(sim.update(1000)).toEqual([]);
  });

  it('shield absorbs the first impact of a wave: enemy destroyed, no hp lost, streak kept, still missed and explained', () => {
    const sim = simOffering('shield');
    expect(sim.pickUpgrade('shield')).toEqual([]);
    expect(sim.state.shieldCharges).toBe(1);
    sim.state.streak = 7;
    const hpBefore = sim.state.domes.map((d) => d.hp);
    const ev = runUntil(sim, (e) => e.some((x) => x.type === 'shieldBlock'), 120_000, 50);
    const block = ev.find((x) => x.type === 'shieldBlock')!;
    if (block.type !== 'shieldBlock') throw new Error();
    const nearest = DOME_X.map((x, i) => ({ i, d: Math.abs(x - block.enemy.x) })).sort((a, b) => a.d - b.d)[0].i;
    expect(block.domeIndex).toBe(nearest);
    expect(ev.some((x) => x.type === 'impact')).toBe(false);
    expect(sim.state.domes.map((d) => d.hp)).toEqual(hpBefore);
    expect(sim.state.streak).toBe(7);
    expect(sim.state.shieldCharges).toBe(0);
    expect(sim.state.enemies.some((e) => e.id === block.enemy.id)).toBe(false);
    expect(sim.records.at(-1)).toMatchObject({ factId: block.enemy.fact.id, outcome: 'missed' });
    expect(sim.state.missed.map((f) => f.id)).toContain(block.enemy.fact.id);
    expect(sim.state.phase).toBe('explaining');
    expect(sim.state.explaining?.id).toBe(block.enemy.fact.id);
    expect(ev).toContainEqual({ type: 'explainStart', fact: block.enemy.fact });

    // The charge is used up: the next impact in this wave does damage.
    const ev2 = runUntil(sim, (e) => e.some((x) => x.type === 'impact' || x.type === 'shieldBlock'), 120_000, 50);
    expect(ev2.some((x) => x.type === 'shieldBlock')).toBe(false);
    expect(sim.state.streak).toBe(0);

    // Refilled at the next wave start.
    for (let i = 0; i < 200 && sim.state.phase !== 'waveCleared' && sim.state.phase !== 'lost'; i++) {
      sim.update(EXPLAIN_MS);
      clearWave(sim);
    }
    expect(sim.state.phase).toBe('waveCleared');
    sim.pickUpgrade(sim.offers()[0].def.id);
    expect(sim.state.shieldCharges).toBe(sim.state.ownedUpgrades.shield);
  });

  it('repairs the most damaged dome when the streak reaches a multiple of 10', () => {
    const sim = new BattleSim(cfg());
    const e = firstSpawn(sim);
    sim.state.domes[1].hp = 1;
    sim.state.domes[2].hp = 0;
    sim.state.streak = 9;
    const ev = answer(sim, e.fact.answer);
    expect(ev).toContainEqual({ type: 'repair', domeIndex: 2 });
    expect(sim.state.domes[2].hp).toBe(1);
  });
});

describe('BattleSim waves and upgrades', () => {
  it('clears a wave, offers 3 distinct upgrades, picks one for free and continues', () => {
    const sim = new BattleSim(cfg());
    const ev = clearWave(sim);
    expect(ev.filter((x) => x.type === 'spawn')).toHaveLength(8);
    expect(ev).toContainEqual({ type: 'waveCleared', wave: 1 });
    expect(sim.state.phase).toBe('waveCleared');
    expect(sim.update(5000)).toEqual([]);
    const offers = sim.offers();
    expect(offers).toHaveLength(3);
    expect(new Set(offers.map((o) => o.def.id)).size).toBe(3);
    expect(sim.offers()).toEqual(offers);
    expect(offers.every((o) => o.nextTier === 1)).toBe(true);

    const notOffered = ['slowField', 'autoTurret', 'overcharge', 'salvage', 'repairDrone', 'shield']
      .find((id) => !offers.some((o) => o.def.id === id))!;
    expect(sim.pickUpgrade(notOffered)).toEqual([]);
    expect(sim.pickUpgrade('collector')).toEqual([]);
    expect(sim.state.phase).toBe('waveCleared');
    expect(sim.state.ownedUpgrades).toEqual({});

    expect(sim.pickUpgrade(offers[0].def.id)).toEqual([]);   // no repair drone: no events
    expect(sim.state.ownedUpgrades).toEqual({ [offers[0].def.id]: 1 });
    expect(sim.state.phase).toBe('spawning');
    expect(sim.state.wave).toBe(2);
    expect(sim.offers()).toEqual([]);
    expect(sim.pickUpgrade(offers[1].def.id)).toEqual([]);
    expect(sim.state.ownedUpgrades).toEqual({ [offers[0].def.id]: 1 });
  });

  it('pickUpgrade raises the tier of an upgrade already owned', () => {
    for (let seed = 1; seed < 300; seed++) {
      const sim = new BattleSim(cfg({ seed }));
      clearWave(sim);
      if (!sim.offers().some((o) => o.def.id === 'overcharge')) continue;
      sim.pickUpgrade('overcharge');
      clearWave(sim);
      const again = sim.offers().find((o) => o.def.id === 'overcharge');
      if (!again) continue;
      expect(again.nextTier).toBe(2);
      sim.pickUpgrade('overcharge');
      expect(sim.state.ownedUpgrades.overcharge).toBe(2);
      expect(sim.upgradeEffects().scoreMult).toBe(1.5);
      return;
    }
    throw new Error('no seed offers overcharge twice');
  });

  it('offers nothing when every upgrade is at max tier; nextWave() then continues', () => {
    const sim = new BattleSim(cfg());
    clearWave(sim);
    sim.state.ownedUpgrades = { slowField: 3, autoTurret: 3, overcharge: 3, salvage: 3, repairDrone: 3, shield: 3 };
    // Offers are computed at wave end; with everything maxed the current ones resolve to nothing.
    expect(sim.offers()).toEqual([]);
    sim.nextWave();
    expect(sim.state.phase).toBe('spawning');
    expect(sim.state.wave).toBe(2);
  });

  it('wins after the last wave', () => {
    const sim = new BattleSim(cfg({ totalWaves: 1 }));
    const ev = clearWave(sim);
    expect(ev).toContainEqual({ type: 'won' });
    expect(sim.state.phase).toBe('won');
  });

  it('slowField slows enemies spawned afterwards', () => {
    const sim = simOffering('slowField');
    sim.pickUpgrade('slowField');
    const e = firstSpawn(sim);
    expect(e.speed).toBeLessThanOrEqual(26 * 1.1 * 0.9 + 1e-9);
  });

  it('repairDrone repairs at wave start', () => {
    const sim = simOffering('repairDrone');
    sim.state.domes[0].hp = 0;
    expect(sim.pickUpgrade('repairDrone')).toEqual([{ type: 'repair', domeIndex: 0 }]);
    expect(sim.state.domes[0].hp).toBe(1);
    expect(sim.state.wave).toBe(2);
  });

  it('auto-turret fires only on mastered facts and its kills are not recorded', () => {
    const stats: Record<string, FactStats> = {};
    factsForPlanet(DIGITS).forEach((f) => { stats[f.id] = f.a < 8 ? stat(4) : stat(1); });
    const sim = simOffering('autoTurret', { stats });
    sim.pickUpgrade('autoTurret');
    expect(sim.state.autoTurretCooldownMs).toBe(7000);
    expect(sim.state.wave).toBe(2);
    const recordsBefore = sim.records.length;
    const scoreBefore = sim.state.score;
    const streakBefore = sim.state.streak;
    const events: BattleEvent[] = [];
    for (let i = 0; i < 20000 && (sim.state.phase === 'spawning' || sim.state.phase === 'explaining'); i++) {
      events.push(...sim.update(50));
    }
    const turretKills = events.filter((e) => e.type === 'kill' && e.byTurret);
    const impacts = events.filter((e) => e.type === 'impact');
    expect(turretKills.length).toBeGreaterThan(0);
    for (const k of turretKills) {
      if (k.type !== 'kill') throw new Error();
      expect(isMastered(stats[k.enemy.fact.id])).toBe(true);
      expect(k.points).toBe(5);
    }
    const newRecords = sim.records.slice(recordsBefore);
    expect(newRecords).toHaveLength(impacts.length);
    expect(newRecords.every((r) => r.outcome === 'missed')).toBe(true);
    expect(sim.state.score).toBe(scoreBefore + 5 * turretKills.length);
    expect(sim.state.streak).toBe(impacts.length > 0 ? 0 : streakBefore);
  });
});

describe('BattleSim determinism', () => {
  function script(seed: number): string {
    const stats: Record<string, FactStats> = {};
    factsForPlanet('mul-c.3').forEach((f, i) => { stats[f.id] = stat(i % 6, { dueAt: i % 2 ? NOW - 1 : NOW + 1 }); });
    const sim = new BattleSim(cfg({ planetId: 'mul-c.3', stats, seed, modules: { headStart: 2 } }));
    const log: BattleEvent[] = [];
    for (let tick = 0; tick < 6000; tick++) {
      const p = sim.state.phase;
      if (p === 'won' || p === 'lost') break;
      if (p === 'waveCleared') {
        const offers = sim.offers();
        log.push(...(offers.length > 0 ? sim.pickUpgrade(offers[tick % offers.length].def.id) : sim.nextWave()));
        continue;
      }
      log.push(...sim.update(37 + (tick % 5) * 11));
      if (sim.state.phase !== 'spawning' || sim.state.enemies.length === 0) continue;
      if (tick % 13 === 0) {
        typeNumber(sim, 1);
        log.push(...sim.submit());
      } else if (tick % 4 === 0) {
        log.push(...answer(sim, lowestEnemy(sim).fact.answer));
      }
    }
    return JSON.stringify({ state: sim.state, records: sim.records, log });
  }

  it('same config and calls give identical state, records and events', () => {
    const a = script(123);
    expect(script(123)).toBe(a);
    expect(script(124)).not.toBe(a);
    expect(JSON.parse(a).state.phase).toMatch(/won|lost/);
  });

  it('factById resolves every fact the sim can produce', () => {
    const sim = new BattleSim(cfg());
    const e = firstSpawn(sim);
    expect(factById(e.fact.id)).toEqual(e.fact);
  });
});
