import { describe, expect, it } from 'vitest';
import { SECTORS, SYSTEMS } from '../src/core/content';
import { stableHash } from '../src/core/names';
import type { Call } from '../src/core/story';
import {
  CARD_ANCHORS, CARD_H, CARD_W, CALL_GAP_MAX_MS, CALL_GAP_MIN_MS, FIRST_CALL_MS, ORBIT_TILT, SUN_X, SUN_Y, VIEW_H, VIEW_W,
  anchorCard, callDelayMs, circleHitsRect, discBounds, distanceToRect, edgeX, edgeY, fitView, inFront,
  isDrag, isIntroCall, nearestPoint, orbitRadius, orbitSpeed, orbitX, orbitY, pickCall, planetSize, resolveLabels,
  screenToWorldX, screenToWorldY, sectorLabelOffset, worldToScreenX, worldToScreenY, zoomAt,
} from '../src/fx/mapLayout';
import type { MapView, Rect } from '../src/fx/mapLayout';

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('galaxy camera', () => {
  const view: MapView = { cx: 2400, cy: 1350, zoom: 0.5 };

  it('maps the view centre to the screen centre and round-trips', () => {
    expect(worldToScreenX(view, 2400)).toBe(VIEW_W / 2);
    expect(worldToScreenY(view, 1350)).toBe(VIEW_H / 2);
    expect(screenToWorldX(view, worldToScreenX(view, 3111))).toBeCloseTo(3111);
    expect(screenToWorldY(view, worldToScreenY(view, 777))).toBeCloseTo(777);
    expect(worldToScreenX(view, 2400 + 100)).toBe(VIEW_W / 2 + 50);
  });

  it('zooming keeps the world point under the pointer fixed', () => {
    for (const [px, py, z] of [[100, 600, 1.2], [1200, 40, 0.3], [640, 360, 2]] as const) {
      const wx = screenToWorldX(view, px);
      const wy = screenToWorldY(view, py);
      const next = zoomAt(view, z, px, py);
      expect(next.zoom).toBe(z);
      expect(worldToScreenX(next, wx)).toBeCloseTo(px, 6);
      expect(worldToScreenY(next, wy)).toBeCloseTo(py, 6);
    }
  });

  it('the opening view shows the whole galaxy with margin, and every system lands on screen', () => {
    const bounds = discBounds(SECTORS);
    const fit = fitView(bounds, 40);
    expect(worldToScreenX(fit, bounds.x)).toBeGreaterThanOrEqual(40 - 1e-6);
    expect(worldToScreenX(fit, bounds.x + bounds.w)).toBeLessThanOrEqual(VIEW_W - 40 + 1e-6);
    expect(worldToScreenY(fit, bounds.y)).toBeGreaterThanOrEqual(40 - 1e-6);
    expect(worldToScreenY(fit, bounds.y + bounds.h)).toBeLessThanOrEqual(VIEW_H - 40 + 1e-6);
    // Vast and small: the galaxy is shown at roughly a quarter scale, stars about 15+ px apart.
    expect(fit.zoom).toBeGreaterThan(0.2);
    expect(fit.zoom).toBeLessThan(0.35);
    for (const s of SYSTEMS) {
      const x = worldToScreenX(fit, s.x);
      const y = worldToScreenY(fit, s.y);
      expect(x).toBeGreaterThan(40);
      expect(x).toBeLessThan(VIEW_W - 40);
      expect(y).toBeGreaterThan(40);
      expect(y).toBeLessThan(VIEW_H - 40);
    }
    let minGap = Infinity;
    for (let i = 0; i < SYSTEMS.length; i++) {
      for (let j = i + 1; j < SYSTEMS.length; j++) {
        minGap = Math.min(minGap, Math.hypot(SYSTEMS[i].x - SYSTEMS[j].x, SYSTEMS[i].y - SYSTEMS[j].y) * fit.zoom);
      }
    }
    expect(minGap).toBeGreaterThan(15);
  });

  it('tells a click from a drag and finds the nearest star', () => {
    expect(isDrag(3, 4)).toBe(false);
    expect(isDrag(5, 5)).toBe(true);
    const xs = new Float32Array([10, 100, 104]);
    const ys = new Float32Array([10, 100, 100]);
    expect(nearestPoint(xs, ys, 3, 103, 101, 18)).toBe(2);
    expect(nearestPoint(xs, ys, 3, 300, 300, 18)).toBe(-1);
  });
});

