import { describe, expect, it } from 'vitest';
import { SECTORS } from '../src/core/content';
import { makeFact } from '../src/core/factgen';
import { factById, sectorStatIds } from '../src/core/facts';
import {
  BOX_INTERVAL_MS, LEVEL_UP_ACCURACY, MASTERED_BOX, MAX_PLANET_LEVEL, PLANET_INTERVAL_MS, applyOutcome, applyPlanetResult,
  classify, emptyProgress, emptyStats, factLevel, fastThresholdMs, galaxyKnowledge, isDue, isMastered, isPlanetDue,
  knowledge, masteryBand, planetMastery, planetProgress, sectorKnowledge,
} from '../src/core/mastery';
import type { Fact } from '../src/core/types';
import { DAY, NOW, progress, stat, statsFor } from './helpers';

const f = (id: string): Fact => factById(id)!;

describe('classify', () => {
  it('uses 3000 ms + 700 ms per extra answer digit', () => {
    const one = f('mul:2x3');      // answer 6
    expect(fastThresholdMs(one)).toBe(3000);
    expect(classify(one, true, 3000)).toBe('fast');
    expect(classify(one, true, 3001)).toBe('slow');
    const two = f('mul:7x8');      // answer 56
    expect(classify(two, true, 3700)).toBe('fast');
    expect(classify(two, true, 3701)).toBe('slow');
    const three = f('mul:10x10');  // answer 100
    expect(fastThresholdMs(three)).toBe(4400);
  });

  it('ignores the sign when counting digits and scales with a multiplier', () => {
    const neg = makeFact('add', -15, 3);   // answer -12
    expect(fastThresholdMs(neg)).toBe(3700);
    expect(fastThresholdMs(f('mul:2x3'), 1.1)).toBeCloseTo(3300);
  });

  it('returns wrong for incorrect answers', () => {
    expect(classify(f('mul:7x8'), false, 100)).toBe('wrong');
  });
});

describe('applyOutcome', () => {
  const due = (box: number) => stat(box, { dueAt: NOW });          // due exactly now
  const notDue = (box: number) => stat(box, { dueAt: NOW + 1 });   // due 1 ms later

  it('BOX_INTERVAL_MS[1] is 2 minutes', () => {
    expect(BOX_INTERVAL_MS).toEqual([0, 2 * 60e3, 24 * 3600e3, 3 * 24 * 3600e3, 7 * 24 * 3600e3, 21 * 24 * 3600e3]);
  });

  it('isDue: never seen, or now >= dueAt', () => {
    expect(isDue(emptyStats(), NOW)).toBe(true);
    expect(isDue(stat(2, { attempts: 0, dueAt: NOW + 1e9 }), NOW)).toBe(true);
    expect(isDue(due(2), NOW)).toBe(true);
    expect(isDue(notDue(2), NOW)).toBe(false);
  });

  it('fast and due: box + 1 (max 5) with a new dueAt', () => {
    const s = applyOutcome(due(2), 'fast', 1000, NOW);
    expect(s.box).toBe(3);
    expect(s.dueAt).toBe(NOW + BOX_INTERVAL_MS[3]);
    const top = applyOutcome(due(5), 'fast', 1000, NOW);
    expect(top.box).toBe(5);
    expect(top.dueAt).toBe(NOW + BOX_INTERVAL_MS[5]);
  });

  it('fast on a never-seen fact promotes to box 1, due in 2 minutes', () => {
    const s = applyOutcome(emptyStats(), 'fast', 1500, NOW);
    expect(s.box).toBe(1);
    expect(s.dueAt).toBe(NOW + 2 * 60e3);
  });

  it('fast and not due: box and dueAt unchanged, counters updated', () => {
    const before = notDue(2);
    const s = applyOutcome(before, 'fast', 1000, NOW);
    expect(s.box).toBe(2);
    expect(s.dueAt).toBe(before.dueAt);
    expect(s.attempts).toBe(before.attempts + 1);
    expect(s.correct).toBe(before.correct + 1);
    expect(s.lastSeen).toBe(NOW);
  });

  it('cannot climb several boxes in one sitting', () => {
    let s = emptyStats();
    for (let i = 0; i < 10; i++) s = applyOutcome(s, 'fast', 1000, NOW + i * 1000);
    expect(s.box).toBe(1);
    // after the 2-minute interval it may climb once more, then waits a day
    s = applyOutcome(s, 'fast', 1000, NOW + 2 * 60e3);
    expect(s.box).toBe(2);
    s = applyOutcome(s, 'fast', 1000, NOW + 3 * 60e3);
    expect(s.box).toBe(2);
    s = applyOutcome(s, 'fast', 1000, NOW + 2 * 60e3 + 24 * 3600e3);
    expect(s.box).toBe(3);
  });

  it('slow: box 0 becomes 1 with a new dueAt; otherwise box and dueAt unchanged', () => {
    const fromZero = applyOutcome(notDue(0), 'slow', 5000, NOW);
    expect(fromZero.box).toBe(1);
    expect(fromZero.dueAt).toBe(NOW + BOX_INTERVAL_MS[1]);
    for (const before of [notDue(3), due(3)]) {
      const s = applyOutcome(before, 'slow', 5000, NOW);
      expect(s.box).toBe(3);
      expect(s.dueAt).toBe(before.dueAt);
      expect(s.correct).toBe(before.correct + 1);
    }
  });

  it('wrong: box - 1 (min 0), always applied, dueAt rescheduled', () => {
    const s = applyOutcome(notDue(3), 'wrong', 1000, NOW);
    expect(s.box).toBe(2);
    expect(s.dueAt).toBe(NOW + BOX_INTERVAL_MS[2]);
    const zero = applyOutcome(notDue(0), 'wrong', 1000, NOW);
    expect(zero.box).toBe(0);
    expect(zero.dueAt).toBe(NOW);
    expect(applyOutcome(due(1), 'wrong', 1000, NOW).box).toBe(0);
  });

  it('missed: box - 2 (min 0), always applied, dueAt rescheduled', () => {
    const s = applyOutcome(notDue(4), 'missed', 1000, NOW);
    expect(s.box).toBe(2);
    expect(s.dueAt).toBe(NOW + BOX_INTERVAL_MS[2]);
    const one = applyOutcome(notDue(1), 'missed', 1000, NOW);
    expect(one.box).toBe(0);
    expect(one.dueAt).toBe(NOW);
    expect(one.correct).toBe(notDue(1).correct);
  });

  it('counts attempts and correct answers and keeps a running mean of correct times', () => {
    let s = emptyStats();
    s = applyOutcome(s, 'fast', 1000, NOW);
    s = applyOutcome(s, 'wrong', 9999, NOW);
    s = applyOutcome(s, 'slow', 3000, NOW);
    expect(s.attempts).toBe(3);
    expect(s.correct).toBe(2);
    expect(s.avgMs).toBe(2000);
  });

  it('is pure', () => {
    const before = due(2);
    const copy = { ...before };
    applyOutcome(before, 'fast', 1000, NOW);
    expect(before).toEqual(copy);
  });
});

