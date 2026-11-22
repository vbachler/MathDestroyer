import Phaser from 'phaser';
import { DEPTH, GAME_HEIGHT, GAME_WIDTH } from '../ui/theme';
import { TEX } from './textures';

export interface StarfieldOptions {
  /** Multiplies the drift speed of every layer (0 = static). Default 1. */
  speed?: number;
  /** Render depth of the field. Default DEPTH.background. */
  depth?: number;
}

interface Layer { stars: Phaser.GameObjects.Image[]; speed: number; }

const LAYERS = [
  { count: 90, speed: 6, scale: [0.35, 0.6], alpha: [0.25, 0.5] },
  { count: 50, speed: 14, scale: [0.6, 0.9], alpha: [0.45, 0.75] },
  { count: 22, speed: 30, scale: [0.9, 1.4], alpha: [0.7, 1] },
] as const;

const TINTS = [0xffffff, 0xcfe8ff, 0xfff1d6, 0xd6f6ff];

/** Three-layer parallax starfield drifting downward. Call update(dtMs) every frame. Requires generateTextures(). */
export class Starfield {
  private readonly layers: Layer[] = [];
  private speedScale: number;
  private readonly rnd = new Phaser.Math.RandomDataGenerator(['mathdestroyer-stars']);

  constructor(scene: Phaser.Scene, opts: StarfieldOptions = {}) {
    this.speedScale = opts.speed ?? 1;
    const depth = opts.depth ?? DEPTH.background;
    const rnd = this.rnd;
    LAYERS.forEach((cfg, li) => {
      const stars: Phaser.GameObjects.Image[] = [];
      for (let i = 0; i < cfg.count; i++) {
        const star = scene.add.image(rnd.between(0, GAME_WIDTH), rnd.between(0, GAME_HEIGHT), TEX.star)
          .setScale(rnd.realInRange(cfg.scale[0], cfg.scale[1]))
          .setAlpha(rnd.realInRange(cfg.alpha[0], cfg.alpha[1]))
          .setTint(rnd.pick(TINTS))
          .setDepth(depth + li)
          .setScrollFactor(0);
        stars.push(star);
      }
      this.layers.push({ stars, speed: cfg.speed });
    });
  }

  setSpeed(scale: number): void {
    this.speedScale = scale;
  }

  update(dtMs: number): void {
    const dt = dtMs / 1000;
    for (const layer of this.layers) {
      const dy = layer.speed * this.speedScale * dt;
      for (const s of layer.stars) {
        s.y += dy;
        if (s.y > GAME_HEIGHT + 4) {
          s.y -= GAME_HEIGHT + 8;
          s.x = this.rnd.between(0, GAME_WIDTH);
        }
      }
    }
  }

  destroy(): void {
    for (const layer of this.layers) for (const s of layer.stars) s.destroy();
    this.layers.length = 0;
  }
}
