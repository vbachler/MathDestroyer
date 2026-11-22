import { describe, expect, it } from 'vitest';
import { PLANETS, SKILLS, planetById } from '../src/core/content';
import { defaultSave } from '../src/core/save';
import type { SaveData } from '../src/core/save';
import { CALL_SENDER, SYSTEM_SENDERS, callFor, markSeen, sectorCalls, stableHash } from '../src/core/story';
import type { PlanetProgress } from '../src/core/types';
import enStory from '../src/locales/en/story.json';
import hrStory from '../src/locales/hr/story.json';
import { DAY, NOW, planetIds, progress } from './helpers';

const dicts: Record<string, Record<string, string>> = { hr: hrStory, en: enStory };

/** A save where every skill intro has been seen. */
const seenAll = (planets: Record<string, PlanetProgress> = {}): SaveData =>
  ({ ...SKILLS.reduce((s, k) => markSeen(s, k), defaultSave()), planets });

const P = planetIds('sub-15');

/** Every planet of P at one level, not due. */
const all = (level: number): Record<string, PlanetProgress> => Object.fromEntries(P.map((id) => [id, progress(level)]));

describe('sectorCalls', () => {
  it('fresh sector: liberate the first planet, then patrol nothing (all hostile)', () => {
    const calls = sectorCalls('sub-15', seenAll(), NOW, 3);
    expect(calls.map((c) => [c.planetId, c.kind])).toEqual([[P[0], 'liberate']]);
  });

  it('defend (longest overdue first), then the next hostile planet, then the weakest non-hostile', () => {
    const planets: Record<string, PlanetProgress> = {};
    P.slice(0, 6).forEach((id) => { planets[id] = progress(4); });
    planets[P[1]] = progress(3, { dueAt: NOW - 10 });
    planets[P[4]] = progress(2, { dueAt: NOW - DAY });
    planets[P[2]] = progress(1, { dueAt: NOW - 100 });
    planets[P[5]] = progress(2);      // the weakest non-hostile planet that is not under attack
    const calls = sectorCalls('sub-15', seenAll(planets), NOW, 10);
    expect(calls.map((c) => [c.planetId, c.kind])).toEqual([
      [P[4], 'defend'], [P[2], 'defend'], [P[1], 'defend'], [P[6], 'liberate'], [P[5], 'patrol'],
    ]);
    expect(sectorCalls('sub-15', seenAll(planets), NOW, 2).map((c) => c.planetId)).toEqual([P[4], P[2]]);
    expect(sectorCalls('sub-15', seenAll(planets), NOW, 0)).toEqual([]);
  });

  it('a fully secured sector gets one patrol to its weakest planet', () => {
    const planets = all(5);
    planets[P[P.length - 1]] = progress(4);
    const calls = sectorCalls('sub-15', seenAll(planets), NOW, 3);
    expect(calls.map((c) => [c.planetId, c.kind])).toEqual([[P[P.length - 1], 'patrol']]);
  });

  it('a lost mission brings a defend call (the planet is due now)', () => {
    const planets = all(5);
    planets[P[3]] = { level: 2, dueAt: NOW, wins: 4 };
    expect(sectorCalls('sub-15', seenAll(planets), NOW, 1).map((c) => [c.planetId, c.kind])).toEqual([[P[3], 'defend']]);
  });

  it('messages: story.call.<kind>.1..3 by stable hash, sender from story.call.from, planet name param', () => {
    const [call] = sectorCalls('sub-15', seenAll(), NOW, 1);
    expect(call.storyKey).toBe(`story.call.liberate.${1 + (stableHash(P[0]) % 3)}`);
    expect(call.sender).toBe(CALL_SENDER);
    expect(call.params).toEqual({ planet: planetById(P[0])!.name });
    for (const d of Object.values(dicts)) {
      expect(d['story.call.from']).toBe(CALL_SENDER);
      for (const kind of ['defend', 'liberate', 'patrol']) {
        for (let v = 1; v <= 3; v++) expect(d[`story.call.${kind}.${v}`]).toContain('{planet}');
      }
    }
  });

  it('the first call carries the skill intro until the skill is seen', () => {
    const fresh = defaultSave();
    const calls = sectorCalls('mul-c', fresh, NOW, 3);
    expect(calls[0]).toMatchObject({ storyKey: 'story.system.multiplication.text', sender: 'tarrow', kind: 'liberate' });
    const seen = markSeen(fresh, 'multiplication');
    expect(sectorCalls('mul-c', seen, NOW, 3)[0].storyKey).toMatch(/^story\.call\.liberate\.[123]$/);
    expect(sectorCalls('nope', fresh, NOW, 3)).toEqual([]);
  });
});

describe('callFor', () => {
  it('picks the kind from the planet state', () => {
    const save = seenAll({ [P[3]]: progress(2, { dueAt: NOW }), [P[6]]: progress(3) });
    expect(callFor(P[3], save, NOW).kind).toBe('defend');
    expect(callFor(P[0], save, NOW).kind).toBe('liberate');
    expect(callFor(P[6], save, NOW)).toEqual({
      planetId: P[6], kind: 'patrol', storyKey: `story.call.patrol.${1 + (stableHash(P[6]) % 3)}`,
      sender: 'abacus', params: { planet: planetById(P[6])!.name },
    });
    expect(() => callFor('nowhere', save, NOW)).toThrow();
  });

  it('carries the skill intro while the skill is unseen', () => {
    const core = PLANETS[PLANETS.length - 1].id;
    expect(callFor(core, defaultSave(), NOW)).toMatchObject({ storyKey: 'story.system.mixed.text', sender: 'tarrow' });
    expect(callFor(P[0], defaultSave(), NOW).storyKey).toBe('story.system.subtraction.text');
  });

  it('every call key exists in both locales', () => {
    for (const p of PLANETS) {
      for (const save of [defaultSave(), seenAll()]) {
        const c = callFor(p.id, save, NOW);
        expect(dicts.hr[c.storyKey], c.storyKey).toBeTruthy();
        expect(dicts.en[c.storyKey], c.storyKey).toBeTruthy();
      }
    }
  });
});

describe('story', () => {
  it('markSeen is pure and idempotent', () => {
    const save = defaultSave();
    const a = markSeen(save, 'typing');
    expect(save.story.seen).toEqual([]);
    expect(a.story.seen).toEqual(['typing']);
    expect(markSeen(a, 'typing')).toBe(a);
    expect(markSeen(a, 'addition').story.seen).toEqual(['typing', 'addition']);
  });

  it('every skill intro exists in both locales and its sender matches the .from key', () => {
    for (const skill of SKILLS) {
      for (const d of Object.values(dicts)) {
        expect(d[`story.system.${skill}.text`], skill).toBeTruthy();
        expect(d[`story.system.${skill}.from`]).toBe(SYSTEM_SENDERS[skill]);
        expect(d[`story.sender.${SYSTEM_SENDERS[skill]}`]).toBeTruthy();
      }
    }
  });

  it('stableHash is deterministic and spreads planet ids', () => {
    expect(stableHash('mul-c.3')).toBe(stableHash('mul-c.3'));
    expect(stableHash('')).toBe(0x811c9dc5);
    const buckets = new Set(PLANETS.map((p) => stableHash(p.id) % 8));
    expect(buckets.size).toBe(8);
    const variants = new Set(PLANETS.map((p) => stableHash(p.id) % 3));
    expect(variants.size).toBe(3);
  });
});
