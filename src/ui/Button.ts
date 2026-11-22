import Phaser from 'phaser';
import { COLORS, CSS, FONT_UI, LETTER_SPACING, LINE_WIDTH, SIZES } from './theme';

export type ButtonVariant = 'primary' | 'accent' | 'danger' | 'ghost';

export interface ButtonOptions {
  width?: number;          // default 180
  height?: number;         // default 40
  variant?: ButtonVariant; // default 'primary' (amber); 'accent' is teal
  fontSize?: number;       // default SIZES.label + 1
}

const VARIANT_COLOR: Record<ButtonVariant, number> = {
  primary: COLORS.primary,
  accent: COLORS.accent,
  danger: COLORS.danger,
  ghost: COLORS.textDim,
};

type VisualState = 'idle' | 'hover' | 'pressed' | 'disabled';

/**
 * Small flat button (Theme v2): faint dark backing, 1 px frame, caps label with letter spacing. (x, y) is the centre. Works with mouse and touch:
 * the click fires on release over the button after a press that started on it.
 * The button adds itself to the scene.
 */
export class Button extends Phaser.GameObjects.Container {
  /** Optional sound played on every click (BootScene sets it to app.sfx.click). */
  static clickSound: (() => void) | null = null;

  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly text: Phaser.GameObjects.Text;
  private readonly btnW: number;
  private readonly btnH: number;
  private readonly color: number;
  private enabled = true;
  private pressed = false;
  private hovered = false;
  private onClick: () => void;

  constructor(scene: Phaser.Scene, x: number, y: number, label: string, onClick: () => void, opts: ButtonOptions = {}) {
    super(scene, x, y);
    this.btnW = opts.width ?? 180;
    this.btnH = opts.height ?? 40;
    this.color = VARIANT_COLOR[opts.variant ?? 'primary'];
    this.onClick = onClick;

    this.bg = scene.add.graphics();
    this.text = scene.add.text(0, 0, label.toUpperCase(), {
      fontFamily: FONT_UI,
      fontSize: `${opts.fontSize ?? SIZES.label + 1}px`,
      fontStyle: '600',
      color: CSS.text,
      align: 'center',
      letterSpacing: LETTER_SPACING.caps,
    }).setOrigin(0.5);
    this.add([this.bg, this.text]);

    this.setSize(this.btnW, this.btnH);
    this.setInteractive({ useHandCursor: true });
    this.on(Phaser.Input.Events.POINTER_OVER, () => { this.hovered = true; this.redraw(); });
    this.on(Phaser.Input.Events.POINTER_OUT, () => { this.hovered = false; this.pressed = false; this.redraw(); });
    this.on(Phaser.Input.Events.POINTER_DOWN, () => {
      if (!this.enabled) return;
      this.pressed = true;
      this.redraw();
    });
    this.on(Phaser.Input.Events.POINTER_UP, (pointer: Phaser.Input.Pointer) => {
      const fire = this.enabled && this.pressed;
      this.pressed = false;
      // Touch has no hover: drop the hover look after release.
      if (pointer.wasTouch) this.hovered = false;
      this.redraw();
      if (fire) {
        Button.clickSound?.();
        this.onClick();
      }
    });

    this.redraw();
    scene.add.existing(this);
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

  setLabel(label: string): this {
    this.text.setText(label.toUpperCase());
    return this;
  }

  setOnClick(onClick: () => void): this {
    this.onClick = onClick;
    return this;
  }

  private visualState(): VisualState {
    if (!this.enabled) return 'disabled';
    if (this.pressed) return 'pressed';
    if (this.hovered) return 'hover';
    return 'idle';
  }

  private redraw(): void {
    const st = this.visualState();
    const g = this.bg;
    const c = st === 'disabled' ? COLORS.disabled : this.color;
    const fillAlpha = st === 'pressed' ? 0.3 : st === 'hover' ? 0.16 : 0;
    const x = -this.btnW / 2;
    const y = -this.btnH / 2;
    g.clear();
    g.fillStyle(COLORS.bg, 0.55);
    g.fillRect(x, y, this.btnW, this.btnH);
    if (fillAlpha > 0) {
      g.fillStyle(c, fillAlpha);
      g.fillRect(x, y, this.btnW, this.btnH);
    }
    g.lineStyle(LINE_WIDTH, c, st === 'disabled' ? 0.5 : st === 'idle' ? 0.7 : 1);
    g.strokeRect(x + 0.5, y + 0.5, this.btnW - 1, this.btnH - 1);
    // Short solid ticks on the left and right edges give the flat frame a little weight.
    g.fillStyle(c, st === 'disabled' ? 0.4 : 1);
    g.fillRect(x, y + this.btnH * 0.3, 2, this.btnH * 0.4);
    g.fillRect(x + this.btnW - 2, y + this.btnH * 0.3, 2, this.btnH * 0.4);
    const textColor = st === 'disabled' ? CSS.textDim : st === 'idle' ? CSS.text : `#${c.toString(16).padStart(6, '0')}`;
    this.text.setColor(textColor);
    this.setScale(st === 'pressed' ? 0.98 : 1);
  }
}
