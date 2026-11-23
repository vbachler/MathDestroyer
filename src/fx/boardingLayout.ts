/**
 * Boarding screen geometry (logical 1280x720) and the code animation of the crawler stills.
 * Pure: no Phaser, unit tested in tests/boardingLayout.test.ts.
 *
 * One-point perspective onto the hangar floor of `bg/bg_hangar.jpg` (cover-fit): the far door's
 * floor line is at y 370 (opening x 550..740), the floor runs to the bottom of the frame. The two
 * guns are separate foreground sprites (GUNS) that pivot to aim; at rest their muzzles are at
 * about (505, 545) and (797, 545).
 * A crawler at depth z (1 = far door, 0 = at the guns) stands on the floor at
 *   scale s(z) = 1 / (1 + z (1 / FAR_SCALE - 1))      (true perspective: slow far, fast near)
 *   y = HORIZON_Y + (NEAR_Y - HORIZON_Y) s,  x = CX + lane LANE_NEAR_DX s
 * so s(1) = FAR_SCALE at the door and s(0) = 1 at the bottom.
 */

import type { CrawlerKind } from '../core/boarding';
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

// ---------------------------------------------------------------- foreground guns

/**
 * One of the two foreground guns (ui/gun_left.png, ui/gun_right.png from tools/process-art.mjs).
 * The sprites are in background space (the 1920x1080 cover-fit of the hangar), drawn at
 * GUN_SCALE; (x, y) is the sprite's top-left in the view at rest, so the gun sits exactly where
 * it is in the original picture. `pivot` (near the grip, below the frame) and `muzzle` (centre of
 * the barrel tip) are in sprite px. The sprites carry extra rows below the frame so a rotated
 * gun never shows its cut edge.
 */
export interface GunGeom {
  x: number; y: number; w: number; h: number;
  pivot: Point; muzzle: Point;
}
/** Background space -> view (1920 -> 1280). */
export const GUN_SCALE = 2 / 3;
export const GUN_LEFT: GunGeom = { x: 292.0, y: 530.7, w: 387, h: 394, pivot: { x: 190, y: 330 }, muzzle: { x: 322, y: 24 } };
export const GUN_RIGHT: GunGeom = { x: 755.3, y: 530.0, w: 381, h: 395, pivot: { x: 194, y: 330 }, muzzle: { x: 62, y: 24 } };
export const GUNS: readonly GunGeom[] = [GUN_LEFT, GUN_RIGHT];
/** Largest aim rotation either way from the rest pose (radians, ~18 deg). */
export const GUN_MAX_ANGLE = (18 * Math.PI) / 180;

/** Pivot of a gun in view coordinates (the sprite rotates about it). */
export function gunPivot(g: GunGeom): Point {
  return { x: g.x + g.pivot.x * GUN_SCALE, y: g.y + g.pivot.y * GUN_SCALE };
}

/** Rest direction of the barrel (pivot -> muzzle), radians in screen coordinates. */
export function gunRestAngle(g: GunGeom): number {
  return Math.atan2(g.muzzle.y - g.pivot.y, g.muzzle.x - g.pivot.x);
}

const wrapPi = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Rotation (from rest, clamped to +-GUN_MAX_ANGLE) that points the barrel at `target`. */
export function gunAimAngle(g: GunGeom, target: Point): number {
  const p = gunPivot(g);
  const want = wrapPi(Math.atan2(target.y - p.y, target.x - p.x) - gunRestAngle(g));
  return Math.max(-GUN_MAX_ANGLE, Math.min(GUN_MAX_ANGLE, want));
}

/** Muzzle tip in view coordinates for a rotation `angle` and a recoil offset (view px). */
export function gunMuzzle(g: GunGeom, angle: number, recoil: Point = { x: 0, y: 0 }): Point {
  const p = gunPivot(g);
  const dx = (g.muzzle.x - g.pivot.x) * GUN_SCALE;
  const dy = (g.muzzle.y - g.pivot.y) * GUN_SCALE;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: p.x + dx * c - dy * s + recoil.x, y: p.y + dx * s + dy * c + recoil.y };
}

/** Recoil kick at full strength (view px): back along the barrel and a little down. */
export function gunKick(g: GunGeom, angle: number, strength: number): Point {
  const a = gunRestAngle(g) + angle;
  return { x: -Math.cos(a) * 9 * strength, y: -Math.sin(a) * 9 * strength + 4 * strength };
}

/**
 * Broken strip lights painted into the hangar (with spark bursts), measured on the cover-fit
 * 1280x720 view. (x, y) is the centre of the painted lamp and spray; rx/ry the half-size of the
 * dark patch that hides them while the lamp is out (solid to 40 %, feathered to the rim);
 * `tint` the near-black of the surrounding wall; `size` scales flash and particles.
 */
export interface SparkLamp {
  x: number; y: number; rx: number; ry: number; tint: number; size: number;
}
export const SPARK_LAMPS: readonly SparkLamp[] = [
  { x: 257, y: 160, rx: 165, ry: 130, tint: 0x14120e, size: 1 },
  { x: 395, y: 226, rx: 70, ry: 56, tint: 0x131518, size: 0.5 },
  { x: 901, y: 226, rx: 70, ry: 56, tint: 0x141515, size: 0.5 },
  { x: 1040, y: 160, rx: 165, ry: 130, tint: 0x14120e, size: 1 },
];

