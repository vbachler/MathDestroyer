import Phaser from 'phaser';
import { MINUS } from '../core/i18n';
import { drawEnterGlyph, drawRightArrow } from '../ui/hudGlyphs';
import { drawBrackets } from '../ui/Panel';
import { COLORS, CSS, DEPTH, FONT_MONO, LINE_WIDTH } from '../ui/theme';
import { DASH_SCREENS, KEY_GAP, KEYPAD_DIGITS, KEYPAD_FIRE } from './battleLayout';
import type { Rect } from './battleLayout';

/** The enemy the hint points at (the lowest alive one, the one a submit would hit first). */
export interface HintTarget {
  x: number;
  y: number;
  halfW: number;
  halfH: number;
  answer: number;
}

/** Up to 4 digits plus a sign (core/battle MAX_INPUT_DIGITS). */
const MAX_KEYS = 5;
const KEY_W = 26;
const KEY_H = 28;
const ENTER_W = 40;
const KEY_SPACING = 6;
const ARROW_W = 18;
/** Time each key stays "pressed" in the loop; the loop ends with one blank step. */
const STEP_MS = 420;
const FADE_MS = 400;
const RETICLE_PAD = 5;
const RETICLE_ARM = 7;
/** Row of keycaps sits on the console hood just above the centre (answer) screen. */
const ROW_Y = DASH_SCREENS.centre.y - 24;
const ROW_CX = DASH_SCREENS.centre.x + DASH_SCREENS.centre.w / 2;

/** Keypad key rectangle for a char ('0'..'9' or '-'), matching ui/Keypad's 4x3 layout. */
function keypadKey(ch: string): Rect {
  const d = KEYPAD_DIGITS;
  const kw = (d.w - 3 * KEY_GAP) / 4;
  const kh = (d.h - 2 * KEY_GAP) / 3;
  let row: number;
  let col: number;
  if (ch === '-') { row = 2; col = 2; }
  else if (ch === '9') { row = 2; col = 0; }
  else if (ch === '0') { row = 2; col = 1; }
  else { const n = Number(ch) - 1; row = Math.floor(n / 4); col = n % 4; }
  return { x: d.x + col * (kw + KEY_GAP), y: d.y + row * (kh + KEY_GAP), w: kw, h: kh };
}

/**
 * First-mission onboarding, no text: a pulsing amber reticle on the most urgent enemy, and
 * keycaps that "type" its answer and press Enter in a loop (on touch: the keypad keys pulse
 * instead). Redrawn every frame by `update`; `fadeOut` retires it for good.
 */
export class InputHint {
  private readonly scene: Phaser.Scene;
  private readonly touch: boolean;
  private readonly reticle: Phaser.GameObjects.Graphics;
  private readonly keys: Phaser.GameObjects.Graphics;
  private readonly labels: Phaser.GameObjects.Text[] = [];
  private elapsed = 0;
  private lastAnswer: number | null = null;
  private fading = false;
  private destroyed = false;

  constructor(scene: Phaser.Scene, touch: boolean) {
    this.scene = scene;
    this.touch = touch;
    this.reticle = scene.add.graphics().setDepth(DEPTH.fx - 1);
    // Above the console's screen glass and scanlines (hud + 2) and the keypad (hud).
    this.keys = scene.add.graphics().setDepth(DEPTH.hud + 3);
    if (!touch) {
      for (let i = 0; i < MAX_KEYS; i++) {
        this.labels.push(scene.add.text(0, 0, '', {
          fontFamily: FONT_MONO, fontSize: '20px', color: CSS.primary,
        }).setOrigin(0.5).setDepth(DEPTH.hud + 4).setVisible(false));
      }
    }
  }

  get active(): boolean {
    return !this.destroyed && !this.fading;
  }

  /** `target` null hides the hint (no enemy, paused, explaining). `input` is the sim's raw input. */
  update(target: HintTarget | null, input: string, dt: number): void {
    if (this.destroyed) return;
    this.reticle.clear();
    this.keys.clear();
    if (!target) {
      for (const l of this.labels) l.setVisible(false);
      return;
    }
    if (target.answer !== this.lastAnswer) {
      this.lastAnswer = target.answer;
      this.elapsed = 0;
    }
    this.elapsed += dt;
    const pulse = 0.55 + 0.45 * Math.sin((this.elapsed / 600) * Math.PI * 2);

    // Reticle: thin corner brackets hugging the ship (tags sit TAG_GAP beyond its edge).
    const breathe = RETICLE_PAD + pulse * 2;
    drawBrackets(this.reticle, target.x - target.halfW - breathe, target.y - target.halfH - breathe,
      (target.halfW + breathe) * 2, (target.halfH + breathe) * 2, COLORS.primary, 0.35 + 0.6 * pulse, RETICLE_ARM);

    const chars = String(target.answer).split('');
    const typed = chars.join('').startsWith(input) ? input.length : 0;
    const complete = typed === chars.length;
    // Loop over the keys still to press, then Enter, then one blank beat.
    const remaining = chars.length - typed;
    const step = Math.floor(this.elapsed / STEP_MS) % (remaining + 2);
    const lit = complete ? -1 : (step < remaining ? typed + step : -1);
    const enterLit = complete || step === remaining;
    const enterAlpha = complete ? pulse : 1;

    if (this.touch) this.drawKeypad(chars, lit, enterLit, enterAlpha);
    else this.drawRow(chars, typed, lit, enterLit, enterAlpha);
  }

