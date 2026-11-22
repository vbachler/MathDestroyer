import Phaser from 'phaser';
import { COLORS, DEPTH } from '../ui/theme';
import { TEX } from './textures';

/** Particle burst with a short soft glow at (x, y). Cleans itself up. Requires generateTextures(). */
export function explode(scene: Phaser.Scene, x: number, y: number, tint: number = COLORS.accent): void {
  const emitter = scene.add.particles(x, y, TEX.particle, {
    speed: { min: 60, max: 280 },
    angle: { min: 0, max: 360 },
    lifespan: { min: 350, max: 750 },
    scale: { start: 0.9, end: 0 },
    alpha: { start: 1, end: 0 },
    tint: [tint, COLORS.white, tint],
    blendMode: Phaser.BlendModes.ADD,
    emitting: false,
  });
  emitter.setDepth(DEPTH.fx);
  emitter.explode(28);

  const glow = scene.add.image(x, y, TEX.glow)
    .setTint(tint)
    .setBlendMode(Phaser.BlendModes.ADD)
    .setDepth(DEPTH.fx)
    .setScale(0.3)
    .setAlpha(0.9);
  scene.tweens.add({
    targets: glow,
    scale: 1.1,
    alpha: 0,
    duration: 420,
    ease: 'Cubic.easeOut',
    onComplete: () => glow.destroy(),
  });
  scene.time.delayedCall(900, () => emitter.destroy());
}
