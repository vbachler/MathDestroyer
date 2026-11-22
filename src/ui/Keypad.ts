import Phaser from 'phaser';
import type { Rect } from '../fx/battleLayout';
import { COLORS, CSS, FONT_MONO, FONT_UI, LETTER_SPACING, LINE_WIDTH, SIZES } from './theme';

export interface KeypadCallbacks {
  onDigit(d: number): void;
  onSign(): void;
  onBackspace(): void;
  onFire(): void;
}

export interface KeypadOptions {
  /** Label of the fire key (already translated, one word). */
  fireLabel: string;
  /** Rectangle of the 4x3 digit cluster (1-4, 5-8, 9 0 ± ⌫). */
  digits: Rect;
  /** Rectangle of the single fire key. */
  fire: Rect;
  /** Gap between digit keys. Default 4. */
  gap?: number;
}

type KeyKind = 'digit' | 'sign' | 'backspace' | 'fire';

const ROWS: ReadonlyArray<ReadonlyArray<{ kind: KeyKind; digit?: number }>> = [
  [1, 2, 3, 4].map((d) => ({ kind: 'digit' as const, digit: d })),
  [5, 6, 7, 8].map((d) => ({ kind: 'digit' as const, digit: d })),
  [{ kind: 'digit', digit: 9 }, { kind: 'digit', digit: 0 }, { kind: 'sign' }, { kind: 'backspace' }],
];

/**
 * Compact, semi-transparent touch keypad in two clusters: a 4x3 digit pad (with sign and
 * backspace) and one tall FIRE key, each placed in its own rectangle (the battle puts them in
 * the bottom corners beside the console). Keys act on press so touch typing feels immediate.
 * Positions are absolute; the keypad adds itself to the scene.
 */
export class Keypad extends Phaser.GameObjects.Container {
  constructor(scene: Phaser.Scene, callbacks: KeypadCallbacks, opts: KeypadOptions) {
    super(scene, 0, 0);
    const gap = opts.gap ?? 4;
    const d = opts.digits;
    const kw = (d.w - 3 * gap) / 4;
    const kh = (d.h - 2 * gap) / 3;
    ROWS.forEach((row, r) => row.forEach((spec, c) => {
      const action = (): void => {
        if (spec.kind === 'digit') callbacks.onDigit(spec.digit ?? 0);
        else if (spec.kind === 'sign') callbacks.onSign();
        else callbacks.onBackspace();
      };
      this.add(this.makeKey(d.x + c * (kw + gap) + kw / 2, d.y + r * (kh + gap) + kh / 2, kw, kh, spec.kind, spec.digit, opts.fireLabel, action));
    }));
    const f = opts.fire;
    this.add(this.makeKey(f.x + f.w / 2, f.y + f.h / 2, f.w, f.h, 'fire', undefined, opts.fireLabel, () => callbacks.onFire()));
    scene.add.existing(this);
  }

  private makeKey(x: number, y: number, w: number, h: number, kind: KeyKind, digit: number | undefined,
                  fireLabel: string, action: () => void): Phaser.GameObjects.Container {
    const scene = this.scene;
    const key = scene.add.container(x, y);
    const color = kind === 'fire' ? COLORS.danger : kind === 'digit' ? COLORS.primary : COLORS.accent;
    const bg = scene.add.graphics();
    const draw = (pressed: boolean): void => {
      bg.clear();
      bg.fillStyle(COLORS.bg, pressed ? 0.7 : 0.42);
      bg.fillRect(-w / 2, -h / 2, w, h);
      if (pressed) {
        bg.fillStyle(color, 0.3);
        bg.fillRect(-w / 2, -h / 2, w, h);
      }
      bg.lineStyle(LINE_WIDTH, color, pressed ? 1 : 0.55);
      bg.strokeRect(-w / 2 + 0.5, -h / 2 + 0.5, w - 1, h - 1);
    };
    draw(false);
    key.add(bg);

    if (kind === 'backspace') {
      key.add(this.backspaceIcon());
    } else if (kind === 'fire') {
      key.add(this.fireIcon(h));
      key.add(scene.add.text(0, h / 2 - 16, fireLabel.toUpperCase(), {
        fontFamily: FONT_UI, fontSize: `${SIZES.small}px`, fontStyle: '600', color: CSS.text,
        letterSpacing: LETTER_SPACING.caps,
      }).setOrigin(0.5));
    } else {
      key.add(scene.add.text(0, 0, kind === 'digit' ? String(digit) : '±', {
        fontFamily: FONT_MONO, fontSize: `${SIZES.heading + 2}px`, color: CSS.text,
      }).setOrigin(0.5));
    }

    key.setSize(w, h);
    key.setInteractive({ useHandCursor: true });
    key.on(Phaser.Input.Events.POINTER_DOWN, () => {
      draw(true);
      key.setScale(0.96);
      action();
    });
    const release = (): void => {
      draw(false);
      key.setScale(1);
    };
    key.on(Phaser.Input.Events.POINTER_UP, release);
    key.on(Phaser.Input.Events.POINTER_OUT, release);
    return key;
  }

  /** Crosshair glyph for the fire key. */
  private fireIcon(h: number): Phaser.GameObjects.Graphics {
    const g = this.scene.add.graphics();
    const cy = -8;
    const r = Math.min(18, h * 0.16);
    g.lineStyle(LINE_WIDTH + 0.5, COLORS.text, 0.95);
    g.strokeCircle(0, cy, r);
    g.lineBetween(-r - 6, cy, -r + 5, cy);
    g.lineBetween(r - 5, cy, r + 6, cy);
    g.lineBetween(0, cy - r - 6, 0, cy - r + 5);
    g.lineBetween(0, cy + r - 5, 0, cy + r + 6);
    g.fillStyle(COLORS.danger, 1);
    g.fillCircle(0, cy, 2.5);
    return g;
  }

  /** Left-pointing tag with a cross, drawn so it does not depend on font glyph coverage. */
  private backspaceIcon(): Phaser.GameObjects.Graphics {
    const g = this.scene.add.graphics();
    g.lineStyle(1.5, COLORS.text, 1);
    g.strokePoints([
      new Phaser.Math.Vector2(-12, 0), new Phaser.Math.Vector2(-4, -8), new Phaser.Math.Vector2(12, -8),
      new Phaser.Math.Vector2(12, 8), new Phaser.Math.Vector2(-4, 8),
    ], true, true);
    g.lineBetween(0, -4, 7, 4);
    g.lineBetween(0, 4, 7, -4);
    return g;
  }
}
