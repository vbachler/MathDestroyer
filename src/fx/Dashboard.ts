import Phaser from 'phaser';
import { capsStyle, numeralStyle } from '../ui/TextStyles';
import { COLORS, CSS, DEPTH, LINE_WIDTH, SIZES } from '../ui/theme';
import { hasImage, IMG } from './assets';
import { DASH_H, DASH_SCALE, DASH_SCREENS, DASH_W, DASH_X, DASH_Y, VIEW_H, VIEW_W } from './battleLayout';
import type { Rect } from './battleLayout';

const BOTTOM_SHADE_KEY = 'tex-battle-bottom-shade';
const SCANLINE_STEP = 3;

/** Amber CRT text: mono numerals with a soft glow. */
function crt(size: number): Phaser.Types.GameObjects.Text.TextStyle {
  return numeralStyle({ fontSize: `${size}px`, color: CSS.primary });
}

function glow(t: Phaser.GameObjects.Text): Phaser.GameObjects.Text {
  return t.setShadow(0, 0, CSS.primary, 6, false, true);
}

/** Vertical gradient texture (transparent -> near black) for the darkness under and beside the console. */
function ensureBottomShade(scene: Phaser.Scene): void {
  if (scene.textures.exists(BOTTOM_SHADE_KEY)) return;
  const tex = scene.textures.createCanvas(BOTTOM_SHADE_KEY, 4, 128);
  if (!tex) return;
  const ctx = tex.getContext();
  const grad = ctx.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.55)');
  grad.addColorStop(1, 'rgba(0,0,0,0.9)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 4, 128);
  tex.refresh();
}

/**
 * First-person console along the bottom of the battle view: `ui/dash.png` scaled to
 * DASH_SCALE (see battleLayout), and the HUD drawn as amber CRT readouts inside its five
 * screens: wave (left), score (left inner), typed answer (centre), streak (right inner) and
 * station hp (right). Without the image the screens are drawn as plain dark panels.
 */
export class Dashboard {
  private readonly scene: Phaser.Scene;
  private readonly waveText: Phaser.GameObjects.Text;
  private readonly scoreText: Phaser.GameObjects.Text;
  private readonly streakText: Phaser.GameObjects.Text;
  private readonly inputText: Phaser.GameObjects.Text;
  private readonly caret: Phaser.GameObjects.Rectangle;
  private readonly stations: Phaser.GameObjects.Graphics;
  private readonly inputHome: number;
  private stationSig = '';

  constructor(scene: Phaser.Scene, labels: { wave: string; score: string; streak: string; stations: string }) {
    this.scene = scene;
    const depth = DEPTH.hud;

    ensureBottomShade(scene);
    if (scene.textures.exists(BOTTOM_SHADE_KEY)) {
      // Darkness flanking and under the console (begins just below the stations' pips).
      scene.add.image(0, 580, BOTTOM_SHADE_KEY).setOrigin(0, 0)
        .setDisplaySize(VIEW_W, VIEW_H - 580).setDepth(depth - 2);
    }

    if (hasImage(scene, IMG.ui.dash)) {
      scene.add.image(DASH_X, DASH_Y, IMG.ui.dash).setOrigin(0, 0).setScale(DASH_SCALE).setDepth(depth - 1);
    } else {
      const g = scene.add.graphics().setDepth(depth - 1);
      g.fillStyle(COLORS.bgPanel, 0.95);
      g.fillRect(DASH_X, DASH_Y + 16, DASH_W, DASH_H);
      g.lineStyle(LINE_WIDTH, COLORS.primaryDim, 0.8);
      g.lineBetween(DASH_X, DASH_Y + 16.5, DASH_X + DASH_W, DASH_Y + 16.5);
      for (const r of Object.values(DASH_SCREENS)) {
        g.fillStyle(COLORS.plate, 1);
        g.fillRect(r.x, r.y, r.w, r.h);
        g.strokeRect(r.x - 1.5, r.y - 1.5, r.w + 3, r.h + 3);
      }
    }

    this.drawScreenGlass(depth);

    const s = DASH_SCREENS;
    this.waveText = this.readout(s.left, labels.wave, SIZES.heading + 2, depth);
    this.scoreText = this.readout(s.leftInner, labels.score, SIZES.heading, depth);
    this.streakText = this.readout(s.rightInner, labels.streak, SIZES.heading, depth);
    this.label(s.right, labels.stations, depth);
    this.stations = scene.add.graphics().setDepth(depth + 1);

    const c = s.centre;
    this.inputHome = c.x + c.w / 2;
    this.inputText = glow(scene.add.text(this.inputHome, c.y + c.h / 2, '', crt(SIZES.input + 2))
      .setOrigin(0.5).setDepth(depth + 1));
    this.caret = scene.add.rectangle(this.inputHome, c.y + c.h / 2, 12, 3, COLORS.primary)
      .setOrigin(0, 0.5).setDepth(depth + 1);
  }

