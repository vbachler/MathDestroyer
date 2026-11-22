import Phaser from 'phaser';
import { formatSolved } from '../core/facts';
import { formatNumber, MINUS } from '../core/i18n';
import type { I18n } from '../core/i18n';
import type { Fact } from '../core/types';
import { Panel } from '../ui/Panel';
import { labelStyle, numeralStyle } from '../ui/TextStyles';
import { COLORS, CSS, LINE_WIDTH, SIZES } from '../ui/theme';

const CARD_W = 420;
const CARD_H = 260;
const CARD_H_PLAIN = 110;
const DOT_MAX = 10;
const LINE_MAX = 20;

type Illustration = 'dots' | 'numberLine' | 'none';

function illustrationFor(f: Fact): Illustration {
  const in1to10 = (n: number): boolean => n >= 1 && n <= DOT_MAX;
  const in0to20 = (n: number): boolean => n >= 0 && n <= LINE_MAX;
  if (f.op === 'mul' && in1to10(f.a) && in1to10(f.b)) return 'dots';
  if ((f.op === 'add' || f.op === 'sub') && in0to20(f.a) && in0to20(f.b) && in0to20(f.result)) return 'numberLine';
  return 'none';
}

/**
 * Small card shown while the sim explains a fact that reached the planet: the solved fact and,
 * for small facts, a dot array or a number-line hop. No words, only numbers and shapes.
 * About 420x260 (110 tall when there is no picture). (x, y) is the card centre.
 */
export class ExplanationCard extends Phaser.GameObjects.Container {
  constructor(scene: Phaser.Scene, x: number, y: number, fact: Fact, i18n: I18n) {
    super(scene, x, y);
    const kind = illustrationFor(fact);
    const h = kind === 'none' ? CARD_H_PLAIN : CARD_H;
    const top = -h / 2;

    this.add(new Panel(scene, -CARD_W / 2, top, CARD_W, h, { borderColor: COLORS.accent, fillAlpha: 0.9 }));
    const solved = scene.add.text(0, kind === 'none' ? 0 : top + 34, formatSolved(fact, i18n.locale),
      numeralStyle({ fontSize: `${kind === 'none' ? SIZES.title + 6 : SIZES.title}px`, color: CSS.accent })).setOrigin(0.5);
    this.add(solved);

    const areaTop = top + 66;
    const areaH = h - 66 - 14;
    if (kind === 'dots') this.drawDots(fact, areaTop, areaH, i18n);
    else if (kind === 'numberLine') this.drawNumberLine(fact, areaTop, areaH, i18n);

    scene.add.existing(this);
  }

  /** `a` rows of `b` dots; the row and column counts as numbers beside the brackets. */
  private drawDots(f: Fact, top: number, height: number, i18n: I18n): void {
    const scene = this.scene;
    const rows = f.a;
    const cols = f.b;
    const step = Math.min(16, (height - 22) / Math.max(1, Math.max(rows, cols) - 1 + 0.8));
    const r = Math.max(2, step * 0.3);
    const gridW = (cols - 1) * step;
    const gridH = (rows - 1) * step;
    const ox = -gridW / 2 + 10;
    const oy = top + 18 + (height - 18 - gridH) / 2;

    const g = scene.add.graphics();
    g.fillStyle(COLORS.primary, 1);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) g.fillCircle(ox + col * step, oy + row * step, r);
    }
    g.lineStyle(LINE_WIDTH, COLORS.textDim, 0.9);
    const bt = oy - r - 7;
    g.lineBetween(ox - r, bt, ox + gridW + r, bt);
    g.lineBetween(ox - r, bt, ox - r, bt + 4);
    g.lineBetween(ox + gridW + r, bt, ox + gridW + r, bt + 4);
    const bl = ox - r - 8;
    g.lineBetween(bl, oy - r, bl, oy + gridH + r);
    g.lineBetween(bl, oy - r, bl + 4, oy - r);
    g.lineBetween(bl, oy + gridH + r, bl + 4, oy + gridH + r);

    const style = numeralStyle({ fontSize: `${SIZES.label + 1}px`, color: CSS.text });
    const colLabel = scene.add.text(ox + gridW / 2, bt - 3, formatNumber(cols, i18n.locale), style).setOrigin(0.5, 1);
    const rowLabel = scene.add.text(bl - 6, oy + gridH / 2, formatNumber(rows, i18n.locale), style).setOrigin(1, 0.5);
    this.add([g, colLabel, rowLabel]);
  }

  /** Number line 0..10 or 0..20 with one hop from a to the result. */
  private drawNumberLine(f: Fact, top: number, height: number, i18n: I18n): void {
    const scene = this.scene;
    const max = Math.max(f.a, f.result) <= 10 ? 10 : LINE_MAX;
    const lineW = CARD_W - 70;
    const x0 = -lineW / 2;
    const unit = lineW / max;
    const ly = top + height - 34;
    const xOf = (n: number): number => x0 + n * unit;

    const g = scene.add.graphics();
    g.lineStyle(LINE_WIDTH, COLORS.textDim, 1);
    g.lineBetween(x0 - 6, ly, x0 + lineW + 6, ly);
    const labels: Phaser.GameObjects.Text[] = [];
    for (let n = 0; n <= max; n++) {
      const major = n % 5 === 0;
      g.lineBetween(xOf(n), ly - (major ? 6 : 3), xOf(n), ly + (major ? 6 : 3));
      if (major && n !== f.a && n !== f.result) {
        labels.push(scene.add.text(xOf(n), ly + 9, formatNumber(n, i18n.locale), labelStyle()).setOrigin(0.5, 0));
      }
    }

    const sx = xOf(f.a);
    const ex = xOf(f.result);
    const arcH = Math.min(70, 22 + Math.abs(ex - sx) * 0.3);
    if (f.b !== 0) {
      const pts: Phaser.Math.Vector2[] = [];
      const n = 32;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        pts.push(new Phaser.Math.Vector2(sx + (ex - sx) * t, ly - Math.sin(Math.PI * t) * arcH));
      }
      g.lineStyle(2, COLORS.accent, 1);
      g.strokePoints(pts, false);
      const dir = Math.sign(ex - sx);
      g.fillStyle(COLORS.accent, 1);
      g.fillTriangle(ex, ly - 2, ex - dir * 10, ly - 12, ex - dir * 2, ly - 15);
      const sign = f.op === 'add' ? '+' : MINUS;
      labels.push(scene.add.text((sx + ex) / 2, ly - arcH - 4, `${sign}${f.b}`,
        numeralStyle({ fontSize: `${SIZES.body}px`, color: CSS.accent })).setOrigin(0.5, 1));
    }

    g.lineStyle(2, COLORS.text, 1);
    g.strokeCircle(sx, ly, 6);
    g.fillStyle(COLORS.ok, 1);
    g.fillCircle(ex, ly, 7);
    labels.push(scene.add.text(sx, ly + 10, formatNumber(f.a, i18n.locale),
      numeralStyle({ fontSize: `${SIZES.label}px` })).setOrigin(0.5, 0));
    if (ex !== sx) {
      labels.push(scene.add.text(ex, ly + 10, formatNumber(f.result, i18n.locale),
        numeralStyle({ fontSize: `${SIZES.body}px`, color: CSS.ok })).setOrigin(0.5, 0));
    }
    this.add([g, ...labels]);
  }
}
