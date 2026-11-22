import Phaser from 'phaser';
import type { CallKind } from '../core/story';
import { hasImage } from '../fx/assets';
import type { Rect } from '../fx/mapLayout';
import { CARD_H, CARD_W, VIEW_W } from '../fx/mapLayout';
import { TEX } from '../fx/textures';
import { VoiceLine } from '../fx/VoiceLine';
import { Button } from './Button';
import { drawRing } from './glyphs';
import { drawKindGlyph, kindColor } from './mapGlyphs';
import { drawBrackets } from './Panel';
import { capsStyle, numeralStyle } from './TextStyles';
import { COLORS, CSS, DEPTH, LETTER_SPACING, SIZES } from './theme';

/** Everything the card shows, already translated. */
export interface CallCardContent {
  kind: CallKind;
  portrait: string;          // texture key
  sender: string;            // display name
  message: string;           // the one line
  planetTexture: string;
  planetName: string;
  mastery: number;           // 0..1
  masteryText: string;       // e.g. "40 %"
  masteryColor: number;
  goLabel: string;
  voiceUrls: readonly string[];
  volume: number;
}

const PAD = 12;
const PORTRAIT = 56;
const MSG_X = PAD + PORTRAIT + 12;
const MSG_W = CARD_W - MSG_X - PAD;
const ROW_Y = 116;
const THUMB = 32;
const GO_W = 112;
const GO_H = 38;
const MS_PER_CHAR = 22;
const SLIDE = 36;

/**
 * The incoming call: sender portrait and name, the one message line typed out in the mono
 * font, the planet (picture, name, mastery) with the call kind as a glyph, and one GO button.
 * Anchored at a screen corner (see `CARD_ANCHORS`), sliding in from its side. The scene wires
 * Enter / Space to `go()` and Esc to `close()`. The voice clip (if any) plays while it is open.
 */
export class CallCard extends Phaser.GameObjects.Container {
  private readonly frame: Phaser.GameObjects.Graphics;
  private readonly portrait: Phaser.GameObjects.Image;
  private readonly senderText: Phaser.GameObjects.Text;
  private readonly msgText: Phaser.GameObjects.Text;
  private readonly thumb: Phaser.GameObjects.Image;
  private readonly thumbRing: Phaser.GameObjects.Graphics;
  private readonly planetText: Phaser.GameObjects.Text;
  private readonly masteryText: Phaser.GameObjects.Text;
  private readonly goButton: Button;
  private readonly voice = new VoiceLine();
  private typing: Phaser.Time.TimerEvent | null = null;
  private fullMessage = '';
  private opened = false;
  private anchor: Rect | null = null;
  private onGo: () => void;

  constructor(scene: Phaser.Scene, onGo: () => void) {
    super(scene, 0, 0);
    this.onGo = onGo;
    this.setDepth(DEPTH.overlay).setVisible(false).setAlpha(0);

    // Swallows clicks so the map underneath does not react to taps on the card.
    const blocker = scene.add.zone(CARD_W / 2, CARD_H / 2, CARD_W, CARD_H).setInteractive();
    this.frame = scene.add.graphics();
    this.portrait = scene.add.image(PAD + PORTRAIT / 2, PAD + PORTRAIT / 2, TEX.glow).setDisplaySize(PORTRAIT, PORTRAIT);
    this.senderText = scene.add.text(MSG_X, PAD - 1, '', capsStyle({ fontSize: `${SIZES.small}px`, letterSpacing: LETTER_SPACING.caps }));
    this.msgText = scene.add.text(MSG_X, PAD + 17, '', numeralStyle({
      fontSize: `${SIZES.label}px`, color: CSS.text, lineSpacing: 3, wordWrap: { width: MSG_W, useAdvancedWrap: true },
    }));
    this.thumb = scene.add.image(PAD + THUMB / 2 + 2, ROW_Y, TEX.planetSmall).setDisplaySize(THUMB, THUMB);
    this.thumbRing = scene.add.graphics();
    this.planetText = scene.add.text(PAD + THUMB + 16, ROW_Y - 8, '', capsStyle({
      fontSize: `${SIZES.label}px`, color: CSS.text, letterSpacing: LETTER_SPACING.caps,
    })).setOrigin(0, 0.5);
    this.masteryText = scene.add.text(PAD + THUMB + 16, ROW_Y + 9, '', numeralStyle({ fontSize: `${SIZES.small + 1}px` }))
      .setOrigin(0, 0.5);
    this.goButton = new Button(scene, CARD_W - PAD - GO_W / 2, ROW_Y, '', () => this.go(),
      { width: GO_W, height: GO_H, fontSize: SIZES.body, variant: 'primary' });
    this.add([blocker, this.frame, this.portrait, this.senderText, this.msgText, this.thumb, this.thumbRing,
      this.planetText, this.masteryText, this.goButton]);
    scene.add.existing(this);
    this.once(Phaser.GameObjects.Events.DESTROY, () => this.silence());
  }

