import type Phaser from 'phaser';
import { COLORS, LINE_WIDTH } from './theme';

type G = Phaser.GameObjects.Graphics;

/** Credits glyph: a thin hexagonal chip with a filled core, centred on (x, y); `size` is its height. */
export function drawCreditGlyph(g: G, x: number, y: number, size: number, color: number = COLORS.primary, alpha = 1): void {
  const r = size / 2;
  g.lineStyle(LINE_WIDTH, color, alpha);
  g.beginPath();
  for (let i = 0; i <= 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.strokePath();
  g.fillStyle(color, alpha);
  g.fillRect(x - r * 0.28, y - r * 0.28, r * 0.56, r * 0.56);
}

/** Enter (return) glyph: a bent arrow, down then left, centred on (x, y); `size` is its height. */
export function drawEnterGlyph(g: G, x: number, y: number, size: number, color: number = COLORS.primary, alpha = 1): void {
  const h = size / 2;
  const right = x + h * 0.9;
  const left = x - h * 0.9;
  const low = y + h * 0.45;
  const head = h * 0.5;
  g.lineStyle(LINE_WIDTH + 0.5, color, alpha);
  g.lineBetween(right, y - h, right, low);
  g.lineBetween(right, low, left, low);
  g.lineBetween(left, low, left + head, low - head);
  g.lineBetween(left, low, left + head, low + head);
}

/** Small right-pointing arrow (shaft and head), centred on (x, y); `w` is its length. */
export function drawRightArrow(g: G, x: number, y: number, w: number, color: number = COLORS.primary, alpha = 1): void {
  const head = w * 0.35;
  g.lineStyle(LINE_WIDTH, color, alpha);
  g.lineBetween(x - w / 2, y, x + w / 2, y);
  g.lineBetween(x + w / 2, y, x + w / 2 - head, y - head);
  g.lineBetween(x + w / 2, y, x + w / 2 - head, y + head);
}