describe('system view geometry', () => {
  it('orbits grow outward, fit the screen and leave the top HUD row free', () => {
    for (const count of [1, 2, 3, 4, 5]) {
      let prev = 0;
      for (let i = 0; i < count; i++) {
        const rx = orbitRadius(i, count);
        expect(rx).toBeGreaterThan(prev + 50);
        prev = rx;
        const half = 46 / 2 + 6;
        expect(SUN_X - rx - half).toBeGreaterThan(0);
        expect(SUN_X + rx + half).toBeLessThan(VIEW_W);
        expect(SUN_Y - rx * ORBIT_TILT - half).toBeGreaterThan(110);
        expect(SUN_Y + rx * ORBIT_TILT + half).toBeLessThan(VIEW_H);
      }
    }
  });

  it('puts points on a tilted ellipse; the near half is in front of the sun', () => {
    const rx = 300;
    expect(orbitX(rx, 0)).toBeCloseTo(300);
    expect(orbitY(rx, 0)).toBeCloseTo(0);
    expect(orbitY(rx, Math.PI / 2)).toBeCloseTo(300 * ORBIT_TILT);
    expect(inFront(Math.PI / 2)).toBe(true);
    expect(inFront(-Math.PI / 2)).toBe(false);
    for (let a = 0; a < Math.PI * 2; a += 0.3) {
      const x = orbitX(rx, a) / rx;
      const y = orbitY(rx, a) / (rx * ORBIT_TILT);
      expect(x * x + y * y).toBeCloseTo(1, 6);
    }
  });

  it('planets move slowly, outer ones slower; sizes stay 34..46 px', () => {
    expect(orbitSpeed(orbitRadius(0, 4))).toBeGreaterThan(orbitSpeed(orbitRadius(3, 4)));
    expect(orbitSpeed(orbitRadius(0, 4))).toBeLessThan(0.1);   // at most about 6 degrees per second
    for (const s of SYSTEMS) for (const p of s.planets) {
      const size = planetSize(stableHash(p.id));
      expect(size).toBeGreaterThanOrEqual(34);
      expect(size).toBeLessThanOrEqual(46);
    }
  });
});

describe('labels', () => {
  it('keeps higher priority labels and drops the ones that collide', () => {
    const x = [0, 50, 200, 10];
    const y = [0, 5, 0, 100];
    const w = [100, 100, 80, 50];
    const h = [14, 14, 14, 14];
    const active = [1, 1, 1, 0];
    const out: number[] = [];
    const kept = resolveLabels(x, y, w, h, active, [1, 0, 2, 3], 4, out);
    expect(out).toEqual([0, 1, 1, 0]);   // 1 beats 0 (priority), 2 is free, 3 inactive
    expect(kept).toBe(2);
  });

  it('places every sector name off its stars at the opening zoom', () => {
    const fit = fitView(discBounds(SECTORS), 40);
    const labelW = 130 / fit.zoom;
    const labelH = 14 / fit.zoom;
    const clearance = 6 / fit.zoom;
    let clear = 0;
    for (const s of SECTORS) {
      const dy = sectorLabelOffset(s.x, s.y, s.radius, labelW, labelH, s.systems, clearance);
      expect(Math.abs(dy)).toBeLessThanOrEqual(0.6 * s.radius);
      const free = s.systems.every((p) => Math.abs(p.x - s.x) > labelW / 2 + clearance
        || Math.abs(p.y - (s.y + dy)) > labelH / 2 + clearance);
      if (free) clear++;
    }
    expect(clear).toBeGreaterThanOrEqual(SECTORS.length - 2);
  });
});

