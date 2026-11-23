import Phaser from 'phaser';
import { app, setLocale } from '../app';
import { LOCALES } from '../core/i18n';
import { DENSITIES, GAME_SPEEDS, defaultSave } from '../core/save';
import type { SaveData } from '../core/save';
import { IMG } from '../fx/assets';
import { addBackdrop, addShade } from '../fx/backdrop';
import { Button } from '../ui/Button';
import { LevelControl } from '../ui/LevelControl';
import { Panel } from '../ui/Panel';
import { Toggle } from '../ui/Toggle';
import { capsStyle } from '../ui/TextStyles';
import { multiplierText, percentText } from '../ui/format';
import { CSS, DEPTH, GAME_HEIGHT, SIZES, SPACING } from '../ui/theme';

/** Compact centred column: labels on the left, controls from CONTROL_X. */
const COLUMN = { x: 290, y: 166, w: 700, h: 414 };
const LABEL_X = COLUMN.x + 32;
const CONTROL_X = COLUMN.x + 272;
const ROW_Y = { language: 206, sfx: 258, music: 310, speed: 362, density: 414, keypad: 466, reset: 532 };
const SMALL_BTN_H = 30;
/** Four-choice rows (speed, density): button width and step. */
const CHOICE_W = 88;
const CHOICE_STEP = 96;
/** How long the "erased" mark stays before the reset row returns to its first step. */
const RESET_DONE_MS = 1600;

/** Language, volumes, game speed, density, keypad and progress reset. Labels only; every change is saved at once. */
export class SettingsScene extends Phaser.Scene {
  private resetLayer!: Phaser.GameObjects.Container;
  private speedLayer!: Phaser.GameObjects.Container;
  private densityLayer!: Phaser.GameObjects.Container;
  private resetTimer: Phaser.Time.TimerEvent | null = null;

  constructor() {
    super('Settings');
  }

  create(): void {
    const { t } = app.i18n;
    this.resetTimer = null;
    addBackdrop(this, IMG.bg.starmap);
    addShade(this, 0.55);

    this.add.text(COLUMN.x, COLUMN.y - 22, t('common.settings.title').toUpperCase(), capsStyle())
      .setOrigin(0, 0.5).setDepth(DEPTH.hud);
    new Panel(this, COLUMN.x, COLUMN.y, COLUMN.w, COLUMN.h, { fillAlpha: 0.45 }).setDepth(DEPTH.hud);
    const ui = this.add.container(0, 0).setDepth(DEPTH.hud + 1);

    // Language.
    ui.add(this.rowLabel(ROW_Y.language, t('common.settings.language')));
    LOCALES.forEach((locale, i) => {
      const active = app.i18n.locale === locale;
      ui.add(new Button(this, CONTROL_X + 60 + i * 128, ROW_Y.language, t(`common.language.${locale}`), () => {
        if (app.i18n.locale === locale) return;
        setLocale(locale);
        document.documentElement.lang = locale;
        this.scene.restart();
      }, { width: 120, height: SMALL_BTN_H, variant: active ? 'primary' : 'ghost', fontSize: SIZES.small + 1 }));
    });

    // Volumes.
    const format = (v: number): string => percentText(app.i18n, v);
    const stepLabels = { decrease: t('common.decrease'), increase: t('common.increase'), format };
    ui.add(this.rowLabel(ROW_Y.sfx, t('common.settings.sfxVolume')));
    ui.add(new LevelControl(this, CONTROL_X, ROW_Y.sfx, app.save.settings.sfxVolume, stepLabels, (v) => {
      this.updateSettings({ sfxVolume: v });
      app.sfx.setVolume(v);
      app.sfx.click();
    }));
    ui.add(this.rowLabel(ROW_Y.music, t('common.settings.musicVolume')));
    ui.add(new LevelControl(this, CONTROL_X, ROW_Y.music, app.save.settings.musicVolume, stepLabels, (v) => {
      this.updateSettings({ musicVolume: v });
      app.sfx.click();
    }));

    // Game speed.
    ui.add(this.rowLabel(ROW_Y.speed, t('common.settings.gameSpeed')));
    this.speedLayer = this.add.container(0, 0).setDepth(DEPTH.hud + 1);
    this.buildSpeedButtons();

    // Density.
    ui.add(this.rowLabel(ROW_Y.density, t('common.settings.density')));
    this.densityLayer = this.add.container(0, 0).setDepth(DEPTH.hud + 1);
    this.buildDensityButtons();

    // Keypad.
    ui.add(this.rowLabel(ROW_Y.keypad, t('common.settings.keypadAlwaysVisible')));
    ui.add(new Toggle(this, CONTROL_X, ROW_Y.keypad, app.save.settings.keypadAlwaysVisible,
      { on: t('common.on'), off: t('common.off') }, (v) => this.updateSettings({ keypadAlwaysVisible: v })));

    // Reset progress (two steps).
    ui.add(this.rowLabel(ROW_Y.reset, t('common.settings.resetProgress')));
    this.resetLayer = this.add.container(0, 0).setDepth(DEPTH.hud + 1);
    this.showResetIdle();

    new Button(this, SPACING.l + 55, GAME_HEIGHT - SPACING.l - 15, t('common.back'), () => this.scene.start('Menu'),
      { width: 110, height: SMALL_BTN_H, variant: 'ghost', fontSize: SIZES.small + 1 }).setDepth(DEPTH.hud);
  }