  /** Fades everything out over FADE_MS, then destroys it. */
  fadeOut(): void {
    if (this.destroyed || this.fading) return;
    this.fading = true;
    this.scene.tweens.add({
      targets: [this.reticle, this.keys, ...this.labels], alpha: 0, duration: FADE_MS, onComplete: () => this.destroy(),
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    const all = [this.reticle, this.keys, ...this.labels];
    this.scene.tweens.killTweensOf(all);
    for (const o of all) o.destroy();
    this.labels.length = 0;
  }

  private drawRow(chars: string[], typed: number, lit: number, enterLit: boolean, enterAlpha: number): void {
    const g = this.keys;
    const n = chars.length;
    const totalW = n * KEY_W + (n - 1) * KEY_SPACING + KEY_SPACING * 2 + ARROW_W + KEY_SPACING * 2 + ENTER_W;
    let x = ROW_CX - totalW / 2;
    this.labels.forEach((l, i) => {
      if (i >= n) { l.setVisible(false); return; }
      const on = i === lit;
      const done = i < typed;
      const dy = on ? 1 : 0;
      this.keycap(x, ROW_Y + dy, KEY_W, on, done ? 0.8 : 0.55);
      l.setVisible(true).setText(chars[i] === '-' ? MINUS : chars[i])
        .setPosition(x + KEY_W / 2, ROW_Y + dy)
        .setColor(on ? CSS.bg : CSS.primary)
        .setAlpha(this.fading ? l.alpha : (done || on ? 1 : 0.7));
      x += KEY_W + KEY_SPACING;
    });
    drawRightArrow(g, x + KEY_SPACING + ARROW_W / 2, ROW_Y, ARROW_W, COLORS.primary, 0.7);
    x += KEY_SPACING * 2 + ARROW_W + KEY_SPACING;
    const ey = ROW_Y + (enterLit ? 1 : 0);
    this.keycap(x, ey, ENTER_W, enterLit, 0.55, enterAlpha);
    drawEnterGlyph(g, x + ENTER_W / 2, ey, 16, enterLit ? COLORS.bg : COLORS.primary, enterLit ? 1 : 0.7);
  }

  /** One keycap with its left edge at x, centred on y; `on` = pressed (filled amber). */
  private keycap(x: number, y: number, w: number, on: boolean, outline: number, onAlpha = 1): void {
    const g = this.keys;
    const top = y - KEY_H / 2;
    g.fillStyle(COLORS.bg, 0.85);
    g.fillRect(x, top, w, KEY_H);
    if (on) {
      g.fillStyle(COLORS.primary, 0.9 * onAlpha);
      g.fillRect(x, top, w, KEY_H);
    }
    g.lineStyle(LINE_WIDTH, COLORS.primary, on ? 1 : outline);
    g.strokeRect(x + 0.5, top + 0.5, w - 1, KEY_H - 1);
    // Keycap lip: a slightly brighter bottom edge.
    if (!on) {
      g.lineStyle(LINE_WIDTH, COLORS.primary, outline * 0.6);
      g.lineBetween(x + 2, top + KEY_H + 1.5, x + w - 2, top + KEY_H + 1.5);
    }
  }

  /** Touch: pulse the keypad key to press next, or the fire key once the answer is typed. */
  private drawKeypad(chars: string[], lit: number, enterLit: boolean, enterAlpha: number): void {
    const g = this.keys;
    const glowRect = (r: Rect, alpha: number): void => {
      g.fillStyle(COLORS.primary, 0.22 * alpha);
      g.fillRect(r.x, r.y, r.w, r.h);
      g.lineStyle(LINE_WIDTH + 1, COLORS.primary, alpha);
      g.strokeRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
    };
    if (lit >= 0) glowRect(keypadKey(chars[lit]), 1);
    if (enterLit) glowRect(KEYPAD_FIRE, enterAlpha);
  }
}