describe('call card anchoring', () => {
  it('has four anchors of card size inside the view, none overlapping another', () => {
    for (const a of CARD_ANCHORS) {
      expect(a.w).toBe(CARD_W);
      expect(a.h).toBe(CARD_H);
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.y).toBeGreaterThanOrEqual(56);   // below the corner controls
      expect(a.x + a.w).toBeLessThanOrEqual(VIEW_W);
      expect(a.y + a.h).toBeLessThanOrEqual(VIEW_H);
    }
    for (let i = 0; i < CARD_ANCHORS.length; i++) {
      for (let j = i + 1; j < CARD_ANCHORS.length; j++) expect(overlaps(CARD_ANCHORS[i], CARD_ANCHORS[j])).toBe(false);
    }
  });

  it('prefers bottom-right and moves away from the target planet', () => {
    expect(anchorCard(300, 300, 50)).toBe(0);
    const br = CARD_ANCHORS[0];
    const i = anchorCard(br.x + 100, br.y + 60, 50);
    expect(i).toBe(1);
    expect(circleHitsRect(CARD_ANCHORS[i], br.x + 100, br.y + 60, 50)).toBe(false);
  });

  it('never covers a planet anywhere on any orbit of the system view', () => {
    for (const count of [2, 3, 4, 5]) {
      for (let o = 0; o < count; o++) {
        const rx = orbitRadius(o, count);
        for (let a = 0; a < Math.PI * 2; a += 0.05) {
          const x = SUN_X + orbitX(rx, a);
          const y = SUN_Y + orbitY(rx, a);
          const r = 46 / 2 + 26;
          const anchor = CARD_ANCHORS[anchorCard(x, y, r)];
          expect(distanceToRect(anchor, x, y)).toBeGreaterThanOrEqual(r);
        }
      }
    }
  });
});

describe('edge markers', () => {
  it('lie on the inset screen rectangle along the direction', () => {
    const inset = 46;
    for (let a = 0; a < Math.PI * 2; a += 0.2) {
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const x = edgeX(dx, dy, inset);
      const y = edgeY(dx, dy, inset);
      const onSide = Math.abs(x - inset) < 1e-6 || Math.abs(x - (VIEW_W - inset)) < 1e-6
        || Math.abs(y - inset) < 1e-6 || Math.abs(y - (VIEW_H - inset)) < 1e-6;
      expect(onSide).toBe(true);
      expect(x).toBeGreaterThanOrEqual(inset - 1e-6);
      expect(x).toBeLessThanOrEqual(VIEW_W - inset + 1e-6);
      expect(Math.sign(x - VIEW_W / 2) || 0).toBe(Math.abs(dx) < 1e-9 ? 0 : Math.sign(dx));
    }
  });
});

describe('calls pacing and choice', () => {
  const call = (planetId: string, storyKey = 'story.call.patrol.1'): Call =>
    ({ planetId, kind: 'patrol', storyKey, sender: 'abacus', params: { planet: planetId } });

  it('first call after 1.2 s, later ones 6..9 s apart', () => {
    expect(callDelayMs(0, 0.7)).toBe(FIRST_CALL_MS);
    expect(callDelayMs(1, 0)).toBe(CALL_GAP_MIN_MS);
    expect(callDelayMs(3, 0.999999)).toBeLessThanOrEqual(CALL_GAP_MAX_MS);
    expect(callDelayMs(2, 0.5)).toBeCloseTo(7500);
  });

  it('prefers planets of the current system and skips planets already called', () => {
    const calls = [call('a.1'), call('a.2'), call('a.5')];
    expect(pickCall(calls, [], ['a.5', 'a.6'])?.planetId).toBe('a.5');
    expect(pickCall(calls, [calls[2]], ['a.5', 'a.6'])?.planetId).toBe('a.1');
    expect(pickCall(calls, calls, ['a.5'])).toBeNull();
  });

  it('never delivers a second skill intro while one is pending', () => {
    const intro = call('a.1', 'story.system.typing.text');
    expect(isIntroCall(intro)).toBe(true);
    const other = call('a.2', 'story.system.typing.text');
    expect(pickCall([other, call('a.3')], [intro], [])?.planetId).toBe('a.3');
  });
});
