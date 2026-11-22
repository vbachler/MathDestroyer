import Phaser from 'phaser';
import { labelStyle } from './TextStyles';
import { COLORS, CSS, LINE_WIDTH } from './theme';
import { addHitZone } from './hitZone';

const TRACK_W = 64;
const TRACK_H = 30;

/**
 * On/off switch with a state word next to it (never colour alone). (x, y) is the left edge,
 * vertically centred. The toggle adds itself to the scene.
 */
export class Toggle extends Phaser.GameObjects.Container {
  private value: boolean;
  private readonly track: Phaser.GameObjects.Graphics;
  private readonly stateText: Phaser.GameObjects.Text;
  private readonly labels: { on: string; off: string };

  constructor(scene: Phaser.Scene, x: number, y: number, value: boolean,
              labels: { on: string; off: string }, onChange: (value: boolean) => void) {
    super(scene, x, y);
    this.value = value;
    this.labels = labels;
    this.track = scene.add.graphics();
    this.stateText = scene.add.text(TRACK_W + 14, 0, '', labelStyle({ color: CSS.text })).setOrigin(0, 0.5);
    const onW = this.stateText.setText(labels.on).width;
    const textW = Math.max(onW, this.stateText.setText(labels.off).width);
    const hitW = TRACK_W + 14 + textW + 8;
    const zone = addHitZone(scene, hitW / 2 - 4, 0, hitW, TRACK_H + 16, () => {
      this.value = !this.value;
      this.redraw();
      onChange(this.value);
    });
    this.add([this.track, this.stateText, zone]);
    this.redraw();
    scene.add.existing(this);
  }

  private redraw(): void {
    const g = this.track;
    const on = this.value;
    const c = on ? COLORS.primary : COLORS.textDim;
    g.clear();
    g.fillStyle(COLORS.bgPanelHi, 1);
    g.fillRoundedRect(0, -TRACK_H / 2, TRACK_W, TRACK_H, TRACK_H / 2);
    g.fillStyle(c, on ? 0.35 : 0.12);
    g.fillRoundedRect(0, -TRACK_H / 2, TRACK_W, TRACK_H, TRACK_H / 2);
    g.lineStyle(LINE_WIDTH, c, 0.95);
    g.strokeRoundedRect(0, -TRACK_H / 2, TRACK_W, TRACK_H, TRACK_H / 2);
    g.fillStyle(on ? COLORS.primary : COLORS.textDim, 1);
    g.fillCircle(on ? TRACK_W - TRACK_H / 2 : TRACK_H / 2, 0, TRACK_H / 2 - 5);
    this.stateText.setText(on ? this.labels.on : this.labels.off);
    this.stateText.setColor(on ? CSS.text : CSS.textDim);
  }
}
