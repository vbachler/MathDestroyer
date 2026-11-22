import type Phaser from 'phaser';
import { COLORS } from './theme';

type G = Phaser.GameObjects.Graphics;

/** Thin progress ring: dim track plus an arc from 12 o'clock covering `fraction` of the circle. */
export function drawRing(g: G, x: number, y: number, r: number, fraction: number, color: number, width = 4): void {
  g.lineStyle(width, COLORS.primaryDim, 0.45);
  g.strokeCircle(x, y, r);
  const f = Math.min(1, Math.max(0, fraction));
  if (f <= 0) return;
  g.lineStyle(width, color, 1);
  g.beginPath();
  if (f >= 1) {
    g.arc(x, y, r, 0, Math.PI * 2, false);
  } else {
    g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f, false);
  }
  g.strokePath();
}

/** Horizontal progress bar with its top-left corner at (x, y). */
export function drawBar(g: G, x: number, y: number, w: number, h: number, fraction: number, color: number): void {
  const f = Math.min(1, Math.max(0, fraction));
  g.fillStyle(COLORS.bgPanelHi, 1);
  g.fillRect(x, y, w, h);
  if (f > 0) {
    g.fillStyle(color, 1);
    g.fillRect(x, y, Math.max(2, w * f), h);
  }
  g.lineStyle(1, COLORS.primaryDim, 0.9);
  g.strokeRect(x, y, w, h);
}
