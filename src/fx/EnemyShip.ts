import Phaser from 'phaser';
import { numeralStyle } from '../ui/TextStyles';
import { COLORS, CSS, LINE_WIDTH, SIZES } from '../ui/theme';
import { hasImage, IMG } from './assets';
import { TAG_GAP } from './battleLayout';
import type { Point, TagSide } from './battleLayout';
import { TEX } from './textures';

/** 0 = far, 1 = approaching, 2 = about to hit. */
export type ThreatLevel = 0 | 1 | 2;

const TAG_PAD_X = 9;
const TAG_PAD_Y = 3;
/** The aiming line shows in the last quarter of the charge. */
const AIM_FROM_CHARGE = 0.75;
/** Nose of the hull below the centre, as a fraction of the ship size (the nose points down). */
const NOSE = 0.42;

/** Visible hull width as a fraction of the 256 px frame (measured from the alpha of each image). */
const HULL_WIDTH: Readonly<Record<string, number>> = {
  [IMG.ships.enemyA]: 0.62,
  [IMG.ships.enemyB]: 0.56,
  [IMG.ships.enemyC]: 0.41,
};

/**
 * Hostile ship: image sprite (nose down) with a faint engine glow, scaled by depth, and its
 * problem on a compact dark tag beside it, joined by a hairline. The container origin is the
 * ship centre. The tag keeps its size (numerals SIZES.problem, never smaller) while the ship
 * grows; the scene picks the tag side (`setTagSide`) with layoutTags().
 */
export class EnemyShip extends Phaser.GameObjects.Container {
  readonly tagWidth: number;
  readonly tagHeight: number;

  private readonly hull: Phaser.GameObjects.Image;
  private readonly engine: Phaser.GameObjects.Image;
  private readonly noseGlow: Phaser.GameObjects.Image;
  private readonly aim: Phaser.GameObjects.Graphics;
  private charge: number | null = null;
  private readonly hairline: Phaser.GameObjects.Graphics;
  private readonly plate: Phaser.GameObjects.Graphics;
  private readonly text: Phaser.GameObjects.Text;
  private readonly hullFrac: number;
  private size = 0;
  private side: TagSide | null = null;
  private threat: ThreatLevel | -1 = -1;
  private glowPhase = Math.random() * Math.PI * 2;

  /** `texture` is enemyImageFor(enemy.id); a missing image falls back to the procedural hull. */
  constructor(scene: Phaser.Scene, x: number, y: number, problem: string, texture: string, size: number) {
    super(scene, x, y);
    const key = hasImage(scene, texture) ? texture : TEX.enemy;
    this.hullFrac = HULL_WIDTH[key] ?? 0.9;

    this.engine = scene.add.image(0, 0, TEX.glow)
      .setTint(COLORS.danger)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.hull = scene.add.image(0, 0, key);
    this.noseGlow = scene.add.image(0, 0, TEX.glow)
      .setTint(COLORS.danger)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false);
    this.aim = scene.add.graphics().setVisible(false);

    this.text = scene.add.text(0, 0, problem, numeralStyle({ fontSize: `${SIZES.problem}px`, color: CSS.text })).setOrigin(0.5);
    this.tagWidth = Math.ceil(this.text.width) + TAG_PAD_X * 2;
    this.tagHeight = Math.ceil(this.text.height) + TAG_PAD_Y * 2;
    this.hairline = scene.add.graphics();
    this.plate = scene.add.graphics();

