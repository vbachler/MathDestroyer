import { SECTORS } from './content';
import { sectorStatIds } from './facts';
import type { Fact, FactStats, PlanetProgress, ProgressHolder } from './types';

export const BOX_INTERVAL_MS = [0, 2 * 60e3, 24 * 3600e3, 3 * 24 * 3600e3, 7 * 24 * 3600e3, 21 * 24 * 3600e3];
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

/** Mean knowledge level (box / 5) of the given stat ids; 0 for an empty list. */
export function knowledge(statIds: readonly string[], stats: Record<string, FactStats>): number {
  if (statIds.length === 0) return 0;
  let boxes = 0;
  for (const id of statIds) boxes += stats[id]?.box ?? 0;
  return boxes / (MAX_BOX * statIds.length);   // exact for whole-box fractions
}

/** Real knowledge of a sector from `stats` (per fact or per category), for the parent report. */
export function sectorKnowledge(sectorId: string, stats: Record<string, FactStats>): number {
  return knowledge(sectorStatIds(sectorId), stats);
}

/** Real knowledge over every sector's stat ids (the core's line in the parent report). */
export function galaxyKnowledge(stats: Record<string, FactStats>): number {
  return knowledge(SECTORS.flatMap((s) => sectorStatIds(s.id)), stats);
}

// ---------------------------------------------------------------- planet progress

const MINUTE = 60e3;
const DAY = 24 * 3600e3;
/** Time until a planet is due again, by its new level. */
export const PLANET_INTERVAL_MS = [0, 20 * MINUTE, DAY, 3 * DAY, 7 * DAY, 21 * DAY];
export const MAX_PLANET_LEVEL = 5;
/** A won mission raises the planet's level only with at least this accuracy. */
export const LEVEL_UP_ACCURACY = 0.8;

export function emptyProgress(): PlanetProgress {
  return { level: 0, dueAt: 0, wins: 0 };
}

/** Progress of a planet (level 0, never visited, when missing). */
export function planetProgress(save: ProgressHolder, planetId: string): PlanetProgress {
  return save.planets[planetId] ?? emptyProgress();
}

/** A planet is due when it is at level 0 or now >= dueAt. */
export function isPlanetDue(p: PlanetProgress, now: number): boolean {
  return p.level === 0 || now >= p.dueAt;
}

/**
 * Result of one mission at a planet:
 * won with accuracy >= 0.8 at level 0: level 2, dueAt = now + PLANET_INTERVAL_MS[1] (20 min), so a
 * second good win in the same session secures it (level 3; "Review fixes v5");
 * won with accuracy >= 0.8 and due at level >= 1: level + 1 (max 5), dueAt = now + PLANET_INTERVAL_MS[new level];
 * won otherwise: only `wins` changes; lost: level − 1 (min 0) and due now. Pure.
 */
export function applyPlanetResult(p: PlanetProgress, r: { won: boolean; accuracy: number; now: number }): PlanetProgress {
  if (!r.won) return { level: Math.max(0, p.level - 1), dueAt: r.now, wins: p.wins };
  if (r.accuracy >= LEVEL_UP_ACCURACY && p.level === 0) {
    return { level: 2, dueAt: r.now + PLANET_INTERVAL_MS[1], wins: p.wins + 1 };
  }
  if (r.accuracy >= LEVEL_UP_ACCURACY && isPlanetDue(p, r.now)) {
    const level = Math.min(MAX_PLANET_LEVEL, p.level + 1);
    return { level, dueAt: r.now + PLANET_INTERVAL_MS[level], wins: p.wins + 1 };
  }
  return { ...p, wins: p.wins + 1 };
}

/** Planet mastery = level / 5 (0 for a never-visited or unknown planet). */
export function planetMastery(planetId: string, save: ProgressHolder): number {
  return planetProgress(save, planetId).level / MAX_PLANET_LEVEL;
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
