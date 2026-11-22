import type Phaser from 'phaser';
import type { CallKind } from '../core/story';
import { COLORS } from './theme';

type G = Phaser.GameObjects.Graphics;

/**
 * Thin line glyphs of the star map, each centred on (x, y) and about `size` px across. They
 * stand in for words: controls, call kinds, the Static's marker, edge arrows.
 */

/** Galaxy: a bright core and two spiral arms. */
export function drawGalaxyGlyph(g: G, x: number, y: number, size: number, color: number, alpha = 1): void {
  const r = size / 2;
  g.lineStyle(1.2, color, alpha);
  for (let arm = 0; arm < 2; arm++) {
    g.beginPath();
    for (let k = 0; k <= 16; k++) {
      const t = k / 16;
      const a = arm * Math.PI + t * Math.PI * 1.25;
      const d = r * (0.18 + 0.82 * t);
      const px = x + Math.cos(a) * d;
      const py = y + Math.sin(a) * d * 0.62;
      if (k === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.strokePath();
  }
  g.fillStyle(color, alpha);
  g.fillCircle(x, y, Math.max(1.5, size * 0.1));
}

/** Star system: a sun and one tilted orbit with a planet on it. */
export function drawSystemGlyph(g: G, x: number, y: number, size: number, color: number, alpha = 1): void {
  const r = size / 2;
  g.lineStyle(1, color, alpha * 0.85);
  g.strokeEllipse(x, y, r * 2, r * 0.8);
  g.fillStyle(color, alpha);
  g.fillCircle(x, y, Math.max(2, size * 0.14));
  g.fillCircle(x + r * 0.72, y + r * 0.28, Math.max(1.2, size * 0.07));
}

/** Hangar: a bay door under a low roof. */
export function drawHangarGlyph(g: G, x: number, y: number, size: number, color: number, alpha = 1): void {
  const r = size / 2;
  g.lineStyle(1.2, color, alpha);
  g.beginPath();
  g.moveTo(x - r, y + r * 0.7);
  g.lineTo(x - r, y - r * 0.15);
  g.lineTo(x, y - r * 0.7);
  g.lineTo(x + r, y - r * 0.15);
  g.lineTo(x + r, y + r * 0.7);
  g.strokePath();
  g.lineStyle(1, color, alpha * 0.8);
  g.strokeRect(x - r * 0.5, y + r * 0.05, r, r * 0.65);
  g.lineBetween(x, y + r * 0.05, x, y + r * 0.7);
}

/** Report: three bars of rising height on a base line. */
export function drawReportGlyph(g: G, x: number, y: number, size: number, color: number, alpha = 1): void {
  const r = size / 2;
  const bw = size * 0.17;
  const base = y + r * 0.7;
  g.fillStyle(color, alpha);
  [0.45, 0.8, 1.25].forEach((hk, i) => {
    const bx = x - r * 0.62 + i * size * 0.3;
    g.fillRect(bx, base - r * hk, bw, r * hk);
  });
  g.lineStyle(1, color, alpha * 0.8);
  g.lineBetween(x - r, base + 1.5, x + r, base + 1.5);
}

/** Menu: three short lines. */
export function drawMenuGlyph(g: G, x: number, y: number, size: number, color: number, alpha = 1): void {
  const r = size / 2;
  g.lineStyle(1.4, color, alpha);
  for (let i = -1; i <= 1; i++) g.lineBetween(x - r * 0.8, y + i * r * 0.5, x + r * 0.8, y + i * r * 0.5);
}

/** The Static's marker: an angular three-pronged sigil (three barbed spikes around a hollow core). */
export function drawStaticSigil(g: G, x: number, y: number, size: number, color: number = COLORS.danger, alpha = 1): void {
  const r = size / 2;
  g.fillStyle(color, alpha);
  for (let k = 0; k < 3; k++) {
    const a = -Math.PI / 2 + (k * Math.PI * 2) / 3;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const px = -sa;
    const py = ca;
    // Spike: from a wide base near the core to a point, with a barb bent clockwise.
    const bx = x + ca * r * 0.3;
    const by = y + sa * r * 0.3;
    const tx = x + ca * r;
    const ty = y + sa * r;
    g.fillTriangle(bx + px * r * 0.26, by + py * r * 0.26, bx - px * r * 0.26, by - py * r * 0.26, tx, ty);
    g.fillTriangle(tx, ty, x + ca * r * 0.62 + px * r * 0.42, y + sa * r * 0.62 + py * r * 0.42,
      x + ca * r * 0.7, y + sa * r * 0.7);
  }
  g.lineStyle(1, color, alpha);
  g.strokeCircle(x, y, r * 0.2);
}

/** Defend: a shield. */
export function drawDefendGlyph(g: G, x: number, y: number, size: number, color: number, alpha = 1): void {
  const r = size / 2;
  g.lineStyle(1.3, color, alpha);
  g.beginPath();
  g.moveTo(x, y - r);
  g.lineTo(x + r * 0.8, y - r * 0.62);
  g.lineTo(x + r * 0.66, y + r * 0.25);
  g.lineTo(x, y + r);
  g.lineTo(x - r * 0.66, y + r * 0.25);
  g.lineTo(x - r * 0.8, y - r * 0.62);
  g.closePath();
  g.strokePath();
  g.lineBetween(x, y - r * 0.55, x, y + r * 0.55);
}

/** Liberate: a target reticle. */
export function drawLiberateGlyph(g: G, x: number, y: number, size: number, color: number, alpha = 1): void {
  const r = size / 2;
  g.lineStyle(1.2, color, alpha);
  g.strokeCircle(x, y, r * 0.62);
  g.lineBetween(x - r, y, x - r * 0.35, y);
  g.lineBetween(x + r * 0.35, y, x + r, y);
  g.lineBetween(x, y - r, x, y - r * 0.35);
  g.lineBetween(x, y + r * 0.35, x, y + r);
  g.fillStyle(color, alpha);
  g.fillCircle(x, y, Math.max(1, size * 0.07));
}

/** Patrol: an orbit with a ship arrow riding it. */
export function drawPatrolGlyph(g: G, x: number, y: number, size: number, color: number, alpha = 1): void {
  const r = size / 2;
  g.lineStyle(1.2, color, alpha * 0.85);
  g.beginPath();
  g.arc(x, y, r * 0.75, Math.PI * 0.15, Math.PI * 1.75, false);
  g.strokePath();
  drawChevron(g, x + r * 0.62, y - r * 0.45, size * 0.42, -Math.PI / 5, color, alpha);
}

/** The glyph of a call kind. */
export function drawKindGlyph(g: G, kind: CallKind, x: number, y: number, size: number, color: number, alpha = 1): void {
  if (kind === 'defend') drawDefendGlyph(g, x, y, size, color, alpha);
  else if (kind === 'liberate') drawLiberateGlyph(g, x, y, size, color, alpha);
  else drawPatrolGlyph(g, x, y, size, color, alpha);
}

/** Colour of a call kind: defend is urgent (danger), the others amber. */
export function kindColor(kind: CallKind): number {
  return kind === 'defend' ? COLORS.danger : COLORS.primary;
}

/** Filled arrow head pointing along `angle` (radians, 0 = right). */
export function drawChevron(g: G, x: number, y: number, size: number, angle: number, color: number, alpha = 1): void {
  const r = size / 2;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const tipX = x + c * r;
  const tipY = y + s * r;
  const backX = x - c * r * 0.7;
  const backY = y - s * r * 0.7;
  g.fillStyle(color, alpha);
  g.fillTriangle(tipX, tipY, backX - s * r * 0.75, backY + c * r * 0.75, x - c * r * 0.25, y - s * r * 0.25);
  g.fillTriangle(tipX, tipY, backX + s * r * 0.75, backY - c * r * 0.75, x - c * r * 0.25, y - s * r * 0.25);
}

/** Call blip: a small diamond with an outer tick ring. */
export function drawCallBlip(g: G, x: number, y: number, size: number, color: number, alpha = 1): void {
  const r = size / 2;
  g.fillStyle(color, alpha);
  g.fillTriangle(x, y - r * 0.55, x + r * 0.4, y, x - r * 0.4, y);
  g.fillTriangle(x, y + r * 0.55, x + r * 0.4, y, x - r * 0.4, y);
  g.lineStyle(1, color, alpha * 0.7);
  g.strokeCircle(x, y, r);
}
