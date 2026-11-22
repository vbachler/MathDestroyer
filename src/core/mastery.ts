import { CORE_PLANET_ID, sectorsOfSkill } from './content';
import { allFacts, factsForPlanet } from './facts';
import type { Fact, FactStats, SkillId } from './types';

export const BOX_INTERVAL_MS = [0, 2 * 60e3,24 * 3600e3, 3 * 24 * 3600e3, 7 * 24 * 3600e3, 21 * 24 * 3600e3];
export const MASTERED_BOX = 4;
export const MAX_BOX = 5;

export type Outcome = 'fast' | 'slow' | 'wrong' | 'missed';

function digitCount(n: number): number {
  return String(Math.abs(Math.trunc(n))).length;
}

/**
 * Fast threshold: 3000 ms + 700 ms per digit of the answer beyond the first.
 * `multiplier` scales it (the targeting module uses it for scoring only, never for mastery).
 */
export function fastThresholdMs(fact: Fact, multiplier = 1): number {
  return (3000 + 700 * (digitCount(fact.answer) - 1)) * multiplier;
}

/** Correct answers are 'fast' (<= threshold) or 'slow'; incorrect ones are 'wrong'. */
export function classify(fact: Fact, correct: boolean, responseMs: number): Outcome {
  if (!correct) return 'wrong';
  return responseMs <= fastThresholdMs(fact) ? 'fast' : 'slow';
}

export function emptyStats(): FactStats {
  return { box: 0, attempts: 0, correct: 0, avgMs: 0, lastSeen: 0, dueAt: 0 };
}

/** A fact is due when it was never seen (attempts 0) or now >= dueAt. */
export function isDue(s: FactStats, now: number): boolean {
  return s.attempts === 0 || now >= s.dueAt;
}

/** Promotion happens only when the fact is due (now >= s.dueAt; a never-seen fact is due):
 *  fast and due: box+1 (max 5), dueAt = now + BOX_INTERVAL_MS[box].
 *  fast and not due: box and dueAt unchanged (only the counters and avgMs change), so a fact
 *  cannot climb several boxes inside one sitting; real mastery needs returning on later days.
 *  slow: box 0 becomes 1 with a new dueAt; otherwise box and dueAt unchanged.
 *  wrong: box-1 (min 0). missed (enemy reached the planet): box-2 (min 0). Demotions always
 *  apply and set dueAt = now + BOX_INTERVAL_MS[box].
 *  attempts, correct, avgMs and lastSeen are updated for every outcome. */
export function applyOutcome(s: FactStats, o: Outcome, responseMs: number, now: number): FactStats {
  let box = s.box;
  let dueAt = s.dueAt;
  const reschedule = (b: number): void => {
    box = b;
    dueAt = now + BOX_INTERVAL_MS[b];
  };
  switch (o) {
    case 'fast':
      if (isDue(s, now)) reschedule(Math.min(MAX_BOX, s.box + 1));
      break;
    case 'slow':
      if (s.box === 0) reschedule(1);
      break;
    case 'wrong':
      reschedule(Math.max(0, s.box - 1));
      break;
    case 'missed':
      reschedule(Math.max(0, s.box - 2));
      break;
  }
  const isCorrect = o === 'fast' || o === 'slow';
  const correct = s.correct + (isCorrect ? 1 : 0);
  const avgMs = isCorrect ? s.avgMs + (responseMs - s.avgMs) / correct : s.avgMs;
  return { box, attempts: s.attempts + 1, correct, avgMs, lastSeen: now, dueAt };
}

export function isMastered(s: FactStats | undefined): boolean {
  return s !== undefined && s.box >= MASTERED_BOX;
}

export function factLevel(s: FactStats | undefined): number {
  return s ? s.box / MAX_BOX : 0;
}

function meanLevel(facts: Fact[], stats: Record<string, FactStats>): number {
  if (facts.length === 0) return 0;
  let boxes = 0;
  for (const f of facts) boxes += stats[f.id]?.box ?? 0;
  return boxes / (MAX_BOX * facts.length);   // exact for whole-box fractions
}

/**
 * Mean factLevel of the planet's facts. The core planet has no facts of its own; its mastery is
 * the mean over every fact of the galaxy.
 */
export function planetMastery(planetId: string, stats: Record<string, FactStats>): number {
  if (planetId === CORE_PLANET_ID) return meanLevel(allFacts(), stats);
  return meanLevel(factsForPlanet(planetId), stats);
}

/** Mean planetMastery over every planet of the skill's sectors (each planet weighs the same). */
export function skillMastery(skill: SkillId, stats: Record<string, FactStats>): number {
  const planets = sectorsOfSkill(skill).flatMap((s) => s.systems.flatMap((y) => y.planets));
  if (planets.length === 0) return 0;
  let sum = 0;
  for (const p of planets) sum += planetMastery(p.id, stats);
  return sum / planets.length;
}

/** Facts of the planet seen before (attempts>0) whose dueAt <= now. */
export function dueFacts(planetId: string, stats: Record<string, FactStats>, now: number): Fact[] {
  return factsForPlanet(planetId).filter((f) => {
    const s = stats[f.id];
    return s !== undefined && s.attempts > 0 && s.dueAt <= now;
  });
}

/** Mastery -> colour band: 0 'unlit' (<0.10), 1 'weak' (<0.35), 2 'learning' (<0.6),
 *  3 'good' (<0.85), 4 'mastered'. */
export function masteryBand(level: number): 0 | 1 | 2 | 3 | 4 {
  if (level < 0.1) return 0;
  if (level < 0.35) return 1;
  if (level < 0.6) return 2;
  if (level < 0.85) return 3;
  return 4;
}
