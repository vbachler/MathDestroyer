import Phaser from 'phaser';
import { app } from '../app';
import type { BattleEvent, BattleSim } from '../core/battle';
import { iconFor } from '../fx/assets';
import { ImageCard } from '../ui/ImageCard';
import { capsStyle } from '../ui/TextStyles';
import { COLORS, DEPTH, GAME_HEIGHT, GAME_WIDTH, LETTER_SPACING, SIZES } from '../ui/theme';
import { SIM_EVENTS } from './BattleScene';

export interface UpgradeSceneData { sim: BattleSim; }

/** Wide enough for a two-word caps name on one line (ImageCard wraps at CARD_W - 20). */
const CARD_W = 184;
/** ImageCard stack: 10 pad + picture (CARD_W - 20) + 10 + name 22 + pip row 10 + 12 pad. */
const CARD_H = CARD_W + 44;
const CARD_GAP = 28;
const CARD_Y = 340;
const TITLE_Y = 198;

/**
 * Reward overlay launched over the paused (dimmed) Battle between waves: three free upgrade
 * cards (picture, short name, tier pips). Tapping one or pressing 1, 2, 3 plays its
 * "installed" animation, calls sim.pickUpgrade(), hands the events to Battle and resumes it.
 * Battle skips this scene when nothing can be offered; if it is reached anyway with no
 * offers it calls sim.nextWave() and closes at once.
 */
export class UpgradeScene extends Phaser.Scene {
  private sim!: BattleSim;
  private picked = false;
  private left = false;

  constructor() {
    super('Upgrade');
  }

  create(data: UpgradeSceneData): void {
    this.sim = data.sim;
    this.picked = false;
    this.left = false;
    const { t } = app.i18n;
    const cx = GAME_WIDTH / 2;

    const offers = this.sim.offers();
    if (offers.length === 0) {
      this.leave(() => this.sim.nextWave());
      return;
    }

    this.add.rectangle(cx, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, COLORS.bg, 0.62)
      .setDepth(DEPTH.overlay - 1).setInteractive();
    this.add.text(cx, TITLE_Y, t('battle.upgrades.title').toUpperCase(),
      capsStyle({ fontSize: `${SIZES.heading}px`, letterSpacing: LETTER_SPACING.wide }))
      .setOrigin(0.5).setDepth(DEPTH.overlay);

    const totalW = offers.length * CARD_W + (offers.length - 1) * CARD_GAP;
    const x0 = (GAME_WIDTH - totalW) / 2 + CARD_W / 2;
    const cards = offers.map((o, i) => {
      const card = new ImageCard(this, x0 + i * (CARD_W + CARD_GAP), CARD_Y, {
        texture: iconFor(o.def.id),
        name: t(o.def.nameKey),
        width: CARD_W,
        height: CARD_H,
        tier: o.nextTier - 1,
        maxTier: o.def.maxTier,
        highlightNext: true,
        hotkey: String(i + 1),
      }).setDepth(DEPTH.overlay);
      card.setOnClick(() => this.pick(card, o.def.id));
      card.setAlpha(0).setY(CARD_Y + 12);
      this.tweens.add({ targets: card, alpha: 1, y: CARD_Y, delay: 60 * i, duration: 220, ease: 'Quad.easeOut' });
      return card;
    });

    const keys = ['ONE', 'TWO', 'THREE'];
    keys.slice(0, cards.length).forEach((name, i) => {
      this.input.keyboard?.on(`keydown-${name}`, () => cards[i].click());
      this.input.keyboard?.on(`keydown-NUMPAD_${name}`, () => cards[i].click());
    });
  }

  private pick(card: ImageCard, upgradeId: string): void {
    if (this.picked) return;
    this.picked = true;
    app.sfx.upgrade();
    card.playInstalled(() => this.leave(() => this.sim.pickUpgrade(upgradeId)));
  }

  /** Runs the sim call that starts the next wave, hands its events to Battle and closes. */
  private leave(startWave: () => BattleEvent[]): void {
    if (this.left) return;
    this.left = true;
    const events = startWave();
    this.scene.get('Battle').events.emit(SIM_EVENTS, events);
    this.scene.resume('Battle');
    this.scene.stop();
  }
}
