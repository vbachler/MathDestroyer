import Phaser from 'phaser';
import { app } from '../app';
import { MODULES, buyModule, nextModuleCost } from '../core/economy';
import type { ModuleDef } from '../core/economy';
import { IMG, hasImage, iconFor, portraitFor } from '../fx/assets';
import { addBackdrop, addShade } from '../fx/backdrop';
import { Button } from '../ui/Button';
import { ImageCard } from '../ui/ImageCard';
import { drawBrackets } from '../ui/Panel';
import { capsStyle, labelStyle, numeralStyle } from '../ui/TextStyles';
import type { TextStyle } from '../ui/TextStyles';
import { drawCreditGlyph } from '../ui/hudGlyphs';
import { COLORS, CSS, DEPTH, GAME_HEIGHT, GAME_WIDTH, SIZES, SPACING } from '../ui/theme';

/** Card width never below this; it grows only if a name or line would otherwise wrap. */
const CARD_MIN_W = 176;
/** ImageCard inner padding on each side (picture inset). */
const CARD_PAD = 10;
const CARD_GAP = 28;
/** Card height for a picture square of (w - 20) plus name, line, pips and price. */
const cardHeight = (w: number): number => w + 96;
const CARD_BOTTOM = GAME_HEIGHT - 56;
const PORTRAIT = 56;

/** Station shop: three module cards over the hangar, credits top-left, the engineer in a corner. */
export class StationScene extends Phaser.Scene {
  private cards: Array<{ def: ModuleDef; card: ImageCard }> = [];
  private creditsText!: Phaser.GameObjects.Text;

  constructor() {
    super('Station');
  }

  create(): void {
    const { t } = app.i18n;
    addBackdrop(this, IMG.bg.station);
    addShade(this, 0.12, { from: GAME_HEIGHT * 0.42, alpha: 0.7 });

    this.createCredits();
    this.createEngineer();
    this.createCards();

    new Button(this, SPACING.l + 55, GAME_HEIGHT - SPACING.l - 15, t('common.back'), () => this.scene.start('StarMap'),
      { width: 110, height: 30, variant: 'ghost', fontSize: SIZES.small + 1 }).setDepth(DEPTH.hud);
  }

  /** Credits as a number with a small glyph, top-left. */
  private createCredits(): void {
    const y = SPACING.l + 14;
    const g = this.add.graphics().setDepth(DEPTH.hud);
    drawCreditGlyph(g, SPACING.l + 8, y, 14);
    this.creditsText = this.add.text(SPACING.l + 22, y, '', numeralStyle({ fontSize: `${SIZES.heading}px`, color: CSS.primary }))
      .setOrigin(0, 0.5).setDepth(DEPTH.hud);
  }

  /** Kito's portrait, small, top-right, with his name beside it. No speech. */
  private createEngineer(): void {
    const right = GAME_WIDTH - SPACING.l;
    const top = SPACING.l;
    const cx = right - PORTRAIT / 2;
    const cy = top + PORTRAIT / 2;
    const key = portraitFor('kito');
    if (hasImage(this, key)) {
      this.add.image(cx, cy, key).setDisplaySize(PORTRAIT, PORTRAIT).setAlpha(0.92).setDepth(DEPTH.hud);
    }
    const g = this.add.graphics().setDepth(DEPTH.hud);
    drawBrackets(g, right - PORTRAIT - 3, top - 3, PORTRAIT + 6, PORTRAIT + 6, COLORS.primary, 0.85, 8);
    this.add.text(right - PORTRAIT - SPACING.m, cy, app.i18n.t('story.sender.kito').toUpperCase(),
      capsStyle({ fontSize: `${SIZES.small}px`, color: CSS.textDim }))
      .setOrigin(1, 0.5).setDepth(DEPTH.hud);
  }

  private createCards(): void {
    const { t } = app.i18n;
    const w = this.cardWidth();
    const h = cardHeight(w);
    const totalW = MODULES.length * w + (MODULES.length - 1) * CARD_GAP;
    const x0 = (GAME_WIDTH - totalW) / 2 + w / 2;
    const y = CARD_BOTTOM - h / 2;
    this.cards = MODULES.map((def, i) => {
      const card = new ImageCard(this, x0 + i * (w + CARD_GAP), y, {
        texture: iconFor(def.id),
        name: t(def.nameKey),
        subtitle: t(def.descKey),
        width: w,
        height: h,
        tier: app.save.modules[def.id] ?? 0,
        maxTier: def.maxTier,
        price: nextModuleCost(app.save.modules, def.id),
      });
      card.setDepth(DEPTH.hud);
      card.setOnClick(() => this.buy(def, card));
      return { def, card };
    });
    this.refresh();
  }

  /**
   * Narrowest card width (at least CARD_MIN_W) on which every module name and line fits on one
   * line, measured with the card's own text styles, so ImageCard never wraps them.
   */
  private cardWidth(): number {
    const { t } = app.i18n;
    const nameStyle = capsStyle({ fontSize: `${SIZES.label + 2}px`, color: CSS.text });
    const lineStyle = labelStyle({ fontSize: `${SIZES.small + 1}px` });
    const measure = (text: string, style: TextStyle): number => {
      const probe = this.add.text(0, 0, text, style).setVisible(false);
      const w = probe.width;
      probe.destroy();
      return w;
    };
    let widest = 0;
    for (const def of MODULES) {
      widest = Math.max(widest, measure(t(def.nameKey).toUpperCase(), nameStyle), measure(t(def.descKey), lineStyle));
    }
    return Math.max(CARD_MIN_W, Math.ceil(widest) + 2 * CARD_PAD + 8);
  }

  private buy(def: ModuleDef, card: ImageCard): void {
    const next = buyModule(app.save, def.id);
    if (!next) return;
    app.save = next;
    app.persist();
    app.sfx.upgrade();
    card.setPrice(nextModuleCost(app.save.modules, def.id));
    // Other cards may have become unaffordable; the bought one refreshes after its animation.
    this.refresh(card);
    card.playInstalled(() => this.refresh());
  }

  /** Credits, prices, pips and enabled state from the save. `skip` is left alone (animating). */
  private refresh(skip?: ImageCard): void {
    this.creditsText.setText(String(app.save.credits));
    for (const { def, card } of this.cards) {
      if (card === skip) continue;
      const cost = nextModuleCost(app.save.modules, def.id);
      const affordable = cost !== null && app.save.credits >= cost;
      card.setTier(app.save.modules[def.id] ?? 0, affordable);
      card.setPrice(cost);
      card.setEnabled(affordable);
    }
  }
}