describe('levels', () => {
  it('isMastered and factLevel', () => {
    expect(MASTERED_BOX).toBe(4);
    expect(isMastered(undefined)).toBe(false);
    expect(isMastered(stat(3))).toBe(false);
    expect(isMastered(stat(4))).toBe(true);
    expect(factLevel(undefined)).toBe(0);
    expect(factLevel(stat(5))).toBe(1);
    expect(factLevel(stat(2))).toBeCloseTo(0.4);
  });

  it('masteryBand boundaries', () => {
    expect(masteryBand(0)).toBe(0);
    expect(masteryBand(0.0999)).toBe(0);
    expect(masteryBand(0.1)).toBe(1);
    expect(masteryBand(0.3499)).toBe(1);
    expect(masteryBand(0.35)).toBe(2);
    expect(masteryBand(0.5999)).toBe(2);
    expect(masteryBand(0.6)).toBe(3);
    expect(masteryBand(0.8499)).toBe(3);
    expect(masteryBand(0.85)).toBe(4);
    expect(masteryBand(1)).toBe(4);
  });

  it('knowledge: mean box / 5 over stat ids, per sector and over the galaxy', () => {
    expect(knowledge([], {})).toBe(0);
    expect(knowledge(['a', 'b'], { a: stat(5) })).toBe(0.5);
    expect(sectorKnowledge('mul-c', {})).toBe(0);
    expect(sectorKnowledge('mul-c', statsFor(['mul-c'], 5))).toBe(1);
    expect(sectorKnowledge('add-100', { 'cat:add-100:carry': stat(5), 'cat:add-100:easy': stat(2) })).toBeCloseTo(7 / 15);
    expect(sectorKnowledge('nope', {})).toBe(0);
    const all = SECTORS.flatMap((s) => sectorStatIds(s.id)).length;
    expect(galaxyKnowledge(statsFor(['type-1'], 5))).toBeCloseTo(10 / all);
  });
});