  get isOpen(): boolean {
    return this.opened;
  }

  /** The anchor rectangle the card sits in (null while closed). */
  get rect(): Rect | null {
    return this.opened ? this.anchor : null;
  }

  setOnGo(onGo: () => void): this {
    this.onGo = onGo;
    return this;
  }

  /** Shows the card at `anchor` with the given content (replacing what it showed). */
  open(content: CallCardContent, anchor: Rect): void {
    const scene = this.scene;
    this.silence();
    scene.tweens.killTweensOf(this);
    this.anchor = anchor;
    this.opened = true;

    const fromRight = anchor.x + anchor.w / 2 > VIEW_W / 2;
    this.setPosition(anchor.x + (fromRight ? SLIDE : -SLIDE), anchor.y).setVisible(true).setAlpha(0);
    scene.tweens.add({ targets: this, x: anchor.x, alpha: 1, duration: 260, ease: 'Cubic.easeOut' });

    this.drawFrame(content.kind);
    if (hasImage(scene, content.portrait)) {
      this.portrait.setTexture(content.portrait).setDisplaySize(PORTRAIT, PORTRAIT).clearTint().setVisible(true);
    } else {
      this.portrait.setTexture(TEX.glow).setDisplaySize(PORTRAIT, PORTRAIT).setTint(COLORS.primaryDim).setVisible(true);
    }
    this.senderText.setText(content.sender.toUpperCase());
    // Wrap once on the full line, then type the wrapped text so words never jump between lines.
    this.msgText.setWordWrapWidth(MSG_W, true);
    this.fullMessage = this.msgText.getWrappedText(content.message).join('\n');
    this.msgText.setWordWrapWidth(null);
    this.msgText.setText('');
    let shown = 0;
    const total = this.fullMessage.length;
    this.typing = scene.time.addEvent({
      delay: MS_PER_CHAR,
      repeat: Math.max(0, total - 1),
      callback: () => {
        shown = Math.min(total, shown + 1);
        this.msgText.setText(this.fullMessage.slice(0, shown));
      },
    });

    if (hasImage(scene, content.planetTexture)) {
      this.thumb.setTexture(content.planetTexture).setDisplaySize(THUMB, THUMB).clearTint();
    } else {
      this.thumb.setTexture(TEX.planetSmall).setDisplaySize(THUMB, THUMB).setTint(COLORS.textDim);
    }
    this.thumbRing.clear();
    drawRing(this.thumbRing, this.thumb.x, this.thumb.y, THUMB / 2 + 3, content.mastery, content.masteryColor, 1.5);
    this.planetText.setText(content.planetName.toUpperCase());
    this.masteryText.setText(content.masteryText).setColor(CSS.textDim);
    this.goButton.setLabel(content.goLabel);

    this.voice.play(content.voiceUrls, content.volume);
  }

  /** Slides the open card to another anchor (when its planet drifts under it). */
  slideTo(anchor: Rect): void {
    if (!this.opened || anchor === this.anchor) return;
    this.anchor = anchor;
    this.scene.tweens.killTweensOf(this);
    this.scene.tweens.add({ targets: this, x: anchor.x, y: anchor.y, alpha: 1, duration: 320, ease: 'Cubic.easeInOut' });
  }

  /** Finishes the typing at once (first key press while typing). Returns false if it was already complete. */
  completeTyping(): boolean {
    if (!this.typing || this.typing.getOverallProgress() >= 1) return false;
    this.typing.remove(false);
    this.typing = null;
    this.msgText.setText(this.fullMessage);
    return true;
  }

  go(): void {
    if (!this.opened) return;
    this.onGo();
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.anchor = null;
    this.silence();
    this.scene.tweens.killTweensOf(this);
    this.scene.tweens.add({
      targets: this, alpha: 0, duration: 180, ease: 'Quad.easeIn',
      onComplete: () => this.setVisible(false),
    });
  }

  /** Stops the typing and the voice clip at once. */
  silence(): void {
    this.voice.stop();
    this.typing?.remove(false);
    this.typing = null;
  }

  private drawFrame(kind: CallKind): void {
    const g = this.frame;
    g.clear();
    g.fillStyle(COLORS.bg, 0.84);
    g.fillRect(0, 0, CARD_W, CARD_H);
    drawBrackets(g, 0, 0, CARD_W, CARD_H, COLORS.primary, 0.85, 12);
    g.lineStyle(1, COLORS.primary, 0.18);
    g.lineBetween(PAD, ROW_Y - 25.5, CARD_W - PAD, ROW_Y - 25.5);
    // Portrait frame: thin amber line.
    g.lineStyle(1, COLORS.primary, 0.8);
    g.strokeRect(PAD - 1.5, PAD - 1.5, PORTRAIT + 3, PORTRAIT + 3);
    drawKindGlyph(g, kind, CARD_W - PAD - 7, PAD + 7, 15, kindColor(kind), 1);
  }
}
