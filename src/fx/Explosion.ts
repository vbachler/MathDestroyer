import Phaser from 'phaser';
import { COLORS, DEPTH } from '../ui/theme';
import { TEX } from './textures';

/**
 * Particle burst with a short soft glow at (x, y). Cleans itself up. Requires generateTextures().
 * `size` scales the burst (particle speed, particle size and glow); 1 is the full-size burst.
 */
export function explode(scene: Phaser.Scene, x: number, y: number, tint: number = COLORS.accent, size = 1): void {
  const emitter = scene.add.particles(x, y, TEX.particle, {
    speed: { min: 60 * size, max: 280 * size },
    angle: { min: 0, max: 360 },
    lifespan: { min: 350, max: 750 },
    scale: { start: 0.9 * Math.sqrt(size), end: 0 },
    alpha: { start: 1, end: 0 },
    tint: [tint, COLORS.white, tint],
    blendMode: Phaser.BlendModes.ADD,
    emitting: false,
  });
  emitter.setDepth(DEPTH.fx);
  emitter.explode(Math.max(10, Math.round(28 * Math.sqrt(size))));

  const glow = scene.add.image(x, y, TEX.glow)
    .setTint(tint)
    .setBlendMode(Phaser.BlendModes.ADD)
    .setDepth(DEPTH.fx)
    .setScale(0.3 * size)
    .setAlpha(0.9);
  scene.tweens.add({
    targets: glow,
    scale: 1.1 * size,
    alpha: 0,
    duration: 420,
    ease: 'Cubic.easeOut',
    onComplete: () => glow.destroy(),
  });
  scene.time.delayedCall(900, () => emitter.destroy());
}
