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
