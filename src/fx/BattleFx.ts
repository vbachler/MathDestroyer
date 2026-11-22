import Phaser from 'phaser';
import { COLORS, DEPTH } from '../ui/theme';
import type { Point } from './battleLayout';
import { TEX } from './textures';

/** Light effects for the battle: thin beams, small flashes, sparks, drifting debris, shield hex. Code draws light only. */

const BEAM_MS = 170;

/**
 * Thin beam from `from` to `to` that fades out. `fadeInto` (a missed shot) stretches the beam
 * on past the aim point while it fades, so the shot visibly carries on into space.
 */
export function beam(scene: Phaser.Scene, from: Point, to: Point, color: number,
                     opts: { width?: number; fadeInto?: boolean; durationMs?: number } = {}): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  const width = opts.width ?? 0.42;            // x scale of the 12 px laser texture: about 2 px core
  const dur = opts.durationMs ?? BEAM_MS;
  const b = scene.add.image(from.x, from.y, TEX.laser)
    .setOrigin(0.5, 1)
    .setRotation(Math.atan2(dx, -dy))
    .setScale(width, dist / 128)
    .setTint(color)
    .setBlendMode(Phaser.BlendModes.ADD)
    .setDepth(DEPTH.fx);
  scene.tweens.add({
    targets: b,
    alpha: 0,
    scaleX: width * 0.3,
    ...(opts.fadeInto ? { scaleY: (dist * 1.7) / 128 } : {}),
    duration: opts.fadeInto ? dur * 2.2 : dur,
    ease: opts.fadeInto ? 'Quad.easeOut' : 'Quad.easeIn',
    onComplete: () => b.destroy(),
  });
  flash(scene, from.x, from.y, color, 10);
}

/** Small soft flash of light, `size` px across at its peak. */
export function flash(scene: Phaser.Scene, x: number, y: number, color: number, size: number, durationMs = 220): void {
  const g = scene.add.image(x, y, TEX.glow)
    .setTint(color)
    .setBlendMode(Phaser.BlendModes.ADD)
    .setDepth(DEPTH.fx)
    .setScale((size * 0.5) / 128)
    .setAlpha(0.95);
  scene.tweens.add({
    targets: g, scale: size / 128, alpha: 0, duration: durationMs, ease: 'Cubic.easeOut',
    onComplete: () => g.destroy(),
  });
}

/** Short spark burst (small hot particles). */
export function sparks(scene: Phaser.Scene, x: number, y: number, color: number, count = 6, speed = 60): void {
  const e = scene.add.particles(x, y, TEX.particle, {
    speed: { min: speed * 0.3, max: speed },
    angle: { min: 0, max: 360 },
    lifespan: { min: 180, max: 420 },
    scale: { start: 0.28, end: 0 },
    alpha: { start: 1, end: 0 },
    tint: [color, COLORS.white],
    blendMode: Phaser.BlendModes.ADD,
    emitting: false,
  }).setDepth(DEPTH.fx);
  e.explode(count);
  scene.time.delayedCall(500, () => e.destroy());
}

/** Dark hull fragments that drift slowly outward, tumble and fade. */
export function debris(scene: Phaser.Scene, x: number, y: number, count = 9, speed = 34): void {
  const e = scene.add.particles(x, y, TEX.star, {
    speed: { min: speed * 0.25, max: speed },
    angle: { min: 0, max: 360 },
    lifespan: { min: 1200, max: 2400 },
    scale: { min: 0.6, max: 1.3 },
    rotate: { start: 0, end: 360 },
    alpha: { start: 0.9, end: 0 },
    tint: [COLORS.textDim, COLORS.disabled, COLORS.primaryDim],
    emitting: false,
  }).setDepth(DEPTH.fx - 1);
  e.explode(count);
  scene.time.delayedCall(2500, () => e.destroy());
}

/**
 * Ship destroyed: a flash about the size of the ship, hot sparks, then debris drifting away.
 * `size` is the ship's drawn length.
 */
export function shipExplosion(scene: Phaser.Scene, x: number, y: number, size: number, tint: number = COLORS.primary): void {
  flash(scene, x, y, COLORS.white, size * 1.1, 160);
  flash(scene, x, y, tint, size * 2.4, 420);
  sparks(scene, x, y, tint, 14, 120);
  debris(scene, x, y, 10, 40);
}

/** Teal hexagonal shield that flashes over a station and fades. */
export function hexShield(scene: Phaser.Scene, x: number, y: number, radius: number): void {
  const g = scene.add.graphics({ x, y }).setDepth(DEPTH.fx).setBlendMode(Phaser.BlendModes.ADD);
  const pts: Phaser.Math.Vector2[] = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    pts.push(new Phaser.Math.Vector2(Math.cos(a) * radius, Math.sin(a) * radius));
  }
  g.fillStyle(COLORS.accent, 0.14);
  g.fillPoints(pts, true);
  g.lineStyle(1, COLORS.accent, 0.95);
  g.strokePoints(pts, true, true);
  // Inner cell lines: a faint honeycomb hint.
  g.lineStyle(1, COLORS.accent, 0.35);
  for (const p of pts) g.lineBetween(0, 0, p.x * 0.55, p.y * 0.55);
  g.setScale(0.8);
  scene.tweens.add({ targets: g, scale: 1.08, duration: 160, ease: 'Quad.easeOut' });
  scene.tweens.add({ targets: g, alpha: 0, delay: 220, duration: 520, ease: 'Quad.easeIn', onComplete: () => g.destroy() });
}

/** Thin expanding ring (repair pulse, etc.). */
export function ring(scene: Phaser.Scene, x: number, y: number, radius: number, color: number): void {
  const c = scene.add.circle(x, y, radius).setStrokeStyle(1, color, 1).setDepth(DEPTH.fx);
  scene.tweens.add({ targets: c, scale: 1.8, alpha: 0, duration: 650, ease: 'Cubic.easeOut', onComplete: () => c.destroy() });
}