  private rowLabel(y: number, text: string): Phaser.GameObjects.Text {
    return this.add.text(LABEL_X, y, text.toUpperCase(), capsStyle({ color: CSS.text, wordWrap: { width: CONTROL_X - LABEL_X - 16 } }))
      .setOrigin(0, 0.5);
  }

  /** Four speed choices (×0.5 … ×1.25); the active one is highlighted. Rebuilt after every change. */
  private buildSpeedButtons(): void {
    this.buildChoices(this.speedLayer, ROW_Y.speed, GAME_SPEEDS, () => app.save.settings.gameSpeed,
      (gameSpeed) => this.updateSettings({ gameSpeed }), () => this.buildSpeedButtons());
  }

  /** Four density choices (×0.5 … ×1.25), same control as the speed row. */
  private buildDensityButtons(): void {
    this.buildChoices(this.densityLayer, ROW_Y.density, DENSITIES, () => app.save.settings.density,
      (density) => this.updateSettings({ density }), () => this.buildDensityButtons());
  }

  private buildChoices<T extends number>(layer: Phaser.GameObjects.Container, y: number, values: readonly T[],
    current: () => T, set: (v: T) => void, rebuild: () => void): void {
    layer.removeAll(true);
    values.forEach((v, i) => {
      const active = current() === v;
      layer.add(new Button(this, CONTROL_X + CHOICE_W / 2 + i * CHOICE_STEP, y, multiplierText(app.i18n, v), () => {
        if (current() === v) return;
        set(v);
        // Rebuild on the next tick, not inside the tapped button's own input handler.
        this.time.delayedCall(0, rebuild);
      }, { width: CHOICE_W, height: SMALL_BTN_H, variant: active ? 'primary' : 'ghost', fontSize: SIZES.small + 1 }));
    });
  }

  private updateSettings(patch: Partial<SaveData['settings']>): void {
    app.save = { ...app.save, settings: { ...app.save.settings, ...patch } };
    app.persist();
  }

  /** First step: one danger button. */
  private showResetIdle(): void {
    const { t } = app.i18n;
    this.resetLayer.removeAll(true);
    this.resetLayer.add(new Button(this, CONTROL_X + 60, ROW_Y.reset, t('common.settings.resetErase'),
      () => this.time.delayedCall(0, () => this.showResetConfirm()),
      { width: 120, height: SMALL_BTN_H, variant: 'danger', fontSize: SIZES.small + 1 }));
  }

  /** Second step: confirm (danger) or cancel. */
  private showResetConfirm(): void {
    const { t } = app.i18n;
    this.resetLayer.removeAll(true);
    this.resetLayer.add(new Button(this, CONTROL_X + 70, ROW_Y.reset, t('common.settings.resetConfirmYes'), () => {
      const { locale, settings } = app.save;
      app.save = { ...defaultSave(), locale, settings: { ...settings } };
      app.persist();
      this.time.delayedCall(0, () => this.showResetDone());
    }, { width: 140, height: SMALL_BTN_H, variant: 'danger', fontSize: SIZES.small + 1 }));
    this.resetLayer.add(new Button(this, CONTROL_X + 70 + 140 + SPACING.s, ROW_Y.reset, t('common.cancel'),
      () => this.time.delayedCall(0, () => this.showResetIdle()),
      { width: 120, height: SMALL_BTN_H, variant: 'ghost', fontSize: SIZES.small + 1 }));
  }

  /** Short "erased" mark, then back to the first step. */
  private showResetDone(): void {
    this.resetLayer.removeAll(true);
    this.resetLayer.add(this.add.text(CONTROL_X, ROW_Y.reset, app.i18n.t('common.settings.resetDone').toUpperCase(),
      capsStyle({ color: CSS.ok })).setOrigin(0, 0.5));
    this.resetTimer?.remove();
    this.resetTimer = this.time.delayedCall(RESET_DONE_MS, () => {
      this.resetTimer = null;
      this.showResetIdle();
    });
  }
}
