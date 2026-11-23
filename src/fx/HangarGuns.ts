import Phaser from 'phaser';
import { DEPTH } from '../ui/theme';
import { hasImage, IMG } from './assets';
import type { Point } from './battleLayout';
import {
  GUN_LEFT, GUN_RIGHT, GUN_SCALE, gunAimAngle, gunKick, gunMuzzle, gunPivot, gunRestAngle,
} from './boardingLayout';
import type { GunGeom } from './boardingLayout';

/** Display depth: above every crawler body (DEPTH.enemies .. +5), below their tags (+8). */
export const GUN_DEPTH = DEPTH.enemies + 6.5;
/** How fast the barrels follow their target (1/s, exponential approach). */
const TRACK_RATE = 7;
/** Idle sway with no target: amplitude (radians) and periods (ms). */
const IDLE_AMP = 0.05;
const RECOIL_MS = 150;

interface Gun {
  geom: GunGeom;
  view: Phaser.GameObjects.Image | Phaser.GameObjects.Graphics;
  angle: number;
  /** Recoil strength 1 -> 0 over RECOIL_MS after a shot. */
  kick: number;
  phase: number;
}

/**
 * The two foreground guns of the boarding hangar. Each pivots near its grip: both barrels track
 * a target smoothly (idle sway without one), limited to +-GUN_MAX_ANGLE; `fire` snaps them onto
 * the aim point, kicks them back and returns the rotated muzzle tips for the beams. With the
 * gun sprites missing, simple code-drawn barrels with the same geometry stand in.
 */
export class HangarGuns {
  private guns: Gun[] = [];
  private clock = 0;

  constructor(scene: Phaser.Scene) {
    const keys = [IMG.ui.gunLeft, IMG.ui.gunRight];
    [GUN_LEFT, GUN_RIGHT].forEach((geom, i) => {
      const key = keys[i]!;
      const p = gunPivot(geom);
      const view = hasImage(scene, key)
        ? scene.add.image(p.x, p.y, key).setOrigin(geom.pivot.x / geom.w, geom.pivot.y / geom.h).setScale(GUN_SCALE)
        : drawFallback(scene, geom);
      view.setDepth(GUN_DEPTH);
      this.guns.push({ geom, view, angle: 0, kick: 0, phase: i * 1.7 });
    });
  }

  /** Smoothly aims both barrels at `target` (or sways idly when null). `dt` 0 freezes them. */
  update(dt: number, target: Point | null): void {
    if (dt <= 0) return;
    this.clock += dt;
    const k = 1 - Math.exp((-TRACK_RATE * dt) / 1000);
    for (const g of this.guns) {
      const want = target
        ? gunAimAngle(g.geom, target)
        : IDLE_AMP * Math.sin(this.clock / 1900 + g.phase) + 0.4 * IDLE_AMP * Math.sin(this.clock / 730 + g.phase * 2);
      g.angle += (want - g.angle) * k;
      g.kick = Math.max(0, g.kick - dt / RECOIL_MS);
      this.place(g);
    }
  }

  /** Snaps both barrels onto `to`, starts the recoil and returns the muzzle tips at that instant. */
  fire(to: Point): Point[] {
    return this.guns.map((g) => {
      g.angle = gunAimAngle(g.geom, to);
      g.kick = 1;
      this.place(g);
      return gunMuzzle(g.geom, g.angle);
    });
  }

  destroy(): void {
    for (const g of this.guns) g.view.destroy();
    this.guns = [];
  }

  private place(g: Gun): void {
    // Ease-out recoil: a sharp kick, a smooth return.
    const s = g.kick * g.kick;
    const off = gunKick(g.geom, g.angle, s);
    const p = gunPivot(g.geom);
    g.view.setPosition(p.x + off.x, p.y + off.y).setRotation(g.angle);
  }
}

/** Code-drawn barrel in the gun's geometry: a dark tapered body from the grip to the muzzle. */
function drawFallback(scene: Phaser.Scene, geom: GunGeom): Phaser.GameObjects.Graphics {
  const p = gunPivot(geom);
  const m = gunMuzzle(geom, 0);
  const len = Math.hypot(m.x - p.x, m.y - p.y);
  const a = gunRestAngle(geom);
  const g = scene.add.graphics({ x: p.x, y: p.y });
  // Local frame: barrel along the rest direction.
  const ux = Math.cos(a); const uy = Math.sin(a);
  const nx = -uy; const ny = ux;
  const pt = (along: number, across: number): Phaser.Math.Vector2 =>
    new Phaser.Math.Vector2(ux * along + nx * across, uy * along + ny * across);
  g.fillStyle(0x0b0c0e, 1);
  g.fillPoints([pt(-40, -70), pt(-40, 70), pt(len * 0.55, 34), pt(len * 0.55, -34)], true);
  g.fillStyle(0x15171b, 1);
  g.fillPoints([pt(len * 0.5, -16), pt(len * 0.5, 16), pt(len, 11), pt(len, -11)], true);
  g.lineStyle(2, 0x3a4250, 0.8);
  g.lineBetween(pt(len * 0.5, -16).x, pt(len * 0.5, -16).y, pt(len, -11).x, pt(len, -11).y);
  g.fillStyle(0x050506, 1);
  g.fillCircle(pt(len, 0).x, pt(len, 0).y, 8);
  return g;
}

