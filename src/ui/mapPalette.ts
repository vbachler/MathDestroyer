/**
 * Star map colours derived from a hue (pure). The saturation / lightness choices keep the
 * galaxy muted and dark: sector fills are deep and greyish, rims a little brighter, names pale
 * and low contrast; suns are bright but not neon.
 */

export interface HslChoice { s: number; l: number; }

export const MAP_HSL = {
  sectorFill: { s: 0.42, l: 0.36 },
  sectorRim: { s: 0.48, l: 0.6 },
  sectorLabel: { s: 0.28, l: 0.74 },
  sunGlow: { s: 0.85, l: 0.62 },
  sunCore: { s: 0.6, l: 0.9 },
} as const satisfies Record<string, HslChoice>;

/** HSL (h in degrees, s and l in 0..1) -> 0xRRGGBB. */
export function hslToInt(h: number, s: number, l: number): number {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0; let g = 0; let b = 0;
  if (hue < 60) { r = c; g = x; }
  else if (hue < 120) { r = x; g = c; }
  else if (hue < 180) { g = c; b = x; }
  else if (hue < 240) { g = x; b = c; }
  else if (hue < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const to = (v: number): number => Math.round(Math.min(1, Math.max(0, v + m)) * 255);
  return (to(r) << 16) | (to(g) << 8) | to(b);
}

export function hueColor(hue: number, choice: HslChoice): number {
  return hslToInt(hue, choice.s, choice.l);
}

/** '#rrggbb' for text styles. */
export function cssColor(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
}

export interface SectorColors { fill: number; rim: number; label: number; }

export function sectorColors(hue: number): SectorColors {
  return {
    fill: hueColor(hue, MAP_HSL.sectorFill),
    rim: hueColor(hue, MAP_HSL.sectorRim),
    label: hueColor(hue, MAP_HSL.sectorLabel),
  };
}

export function sunColors(hue: number): { glow: number; core: number } {
  return { glow: hueColor(hue, MAP_HSL.sunGlow), core: hueColor(hue, MAP_HSL.sunCore) };
}
