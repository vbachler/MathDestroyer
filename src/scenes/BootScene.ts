import Phaser from 'phaser';
import { app } from '../app';
import { preloadAssets } from '../fx/assets';
import { generateTextures } from '../fx/textures';
import { Button } from '../ui/Button';
import { COLORS, GAME_HEIGHT, GAME_WIDTH } from '../ui/theme';

const BAR_W = 360;
const BAR_Y = GAME_HEIGHT / 2;
/** Never wait longer than this for web fonts (a broken font must not block the game). */
const FONT_TIMEOUT_MS = 3000;

/** The bundled faces used by the theme, requested explicitly so the browser loads them now. */
const FONT_FACES = ['500 16px "Rajdhani"', '600 16px "Rajdhani"', '700 16px "Rajdhani"', '400 16px "Share Tech Mono"'];

async function fontsReady(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const load = Promise.all(FONT_FACES.map((f) => document.fonts.load(f).catch(() => [])))
    .then(() => document.fonts.ready)
    .then(() => undefined);
  const timeout = new Promise<void>((resolve) => { window.setTimeout(resolve, FONT_TIMEOUT_MS); });
  await Promise.race([load, timeout]);
}

/** Loads image assets with a thin progress bar, generates procedural textures, waits for the
 *  bundled fonts, wires shared services, then opens the menu. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    const track = this.add.rectangle(GAME_WIDTH / 2, BAR_Y, BAR_W, 1, COLORS.primaryDim, 0.6);
    const bar = this.add.rectangle(track.x - BAR_W / 2, BAR_Y, 1, 1, COLORS.primary, 1).setOrigin(0, 0.5);
    this.load.on(Phaser.Loader.Events.PROGRESS, (p: number) => { bar.width = Math.max(1, BAR_W * p); });
    preloadAssets(this);
  }

  create(): void {
    generateTextures(this);
    app.i18n.setLocale(app.save.locale);
    app.sfx.setVolume(app.save.settings.sfxVolume);
    Button.clickSound = () => app.sfx.click();
    document.documentElement.lang = app.save.locale;
    void fontsReady().then(() => this.scene.start('Menu'));
  }
}
