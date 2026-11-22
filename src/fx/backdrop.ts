import Phaser from 'phaser';
import { COLORS, DEPTH, GAME_HEIGHT, GAME_WIDTH } from '../ui/theme';
import { hasImage } from './assets';

export interface BackdropOptions {
  /** Extra scale over the exact "cover" fit, leaving room for drift or zoom. Default 1.02. */
  overscan?: number;
  /** Render depth. Default DEPTH.background. */
  depth?: number;
}

/**
 * Full-screen background image scaled to cover the 1280x720 view (centre crop), centred.
 * Returns null when the texture is missing; the caller keeps the plain camera background.
 */
export function addBackdrop(scene: Phaser.Scene, key: string, opts: BackdropOptions = {}): Phaser.GameObjects.Image | null {
  if (!hasImage(scene, key)) return null;
  const img = scene.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, key).setDepth(opts.depth ?? DEPTH.background);
  img.setScale(coverScale(img.width, img.height) * (opts.overscan ?? 1.02));
  return img;
}

/** Scale that makes a w x h picture cover the whole view. */
export function coverScale(w: number, h: number): number {
  return Math.max(GAME_WIDTH / Math.max(1, w), GAME_HEIGHT / Math.max(1, h));
}

/**
 * Darkening overlay: a uniform veil of `alpha`, plus an optional vertical gradient that gets
 * darker toward the bottom (from `bottomFrom` y to the bottom edge, reaching `bottomAlpha`).
 */
export function addShade(scene: Phaser.Scene, alpha: number,
                         bottom?: { from: number; alpha: number }, depth: number = DEPTH.background + 1): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics().setDepth(depth);
  if (alpha > 0) {
    g.fillStyle(COLORS.bg, alpha);
    g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
  }
  if (bottom) {
    g.fillGradientStyle(COLORS.bg, COLORS.bg, COLORS.bg, COLORS.bg, 0, 0, bottom.alpha, bottom.alpha);
    g.fillRect(0, bottom.from, GAME_WIDTH, GAME_HEIGHT - bottom.from);
  }
  return g;
}
