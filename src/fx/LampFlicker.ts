import Phaser from 'phaser';
import type { SparkLamp } from './boardingLayout';
import { TEX } from './textures';

/** Dark between bursts, and the length of one lit stutter / gap. */
const DARK_MIN_MS = 600;
const DARK_MAX_MS = 3500;
const ON_MIN_MS = 40;
const ON_MAX_MS = 160;
const GAP_MIN_MS = 30;
const GAP_MAX_MS = 90;
const BURST_MAX_MS = 400;
const GRAVITY = 700;
/** Patch opacity while the lamp is out (enough to sink the painted tube to the wall's gloom). */
const PATCH_ALPHA = 0.94;
const MAX_PARTICLES = 80;
const FLASH_TINT = 0xffc890;
const WASH_TINT = 0xff9a50;
const SPARK_TINT = 0xffd9a0;

interface Spot {
  lamp: SparkLamp;
  patch: Phaser.GameObjects.Image;
  flash: Phaser.GameObjects.Image;
  wash: Phaser.GameObjects.Image;
  /** Remaining segments of the current burst (lit, gap, lit...), or empty while dark. */
  segs: Array<{ on: boolean; ms: number }>;
  darkMs: number;
  /** True on the first frame of a lit segment (emit sparks once). */
  fresh: boolean;
}

interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; }

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

/**
 * Failing strip lights in the hangar: a feathered dark patch hides each painted lamp and its
 * spark spray; at random it drops out for a short (often stuttering) burst, with an additive
 * flash, a warm wash on the wall and a few falling sparks. Driven by `update(dt)` only.
 */
export class LampFlicker {
  private spots: Spot[] = [];
  private sparks: Spark[] = [];
  private gfx: Phaser.GameObjects.Graphics;
  private readonly onFlash: ((lamp: SparkLamp) => void) | undefined;

  /** `onFlash` runs on every lit stutter (the scene rations the crackle sound from it). */
  constructor(scene: Phaser.Scene, lamps: readonly SparkLamp[], depth: number, onFlash?: (lamp: SparkLamp) => void) {
    this.onFlash = onFlash;
    for (const lamp of lamps) {
      const patch = scene.add.image(lamp.x, lamp.y, TEX.shade).setTint(lamp.tint).setDepth(depth)
        .setDisplaySize(lamp.rx * 2, lamp.ry * 2).setAlpha(PATCH_ALPHA);
      const wash = scene.add.image(lamp.x, lamp.y + 40 * lamp.size, TEX.glow).setTint(WASH_TINT)
        .setBlendMode(Phaser.BlendModes.ADD).setDepth(depth + 1).setDisplaySize(lamp.rx * 4, lamp.ry * 4).setAlpha(0);
      const flash = scene.add.image(lamp.x, lamp.y, TEX.glow).setTint(FLASH_TINT)
        .setBlendMode(Phaser.BlendModes.ADD).setDepth(depth + 2).setDisplaySize(lamp.rx * 1.1, lamp.ry * 1.1).setAlpha(0);
      this.spots.push({ lamp, patch, flash, wash, segs: [], darkMs: rnd(300, DARK_MAX_MS), fresh: false });
    }
    this.gfx = scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD).setDepth(depth + 3);
  }

  update(dt: number): void {
    if (dt <= 0) return;
    for (const s of this.spots) this.stepSpot(s, dt);
    this.stepSparks(dt);
  }

  destroy(): void {
    for (const s of this.spots) {
      s.patch.destroy();
      s.flash.destroy();
      s.wash.destroy();
    }
    this.spots = [];
    this.sparks = [];
    this.gfx.destroy();
  }

  private stepSpot(s: Spot, dt: number): void {
    if (s.segs.length === 0) {
      s.darkMs -= dt;
      if (s.darkMs > 0) {
        this.setLit(s, 0);
        return;
      }
      s.segs = this.makeBurst();
      s.fresh = true;
    }
    const seg = s.segs[0]!;
    if (seg.on) {
      if (s.fresh) {
        this.emit(s.lamp);
        this.onFlash?.(s.lamp);
      }
      s.fresh = false;
      this.setLit(s, rnd(0.7, 1));
    } else {
      this.setLit(s, 0);
    }
    seg.ms -= dt;
    if (seg.ms <= 0) {
      s.segs.shift();
      s.fresh = true;
      if (s.segs.length === 0) s.darkMs = rnd(DARK_MIN_MS, DARK_MAX_MS);
    }
  }

  /** One to three lit stutters with short gaps, total within BURST_MAX_MS. */
  private makeBurst(): Array<{ on: boolean; ms: number }> {
    const r = Math.random();
    const count = r < 0.35 ? 1 : r < 0.75 ? 2 : 3;
    const segs: Array<{ on: boolean; ms: number }> = [];
    let total = 0;
    for (let i = 0; i < count; i++) {
      const on = Math.min(rnd(ON_MIN_MS, ON_MAX_MS), BURST_MAX_MS - total);
      if (on < ON_MIN_MS / 2) break;
      if (i > 0) segs.push({ on: false, ms: rnd(GAP_MIN_MS, GAP_MAX_MS) });
      segs.push({ on: true, ms: on });
      total += on;
    }
    if (total < 80) segs[segs.length - 1]!.ms += 80 - total;
    return segs;
  }

  private setLit(s: Spot, lit: number): void {
    s.patch.setAlpha(lit > 0 ? 0 : PATCH_ALPHA);
    s.flash.setAlpha(lit * rnd(0.55, 0.9));
    s.wash.setAlpha(lit * 0.16);
  }

  private emit(lamp: SparkLamp): void {
    const n = Math.round(rnd(4, 9) * (0.5 + lamp.size * 0.5));
    for (let i = 0; i < n && this.sparks.length < MAX_PARTICLES; i++) {
      const a = rnd(-0.15, 1.15) * Math.PI; // screen coords: sideways and down, a few kick up
      const v = rnd(60, 240) * (0.5 + lamp.size * 0.5);
      const life = rnd(300, 750);
      this.sparks.push({
        x: lamp.x + rnd(-14, 14) * lamp.size, y: lamp.y + rnd(-4, 4) * lamp.size,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, life, max: life,
      });
    }
  }

  private stepSparks(dt: number): void {
    const g = this.gfx;
    g.clear();
    if (this.sparks.length === 0) return;
    const sec = dt / 1000;
    const alive: Spark[] = [];
    for (const p of this.sparks) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy += GRAVITY * sec;
      p.x += p.vx * sec;
      p.y += p.vy * sec;
      const k = p.life / p.max;
      g.lineStyle(1.5, SPARK_TINT, k);
      g.lineBetween(p.x, p.y, p.x - p.vx * 0.02, p.y - p.vy * 0.02);
      alive.push(p);
    }
    this.sparks = alive;
  }
}