/** Spark crackle on lamp flashes: only about one flash in 4-5, never two within CRACKLE_GAP_MS. */
export const CRACKLE_CHANCE = 0.22;
export const CRACKLE_GAP_MS = 1500;

/** Whether a lamp flash at `nowMs` gets a crackle (last crackle at `lastMs`, `r01` uniform 0..1). */
export function crackleGate(nowMs: number, lastMs: number, r01: number): boolean {
  return r01 < CRACKLE_CHANCE && nowMs - lastMs >= CRACKLE_GAP_MS;
}

/** Red warning lamps painted on the hangar floor (view coords): their glow pulses. */
export const BEACONS: readonly Point[] = [
  { x: 268, y: 388 }, { x: 481, y: 359 }, { x: 821, y: 359 }, { x: 906, y: 378 }, { x: 1045, y: 388 },
];

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
  /** Lunging zig-zag: > 0 makes the side-to-side a quick dash then a hold (sharpness). */
  lunge?: number;
  /** Flying: the body floats this fraction of its drawn height above its floor point. */
  hover?: number;
  /** Flying: slow vertical bob frequency (Hz); its height is `bob`. */
  bobHz?: number;
  /** Gliding: no step bob or squash, only a slow sway (rotation `rock`). */
  glide?: boolean;
}

export const GAIT: Readonly<Record<CrawlerKind, GaitStyle>> = {
  scorpion: { hz: 7, rock: 0.05, squash: 0.05, bob: 0.025, zig: 60, zigHz: 0.45 },
  spider: { hz: 10, rock: 0.07, squash: 0.06, bob: 0.03, zig: 90, zigHz: 0.7 },
  crab: { hz: 8, rock: 0.06, squash: 0.04, bob: 0.02, zig: 130, zigHz: 0.55 },
  beetle: { hz: 6, rock: 0.04, squash: 0.07, bob: 0.035, zig: 45, zigHz: 0.35 },
  stalker: { hz: 8, rock: 0.04, squash: 0.05, bob: 0.03, zig: 120, zigHz: 0.5, lunge: 4 },
  drifter: { hz: 2, rock: 0.035, squash: 0, bob: 0.07, zig: 70, zigHz: 0.22, hover: 0.6, bobHz: 0.4 },
  wraith: { hz: 1.5, rock: 0.03, squash: 0, bob: 0, zig: 35, zigHz: 0.18, glide: true },
};

/**
 * Drawn size per kind relative to CRAWLER_NEAR_W (the 512 frame's width): the stalker about like
 * the scorpion, the drifter a bit smaller, the wraith about 1.3x the scorpion's height.
 */
export const CRAWLER_SIZE: Readonly<Record<CrawlerKind, number>> = {
  scorpion: 1, spider: 1, crab: 1, beetle: 1, stalker: 0.98, drifter: 0.85, wraith: 1.25,
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
  const wave = (hz: number, ph: number): number => Math.sin(t * Math.PI * 2 * hz + ph);
  if (style.hover !== undefined || style.glide) {
    // Flying / gliding: no legs. A slow sway, a gentle drift, and (flying) a slow bob.
    const bobHz = style.bobHz ?? 0.4;
    return {
      rotation: style.rock * wave(0.31, seed * 2),
      scaleX: 1,
      scaleY: 1,
      lift: style.bob * (0.5 + 0.5 * wave(bobHz, seed)),
      sway: style.zig * (wave(style.zigHz, seed) + 0.25 * wave(style.zigHz * 2.3, seed * 3)),
    };
  }
  const burst = 0.45 + 0.55 * Math.max(0, Math.sin(t * 2.3 + seed * 1.7)) ** 0.5;
  const leg = Math.sin(legPhase + seed);
  const step = Math.abs(Math.sin(legPhase + seed));
  return {
    rotation: style.rock * burst * leg,
    scaleX: 1 + style.squash * 0.6 * burst * step,
    scaleY: 1 - style.squash * burst * step,
    lift: style.bob * burst * (1 - step),
    sway: style.lunge
      ? style.zig * lungeWave(wave(style.zigHz, seed), style.lunge)
      : style.zig * (wave(style.zigHz, seed) + 0.35 * wave(style.zigHz * 2.7, seed * 3)),
  };
}

/** A sine reshaped into dash-and-hold: quick sideways lunges, pauses at either side. In -1..1. */
export function lungeWave(s: number, sharpness: number): number {
  return Math.tanh(sharpness * s) / Math.tanh(sharpness);
}

/** Flying kinds: how high the body floats above its floor point, in px, for a drawn height. */
export function hoverLift(style: GaitStyle, drawnH: number): number {
  return (style.hover ?? 0) * drawnH;
}

// ---------------------------------------------------------------- shots

/** Where a missed shot goes: beside the nearest crawler (or into the far gloom), `r01` in 0..1. */
export function boardingMissPoint(target: Point | null, r01: number): Point {
  if (!target) return { x: CX + (r01 - 0.5) * 240, y: DOOR_Y - 20 - r01 * 40 };
  const side = r01 < 0.5 ? -1 : 1;
  const dist = 50 + 40 * ((r01 * 2) % 1);
  return { x: target.x + side * dist, y: target.y - 10 };
}
