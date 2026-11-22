import Phaser from 'phaser';
import { hasImage } from '../fx/assets';
import { TEX } from '../fx/textures';
import { Button } from './Button';
import { drawBrackets } from './Panel';
import { capsStyle, labelStyle, numeralStyle } from './TextStyles';
import { COLORS, CSS, LINE_WIDTH, SIZES } from './theme';

export interface ImageCardOptions {
  /** Texture key of the picture (e.g. iconFor(id)); a missing texture shows a plain placeholder. */
  texture: string;
  /** Short name (at most two words); shown in caps. */
  name: string;
  width?: number;            // default 200
  height?: number;           // default 268 (picture square + name + pips); grows by 18 with subtitle, 22 with price
  /** Owned tier: this many pips are filled. */
  tier?: number;             // default 0
  /** Number of pips; 0 hides the pip row. */
  maxTier?: number;          // default 3
  /** Outline the next pip in teal (the tier a pick would add). */
  highlightNext?: boolean;   // default false
  /** One short line under the name (station modules: at most six words). */
  subtitle?: string;
  /** Optional number (price) in amber numerals; null/undefined hides it. */
  price?: number | null;
  /** Small key hint drawn in the top-left corner of the picture, e.g. '1'. */
  hotkey?: string;
  onClick?: () => void;
}

type VisualState = 'idle' | 'hover' | 'pressed' | 'disabled';

const PAD = 10;
const PIP_W = 18;
const PIP_H = 4;
const PIP_GAP = 5;

/**
 * Picture card for upgrades and station modules: image, short caps name, tier pips and an
 * optional number (price). (x, y) is the CENTRE. Hover / pressed / disabled states; the click
 * fires on release over the card after a press that started on it (mouse and touch).
 * `playInstalled()` plays a ~500 ms "installed" animation (pip fills, flash, pop).
 * The card adds itself to the scene.
 */
export class ImageCard extends Phaser.GameObjects.Container {
  readonly cardWidth: number;
  readonly cardHeight: number;

  private readonly frame: Phaser.GameObjects.Graphics;
  private readonly picture: Phaser.GameObjects.Image | null;
  private readonly placeholder: Phaser.GameObjects.Graphics | null;
  private readonly flash: Phaser.GameObjects.Rectangle;
  private readonly nameText: Phaser.GameObjects.Text;
  private readonly subtitleText: Phaser.GameObjects.Text | null;
  private readonly priceText: Phaser.GameObjects.Text | null;
  private readonly pips: Phaser.GameObjects.Graphics;
  private readonly picSize: number;
  private readonly picTop: number;
  private readonly pipsY: number;

  private tier: number;
  private readonly maxTier: number;
  private highlightNext: boolean;
  private enabled = true;
  private hovered = false;
  private pressed = false;
  private busy = false;
  private onClick: (() => void) | null;

