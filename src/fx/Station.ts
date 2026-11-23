import Phaser from 'phaser';
import { COLORS, DEPTH, LINE_WIDTH } from '../ui/theme';
import { hasImage, IMG } from './assets';
import { sparks } from './BattleFx';
import { STATION_PIP_H, STATION_PIP_Y, STATION_W, STATION_Y } from './battleLayout';
import { StationWreck } from './StationWreck';
import { TEX } from './textures';

const PIP_W = 8;
const PIP_GAP = 3;

type Condition = 'intact' | 'damaged' | 'wreck';

/**
 * One defended orbital station: the station image (fallback: the procedural dome), tiny hp
 * pips under it, and its condition. Damaged: darker tint, flicker and occasional sparks.
 * Destroyed: the station blows up and is replaced by a drifting debris field (StationWreck);
 * a repair brings it back. Call update(dtMs) every frame (skip it while paused).
 */
export class Station {
  readonly x: number;
  readonly y = STATION_Y;
  private readonly sprite: Phaser.GameObjects.Image;
  private readonly pips: Phaser.GameObjects.Graphics;
  private readonly wreck: StationWreck;
  private condition: Condition = 'intact';
  private signature = '';
  private nextFlickerMs = 0;
  private flickerLeftMs = 0;

  private readonly scene: Phaser.Scene;

  constructor(scene: Phaser.Scene, x: number) {
    this.scene = scene;
    this.x = x;
    const key = hasImage(scene, IMG.ships.station) ? IMG.ships.station : TEX.dome;
    this.sprite = scene.add.image(x, STATION_Y, key).setDepth(DEPTH.world + 2);
    this.sprite.setScale(STATION_W / this.sprite.width);
    this.pips = scene.add.graphics().setDepth(DEPTH.world + 3);
    this.wreck = new StationWreck(scene, x, STATION_Y, key);
    this.nextFlickerMs = 800 + Math.random() * 2000;
  }

  /** Top of the station's visible body (where a descending ship meets it). */
  get top(): number {
    return STATION_Y - this.sprite.displayHeight * 0.4;
  }

  setHp(hp: number, maxHp: number): void {
    const sig = `${hp}/${maxHp}`;
    if (sig === this.signature) return;
    const first = this.signature === '';
    this.signature = sig;
    this.drawPips(hp, maxHp);
    const next: Condition = hp <= 0 ? 'wreck' : hp < maxHp ? 'damaged' : 'intact';
    if (next === this.condition) return;
    this.condition = next;
    this.sprite.setAlpha(1);
    if (next === 'intact') this.sprite.clearTint();
    else if (next === 'damaged') this.sprite.setTint(COLORS.textDim);
    else this.sprite.setTint(COLORS.disabled);
    this.sprite.setVisible(next !== 'wreck');
    if (next === 'wreck') this.wreck.show(!first);
    else this.wreck.hide();
  }

  update(dtMs: number): void {
    this.wreck.update(dtMs);
    if (this.condition !== 'damaged') return;
    if (this.flickerLeftMs > 0) {
      this.flickerLeftMs -= dtMs;
      // Two quick dips while the flicker lasts.
      this.sprite.setAlpha(Math.floor(this.flickerLeftMs / 60) % 2 === 0 ? 0.55 : 1);
      if (this.flickerLeftMs <= 0) this.sprite.setAlpha(1);
      return;
    }
    this.nextFlickerMs -= dtMs;
    if (this.nextFlickerMs > 0) return;
    this.nextFlickerMs = 1400 + Math.random() * 2400;
    this.flickerLeftMs = 240;
    const ox = (Math.random() - 0.5) * STATION_W * 0.7;
    const oy = (Math.random() - 0.5) * 16;
    sparks(this.scene, this.x + ox, STATION_Y + oy, COLORS.primary, 5, 40);
  }

  private drawPips(hp: number, maxHp: number): void {
    const g = this.pips;
    g.clear();
    const total = maxHp * PIP_W + (maxHp - 1) * PIP_GAP;
    const x0 = this.x - total / 2;
    for (let k = 0; k < maxHp; k++) {
      const px = x0 + k * (PIP_W + PIP_GAP);
      if (k < hp) {
        g.fillStyle(COLORS.ok, 0.95);
        g.fillRect(px, STATION_PIP_Y, PIP_W, STATION_PIP_H);
      } else {
        g.lineStyle(LINE_WIDTH, COLORS.textDim, 0.8);
        g.strokeRect(px + 0.5, STATION_PIP_Y + 0.5, PIP_W - 1, STATION_PIP_H - 1);
      }
    }
  }

  /** Frees the debris field objects (scene shutdown). */
  destroy(): void {
    this.wreck.destroy();
  }
}
