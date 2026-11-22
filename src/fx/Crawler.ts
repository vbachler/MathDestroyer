import Phaser from 'phaser';
import { numeralStyle } from '../ui/TextStyles';
import { COLORS, CSS, DEPTH, LINE_WIDTH, SIZES } from '../ui/theme';
import { crawlerImageFor, crawlerWalkFor, hasImage, WALK_FRAMES } from './assets';
import type { CrawlerImageKind } from './assets';
import { TAG_GAP } from './battleLayout';
import type { Point, TagSide } from './battleLayout';
import {
  brightness, CRAWLER_NEAR_W, depthOrder, floorPoint, GAIT, gaitHz, gaitPose, perspectiveScale,
} from './boardingLayout';
import { CRAWLER_FALLBACK } from './textures';

const TAG_PAD_X = 9;
const TAG_PAD_Y = 3;
/** Below this z the tag frame turns red: about to bite. */
const CLOSE_Z = 0.22;
const ENTRY_MS = 700;

/** Opaque vertical extent of each processed image (fractions of the 512 px frame, measured). */
const FRAME: Readonly<Record<CrawlerImageKind, { top: number; foot: number }>> = {
  scorpion: { top: 0.025, foot: 0.975 },
  spider: { top: 0.23, foot: 0.77 },
  crab: { top: 0.035, foot: 0.965 },
  beetle: { top: 0, foot: 1 },
};
/** Union of the opaque extent over the 16 walk-cycle cells (fractions of the 256 px cell, measured). */
const WALK_FRAME: Readonly<Record<CrawlerImageKind, { top: number; foot: number }>> = {
  scorpion: { top: 0.023, foot: 0.973 },
  spider: { top: 0.23, foot: 0.766 },
  crab: { top: 0.059, foot: 0.938 },
  beetle: { top: 0, foot: 0.992 },
};
/** Walk-cycle frame rate at speed factor 1 (the crawler's speed relative to UNIT_SPEED). */
const WALK_FPS = 12;

/** The code-drawn fallbacks: body roughly 0.2..0.9 of the 256 px frame. */
const FALLBACK_FRAME = { top: 0.2, foot: 0.9 };

/**
 * One boarding crawler, standing on the hangar floor in one-point perspective. With its
 * walk-cycle sheet it plays the 16-frame loop (rate follows its approach speed) plus a bob and
 * zig-zag in code; without it, a still animated in code (leg skitter as a quick rock and
 * squash, bob, zig-zag). It stands on the hangar floor in one-point perspective, with its
 * problem on the same compact dark tag the battle ships carry. The container origin is the
 * crawler's feet; the body pivots there.
 */
export class Crawler extends Phaser.GameObjects.Container {
  readonly id: number;
  readonly tagWidth: number;
  readonly tagHeight: number;

  private readonly kind: CrawlerImageKind;
  private readonly sprite: Phaser.GameObjects.Sprite;
  /** True when the walk-cycle sheet plays (no fake rock/squash skitter then). */
  private readonly walking: boolean;
  private readonly shadow: Phaser.GameObjects.Ellipse;
  private readonly hairline: Phaser.GameObjects.Graphics;
  private readonly plate: Phaser.GameObjects.Graphics;
  private readonly text: Phaser.GameObjects.Text;
  private readonly frame: { top: number; foot: number };
  private readonly frameScale: number;   // display width at scale 1 / texture width
  private readonly seed = Math.random() * Math.PI * 2;
  private clock = 0;
  private legPhase = 0;
  private depthZ_ = 1;
  private side: TagSide | null = null;
  private close = false;
  private drawnW = 0;
  private drawnH = 0;
  /** Set while the bite lunge runs: the crawler no longer follows the floor. */
  private lunging = false;

  /**
   * @param speedFactor  approach speed relative to the base speed (1 = a speed-1 crawler at
   *   game speed 1); the walk cycle runs at WALK_FPS times this.
   */
  constructor(scene: Phaser.Scene, id: number, kind: CrawlerImageKind, problem: string, speedFactor = 1) {
    super(scene, 0, 0);
    this.id = id;
    this.kind = kind;
    const sheet = crawlerWalkFor(kind);
    const image = crawlerImageFor(kind);
    this.walking = hasImage(scene, sheet);
    const real = hasImage(scene, image);
    const key = this.walking ? sheet : real ? image : CRAWLER_FALLBACK[kind];
    this.frame = this.walking ? WALK_FRAME[kind] : real ? FRAME[kind] : FALLBACK_FRAME;

    this.shadow = scene.add.ellipse(0, 0, 10, 4, 0x000000, 0.5);
    this.sprite = scene.add.sprite(0, 0, key, 0).setOrigin(0.5, this.frame.foot);
    this.frameScale = CRAWLER_NEAR_W / this.sprite.width;
    if (this.walking) {
      const anim = `${sheet}-loop`;
      if (!scene.anims.exists(anim)) {
        scene.anims.create({
          key: anim, frames: scene.anims.generateFrameNumbers(sheet, { start: 0, end: WALK_FRAMES - 1 }),
          frameRate: WALK_FPS, repeat: -1,
        });
      }
      this.sprite.play({ key: anim, startFrame: Math.floor(Math.random() * WALK_FRAMES) });
      this.sprite.anims.timeScale = Math.max(0.3, speedFactor);
    }

    this.text = scene.add.text(0, 0, problem, numeralStyle({ fontSize: `${SIZES.problem}px`, color: CSS.text })).setOrigin(0.5);
    this.tagWidth = Math.ceil(this.text.width) + TAG_PAD_X * 2;
    this.tagHeight = Math.ceil(this.text.height) + TAG_PAD_Y * 2;
    this.hairline = scene.add.graphics();
    this.plate = scene.add.graphics();
    this.add([this.shadow, this.sprite, this.hairline, this.plate, this.text]);

    // Emerges from the gloom of the door.
    this.sprite.setAlpha(0);
    for (const o of [this.hairline, this.plate, this.text]) o.setAlpha(0);
    scene.tweens.add({ targets: this.sprite, alpha: 1, duration: ENTRY_MS, ease: 'Quad.easeOut' });
    scene.tweens.add({ targets: [this.hairline, this.plate, this.text], alpha: 1, delay: ENTRY_MS * 0.4, duration: 300 });
    scene.add.existing(this);
  }

