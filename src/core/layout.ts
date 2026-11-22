import { createRng } from './rng';
import type { SkillId } from './types';

/**
 * Galaxy layout math (pure, deterministic). `content.ts` uses it to place sectors and systems;
 * `galaxy.ts` re-exports it for scenes and tests.
 */

export const WORLD_W = 4800;
export const WORLD_H = 2700;
/** Sector discs keep this far from the world edge. */
export const WORLD_MARGIN = 60;
/** Minimum distance between any two star systems. */
export const MIN_SYSTEM_SPACING = 70;
/** Largest allowed overlap of two sector discs (see `discOverlap`). */
export const MAX_SECTOR_OVERLAP = 0.15;

/** Base hue of each skill's colour family (degrees). Families are 45 degrees apart and are
 *  arranged so skills that sit next to each other on the spiral differ strongly. */
export const SKILL_HUE: Readonly<Record<SkillId, number>> = {
  typing: 180,          // cyan
  addition: 135,        // green
  subtraction: 90,      // lime
  multiplication: 270,  // violet
  division: 315,        // magenta
  negatives: 225,       // blue
  missing: 0,           // rose
  mixed: 45,            // gold
};
/** Hue step between sectors of the same skill (kept small so a family stays recognisable). */
export const SECTOR_HUE_STEP = 5;

/** Sector hue: the skill's base hue, offset symmetrically by the sector's index in the skill. */
export function sectorHue(skill: SkillId, indexInSkill: number, countInSkill: number): number {
  const offset = (indexInSkill - (countInSkill - 1) / 2) * SECTOR_HUE_STEP;
  return (((SKILL_HUE[skill] + offset) % 360) + 360) % 360;
}

/** Shortest distance between two hues on the colour wheel (0..180). */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Sector disc radius: grows with the number of systems. */
export function sectorRadius(systemCount: number): number {
  return 130 + 55 * Math.max(1, systemCount);
}

export interface Disc { x: number; y: number; radius: number; }

/** How much two discs overlap: penetration depth divided by the smaller diameter (0 = apart). */
export function discOverlap(a: Disc, b: Disc): number {
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  const depth = Math.max(0, a.radius + b.radius - d);
  return depth / (2 * Math.min(a.radius, b.radius));
}

/** Allowed overlap of sectors of the same skill while placing (below the tested limit). */
const PLACE_OVERLAP = 0.06;
/** Extra empty space between sectors of different skills, so each skill reads as a cluster. */
const SKILL_GAP = 30;

export interface SectorSlot { radius: number; group: string; }

/**
 * Sector discs grouped by skill along a loose spiral around the world centre, in the given
 * order (sectors of one group are consecutive). The first slot sits at the centre. The first
 * sector of each group walks outward along the spiral from just behind the previous group's
 * start and takes the first spot inside the world that fits. Every further sector of the group
 * is packed against the group's previous sector: of the spots on rings around it that fit, it
 * takes the one nearest the world centre, so a group stays one cluster and the galaxy stays
 * compact. A seeded radial wobble keeps the spiral from looking mechanical. Deterministic.
 */
export function placeSectors(slots: readonly SectorSlot[], seed = 2718): Disc[] {
  const rng = createRng(seed);
  const cx = WORLD_W / 2;
  const cy = WORLD_H / 2;
  const sx = Math.sqrt(WORLD_W / WORLD_H);   // the spiral is wider than tall, like the world
  const placed: Array<Disc & { group: string }> = [];
  let t = 0;
  for (const { radius, group } of slots) {
    if (placed.length === 0) {
      placed.push({ x: cx, y: cy, radius, group });
      continue;
    }
    const wobble = 1 + (rng.next() - 0.5) * 0.25;
    const fits = (c: Disc): boolean =>
      c.x - radius >= WORLD_MARGIN && c.x + radius <= WORLD_W - WORLD_MARGIN
      && c.y - radius >= WORLD_MARGIN && c.y + radius <= WORLD_H - WORLD_MARGIN
      && placed.every((p) =>
        p.group === group
          ? discOverlap(p, c) <= PLACE_OVERLAP
          : Math.hypot(p.x - c.x, p.y - c.y) >= p.radius + c.radius + SKILL_GAP);
    const prev = placed[placed.length - 1];
    let found: Disc | null = null;
    if (prev.group === group) {
      // Rings around the previous sector of the group, nearest the centre wins.
      let bestD = Infinity;
      for (const extra of [0, 40, 90, 160]) {
        const dist = prev.radius + radius + extra;
        for (let k = 0; k < 96; k++) {
          const a = (k / 96) * Math.PI * 2;
          const cand = { x: Math.round(prev.x + Math.cos(a) * dist), y: Math.round(prev.y + Math.sin(a) * dist), radius };
          const d = Math.hypot(cand.x - cx, cand.y - cy);
          if (d < bestD && fits(cand)) { bestD = d; found = cand; }
        }
        if (found) break;
      }
    }
    if (!found) {
      t = Math.max(0, t - 1.2);                 // step back a little to fill gaps nearby
      for (let guard = 0; guard < 40000 && !found; guard++) {
        t += 0.005;
        const r = 100 * t * wobble;             // archimedean spiral, ~630 units per turn
        const cand = { x: Math.round(cx + Math.cos(t) * r * sx), y: Math.round(cy + Math.sin(t) * r / sx), radius };
        if (fits(cand)) found = cand;
      }
    }
    if (!found) throw new Error(`galaxy layout: no room for sector ${placed.length} (${group})`);
    placed.push({ ...found, group });
  }
  return placed.map(({ x, y, radius }) => ({ x, y, radius }));
}

export interface Point { x: number; y: number; }

/**
 * `count` system positions inside a sector disc (within 70% of its radius), at least
 * MIN_SYSTEM_SPACING from each other and from every point in `others`. A single system sits
 * near the centre. Deterministic for a seed.
 */
export function scatterSystems(sector: Disc, count: number, others: readonly Point[], seed: number): Point[] {
  const rng = createRng(seed);
  const out: Point[] = [];
  const spread = sector.radius * 0.7;
  const ok = (p: Point): boolean =>
    [...others, ...out].every((o) => Math.hypot(o.x - p.x, o.y - p.y) >= MIN_SYSTEM_SPACING);
  for (let i = 0; i < count; i++) {
    let point: Point | null = null;
    for (let attempt = 0; attempt < 500 && !point; attempt++) {
      // Spread grows a little with failed attempts so a crowded disc still finds room.
      const reach = count === 1 && attempt < 50 ? spread * 0.25 : spread * Math.min(1.4, 1 + attempt / 400);
      const a = rng.next() * Math.PI * 2;
      const r = Math.sqrt(rng.next()) * reach;
      const cand = { x: Math.round(sector.x + Math.cos(a) * r), y: Math.round(sector.y + Math.sin(a) * r) };
      if (ok(cand)) point = cand;
    }
    if (!point) throw new Error('galaxy layout: no room for a system');
    out.push(point);
  }
  return out;
}

/** Sun hues look like stars: warm reds and golds, or blue-white. */
const SUN_HUES = [12, 24, 36, 44, 52, 205, 215];

export function sunHueFor(seed: number): number {
  return createRng(seed).pick(SUN_HUES);
}

/** Starting angle of a planet on its orbit, radians in [0, 2π). */
export function planetAngleFor(seed: number): number {
  return createRng(seed).next() * Math.PI * 2;
}