    this.add([this.aim, this.engine, this.hull, this.noseGlow, this.hairline, this.plate, this.text]);
    this.setShipSize(size);
    this.setTagSide('right');
    this.setThreat(0);
    scene.add.existing(this);
  }

  /** Half the visible hull width at the current size. */
  get shipHalfWidth(): number {
    return (this.size * this.hullFrac) / 2;
  }

  get shipHalfHeight(): number {
    return this.size / 2;
  }

  get shipSize(): number {
    return this.size;
  }

  /** Ship length in px (the 256 px frame scaled to it). */
  setShipSize(size: number): this {
    if (Math.abs(size - this.size) < 0.25) return this;
    this.size = size;
    this.hull.setScale(size / this.hull.width);
    // Engines are at the top of the hull (the nose points down).
    this.engine.setPosition(0, -size * 0.42).setScale((size * 0.9) / 128, (size * 0.55) / 128);
    if (this.side) this.layoutTag(this.side, true);
    return this;
  }

  setTagSide(side: TagSide): this {
    if (side === this.side) return this;
    this.layoutTag(side, false);
    return this;
  }

  setThreat(level: ThreatLevel): this {
    if (level === this.threat) return this;
    this.threat = level;
    this.drawTag();
    return this;
  }

  /** Nose of the hull in view coordinates (where an armed ship's shot leaves). */
  get nose(): Point {
    return { x: this.x, y: this.y + this.size * NOSE };
  }

  /**
   * Armed ship: `charge` 0..1 (null = unarmed). A red glow at the nose grows with the charge;
   * in the last quarter a hairline red aiming line runs to `target` (the cockpit, view coords).
   */
  setCharge(charge: number | null, target: Point): this {
    this.charge = charge;
    if (charge === null) {
      this.noseGlow.setVisible(false);
      this.aim.setVisible(false);
      return this;
    }
    const c = Math.min(1, Math.max(0, charge));
    const flicker = 0.85 + 0.15 * Math.sin(this.glowPhase * 3.1);
    this.noseGlow.setVisible(true)
      .setPosition(0, this.size * NOSE)
      .setScale((this.size * (0.35 + 1.1 * c)) / 128)
      .setAlpha((0.35 + 0.6 * c) * flicker);
    const g = this.aim;
    if (c < AIM_FROM_CHARGE) {
      g.setVisible(false);
      return this;
    }
    const k = (c - AIM_FROM_CHARGE) / (1 - AIM_FROM_CHARGE);
    g.clear().setVisible(true);
    g.lineStyle(LINE_WIDTH, COLORS.danger, (0.25 + 0.55 * k) * flicker);
    g.lineBetween(0, this.size * NOSE, target.x - this.x, target.y - this.y);
    return this;
  }

  /** Engine glow shimmer; call every frame. */
  tick(dtMs: number): void {
    this.glowPhase += dtMs * 0.012;
    this.engine.setAlpha(0.32 + 0.1 * Math.sin(this.glowPhase) + 0.05 * Math.sin(this.glowPhase * 2.7));
    if (this.charge !== null) {
      // A hot white core flickers in once the shot is close.
      const c = this.charge;
      this.noseGlow.setTint(c > 0.85 && Math.sin(this.glowPhase * 7) > 0 ? 0xffb0a0 : COLORS.danger);
    }
  }

  /** Arrival: fades in while the hull drops into place. */
  playEntry(durationMs = 500): this {
    this.setAlpha(0);
    this.scene.tweens.add({ targets: this, alpha: 1, duration: durationMs, ease: 'Quad.easeOut' });
    for (const part of [this.hull, this.engine]) {
      const y = part.y;
      part.y = y - 18;
      this.scene.tweens.add({ targets: part, y, duration: durationMs, ease: 'Cubic.easeOut' });
    }
    return this;
  }

  private layoutTag(side: TagSide, force: boolean): void {
    if (!force && side === this.side) return;
    this.side = side;
    const dir = side === 'right' ? 1 : -1;
    const near = dir * (this.shipHalfWidth + TAG_GAP);
    this.text.setPosition(near + dir * (this.tagWidth / 2), 0);
    this.drawTag();
  }

  private drawTag(): void {
    if (!this.side) return;
    const dir = this.side === 'right' ? 1 : -1;
    const w = this.tagWidth;
    const h = this.tagHeight;
    const near = dir * (this.shipHalfWidth + TAG_GAP);
    const left = dir > 0 ? near : near - w;
    const critical = this.threat === 2;
    const frame = critical ? COLORS.danger : COLORS.primary;

    const p = this.plate;
    p.clear();
    // Opaque enough to stay legible over the bright planet.
    p.fillStyle(COLORS.plate, 0.9);
    p.fillRect(left, -h / 2, w, h);
    p.lineStyle(LINE_WIDTH, frame, this.threat === 0 ? 0.75 : 1);
    p.strokeRect(left + 0.5, -h / 2 + 0.5, w - 1, h - 1);
    if (this.threat >= 1) {
      // Short bar on the outer edge: a shape cue that does not depend on colour.
      p.fillStyle(frame, 1);
      p.fillRect(dir > 0 ? left + w - 3 : left, -h / 2, 3, h);
    }

    const g = this.hairline;
    g.clear();
    const from = dir * (this.shipHalfWidth + 2);
    g.lineStyle(LINE_WIDTH, frame, 0.7);
    g.lineBetween(from, 0.5, near, 0.5);
    if (critical) {
      // Downward chevron on the hairline: about to hit.
      const mx = (from + near) / 2;
      g.fillStyle(frame, 1);
      g.fillTriangle(mx - 4, -3, mx + 4, -3, mx, 3);
    }
  }
}