  /** Half the drawn body width (for tag layout). */
  get halfWidth(): number { return this.drawnW / 2; }
  get halfHeight(): number { return this.drawnH / 2; }
  /** Centre of the drawn body in view coordinates. */
  get centre(): Point { return { x: this.x, y: this.y - this.drawnH / 2 }; }
  get depthZ(): number { return this.depthZ_; }

  /** Follows the sim: depth z and lane. Call every frame with the frame time. */
  follow(dtMs: number, z: number, lane: number): this {
    if (this.lunging) return this;
    this.clock += dtMs;
    this.depthZ_ = z;
    if (this.walking) {
      // Our own pause (dt 0) freezes the walk too.
      if (dtMs <= 0 && this.sprite.anims.isPlaying) this.sprite.anims.pause();
      else if (dtMs > 0 && this.sprite.anims.isPaused) this.sprite.anims.resume();
    }
    const style = GAIT[this.kind];
    this.legPhase += (dtMs / 1000) * gaitHz(style, z) * Math.PI * 2;
    const pose = gaitPose(style, this.clock, this.legPhase, this.seed);
    const s = perspectiveScale(z);
    const feet = floorPoint(z, lane, pose.sway);
    const width = CRAWLER_NEAR_W * s;
    this.drawnW = width;
    this.drawnH = width * (this.frame.foot - this.frame.top);
    this.setPosition(feet.x, feet.y);

    const k = this.frameScale * s;
    if (this.walking) this.sprite.setScale(k).setY(-pose.lift * 0.5 * this.drawnH);
    else this.sprite.setScale(k * pose.scaleX, k * pose.scaleY).setRotation(pose.rotation).setY(-pose.lift * this.drawnH);
    const b = brightness(z);
    const c = (f: number): number => Math.round(255 * Math.min(1, b * f));
    this.sprite.setTint(Phaser.Display.Color.GetColor(c(0.92), c(0.96), c(1)));
    this.shadow.setSize(width * 0.8, Math.max(2, width * 0.12)).setAlpha(0.25 + 0.4 * b)
      .setScale(1 - 0.25 * pose.lift / Math.max(0.001, GAIT[this.kind].bob));
    this.setDepth(DEPTH.enemies + depthOrder(z) * 5);

    const close = z < CLOSE_Z;
    if (close !== this.close) {
      this.close = close;
      this.drawTag();
    }
    if (this.side) this.placeTag();
    return this;
  }

  setTagSide(side: TagSide): this {
    if (side === this.side) return this;
    this.side = side;
    this.placeTag();
    this.drawTag();
    return this;
  }

  /**
   * The bite: the crawler leaps at the viewer until it fills the screen, then the caller
   * flashes and shakes. `onDone` runs when the lunge ends (the crawler is destroyed after it).
   */
  lunge(onDone: () => void): void {
    this.lunging = true;
    for (const o of [this.hairline, this.plate, this.text, this.shadow]) o.setVisible(false);
    this.setDepth(DEPTH.overlay - 10);
    const target = (3.4 * this.scene.scale.width) / this.sprite.width;
    this.sprite.setTint(0xffffff);
    this.scene.tweens.add({
      targets: this, x: this.scene.scale.width / 2, y: this.scene.scale.height * 1.55, duration: 220, ease: 'Quad.easeIn',
    });
    this.scene.tweens.add({
      targets: this.sprite, scaleX: target, scaleY: target, rotation: this.sprite.rotation * 3, duration: 220, ease: 'Quad.easeIn',
      onComplete: () => {
        onDone();
        this.scene.tweens.add({ targets: this, alpha: 0, duration: 120, onComplete: () => this.destroy() });
      },
    });
  }

  private placeTag(): void {
    if (!this.side) return;
    const dir = this.side === 'right' ? 1 : -1;
    const near = dir * (this.drawnW / 2 + TAG_GAP);
    const cy = -this.drawnH / 2;
    this.text.setPosition(near + dir * (this.tagWidth / 2), cy);
    this.drawTag();
  }

  private drawTag(): void {
    if (!this.side) return;
    const dir = this.side === 'right' ? 1 : -1;
    const w = this.tagWidth;
    const h = this.tagHeight;
    const cy = -this.drawnH / 2;
    const near = dir * (this.drawnW / 2 + TAG_GAP);
    const left = dir > 0 ? near : near - w;
    const frame = this.close ? COLORS.danger : COLORS.primary;

    const p = this.plate;
    p.clear();
    p.fillStyle(COLORS.plate, 0.9);
    p.fillRect(left, cy - h / 2, w, h);
    p.lineStyle(LINE_WIDTH, frame, this.close ? 1 : 0.8);
    p.strokeRect(left + 0.5, cy - h / 2 + 0.5, w - 1, h - 1);
    if (this.close) {
      p.fillStyle(frame, 1);
      p.fillRect(dir > 0 ? left + w - 3 : left, cy - h / 2, 3, h);
    }
    const g = this.hairline;
    g.clear();
    g.lineStyle(LINE_WIDTH, frame, 0.7);
    g.lineBetween(dir * (this.drawnW * 0.3), cy + 0.5, near, cy + 0.5);
  }
}
