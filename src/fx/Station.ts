import Phaser from 'phaser';
import { COLORS, DEPTH, LINE_WIDTH } from '../ui/theme';
import { hasImage, IMG } from './assets';
import { sparks } from './BattleFx';
import { STATION_PIP_H, STATION_PIP_Y, STATION_W, STATION_Y } from './battleLayout';
import { TEX } from './textures';

const PIP_W = 8;
const PIP_GAP = 3;

type Condition = 'intact' | 'damaged' | 'wreck';

/**
 * One defended orbital station: the station image (fallback: the procedural dome), tiny hp
 * pips under it, and its condition. Damaged: darker tint, flicker and occasional sparks.
 * Destroyed: dark wreck tint and slowly drifting debris. Call update(dtMs) every frame.
 */
export class Station {
  readonly x: number;
  readonly y = STATION_Y;
  private readonly sprite: Phaser.GameObjects.Image;
  private readonly pips: Phaser.GameObjects.Graphics;
  private wreckDebris: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
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
    this.nextFlickerMs = 800 + Math.random() * 2000;
  }

  /** Top of the station's visible body (where a descending ship meets it). */
  get top(): number {
    return STATION_Y - this.sprite.displayHeight * 0.4;
  }

  setHp(hp: number, maxHp: number): void {
    const sig = `${hp}/${maxHp}`;
    if (sig === this.signature) return;
    this.signature = sig;
    this.drawPips(hp, maxHp);
    const next: Condition = hp <= 0 ? 'wreck' : hp < maxHp ? 'damaged' : 'intact';
    if (next === this.condition) return;
    this.condition = next;
    this.sprite.setAlpha(1);
    if (next === 'intact') this.sprite.clearTint();
    else if (next === 'damaged') this.sprite.setTint(COLORS.textDim);
    else this.sprite.setTint(COLORS.disabled);
    if (next === 'wreck') this.startWreckDebris();
    else this.stopWreckDebris();
  }

  update(dtMs: number): void {
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

  private startWreckDebris(): void {
    if (this.wreckDebris) return;
    this.wreckDebris = this.scene.add.particles(this.x, STATION_Y, TEX.star, {
      x: { min: -STATION_W * 0.35, max: STATION_W * 0.35 },
      y: { min: -10, max: 10 },
      speed: { min: 3, max: 12 },
      angle: { min: 0, max: 360 },
      lifespan: { min: 2500, max: 4500 },
      scale: { min: 0.5, max: 1.1 },
      rotate: { start: 0, end: 180 },
      alpha: { start: 0.8, end: 0 },
      tint: [COLORS.textDim, COLORS.disabled],
      frequency: 260,
    }).setDepth(DEPTH.world + 1);
  }

  private stopWreckDebris(): void {
    if (!this.wreckDebris) return;
    const e = this.wreckDebris;
    this.wreckDebris = null;
    e.stop();
    this.scene.time.delayedCall(4600, () => e.destroy());
  }
}