  constructor(scene: Phaser.Scene, x: number, y: number, opts: ImageCardOptions) {
    super(scene, x, y);
    const w = opts.width ?? 200;
    const hasPrice = opts.price !== undefined && opts.price !== null;
    const extra = (opts.subtitle ? 18 : 0) + (hasPrice ? 22 : 0);
    const h = opts.height ?? 268 + extra;
    this.cardWidth = w;
    this.cardHeight = h;
    this.tier = opts.tier ?? 0;
    this.maxTier = opts.maxTier ?? 3;
    this.highlightNext = opts.highlightNext ?? false;
    this.onClick = opts.onClick ?? null;

    const left = -w / 2;
    const top = -h / 2;
    this.picSize = w - PAD * 2;
    this.picTop = top + PAD;

    this.frame = scene.add.graphics();
    this.add(this.frame);

    if (hasImage(scene, opts.texture)) {
      this.picture = scene.add.image(0, this.picTop + this.picSize / 2, opts.texture).setDisplaySize(this.picSize, this.picSize);
      this.placeholder = null;
      this.add(this.picture);
    } else {
      this.picture = null;
      this.placeholder = scene.add.graphics();
      this.placeholder.fillStyle(COLORS.bgPanelHi, 0.8);
      this.placeholder.fillRect(left + PAD, this.picTop, this.picSize, this.picSize);
      this.placeholder.lineStyle(LINE_WIDTH, COLORS.accent, 0.5);
      this.placeholder.strokeCircle(0, this.picTop + this.picSize / 2, this.picSize * 0.22);
      this.add(this.placeholder);
    }
    this.flash = scene.add.rectangle(0, this.picTop + this.picSize / 2, this.picSize, this.picSize, COLORS.primary, 1)
      .setAlpha(0).setBlendMode(Phaser.BlendModes.ADD);
    this.add(this.flash);

    if (opts.hotkey) {
      this.add(scene.add.text(left + PAD + 6, this.picTop + 4, opts.hotkey,
        numeralStyle({ fontSize: `${SIZES.label}px`, color: CSS.primary, backgroundColor: '#000000aa', padding: { x: 4, y: 1 } })));
    }

    let cursor = this.picTop + this.picSize + 10;
    this.nameText = scene.add.text(0, cursor, opts.name.toUpperCase(),
      capsStyle({ fontSize: `${SIZES.label + 2}px`, color: CSS.text, align: 'center', wordWrap: { width: w - PAD * 2 } }))
      .setOrigin(0.5, 0);
    this.add(this.nameText);
    cursor += 22;

    if (opts.subtitle) {
      this.subtitleText = scene.add.text(0, cursor, opts.subtitle,
        labelStyle({ fontSize: `${SIZES.small + 1}px`, align: 'center', wordWrap: { width: w - PAD * 2 } })).setOrigin(0.5, 0);
      this.add(this.subtitleText);
      cursor += 18;
    } else {
      this.subtitleText = null;
    }

    this.pipsY = cursor + 6;
    this.pips = scene.add.graphics();
    this.add(this.pips);
    cursor += this.maxTier > 0 ? 16 : 0;

    if (hasPrice) {
      this.priceText = scene.add.text(0, cursor, String(opts.price), numeralStyle({ fontSize: `${SIZES.heading}px`, color: CSS.primary }))
        .setOrigin(0.5, 0);
      this.add(this.priceText);
    } else {
      this.priceText = null;
    }

    this.setSize(w, h);
    this.setInteractive({ useHandCursor: true });
    this.on(Phaser.Input.Events.POINTER_OVER, () => { this.hovered = true; this.redraw(); });
    this.on(Phaser.Input.Events.POINTER_OUT, () => { this.hovered = false; this.pressed = false; this.redraw(); });
    this.on(Phaser.Input.Events.POINTER_DOWN, () => {
      if (!this.enabled || this.busy) return;
      this.pressed = true;
      this.redraw();
    });
    this.on(Phaser.Input.Events.POINTER_UP, (pointer: Phaser.Input.Pointer) => {
      const fire = this.enabled && this.pressed && !this.busy;
      this.pressed = false;
      if (pointer.wasTouch) this.hovered = false;
      this.redraw();
      if (fire) this.click();
    });

    this.redraw();
    scene.add.existing(this);
  }

  /** Same as a tap: runs onClick when enabled (use it for keyboard shortcuts). */
  click(): void {
    if (!this.enabled || this.busy || !this.onClick) return;
    Button.clickSound?.();
    this.onClick();
  }

  setOnClick(onClick: (() => void) | null): this {
    this.onClick = onClick;
    return this;
  }