describe('planet progress', () => {
  const won = (accuracy: number, now = NOW) => ({ won: true, accuracy, now });
  const lost = { won: false, accuracy: 1, now: NOW };

  it('intervals: 0, 20 min, 1, 3, 7, 21 days', () => {
    expect(PLANET_INTERVAL_MS).toEqual([0, 20 * 60e3, DAY, 3 * DAY, 7 * DAY, 21 * DAY]);
    expect(LEVEL_UP_ACCURACY).toBe(0.8);
    expect(MAX_PLANET_LEVEL).toBe(5);
  });

  it('isPlanetDue: level 0 always, else now >= dueAt', () => {
    expect(isPlanetDue(emptyProgress(), NOW)).toBe(true);
    expect(isPlanetDue(progress(0, { dueAt: NOW + DAY }), NOW)).toBe(true);
    expect(isPlanetDue(progress(2, { dueAt: NOW }), NOW)).toBe(true);
    expect(isPlanetDue(progress(2, { dueAt: NOW + 1 }), NOW)).toBe(false);
  });

  it('a won, due mission with accuracy >= 0.8 raises the level and reschedules by the new level', () => {
    // Level 0 jumps to 2, due again in 20 min (Review fixes v5).
    expect(applyPlanetResult(emptyProgress(), won(0.8))).toEqual({ level: 2, dueAt: NOW + PLANET_INTERVAL_MS[1], wins: 1 });
    expect(PLANET_INTERVAL_MS[1]).toBe(20 * 60e3);
    for (let level = 1; level <= 4; level++) {
      const p = applyPlanetResult(progress(level, { dueAt: NOW, wins: 7 }), won(1));
      expect(p).toEqual({ level: level + 1, dueAt: NOW + PLANET_INTERVAL_MS[level + 1], wins: 8 });
    }
    expect(applyPlanetResult(progress(5, { dueAt: NOW - 1 }), won(0.9))).toEqual({ level: 5, dueAt: NOW + 21 * DAY, wins: 6 });
  });

  it('a win when not due, or with accuracy below 0.8, changes only wins', () => {
    const notDue = progress(2, { dueAt: NOW + 1, wins: 3 });
    expect(applyPlanetResult(notDue, won(1))).toEqual({ ...notDue, wins: 4 });
    const due = progress(2, { dueAt: NOW, wins: 3 });
    expect(applyPlanetResult(due, won(0.79))).toEqual({ ...due, wins: 4 });
    expect(applyPlanetResult(emptyProgress(), won(0.5))).toEqual({ level: 0, dueAt: 0, wins: 1 });
  });

  it('a lost mission lowers the level by 1 (min 0) and makes the planet due now', () => {
    expect(applyPlanetResult(progress(3, { wins: 4 }), lost)).toEqual({ level: 2, dueAt: NOW, wins: 4 });
    expect(applyPlanetResult(emptyProgress(), lost)).toEqual({ level: 0, dueAt: NOW, wins: 0 });
  });

  it('a good first win gives level 2; a second good win 20 min later in the same session secures it', () => {
    let p = emptyProgress();
    for (let i = 0; i < 5; i++) p = applyPlanetResult(p, won(1, NOW + i * 60e3));
    expect(p.level).toBe(2);
    p = applyPlanetResult(p, won(1, NOW + 20 * 60e3));
    expect(p).toEqual({ level: 3, dueAt: NOW + 20 * 60e3 + PLANET_INTERVAL_MS[3], wins: 6 });
    p = applyPlanetResult(p, won(1, NOW + 21 * 60e3));
    expect(p.level).toBe(3);
    p = applyPlanetResult(p, won(1, NOW + 20 * 60e3 + 3 * DAY));
    expect(p.level).toBe(4);
  });

  it('after a loss back to level 0, a good win again gives level 2; from level 1 it is +1', () => {
    const fell = applyPlanetResult(progress(1, { wins: 2 }), lost);
    expect(fell.level).toBe(0);
    expect(applyPlanetResult(fell, won(0.9)).level).toBe(2);
    expect(applyPlanetResult(progress(1, { dueAt: NOW }), won(0.9)).level).toBe(2);
  });

  it('planetMastery = level / 5 from save.planets (0 when missing)', () => {
    const save = { planets: { 'add-10.2': progress(3) } };
    expect(planetMastery('add-10.2', save)).toBeCloseTo(0.6);
    expect(planetMastery('add-10.1', save)).toBe(0);
    expect(planetMastery('nope', save)).toBe(0);
    expect(planetProgress(save, 'add-10.1')).toEqual(emptyProgress());
  });
});
