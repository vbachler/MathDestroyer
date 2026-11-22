import type Phaser from 'phaser';
import { CSS, FONT_MONO, FONT_UI, LETTER_SPACING, SIZES } from './theme';

export type TextStyle = Phaser.Types.GameObjects.Text.TextStyle;

/** Heading (Rajdhani semibold, 30 px). */
export function titleStyle(overrides: TextStyle = {}): TextStyle {
  return {
    fontFamily: FONT_UI,
    fontSize: `${SIZES.title}px`,
    fontStyle: '600',
    color: CSS.text,
    letterSpacing: 1,
    ...overrides,
  };
}

/** Running text (16 px, off-white). */
export function bodyStyle(overrides: TextStyle = {}): TextStyle {
  return {
    fontFamily: FONT_UI,
    fontSize: `${SIZES.body}px`,
    fontStyle: '500',
    color: CSS.text,
    lineSpacing: 4,
    ...overrides,
  };
}

/** Small HUD label (13 px, dimmed). */
export function labelStyle(overrides: TextStyle = {}): TextStyle {
  return {
    fontFamily: FONT_UI,
    fontSize: `${SIZES.label}px`,
    fontStyle: '500',
    color: CSS.textDim,
    ...overrides,
  };
}

/** Small caps-style label with letter spacing (amber). Pass the text already upper-cased. */
export function capsStyle(overrides: TextStyle = {}): TextStyle {
  return {
    fontFamily: FONT_UI,
    fontSize: `${SIZES.label}px`,
    fontStyle: '600',
    color: CSS.primary,
    letterSpacing: LETTER_SPACING.caps,
    ...overrides,
  };
}

/** Monospace numerals (Share Tech Mono): problems, input, counters. Default size is the problem size (24 px). */
export function numeralStyle(overrides: TextStyle = {}): TextStyle {
  return {
    fontFamily: FONT_MONO,
    fontSize: `${SIZES.problem}px`,
    fontStyle: 'normal',
    color: CSS.text,
    ...overrides,
  };
}
