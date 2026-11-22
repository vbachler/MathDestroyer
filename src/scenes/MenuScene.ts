import Phaser from 'phaser';
import { app, setLocale } from '../app';
import { LOCALES } from '../core/i18n';
import type { Locale } from '../core/types';
import { IMG } from '../fx/assets';
import { addBackdrop, addShade } from '../fx/backdrop';
import { Button } from '../ui/Button';
import { titleStyle } from '../ui/TextStyles';
import { COLORS, CSS, DEPTH, GAME_HEIGHT, GAME_WIDTH, LETTER_SPACING, LINE_WIDTH, SIZES, SPACING } from '../ui/theme';

const LEFT = 64;
const TITLE_BOTTOM = 492;
const BUTTON_W = 180;
const BUTTON_H = 36;
const BUTTON_STEP = 46;
const FIRST_BUTTON_Y = 534;
/** One full drift cycle of the background (there and back), ms. */
const DRIFT_MS = 60000;

/** Title screen: the menu picture, the game name small in the lower left, three buttons, HR / EN. */
export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create(): void {
    const { t } = app.i18n;
    app.sfx.startAmbience('menu');
    this.createBackground();

    const hud = this.add.graphics().setDepth(DEPTH.hud);
    hud.lineStyle(LINE_WIDTH, COLORS.primary, 0.7);
    hud.lineBetween(LEFT, TITLE_BOTTOM - SIZES.hero - 14, LEFT + 36, TITLE_BOTTOM - SIZES.hero - 14);

    this.add.text(LEFT - 2, TITLE_BOTTOM, t('common.gameTitle').toUpperCase(), titleStyle({
      fontSize: `${SIZES.hero}px`, color: CSS.text, letterSpacing: LETTER_SPACING.wide * 2,
    })).setOrigin(0, 1).setDepth(DEPTH.hud);

    const buttons: Array<[string, () => void, 'primary' | 'ghost']> = [
      [t('common.menu.play'), () => this.scene.start('StarMap'), 'primary'],
      [t('common.menu.mastery'), () => this.scene.start('Mastery', { from: 'Menu' }), 'ghost'],
      [t('common.menu.settings'), () => this.scene.start('Settings'), 'ghost'],
    ];
    buttons.forEach(([label, onClick, variant], i) => {
      new Button(this, LEFT + BUTTON_W / 2, FIRST_BUTTON_Y + i * BUTTON_STEP, label, onClick,
        { width: BUTTON_W, height: BUTTON_H, variant }).setDepth(DEPTH.hud);
    });

    this.createLanguageSwitch();
  }

  /** bg_menu with a very slow drift and zoom (a few pixels over a minute); a soft shade under the title. */
  private createBackground(): void {
    const bg = addBackdrop(this, IMG.bg.menu, { overscan: 1.03 });
    if (bg) {
      const s = bg.scale;
      this.tweens.add({
        targets: bg,
        x: bg.x - 8,
        y: bg.y - 3,
        scale: s * 1.012,
        duration: DRIFT_MS / 2,
        ease: 'Sine.easeInOut',
        yoyo: true,
        repeat: -1,
      });
    }
    addShade(this, 0, { from: GAME_HEIGHT * 0.45, alpha: 0.55 });
  }

  /** HR / EN in the top-right corner; switching restarts the scene in the new language. */
  private createLanguageSwitch(): void {
    const w = 44;
    const h = 28;
    LOCALES.forEach((locale: Locale, i) => {
      const active = app.i18n.locale === locale;
      const x = GAME_WIDTH - SPACING.l - w / 2 - (LOCALES.length - 1 - i) * (w + SPACING.xs);
      new Button(this, x, SPACING.l + h / 2, app.i18n.t(`common.language.short.${locale}`), () => {
        if (app.i18n.locale === locale) return;
        setLocale(locale);
        document.documentElement.lang = locale;
        this.scene.restart();
      }, { width: w, height: h, variant: active ? 'primary' : 'ghost', fontSize: SIZES.small + 1 }).setDepth(DEPTH.hud);
    });
  }
}
