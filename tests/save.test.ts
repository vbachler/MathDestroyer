import { describe, expect, it } from 'vitest';
import { CORE_PLANET_ID, PLANETS, SECTORS, planetsOfSector } from '../src/core/content';
import { planetHold, sectorMastery, underAttack } from '../src/core/galaxy';
import { BOX_INTERVAL_MS, dueFacts, planetMastery, skillMastery } from '../src/core/mastery';
import { createRng } from '../src/core/rng';
import { buildWaveQueue, missionPool } from '../src/core/scheduler';
import { callFor, sectorCalls } from '../src/core/story';
import { SAVE_KEY, applyMission, defaultLocation, defaultSave, loadSave, migrate, writeSave } from '../src/core/save';
import type { StorageAdapter } from '../src/core/save';
import { NOW, stat } from './helpers';

function memory(initial?: string): StorageAdapter & { data: Map<string, string> } {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(SAVE_KEY, initial);
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
}

describe('save', () => {
  it('defaultSave is Croatian, empty and version 1', () => {
    const s = defaultSave();
    expect(s.version).toBe(1);
    expect(s.locale).toBe('hr');
    expect(s.credits).toBe(0);
    expect(s.stats).toEqual({});
    expect('unlockAll' in s.settings).toBe(false);
    expect(s.location).toEqual({ sectorId: 'type-1', systemId: 'type-1.s1' });
    expect(s.settings.gameSpeed).toBe(1);
    expect(s.totals).toEqual({ missions: 0, wins: 0, bestScore: {} });
    expect(s.story).toEqual({ seen: [] });
    expect(defaultSave()).not.toBe(defaultSave());
  });

  it('loadSave returns defaults for missing data, corrupt JSON, wrong shapes and throwing storage', () => {
    expect(loadSave(memory())).toEqual(defaultSave());
    expect(loadSave(memory('{not json'))).toEqual(defaultSave());
    expect(loadSave(memory('null'))).toEqual(defaultSave());
    expect(loadSave(memory('[1,2]'))).toEqual(defaultSave());
    expect(loadSave(memory('{"version":2}'))).toEqual(defaultSave());
    const throwing: StorageAdapter = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    };
    expect(loadSave(throwing)).toEqual(defaultSave());
  });

  it('writeSave and loadSave round-trip', () => {
    const store = memory();
    const s = { ...defaultSave(), locale: 'en' as const, credits: 42, stats: { 'mul:7x8': stat(3) } };
    writeSave(store, s);
    expect(store.data.has(SAVE_KEY)).toBe(true);
    expect(loadSave(store)).toEqual(s);
  });

  it('migrate keeps valid fields and repairs invalid ones', () => {
    const m = migrate({
      version: 1,
      locale: 'de',
      credits: 'lots',
      modules: { hull: 2, bad: 'x' },
      stats: { 'mul:7x8': { box: 9, attempts: 2 }, junk: 5 },
      settings: { sfxVolume: 3, unlockAll: true },
    });
    expect(m.locale).toBe('hr');
    expect(m.credits).toBe(0);
    expect(m.modules).toEqual({ hull: 2 });
    expect(m.stats).toEqual({ 'mul:7x8': { box: 5, attempts: 2, correct: 0, avgMs: 0, lastSeen: 0, dueAt: 0 } });
    expect(m.settings).toEqual({ sfxVolume: 1, musicVolume: 0.6, keypadAlwaysVisible: false, gameSpeed: 1 });
    expect(m.totals).toEqual({ missions: 0, wins: 0, bestScore: {} });
  });

  it('gameSpeed: filled for older saves, valid values kept, others reset to 1', () => {
    const old = { ...defaultSave(), settings: { sfxVolume: 0.5, musicVolume: 0.5, unlockAll: false, keypadAlwaysVisible: true } };
    const loaded = loadSave(memory(JSON.stringify(old)));
    expect(loaded.settings.gameSpeed).toBe(1);
    expect(loaded.settings.keypadAlwaysVisible).toBe(true);
    for (const v of [0.75, 1, 1.25]) {
      expect(migrate({ version: 1, settings: { gameSpeed: v } }).settings.gameSpeed).toBe(v);
    }
    for (const v of [0.5, 2, '1', null, Number.NaN]) {
      expect(migrate({ version: 1, settings: { gameSpeed: v } }).settings.gameSpeed).toBe(1);
    }
    const store = memory();
    writeSave(store, { ...defaultSave(), settings: { ...defaultSave().settings, gameSpeed: 1.25 } });
    expect(loadSave(store).settings.gameSpeed).toBe(1.25);
  });

  it('drops the removed reactor module from older saves and keeps the others', () => {
    const old = { ...defaultSave(), modules: { hull: 1, reactor: 3, targeting: 2 } };
    expect(loadSave(memory(JSON.stringify(old))).modules).toEqual({ hull: 1, targeting: 2 });
  });

  it('story.seen: filled for older saves, keeps distinct strings, repairs bad shapes', () => {
    const { story: _drop, ...old } = defaultSave();
    expect(loadSave(memory(JSON.stringify(old))).story).toEqual({ seen: [] });
    expect(migrate({ version: 1, story: { seen: ['typing', 'typing', 3, null, 'addition'] } }).story)
      .toEqual({ seen: ['typing', 'addition'] });
    for (const bad of [null, 'x', [], { seen: 'typing' }]) {
      expect(migrate({ version: 1, story: bad }).story).toEqual({ seen: [] });
    }
    const store = memory();
    writeSave(store, { ...defaultSave(), story: { seen: ['typing'] } });
    expect(loadSave(store).story.seen).toEqual(['typing']);
  });

  it('applyMission applies records, credits and totals without mutating the input', () => {
    const save = { ...defaultSave(), credits: 10, stats: { 'mul:7x8': stat(2) } };
    const frozen = JSON.stringify(save);
    const after = applyMission(save, {
      planetId: 'mul-c.4',
      records: [
        { factId: 'mul:7x8', outcome: 'fast', responseMs: 1500 },
        { factId: 'mul:7x9', outcome: 'wrong', responseMs: 4000 },
        { factId: 'mul:7x9', outcome: 'slow', responseMs: 6000 },
        { factId: 'mul:7x3', outcome: 'missed', responseMs: 9000 },
      ],
      credits: 55,
      score: 300,
      won: true,
      now: NOW,
    });
    expect(JSON.stringify(save)).toBe(frozen);
    expect(after.credits).toBe(65);
    // stat(2) is not due yet, so a fast answer does not promote it
    expect(after.stats['mul:7x8'].box).toBe(2);
    expect(after.stats['mul:7x8'].dueAt).toBe(save.stats['mul:7x8'].dueAt);
    expect(after.stats['mul:7x9']).toMatchObject({ box: 1, attempts: 2, correct: 1, avgMs: 6000 });
    expect(after.stats['mul:7x9'].dueAt).toBe(NOW + BOX_INTERVAL_MS[1]);
    expect(after.stats['mul:7x3']).toMatchObject({ box: 0, attempts: 1, correct: 0 });
    expect(after.totals).toEqual({ missions: 1, wins: 1, bestScore: { 'mul-c.4': 300 } });
    expect(after.location).toEqual(save.location);
    expect(after.location).not.toBe(save.location);
    expect(after.story).toEqual(save.story);
    expect(after.story).not.toBe(save.story);

    const again = applyMission(after, { planetId: 'mul-c.4', records: [], credits: 0, score: 100, won: false, now: NOW });
    expect(again.totals).toEqual({ missions: 2, wins: 1, bestScore: { 'mul-c.4': 300 } });
  });

  it('location: default, kept when valid, repaired when unknown or inconsistent', () => {
    expect(defaultLocation()).toEqual({ sectorId: SECTORS[0].id, systemId: SECTORS[0].systems[0].id });
    const sys = SECTORS[5].systems[1];
    expect(migrate({ version: 1, location: { sectorId: sys.sectorId, systemId: sys.id } }).location)
      .toEqual({ sectorId: sys.sectorId, systemId: sys.id });
    // A known system wins over a wrong sector; a known sector alone gives its first system.
    expect(migrate({ version: 1, location: { sectorId: 'type-1', systemId: sys.id } }).location)
      .toEqual({ sectorId: sys.sectorId, systemId: sys.id });
    expect(migrate({ version: 1, location: { sectorId: 'mul-b', systemId: 'nope' } }).location)
      .toEqual({ sectorId: 'mul-b', systemId: 'mul-b.s1' });
    const removed = [{ sectorId: 'add-20', systemId: 'add-20.s1' }, { sectorId: 'sub-20', systemId: 'sub-20.s3' }];
    for (const bad of [undefined, null, 'x', { sectorId: 'mul-7', systemId: 'multiplication' }, { sectorId: 3 }, ...removed]) {
      expect(migrate({ version: 1, location: bad }).location).toEqual(defaultLocation());
    }
    const store = memory();
    writeSave(store, { ...defaultSave(), location: { sectorId: sys.sectorId, systemId: sys.id } });
    expect(loadSave(store).location.systemId).toBe(sys.id);
  });

  it('old saves: unlockAll ignored, bestScore keys that are not planet ids dropped, stats kept', () => {
    const planet = PLANETS[3].id;
    const old = {
      version: 1,
      settings: { sfxVolume: 0.5, musicVolume: 0.5, unlockAll: true, keypadAlwaysVisible: false, gameSpeed: 1 },
      stats: { 'mul:7x8': { box: 3, attempts: 4, correct: 3, avgMs: 2000, lastSeen: 1, dueAt: 2 } },
      totals: { missions: 3, wins: 2, bestScore: { 'mul-7': 120, 'mix-1': 80, [planet]: 50 } },
    };
    const loaded = loadSave(memory(JSON.stringify(old)));
    expect(loaded.settings).toEqual({ sfxVolume: 0.5, musicVolume: 0.5, keypadAlwaysVisible: false, gameSpeed: 1 });
    expect(loaded.totals.bestScore).toEqual({ [planet]: 50 });
    expect(loaded.stats['mul:7x8'].box).toBe(3);
    expect(loaded.location).toEqual(defaultLocation());
  });

  it('stats for fact ids that no longer exist are harmless everywhere', () => {
    // Ids that no sector holds any more (0 + 0, operands below the ranges, the old add-20 / sub-20 style).
    const gone = { 'add:0+0': stat(5), 'add:86+3': stat(2, { dueAt: NOW - 1 }), 'sub:21-2': stat(1, { dueAt: NOW - 1 }),
      'sub:100-2': stat(3, { dueAt: NOW - 1 }), 'sub:0-0': stat(0, { dueAt: NOW - 1 }) };
    const save = loadSave(memory(JSON.stringify({ ...defaultSave(), stats: gone })));
    expect(Object.keys(save.stats).sort()).toEqual(Object.keys(gone).sort());
    for (const sector of SECTORS) {
      expect(sectorMastery(sector.id, save.stats)).toBe(0);
      expect(sectorCalls(sector.id, save, NOW, 3).length).toBeGreaterThan(0);
    }
    for (const p of PLANETS) {
      expect(planetMastery(p.id, save.stats)).toBe(0);
      expect(planetHold(p.id, save.stats)).toBe('hostile');
      expect(underAttack(p.id, save.stats, NOW)).toBe(false);
      expect(dueFacts(p.id, save.stats, NOW)).toEqual([]);
      expect(callFor(p.id, save, NOW).planetId).toBe(p.id);
      const pool = missionPool(p.id, save.stats, NOW);
      expect(pool.every((f) => !(f.id in gone))).toBe(true);
    }
    expect(skillMastery('addition', save.stats)).toBe(0);
    const q = buildWaveQueue({ planetId: planetsOfSector('add-5')[0].id, count: 10, stats: save.stats, now: NOW,
      rng: createRng(1), waveIndex: 0 });
    expect(q).toHaveLength(10);
    expect(missionPool(CORE_PLANET_ID, save.stats, NOW).length).toBeGreaterThan(0);
    const after = applyMission(save, { planetId: planetsOfSector('add-5')[0].id, credits: 0, score: 0, won: false, now: NOW,
      records: [{ factId: 'add:86+3', outcome: 'fast', responseMs: 900 }] });
    expect(after.stats['add:86+3'].attempts).toBe(4);
  });
});