  setEnabled(enabled: boolean): this {
    this.enabled = enabled;
    if (!enabled) this.pressed = false;
    if (this.input) this.input.cursor = enabled ? 'pointer' : 'default';
    this.redraw();
    return this;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setTier(tier: number, highlightNext = this.highlightNext): this {
    this.tier = Math.max(0, Math.min(this.maxTier, tier));
    this.highlightNext = highlightNext;
    this.redraw();
    return this;
  }

  /** Changes the number; null hides it (only for cards created with a price). */
  setPrice(price: number | null): this {
    if (this.priceText) this.priceText.setText(price === null ? '' : String(price)).setVisible(price !== null);
    return this;
  }

  /**
   * "Installed" animation, about 500 ms: the next pip fills, the picture flashes amber, the card
   * pops and its brackets glow. Input on the card is ignored while it plays. `onComplete` runs
   * at the end (e.g. to close the overlay).
   */
  playInstalled(onComplete?: () => void): void {
    this.busy = true;
    this.pressed = false;
    if (this.tier < this.maxTier) this.tier++;
    this.highlightNext = false;
    this.setScale(1);
    this.redraw(true);
    const scene = this.scene;
    const glow = scene.add.image(0, this.picTop + this.picSize / 2, TEX.glow)
      .setTint(COLORS.primary).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.8)
      .setScale((this.picSize * 1.2) / 128);
    this.addAt(glow, 1);
    this.flash.setAlpha(0.55);
    scene.tweens.add({ targets: this.flash, alpha: 0, duration: 420, ease: 'Quad.easeOut' });
    scene.tweens.add({
      targets: glow, alpha: 0, scale: glow.scale * 1.35, duration: 500, ease: 'Cubic.easeOut',
      onComplete: () => glow.destroy(),
    });
    scene.tweens.add({ targets: this, scale: 1.06, duration: 120, yoyo: true, ease: 'Quad.easeOut' });
    scene.time.delayedCall(500, () => {
      this.busy = false;
      this.redraw();
      onComplete?.();
    });
  }

  private visualState(): VisualState {
    if (!this.enabled) return 'disabled';
    if (this.pressed) return 'pressed';
    if (this.hovered) return 'hover';
    return 'idle';
  }

  private redraw(installed = false): void {
    const st = this.visualState();
    const w = this.cardWidth;
    const h = this.cardHeight;
    const g = this.frame;
    g.clear();
    g.fillStyle(COLORS.bg, st === 'hover' || st === 'pressed' ? 0.75 : 0.55);
    g.fillRect(-w / 2, -h / 2, w, h);
    const color = st === 'disabled' ? COLORS.disabled : COLORS.primary;
    if (st === 'hover' || st === 'pressed' || installed) {
      g.lineStyle(LINE_WIDTH, color, 0.35);
      g.strokeRect(-w / 2 + 0.5, -h / 2 + 0.5, w - 1, h - 1);
    }
    drawBrackets(g, -w / 2, -h / 2, w, h, color, st === 'idle' ? 0.7 : 1, 14);

    if (this.picture) {
      if (st === 'disabled') this.picture.setTint(0x555555).setAlpha(0.6);
      else this.picture.clearTint().setAlpha(st === 'idle' ? 0.88 : 1);
    }
    this.placeholder?.setAlpha(st === 'disabled' ? 0.5 : 1);
    this.nameText.setColor(st === 'disabled' ? CSS.textDim : st === 'idle' ? CSS.text : CSS.primary);
    this.subtitleText?.setAlpha(st === 'disabled' ? 0.6 : 1);
    this.priceText?.setColor(st === 'disabled' ? CSS.textDim : CSS.primary);
    if (!this.busy) this.setScale(st === 'pressed' ? 0.97 : 1);
    this.drawPips(st === 'disabled');
  }

  /** Filled = owned tiers; outlined = not owned (shape, not only colour); teal outline = next. */
  private drawPips(disabled: boolean): void {
    const g = this.pips;
    g.clear();
    if (this.maxTier <= 0) return;
    const total = this.maxTier * PIP_W + (this.maxTier - 1) * PIP_GAP;
    const x0 = -total / 2;
    for (let k = 0; k < this.maxTier; k++) {
      const px = x0 + k * (PIP_W + PIP_GAP);
      if (k < this.tier) {
        g.fillStyle(disabled ? COLORS.textDim : COLORS.primary, 1);
        g.fillRect(px, this.pipsY, PIP_W, PIP_H);
      } else if (k === this.tier && this.highlightNext && !disabled) {
        g.fillStyle(COLORS.accent, 0.35);
        g.fillRect(px, this.pipsY, PIP_W, PIP_H);
        g.lineStyle(LINE_WIDTH, COLORS.accent, 1);
        g.strokeRect(px + 0.5, this.pipsY + 0.5, PIP_W - 1, PIP_H - 1);
      } else {
        g.lineStyle(LINE_WIDTH, COLORS.textDim, 0.8);
        g.strokeRect(px + 0.5, this.pipsY + 0.5, PIP_W - 1, PIP_H - 1);
      }
    }
  }
}