  setWave(wave: number, total: number): void {
    this.set(this.waveText, `${wave}/${total}`);
  }

  setScore(score: number): void {
    this.set(this.scoreText, String(score));
  }

  setStreak(streak: number): void {
    this.set(this.streakText, String(streak));
  }

  /** `shown` uses the display minus already. The caret is a block underline after the text. */
  setInput(shown: string, caretOn: boolean): void {
    this.set(this.inputText, shown);
    const c = DASH_SCREENS.centre;
    const baseline = c.y + c.h / 2 + (SIZES.input + 2) / 2 - 1;
    this.caret.setPosition(shown.length === 0 ? this.inputText.x - 6 : this.inputText.x + this.inputText.width / 2 + 3, baseline);
    this.caret.setVisible(caretOn);
  }

  /** Station hp as four columns of pips on the right screen. */
  setStations(domes: ReadonlyArray<{ hp: number; maxHp: number }>): void {
    const sig = domes.map((d) => `${d.hp}/${d.maxHp}`).join(',');
    if (sig === this.stationSig) return;
    this.stationSig = sig;
    const r = DASH_SCREENS.right;
    const g = this.stations;
    g.clear();
    const colW = 12;
    const gap = 6;
    const pipH = 4;
    const pipGap = 3;
    const totalW = domes.length * colW + (domes.length - 1) * gap;
    const x0 = r.x + (r.w - totalW) / 2;
    const bottom = r.y + r.h - 9;
    domes.forEach((d, i) => {
      const x = x0 + i * (colW + gap);
      for (let k = 0; k < d.maxHp; k++) {
        const y = bottom - (k + 1) * pipH - k * pipGap;
        if (k < d.hp) {
          g.fillStyle(COLORS.primary, 0.95);
          g.fillRect(x, y, colW, pipH);
        } else {
          g.lineStyle(LINE_WIDTH, COLORS.primaryDim, 0.9);
          g.strokeRect(x + 0.5, y + 0.5, colW - 1, pipH - 1);
        }
      }
      if (d.hp <= 0) {
        // Destroyed: a cross under the column, so it reads without colour.
        g.lineStyle(LINE_WIDTH, COLORS.danger, 1);
        g.lineBetween(x + 2, bottom + 2, x + colW - 2, bottom + 7);
        g.lineBetween(x + colW - 2, bottom + 2, x + 2, bottom + 7);
      }
    });
  }

  /** Wrong answer: the centre readout shakes briefly. */
  shakeInput(): void {
    const t = this.inputText;
    this.scene.tweens.killTweensOf(t);
    t.x = this.inputHome;
    this.scene.tweens.add({
      targets: t, x: this.inputHome + 5, duration: 40, yoyo: true, repeat: 3, ease: 'Sine.easeInOut',
      onComplete: () => { t.x = this.inputHome; },
    });
  }

  private set(t: Phaser.GameObjects.Text, value: string): void {
    if (t.text !== value) t.setText(value);
  }

  private label(r: Rect, text: string, depth: number): void {
    this.scene.add.text(r.x + r.w / 2, r.y + 5, text.toUpperCase(),
      capsStyle({ fontSize: `${SIZES.small - 1}px`, color: CSS.primaryDim, letterSpacing: 1 }))
      .setOrigin(0.5, 0).setDepth(depth + 1);
  }

  private readout(r: Rect, label: string, size: number, depth: number): Phaser.GameObjects.Text {
    this.label(r, label, depth);
    return glow(this.scene.add.text(r.x + r.w / 2, r.y + 14 + (r.h - 14) / 2, '', crt(size))
      .setOrigin(0.5).setDepth(depth + 1));
  }

  /** Faint phosphor tint and scanlines over every screen. */
  private drawScreenGlass(depth: number): void {
    const g = this.scene.add.graphics().setDepth(depth);
    const lines = this.scene.add.graphics().setDepth(depth + 2);
    for (const r of Object.values(DASH_SCREENS) as Rect[]) {
      g.fillStyle(COLORS.primary, 0.05);
      g.fillRect(r.x, r.y, r.w, r.h);
      lines.lineStyle(1, COLORS.bg, 0.35);
      for (let y = r.y + 1; y < r.y + r.h; y += SCANLINE_STEP) lines.lineBetween(r.x, y + 0.5, r.x + r.w, y + 0.5);
    }
  }
}

