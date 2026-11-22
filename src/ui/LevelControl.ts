import Phaser from 'phaser';
import { numeralStyle } from './TextStyles';
import { COLORS, CSS, LINE_WIDTH, RADIUS, SIZES } from './theme';
import { addHitZone } from './hitZone';

const STEPS = 10;
const BTN = 40;
const SEG_W = 22;
const SEG_GAP = 4;
const SEG_H = 22;

export interface LevelControlLabels {
  decrease: string;
  increase: string;
  /** Formats the level (0..1) for display, e.g. "80 %". */
  format: (value: number) => string;
}

/**
 * Stepped 0..1 level in tenths: a "−" button, ten clickable segments, a "+" button and the value
 * as text. (x, y) is the left edge, vertically centred. Taps make no sound of their own; the caller
 * gives feedback in `onChange` (for a volume, after applying it). Adds itself to the scene.
 */
export class LevelControl extends Phaser.GameObjects.Container {
  private step: number;
  private readonly bars: Phaser.GameObjects.Graphics;
  private readonly valueText: Phaser.GameObjects.Text;
  private readonly labels: LevelControlLabels;
  private readonly onChange: (value: number) => void;

  constructor(scene: Phaser.Scene, x: number, y: number, value: number, labels: LevelControlLabels,
              onChange: (value: number) => void) {
    super(scene, x, y);
    this.step = Math.round(Math.min(1, Math.max(0, value)) * STEPS);
    this.labels = labels;
    this.onChange = onChange;
    this.bars = scene.add.graphics();
    this.add(this.bars);

    const segStart = BTN + 12;
    const plusX = segStart + STEPS * (SEG_W + SEG_GAP) + 8;
    this.addStepButton(scene, 0, labels.decrease, () => this.setStep(this.step - 1));
    this.addStepButton(scene, plusX, labels.increase, () => this.setStep(this.step + 1));
    for (let i = 0; i < STEPS; i++) {
      const sx = segStart + i * (SEG_W + SEG_GAP);
      this.add(addHitZone(scene, sx + SEG_W / 2, 0, SEG_W + SEG_GAP, BTN, () => this.setStep(i + 1), { sound: false }));
    }
    this.valueText = scene.add.text(plusX + BTN + 16, 0, '', numeralStyle({ fontSize: `${SIZES.label}px`, color: CSS.text }))
      .setOrigin(0, 0.5);
    this.add(this.valueText);
    this.redraw();
    scene.add.existing(this);
  }

  private addStepButton(scene: Phaser.Scene, left: number, label: string, onTap: () => void): void {
    const g = scene.add.graphics();
    g.fillStyle(COLORS.bgPanelHi, 1);
    g.fillRoundedRect(left, -BTN / 2, BTN, BTN, RADIUS);
    g.lineStyle(LINE_WIDTH, COLORS.primary, 0.9);
    g.strokeRoundedRect(left, -BTN / 2, BTN, BTN, RADIUS);
    const text = scene.add.text(left + BTN / 2, 0, label, numeralStyle({ fontSize: `${SIZES.body}px`, color: CSS.primary }))
      .setOrigin(0.5);
    const zone = addHitZone(scene, left + BTN / 2, 0, BTN, BTN, onTap, { sound: false });
    this.add([g, text, zone]);
  }

  private setStep(step: number): void {
    const next = Math.min(STEPS, Math.max(0, step));
    this.step = next;
    this.redraw();
    this.onChange(next / STEPS);
  }

  private redraw(): void {
    const g = this.bars;
    g.clear();
    const segStart = BTN + 12;
    for (let i = 0; i < STEPS; i++) {
      const sx = segStart + i * (SEG_W + SEG_GAP);
      const lit = i < this.step;
      g.fillStyle(lit ? COLORS.primary : COLORS.bgPanelHi, lit ? 0.9 : 1);
      g.fillRect(sx, -SEG_H / 2, SEG_W, SEG_H);
      g.lineStyle(1, COLORS.primaryDim, 0.9);
      g.strokeRect(sx, -SEG_H / 2, SEG_W, SEG_H);
    }
    this.valueText.setText(this.labels.format(this.step / STEPS));
  }
}
