import { describe, expect, it } from 'vitest';
import { SECTORS } from '../src/core/content';
import { stableHash } from '../src/core/names';
import { CLOUD_EDGE, cloudFill, cloudGrid, cloudRim, fieldAt, sectorBlobs } from '../src/fx/cloudField';
import { MAP_HSL, cssColor, hslToInt, sectorColors, sunColors } from '../src/ui/mapPalette';

const blobsOf = (i: number) => sectorBlobs(SECTORS[i], SECTORS[i].systems, stableHash(`cloud:${SECTORS[i].id}`));

describe('sector clouds', () => {
  it('are deterministic and hold every system inside the outline', () => {
    for (let i = 0; i < SECTORS.length; i++) {
      const blobs = blobsOf(i);
      expect(blobs).toEqual(blobsOf(i));
      expect(blobs.length).toBe(1 + SECTORS[i].systems.length + 5);
      for (const s of SECTORS[i].systems) expect(fieldAt(blobs, s.x, s.y)).toBeGreaterThan(CLOUD_EDGE + 0.2);
    }
  });

  it('fade out well beyond the sector disc and are not plain circles', () => {
    for (let i = 0; i < SECTORS.length; i++) {
      const s = SECTORS[i];
      const blobs = blobsOf(i);
      // Distance from the centre to the outline along 24 directions: bounded by the disc, and irregular.
      const reach: number[] = [];
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        let d = 0;
        while (d < s.radius * 2 && fieldAt(blobs, s.x + Math.cos(a) * d, s.y + Math.sin(a) * d) >= CLOUD_EDGE) d += 4;
        reach.push(d);
      }
      expect(Math.max(...reach)).toBeLessThan(s.radius * 1.35);
      expect(Math.min(...reach)).toBeGreaterThan(s.radius * 0.3);
      expect(Math.max(...reach) - Math.min(...reach)).toBeGreaterThan(s.radius * 0.1);
    }
  });

  it('bake into a small grid that covers the whole cloud', () => {
    const blobs = blobsOf(4);
    const grid = cloudGrid(blobs, 6);
    expect(grid.field.length).toBe(grid.w * grid.h);
    expect(grid.w * grid.h).toBeLessThan(200 * 200);
    // The border texels are outside the cloud (nothing is cut off).
    for (let i = 0; i < grid.w; i++) {
      expect(grid.field[i]).toBeLessThan(CLOUD_EDGE * 0.2);
      expect(grid.field[(grid.h - 1) * grid.w + i]).toBeLessThan(CLOUD_EDGE * 0.2);
    }
  });

  it('fill is zero outside, strong inside; the rim peaks on the outline', () => {
    expect(cloudFill(0.1)).toBe(0);
    expect(cloudFill(CLOUD_EDGE + 0.3)).toBeGreaterThan(0.5);
    expect(cloudRim(CLOUD_EDGE)).toBeCloseTo(1);
    expect(cloudRim(CLOUD_EDGE + 0.3)).toBeLessThan(0.01);
    expect(cloudRim(CLOUD_EDGE - 0.3)).toBeLessThan(0.01);
  });
});

describe('map palette', () => {
  it('converts HSL to RGB', () => {
    expect(hslToInt(0, 1, 0.5)).toBe(0xff0000);
    expect(hslToInt(120, 1, 0.5)).toBe(0x00ff00);
    expect(hslToInt(240, 1, 0.5)).toBe(0x0000ff);
    expect(hslToInt(60, 1, 0.5)).toBe(0xffff00);
    expect(hslToInt(-120, 1, 0.5)).toBe(0x0000ff);
    expect(hslToInt(0, 0, 1)).toBe(0xffffff);
    expect(hslToInt(0, 0, 0)).toBe(0x000000);
    expect(cssColor(0x0a0b0c)).toBe('#0a0b0c');
  });

  it('keeps sector colours muted: fill darker than rim, label pale', () => {
    const lum = (c: number): number => 0.2126 * (c >> 16) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255);
    for (const s of SECTORS) {
      const c = sectorColors(s.hue);
      expect(lum(c.fill)).toBeLessThan(lum(c.rim));
      expect(lum(c.rim)).toBeLessThan(lum(c.label) + 40);
    }
    expect(MAP_HSL.sectorFill.l).toBeLessThan(0.45);
    expect(MAP_HSL.sectorFill.s).toBeLessThan(0.6);
    const sun = sunColors(30);
    expect(lum(sun.core)).toBeGreaterThan(lum(sun.glow));
  });
});
