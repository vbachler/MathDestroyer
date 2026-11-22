import { describe, expect, it } from 'vitest';
import { DOME_X, IMPACT_Y, LANE_X, SPAWN_Y } from '../src/core/battle';
import {
  DASH_H, DASH_SCREENS, DASH_W, DASH_X, DASH_Y, dashTopAt, KEYPAD_DIGITS, KEYPAD_FIRE, layoutTags, missPoint,
  PAUSE_RECT, SHIP_SIZE_NEAR, shipScreenY, shipSize, STATION_PIP_H, STATION_PIP_Y, stationRect, tagRect,
  VIEW_H, VIEW_W,
} from '../src/fx/battleLayout';
import type { Rect, TagItem } from '../src/fx/battleLayout';

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const item = (id: number, x: number, y: number, tagW = 120): TagItem =>
  ({ id, x, y, shipHalfW: 16, shipHalfH: 26, tagW, tagH: 34 });

describe('battle layout', () => {
  it('dashboard is centred, scaled down and its five screens are inside the view', () => {
    expect(DASH_X + DASH_W / 2).toBeCloseTo(VIEW_W / 2);
    expect(DASH_W).toBeLessThan(VIEW_W * 0.7);
    expect(DASH_Y + DASH_H).toBeGreaterThan(VIEW_H);       // bottom frame cropped by the view edge
    for (const r of Object.values(DASH_SCREENS)) {
      expect(r.x).toBeGreaterThan(DASH_X);
      expect(r.y + r.h).toBeLessThanOrEqual(VIEW_H);
      expect(r.w).toBeGreaterThanOrEqual(80);
      expect(r.h).toBeGreaterThanOrEqual(54);
    }
    expect(DASH_SCREENS.centre.w).toBeGreaterThan(140);
  });

  it('stations, their pips and every ship stay above the dashboard hood', () => {
    for (const x of DOME_X) {
      const st = stationRect(x);
      for (const px of [st.x, x, st.x + st.w]) {
        expect(STATION_PIP_Y + STATION_PIP_H).toBeLessThan(dashTopAt(px));
      }
    }
    for (const x of LANE_X) {
      const bottom = shipScreenY(IMPACT_Y) + SHIP_SIZE_NEAR / 2;
      expect(bottom).toBeLessThan(dashTopAt(x));
    }
  });

  it('ships grow from 34 to 52 px and arrive on top of the stations', () => {
    expect(shipSize(SPAWN_Y)).toBe(34);
    expect(shipSize(IMPACT_Y)).toBe(52);
    const landing = shipScreenY(IMPACT_Y) + SHIP_SIZE_NEAR / 2;
    const st = stationRect(DOME_X[0]);
    expect(landing).toBeGreaterThanOrEqual(st.y);
    expect(landing).toBeLessThanOrEqual(st.y + st.h);
  });

  it('keypad clusters cover neither stations, dashboard, nor descending ships', () => {
    for (const pad of [KEYPAD_DIGITS, KEYPAD_FIRE]) {
      expect(pad.x).toBeGreaterThanOrEqual(0);
      expect(pad.x + pad.w).toBeLessThanOrEqual(VIEW_W);
      expect(pad.y + pad.h).toBeLessThanOrEqual(VIEW_H);
      for (const x of DOME_X) expect(overlaps(pad, stationRect(x))).toBe(false);
      expect(overlaps(pad, { x: DASH_X, y: DASH_Y, w: DASH_W, h: DASH_H })).toBe(false);
      expect(pad.y).toBeGreaterThan(shipScreenY(IMPACT_Y) + SHIP_SIZE_NEAR / 2);
    }
  });

  it('pause glyph sits above the spawn row', () => {
    expect(PAUSE_RECT.y + PAUSE_RECT.h).toBeLessThan(shipScreenY(SPAWN_Y) - 34 / 2);
  });

  it('tags default outward-in and flip at the screen edge', () => {
    const sides = layoutTags([item(1, LANE_X[0], 200), item(2, LANE_X[5], 300, 200)]);
    expect(sides.get(1)).toBe('right');
    expect(sides.get(2)).toBe('left');
    // A wide tag at the right lane cannot go right.
    const edge = layoutTags([item(3, LANE_X[5], 200, 200)], new Map([[3, 'right' as const]]));
    expect(edge.get(3)).toBe('left');
  });

  it('the lower ship keeps its side and the higher neighbour moves', () => {
    const low = item(1, LANE_X[1], 400, 150);        // right tag reaches into lane 2
    const high = item(2, LANE_X[2], 390, 150);       // would put its tag left, onto the low one's tag
    const sides = layoutTags([high, low], new Map([[1, 'right' as const], [2, 'left' as const]]));
    expect(sides.get(1)).toBe('right');
    expect(sides.get(2)).toBe('right');
    expect(overlaps(tagRect(low, 'right'), tagRect(high, 'right'))).toBe(false);
  });

  it('keeps the previous side when it is still free (no flicker)', () => {
    const a = item(1, LANE_X[1], 300);
    expect(layoutTags([a], new Map([[1, 'left' as const]])).get(1)).toBe('left');
  });

  it('a missed shot lands 40..70 px beside the target, inside the view', () => {
    for (const r of [0, 0.2, 0.49, 0.5, 0.8, 0.999]) {
      for (const x of [10, 640, 1270]) {
        const p = missPoint({ x, y: 300 }, r);
        const d = Math.abs(p.x - x);
        expect(d).toBeGreaterThanOrEqual(40);
        expect(d).toBeLessThanOrEqual(70);
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(VIEW_W);
      }
    }
  });
});
