/** Visual constants shared by all scenes. Numeric colours for Phaser graphics/tints, CSS strings for text. */

export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

/** Theme v2: amber primary HUD colour, teal secondary, off-white text, deep near-black backing. */
export const COLORS = {
  bg: 0x04070b,          // deep near-black
  bgPanel: 0x070b10,     // faint panel backing (use at low alpha)
  bgPanelHi: 0x111820,
  primary: 0xffb347,     // amber: HUD lines, readouts, primary buttons
  primaryDim: 0x8a5d22,
  accent: 0x46d6c8,      // teal: secondary highlights
  secondary: 0x46d6c8,   // alias of accent
  danger: 0xff5a4f,
  ok: 0x7fe08a,
  text: 0xeae6dc,        // off-white body text
  textDim: 0x8e8b82,
  disabled: 0x3b3a37,
  plate: 0x020304,       // dark backing behind problem text
  white: 0xffffff,
} as const;

export type ColorName = keyof typeof COLORS;

const toCss = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

export const CSS: Record<ColorName, string> = Object.fromEntries(
  Object.entries(COLORS).map(([k, v]) => [k, toCss(v)]),
) as Record<ColorName, string>;

/** Leitner box colours 0..5: grey, red, orange, yellow, light green, green. */
export const BOX_COLORS: readonly number[] = [0x5a6472, 0xe5484d, 0xf28c28, 0xf2d024, 0x9be37a, 0x2fb36a];
export const BOX_CSS: readonly string[] = BOX_COLORS.map(toCss);

/** masteryBand colours 0..4: unlit, weak, learning, good, mastered. */
export const BAND_COLORS: readonly number[] = [0x4a5566, 0xe5484d, 0xf28c28, 0xd8e04a, 0x2fd08a];
export const BAND_CSS: readonly string[] = BAND_COLORS.map(toCss);

/** Bundled fonts (@fontsource, SIL OFL), loaded in main.ts; BootScene waits for them. */
export const FONT_UI =
  '"Rajdhani", system-ui, "Segoe UI", Roboto, Arial, sans-serif';
/** Share Tech Mono covers Latin-1 only; Croatian č ć đ š ž fall back to the next font. */
export const FONT_MONO =
  '"Share Tech Mono", ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace';

/** Font sizes in logical pixels (Theme v2). `problem` (24) is the minimum for enemy problem numerals. */
export const SIZES = {
  hero: 54,
  title: 30,
  heading: 20,
  body: 16,
  label: 13,
  small: 11,
  problem: 24,
  input: 30,
} as const;

/** Letter spacing (px) for caps labels and buttons. */
export const LETTER_SPACING = { caps: 2, wide: 4 } as const;

export const SPACING = { xs: 4, s: 8, m: 16, l: 24, xl: 40 } as const;

/** Flat look: nearly square corners. */
export const RADIUS = 2;
export const LINE_WIDTH = 1;
/** Length of the corner brackets on panels and cards. */
export const BRACKET = 10;

/** Render depths used across scenes. */
export const DEPTH = {
  background: -100,
  world: 0,
  enemies: 10,
  fx: 20,
  hud: 50,
  overlay: 100,
} as const;
