import Phaser from 'phaser';
import { BRACKET, COLORS, CSS, FONT_UI, LETTER_SPACING, LINE_WIDTH, SIZES, SPACING } from './theme';

export interface PanelOptions {
  title?: string;
  borderColor?: number;    // corner bracket colour, default COLORS.primary (amber)
  fillAlpha?: number;      // backing alpha, default 0.35
}

const TITLE_HEIGHT = 24;

/**
 * Almost invisible HUD panel (Theme v2): a faint dark backing, thin corner brackets and an
 * optional small caps title. No filled box with a border.
 * (x, y) is the TOP-LEFT corner; children added with `add()` use panel-local coordinates
 * (use `contentTop` to place content below the title). The panel adds itself to the scene.
 */
export class Panel extends Phaser.GameObjects.Container {
  private readonly frame: Phaser.GameObjects.Graphics;
  private readonly titleText: Phaser.GameObjects.Text;
  private panelW: number;
  private panelH: number;
  private readonly borderColor: number;
  private readonly fillAlpha: number;

  constructor(scene: Phaser.Scene, x: number, y: number, width: number, height: number, opts: PanelOptions = {}) {
    super(scene, x, y);
    this.panelW = width;
    this.panelH = height;
    this.borderColor = opts.borderColor ?? COLORS.primary;
    this.fillAlpha = opts.fillAlpha ?? 0.35;
    this.frame = scene.add.graphics();
    this.titleText = scene.add.text(SPACING.m, TITLE_HEIGHT / 2 + 1, '', {
      fontFamily: FONT_UI,
      fontSize: `${SIZES.small + 1}px`,
      fontStyle: '600',
      color: CSS.primary,
      letterSpacing: LETTER_SPACING.caps,
    }).setOrigin(0, 0.5);
    this.add([this.frame, this.titleText]);
    this.setSize(width, height);
    this.setTitle(opts.title ?? '');
    scene.add.existing(this);
  }

  get panelWidth(): number { return this.panelW; }
  get panelHeight(): number { return this.panelH; }

  /** Local y where content should start (below the title bar if there is a title). */
  get contentTop(): number {
    return this.titleText.text ? TITLE_HEIGHT + SPACING.s : SPACING.m;
  }

  setTitle(title: string): this {
    this.titleText.setText(title.toUpperCase());
    this.redraw();
    return this;
  }

  resize(width: number, height: number): this {
    this.panelW = width;
    this.panelH = height;
    this.setSize(width, height);
    this.redraw();
    return this;
  }

  private redraw(): void {
    const g = this.frame;
    const w = this.panelW;
    const h = this.panelH;
    g.clear();
    g.fillStyle(COLORS.bgPanel, this.fillAlpha);
    g.fillRect(0, 0, w, h);
    if (this.titleText.text) {
      g.lineStyle(LINE_WIDTH, this.borderColor, 0.25);
      g.lineBetween(SPACING.s, TITLE_HEIGHT + 0.5, w - SPACING.s, TITLE_HEIGHT + 0.5);
    }
    drawBrackets(g, 0, 0, w, h, this.borderColor, 0.85);
  }
}

/** Thin corner brackets around the rectangle (x, y, w, h), 1 px lines. Shared with ImageCard. */
export function drawBrackets(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number,
                             color: number, alpha = 0.85, size = BRACKET): void {
  const c = Math.min(size, w / 3, h / 3);
  const l = x + 0.5; const t = y + 0.5; const r = x + w - 0.5; const b = y + h - 0.5;
  g.lineStyle(LINE_WIDTH, color, alpha);
  g.beginPath();
  g.moveTo(l, t + c); g.lineTo(l, t); g.lineTo(l + c, t);
  g.moveTo(r - c, t); g.lineTo(r, t); g.lineTo(r, t + c);
  g.moveTo(r, b - c); g.lineTo(r, b); g.lineTo(r - c, b);
  g.moveTo(l + c, b); g.lineTo(l, b); g.lineTo(l, b - c);
  g.strokePath();
}
