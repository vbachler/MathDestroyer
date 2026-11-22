import { describe, expect, it } from 'vitest';
import { CORE_PLANET_ID, PLANETS, planetsOfSector } from '../src/core/content';
import { allFacts, factById } from '../src/core/facts';
import {
  BOX_INTERVAL_MS, MASTERED_BOX, applyOutcome, classify, dueFacts, emptyStats, factLevel, isDue,
  fastThresholdMs, isMastered, masteryBand, planetMastery, skillMastery,
} from '../src/core/mastery';
import type { Fact } from '../src/core/types';
import { NOW, stat, statsFor } from './helpers';

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
    const neg = allFacts().find((x) => x.planetId.startsWith('neg-20') && x.answer <= -10)!;
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

  it('planetMastery is the mean fact level', () => {
    expect(planetMastery('mul-c.4', {})).toBe(0);
    expect(planetMastery('mul-c.4', statsFor(['mul-c.4'], 5))).toBe(1);
    const twoOfFive = { 'mul:7x6': stat(5), 'mul:7x7': stat(5) };
    expect(planetMastery('mul-c.4', twoOfFive)).toBeCloseTo(0.4);
    expect(planetMastery('nope', {})).toBe(0);
  });

  it('planetMastery of the core planet is the mean over every fact', () => {
    expect(planetMastery(CORE_PLANET_ID, {})).toBe(0);
    const typing = planetsOfSector('type-1').map((p) => p.id);
    expect(planetMastery(CORE_PLANET_ID, statsFor(typing, 5))).toBeCloseTo(10 / allFacts().length);
  });

  it('skillMastery is the mean of the planets of every sector of the skill', () => {
    const typingPlanets = ['type-1', 'type-2', 'type-3'].flatMap((s) => planetsOfSector(s).map((p) => p.id));
    expect(typingPlanets).toHaveLength(12);
    expect(skillMastery('typing', statsFor(planetsOfSector('type-1').map((p) => p.id), 5))).toBeCloseTo(2 / 12);
    expect(skillMastery('typing', statsFor(typingPlanets, 5))).toBe(1);
    expect(skillMastery('mixed', {})).toBe(0);
    expect(PLANETS.length).toBeGreaterThan(typingPlanets.length);
  });

  it('dueFacts: seen facts with dueAt <= now', () => {
    const stats = {
      'mul:7x1': stat(2, { dueAt: NOW - 1 }),
      'mul:7x2': stat(2, { dueAt: NOW }),
      'mul:7x3': stat(2, { dueAt: NOW + 1 }),
      'mul:7x4': stat(0, { attempts: 0, dueAt: 0 }),
    };
    expect(dueFacts('mul-c.3', stats, NOW).map((x) => x.id)).toEqual(['mul:7x1', 'mul:7x2']);
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
});
