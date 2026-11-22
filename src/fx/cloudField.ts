import { createRng } from '../core/rng';

/**
 * Sector clouds as a density field (pure, no Phaser): soft gaussian blobs around a sector's
 * systems plus a few seeded filler blobs, sampled on a coarse grid. The iso line of the field
 * is the organic cloud outline; `cloudPixel` turns a field value into fill and rim strength.
 */

export interface Blob { x: number; y: number; r: number; w: number; }

export interface CloudGrid {
  /** World position of texel (0, 0)'s top-left corner. */
  x0: number;
  y0: number;
  /** World units per texel. */
  cell: number;
  w: number;
  h: number;
  /** Field value per texel, row-major. */
  field: Float32Array;
}

/** Field value of the cloud outline. A lone blob of radius r reaches it at about 0.83 r. */
export const CLOUD_EDGE = 0.5;
/** Half-width (in field units) of the bright rim around the outline. */
const RIM_WIDTH = 0.07;

/**
 * Blobs of one sector: one per system (radius 110..140), one at the centre (half the sector
 * radius) and five filler blobs scattered inside the disc, so the outline is irregular.
 * Deterministic for a seed.
 */
export function sectorBlobs(sector: { x: number; y: number; radius: number },
                            systems: ReadonlyArray<{ x: number; y: number }>, seed: number): Blob[] {
  const rng = createRng(seed);
  const blobs: Blob[] = [{ x: sector.x, y: sector.y, r: sector.radius * 0.5, w: 0.9 }];
  for (const s of systems) blobs.push({ x: s.x, y: s.y, r: 110 + rng.next() * 30, w: 1 });
  for (let i = 0; i < 5; i++) {
    const a = rng.next() * Math.PI * 2;
    const d = sector.radius * (0.35 + rng.next() * 0.42);
    blobs.push({
      x: sector.x + Math.cos(a) * d,
      y: sector.y + Math.sin(a) * d,
      r: sector.radius * (0.22 + rng.next() * 0.18),
      w: 0.6 + rng.next() * 0.4,
    });
  }
  return blobs;
}

/** Field value at a world point: sum of w * exp(-d² / r²). */
export function fieldAt(blobs: readonly Blob[], x: number, y: number): number {
  let f = 0;
  for (const b of blobs) {
    const dx = x - b.x;
    const dy = y - b.y;
    f += b.w * Math.exp(-(dx * dx + dy * dy) / (b.r * b.r));
  }
  return f;
}

/** Samples the field on a grid that covers every blob out to where it fades (2.2 r), `cell` world units per texel. */
export function cloudGrid(blobs: readonly Blob[], cell: number): CloudGrid {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const b of blobs) {
    const reach = b.r * 2.2;
    x0 = Math.min(x0, b.x - reach); y0 = Math.min(y0, b.y - reach);
    x1 = Math.max(x1, b.x + reach); y1 = Math.max(y1, b.y + reach);
  }
  x0 = Math.floor(x0); y0 = Math.floor(y0);
  const w = Math.max(1, Math.ceil((x1 - x0) / cell));
  const h = Math.max(1, Math.ceil((y1 - y0) / cell));
  const field = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    const wy = y0 + (j + 0.5) * cell;
    for (let i = 0; i < w; i++) field[j * w + i] = fieldAt(blobs, x0 + (i + 0.5) * cell, wy);
  }
  return { x0, y0, cell, w, h, field };
}

/**
 * Strength of the fill (0..1: a faint haze fading outside the outline, the body inside it,
 * a little denser toward the cores) and of the rim (0..1, a thin band on the outline).
 */
export function cloudFill(f: number): number {
  const haze = 0.16 * smoothstep(CLOUD_EDGE - 0.3, CLOUD_EDGE, f);
  const body = smoothstep(CLOUD_EDGE - 0.08, CLOUD_EDGE + 0.06, f);
  const core = Math.min(1, Math.max(0, (f - CLOUD_EDGE) / 1.4));
  return Math.min(1, haze + body * (0.5 + 0.5 * core));
}

export function cloudRim(f: number): number {
  const d = (f - CLOUD_EDGE) / RIM_WIDTH;
  return Math.exp(-d * d);
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
