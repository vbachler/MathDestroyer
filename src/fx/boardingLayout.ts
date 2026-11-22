/**
 * Boarding screen geometry (logical 1280x720) and the code animation of the crawler stills.
 * Pure: no Phaser, unit tested in tests/boardingLayout.test.ts.
 *
 * One-point perspective onto the hangar floor of `bg/bg_hangar.jpg` (cover-fit): the far door's
 * floor line is at y 370 (opening x 550..730), the floor runs to the bottom of the frame, and the
 * two gun barrels in the foreground have their muzzles at about (490, 540) and (795, 540).
 * A crawler at depth z (1 = far door, 0 = at the guns) stands on the floor at
 *   scale s(z) = 1 / (1 + z (1 / FAR_SCALE - 1))      (true perspective: slow far, fast near)
 *   y = HORIZON_Y + (NEAR_Y - HORIZON_Y) s,  x = CX + lane LANE_NEAR_DX s
 * so s(1) = FAR_SCALE at the door and s(0) = 1 at the bottom.
 */

import type { Point } from './battleLayout';

export const VIEW_W = 1280;
export const VIEW_H = 720;
export const CX = VIEW_W / 2;

/** Floor line of the far door and of the nearest point (feet at z = 0). */
export const DOOR_Y = 370;
export const NEAR_Y = 700;
export const FAR_SCALE = 0.08;
/** Where the floor plane meets the horizon (derived so that s = FAR_SCALE lands on DOOR_Y). */
export const HORIZON_Y = (DOOR_Y - NEAR_Y * FAR_SCALE) / (1 - FAR_SCALE);
/** Lane offset from the centre line at scale 1 (lanes -1, 0, 1). */
export const LANE_NEAR_DX = 300;
/** Crawler width in px at scale 1 (the 512 px frame scaled to it). */
export const CRAWLER_NEAR_W = 300;

/** Muzzles of the two barrels painted into the hangar background. */
export const MUZZLE_LEFT: Point = { x: 490, y: 540 };
export const MUZZLE_RIGHT: Point = { x: 795, y: 540 };

/** Typed answer readout and the bite pips, bottom centre between the barrels. */
export const READOUT = { x: CX - 80, y: VIEW_H - 50, w: 160, h: 42 } as const;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Perspective scale at depth z (clamped to 0..1): FAR_SCALE at the door, 1 at the guns. */
export function perspectiveScale(z: number): number {
  // Exponential rather than true 1/z perspective: crawlers are readable for most of the approach.
  return Math.pow(FAR_SCALE, clamp01(z));
}

/** How far along the visible approach a crawler is: 0 at the door, 1 at the guns. */
export function approach(z: number): number {
  return (perspectiveScale(z) - FAR_SCALE) / (1 - FAR_SCALE);
}

/** Feet of a crawler on the floor. `sway` is a lateral offset in scale-1 px (zig-zag). */
export function floorPoint(z: number, lane: number, sway = 0): Point {
  const s = perspectiveScale(z);
  return { x: CX + (lane * LANE_NEAR_DX + sway) * s, y: HORIZON_Y + (NEAR_Y - HORIZON_Y) * s };
}

/** Light level 0..1 for a crawler's tint: dark in the far gloom, full light close by. */
export function brightness(z: number): number {
  return 0.28 + 0.72 * Math.pow(approach(z), 0.6);
}

/** Display depth order: nearer crawlers draw on top (larger value). */
export function depthOrder(z: number): number {
  return 1 - clamp01(z);
}

// ---------------------------------------------------------------- gait

/** Per-kind movement character. */
export interface GaitStyle {
  /** Leg-skitter frequency at the door (Hz); it doubles-plus as the crawler closes in. */
  hz: number;
  /** Body rock amplitude (radians). */
  rock: number;
  /** Squash amount (fraction). */
  squash: number;
  /** Bob height (fraction of the drawn height). */
  bob: number;
  /** Zig-zag amplitude (scale-1 px) and frequency (Hz). */
  zig: number;
  zigHz: number;
}

export const GAIT: Readonly<Record<'scorpion' | 'spider' | 'crab' | 'beetle', GaitStyle>> = {
  scorpion: { hz: 7, rock: 0.05, squash: 0.05, bob: 0.025, zig: 60, zigHz: 0.45 },
  spider: { hz: 10, rock: 0.07, squash: 0.06, bob: 0.03, zig: 90, zigHz: 0.7 },
  crab: { hz: 8, rock: 0.06, squash: 0.04, bob: 0.02, zig: 130, zigHz: 0.55 },
  beetle: { hz: 6, rock: 0.04, squash: 0.07, bob: 0.035, zig: 45, zigHz: 0.35 },
};

/** Skitter frequency at depth z: the closer, the faster (x 2.4 at the guns). */
export function gaitHz(style: GaitStyle, z: number): number {
  return style.hz * (1 + 1.4 * (1 - clamp01(z)));
}

export interface GaitPose {
  rotation: number;   // radians
  scaleX: number;     // multiplier
  scaleY: number;
  lift: number;       // upward bob, fraction of the drawn height (>= 0)
  sway: number;       // lateral zig-zag, scale-1 px
}

/**
 * Pose of a still at time `tMs` (the crawler's own clock) and depth z. `legPhase` is the
 * accumulated skitter phase in radians (advanced by the caller with gaitHz, so the rate can
 * change smoothly), `seed` a per-crawler phase offset. Scuttling comes in bursts: a slow
 * envelope makes the legs work hard, then nearly stall, as real crawling things do.
 */
export function gaitPose(style: GaitStyle, tMs: number, legPhase: number, seed: number): GaitPose {
  const t = tMs / 1000;
  const burst = 0.45 + 0.55 * Math.max(0, Math.sin(t * 2.3 + seed * 1.7)) ** 0.5;
  const leg = Math.sin(legPhase + seed);
  const step = Math.abs(Math.sin(legPhase + seed));
  return {
    rotation: style.rock * burst * leg,
    scaleX: 1 + style.squash * 0.6 * burst * step,
    scaleY: 1 - style.squash * burst * step,
    lift: style.bob * burst * (1 - step),
    sway: style.zig * (Math.sin(t * Math.PI * 2 * style.zigHz + seed) + 0.35 * Math.sin(t * Math.PI * 2 * style.zigHz * 2.7 + seed * 3)),
  };
}

// ---------------------------------------------------------------- shots

/** Where a missed shot goes: beside the nearest crawler (or into the far gloom), `r01` in 0..1. */
export function boardingMissPoint(target: Point | null, r01: number): Point {
  if (!target) return { x: CX + (r01 - 0.5) * 240, y: DOOR_Y - 20 - r01 * 40 };
  const side = r01 < 0.5 ? -1 : 1;
  const dist = 50 + 40 * ((r01 * 2) % 1);
  return { x: target.x + side * dist, y: target.y - 10 };
}
