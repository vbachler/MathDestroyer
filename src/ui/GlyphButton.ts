import Phaser from 'phaser';
import { Button } from './Button';
import { drawBrackets } from './Panel';
import { COLORS } from './theme';

/** Draws a glyph centred on (x, y), about `size` px across. */
export type GlyphDraw = (g: Phaser.GameObjects.Graphics, x: number, y: number, size: number, color: number, alpha: number) => void;

/**
 * Tiny square button that shows only a glyph (no text): faint backing, thin corner brackets on
 * hover. (x, y) is the centre. Fires on release after a press that started on it, like Button.
 * Adds itself to the scene.
 */
export class GlyphButton extends Phaser.GameObjects.Container {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly size: number;
  private draw: GlyphDraw;
  private hovered = false;
  private pressed = false;
  private readonly onClick: () => void;

  constructor(scene: Phaser.Scene, x: number, y: number, size: number, draw: GlyphDraw, onClick: () => void) {
    super(scene, x, y);
    this.size = size;
    this.draw = draw;
    this.onClick = onClick;
    this.g = scene.add.graphics();
    this.add(this.g);
    this.setSize(size, size);
    this.setInteractive({ useHandCursor: true });
    this.on(Phaser.Input.Events.POINTER_OVER, () => { this.hovered = true; this.redraw(); });
    this.on(Phaser.Input.Events.POINTER_OUT, () => { this.hovered = false; this.pressed = false; this.redraw(); });
    this.on(Phaser.Input.Events.POINTER_DOWN, () => { this.pressed = true; this.redraw(); });
    this.on(Phaser.Input.Events.POINTER_UP, (pointer: Phaser.Input.Pointer) => {
      const fire = this.pressed;
      this.pressed = false;
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

  /** Replaces the glyph (e.g. galaxy <-> system toggle). */
  setGlyph(draw: GlyphDraw): this {
    this.draw = draw;
    this.redraw();
    return this;
  }

  private redraw(): void {
    const g = this.g;
    const s = this.size;
    const active = this.hovered || this.pressed;
    g.clear();
    g.fillStyle(COLORS.bg, this.pressed ? 0.75 : 0.45);
    g.fillRect(-s / 2, -s / 2, s, s);
    drawBrackets(g, -s / 2, -s / 2, s, s, COLORS.primary, active ? 0.9 : 0.35, 6);
    this.draw(g, 0, 0, s * 0.52, active ? COLORS.primary : COLORS.text, active ? 1 : 0.7);
  }
}
