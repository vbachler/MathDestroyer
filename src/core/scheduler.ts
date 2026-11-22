import { CORE_PLANET_ID, PLANETS, planetById, planetsOfSector, sectorById } from './content';
import { factsForPlanet } from './facts';
import { planetMastery } from './mastery';
import type { Rng } from './rng';
import type { Fact, FactStats } from './types';

/** Never-seen facts allowed in the first wave, and extra per later wave. */
export const FIRST_WAVE_NEW_FACTS = 4;
export const NEW_FACTS_PER_WAVE = 2;
/** Review facts from other planets of the sector added to a mission. */
export const MAX_REVIEW_FACTS = 4;
/** A planet joins the core pool once its mastery reaches this. */
export const CORE_POOL_MASTERY = 0.4;

/** Threshold comparison tolerant to floating-point rounding of means. */
const atLeast = (x: number, threshold: number): boolean => x >= threshold - 1e-9;

/**
 * Up to 4 facts from the other planets of the planet's sector that the player has seen before:
 * due facts first (earliest dueAt first), then the weakest (lowest box first). Ties keep the
 * galaxy order.
 */
export function reviewFacts(planetId: string, stats: Record<string, FactStats>, now: number): Fact[] {
  const planet = planetById(planetId);
  if (!planet) return [];
  const candidates = planetsOfSector(planet.sectorId)
    .filter((p) => p.id !== planetId)
    .flatMap((p) => factsForPlanet(p.id))
    .map((fact, order) => ({ fact, order, s: stats[fact.id] }))
    .filter((c): c is { fact: Fact; order: number; s: FactStats } => c.s !== undefined && c.s.attempts > 0);
  const due = candidates.filter((c) => c.s.dueAt <= now).sort((x, y) => x.s.dueAt - y.s.dueAt || x.order - y.order);
  const rest = candidates.filter((c) => c.s.dueAt > now).sort((x, y) => x.s.box - y.s.box || x.order - y.order);
  return [...due, ...rest].slice(0, MAX_REVIEW_FACTS).map((c) => c.fact);
}

/**
 * Facts a mission on this planet draws from: the planet's facts, then up to 4 review facts
 * from other planets of the same sector. The core planet: every fact of every planet whose
 * mastery is at least 0.4 (none yet: the first typing planet's facts).
 */
export function missionPool(planetId: string, stats: Record<string, FactStats>, now: number): Fact[] {
  if (planetId === CORE_PLANET_ID) {
    const pool = PLANETS.filter((p) => p.id !== CORE_PLANET_ID && atLeast(planetMastery(p.id, stats), CORE_POOL_MASTERY))
      .flatMap((p) => factsForPlanet(p.id));
    return pool.length > 0 ? pool : factsForPlanet(firstTypingPlanetId());
  }
  return [...factsForPlanet(planetId), ...reviewFacts(planetId, stats, now)];
}

function firstTypingPlanetId(): string {
  return sectorById('type-1')?.systems[0].planets[0].id ?? PLANETS[0].id;
}

function weight(s: FactStats | undefined, now: number): number {
  if (!s || s.attempts === 0) return 3;
  if (s.dueAt <= now) return 4;
  if (s.box <= 1) return 3;
  if (s.box <= 3) return 2;
  return 1;
}

/** Builds the question queue for one wave. Weights: due and seen 4, never seen 3, box 0-1 3,
 *  box 2-3 2, box 4-5 1. No fact appears twice in a row. The pool is `missionPool`. Never more
 *  than 2 never-seen facts are introduced per wave beyond the first wave's 4, so new material
 *  arrives gradually.
 *
 *  `waveIndex` is 0-based. Stats are the mission-start snapshot, so the never-seen facts that
 *  may appear are a fixed prefix (in content order) of length 4 + 2 * waveIndex: each wave adds
 *  at most 2 new facts to those of the waves before it. */
export function buildWaveQueue(args: {
  planetId: string; count: number; stats: Record<string, FactStats>;
  now: number; rng: Rng; waveIndex: number;
}): Fact[] {
  const { planetId, count, stats, now, rng, waveIndex } = args;
  const pool = missionPool(planetId, stats, now);
  const newBudget = FIRST_WAVE_NEW_FACTS + NEW_FACTS_PER_WAVE * Math.max(0, waveIndex);
  let newSeen = 0;
  const eligible: Array<{ fact: Fact; w: number }> = [];
  for (const fact of pool) {
    const s = stats[fact.id];
    const isNew = !s || s.attempts === 0;
    if (isNew) {
      if (newSeen >= newBudget) continue;
      newSeen++;
    }
    eligible.push({ fact, w: weight(s, now) });
  }
  const queue: Fact[] = [];
  if (eligible.length === 0) return queue;
  for (let i = 0; i < count; i++) {
    const prev = queue.length > 0 ? queue[queue.length - 1].id : null;
    const choices = eligible.length > 1 ? eligible.filter((e) => e.fact.id !== prev) : eligible;
    const total = choices.reduce((sum, e) => sum + e.w, 0);
    let r = rng.next() * total;
    let chosen = choices[choices.length - 1];
    for (const e of choices) {
      r -= e.w;
      if (r < 0) { chosen = e; break; }
    }
    queue.push(chosen.fact);
  }
  return queue;
}
