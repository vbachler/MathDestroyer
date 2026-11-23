import { describe, expect, it } from 'vitest';
import {
  approach, boardingMissPoint, brightness, CRACKLE_GAP_MS, crackleGate, CRAWLER_SIZE, CX, depthOrder, DOOR_Y, FAR_SCALE, floorPoint, GAIT, gaitHz,
  gaitPose, GUN_LEFT, GUN_MAX_ANGLE, GUN_RIGHT, gunAimAngle, gunKick, gunMuzzle, gunPivot, GUNS, hoverLift, lungeWave,
  NEAR_Y, perspectiveScale, VIEW_H, VIEW_W,
} from '../src/fx/boardingLayout';

describe('boarding perspective', () => {
  it('maps the far door to small scale at the door line and z 0 to full scale at the bottom', () => {
    expect(perspectiveScale(1)).toBeCloseTo(FAR_SCALE);
    expect(perspectiveScale(0)).toBeCloseTo(1);
    expect(floorPoint(1, 0).y).toBeCloseTo(DOOR_Y);
    expect(floorPoint(0, 0).y).toBeCloseTo(NEAR_Y);
    expect(approach(1)).toBeCloseTo(0);
    expect(approach(0)).toBeCloseTo(1);
    expect(perspectiveScale(-1)).toBeCloseTo(1);
    expect(perspectiveScale(2)).toBeCloseTo(FAR_SCALE);
  });

  it('grows slowly far away and fast up close', () => {
    let prev = perspectiveScale(1);
    for (let z = 0.95; z >= 0; z -= 0.05) {
      const s = perspectiveScale(z);
      expect(s).toBeGreaterThan(prev);
      prev = s;
    }
    const far = perspectiveScale(0.9) - perspectiveScale(1);
    const near = perspectiveScale(0) - perspectiveScale(0.1);
    expect(near).toBeGreaterThan(far * 5);
  });

  it('spreads lanes as crawlers near, keeping them inside the door far away and on screen near', () => {
    const doorL = floorPoint(1, -1);
    const doorR = floorPoint(1, 1);
    expect(doorL.x).toBeGreaterThan(550);
    expect(doorR.x).toBeLessThan(730);
    const nearL = floorPoint(0, -1);
    const nearR = floorPoint(0, 1);
    expect(nearR.x - nearL.x).toBeGreaterThan((doorR.x - doorL.x) * 10);
    expect(nearL.x).toBeGreaterThan(0);
    expect(nearR.x).toBeLessThan(VIEW_W);
    expect(floorPoint(0.5, 0).x).toBeCloseTo(CX);
  });

  it('nearer crawlers are brighter and draw on top', () => {
    expect(brightness(0)).toBeGreaterThan(brightness(0.5));
    expect(brightness(0.5)).toBeGreaterThan(brightness(1));
    expect(depthOrder(0.1)).toBeGreaterThan(depthOrder(0.7));
  });
});

describe('crawler gait', () => {
  it('skitters faster the closer it is', () => {
    for (const style of Object.values(GAIT)) {
      expect(gaitHz(style, 0)).toBeGreaterThan(gaitHz(style, 0.5));
      expect(gaitHz(style, 0.5)).toBeGreaterThan(gaitHz(style, 1));
    }
  });

  it('keeps the pose small: rock, squash and bob stay within their amplitudes', () => {
    for (const style of Object.values(GAIT)) {
      for (let t = 0; t < 5000; t += 37) {
        const p = gaitPose(style, t, t * 0.05, 1.3);
        expect(Math.abs(p.rotation)).toBeLessThanOrEqual(style.rock + 1e-9);
        expect(p.scaleY).toBeLessThanOrEqual(1);
        expect(p.scaleY).toBeGreaterThanOrEqual(1 - style.squash - 1e-9);
        expect(p.lift).toBeGreaterThanOrEqual(0);
        expect(Math.abs(p.sway)).toBeLessThanOrEqual(style.zig * 1.35 + 1e-9);
      }
    }
  });

  it('the drifter flies with a slow bob, the wraith glides without bob, the stalker lunges', () => {
    const d = GAIT.drifter;
    expect(d.hover).toBeCloseTo(0.6);
    expect(hoverLift(d, 100)).toBeCloseTo(60);
    expect(hoverLift(GAIT.scorpion, 100)).toBe(0);
    const lifts = Array.from({ length: 50 }, (_, i) => gaitPose(d, i * 100, 0, 0).lift);
    expect(Math.max(...lifts) - Math.min(...lifts)).toBeGreaterThan(d.bob * 0.8);
    for (let t = 0; t < 5000; t += 50) {
      const w = gaitPose(GAIT.wraith, t, t * 0.01, 0.4);
      expect(w.lift).toBe(0);
      expect(w.scaleY).toBe(1);
    }
    // Lunge: the side-to-side spends more time near the extremes than a sine.
    expect(lungeWave(0.5, GAIT.stalker.lunge ?? 0)).toBeGreaterThan(0.9);
    expect(lungeWave(1, 4)).toBeCloseTo(1);
    expect(CRAWLER_SIZE.wraith).toBeGreaterThan(CRAWLER_SIZE.scorpion);
    expect(CRAWLER_SIZE.drifter).toBeLessThan(CRAWLER_SIZE.scorpion);
  });

  it('misses land beside the target', () => {
    const p = boardingMissPoint({ x: 600, y: 500 }, 0.2);
    expect(Math.abs(p.x - 600)).toBeGreaterThanOrEqual(50);
    expect(boardingMissPoint(null, 0.5).y).toBeLessThan(DOOR_Y);
  });
});

describe('lamp crackle', () => {
  it('crackles on about one flash in four or five, never twice within 1.5 s', () => {
    let last = -Infinity;
    let n = 0;
    let flashes = 0;
    const times: number[] = [];
    let seed = 7;
    const rand = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let t = 0; t < 600_000; t += 900 + rand() * 1200) {
      flashes++;
      if (crackleGate(t, last, rand())) { n++; last = t; times.push(t); }
    }
    expect(n / flashes).toBeGreaterThan(0.12);
    expect(n / flashes).toBeLessThan(0.26);
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(CRACKLE_GAP_MS);
    expect(crackleGate(1000, 0, 0)).toBe(false);
    expect(crackleGate(1600, 0, 0)).toBe(true);
    expect(crackleGate(1600, 0, 0.5)).toBe(false);
  });
});

describe('foreground guns', () => {
  it('muzzles at rest sit where the painted guns had them, either side of the centre', () => {
    const l = gunMuzzle(GUN_LEFT, 0);
    const r = gunMuzzle(GUN_RIGHT, 0);
    expect(l.x).toBeGreaterThan(480);
    expect(l.x).toBeLessThan(CX);
    expect(r.x).toBeGreaterThan(CX);
    expect(r.x).toBeLessThan(820);
    for (const m of [l, r]) {
      expect(m.y).toBeGreaterThan(520);
      expect(m.y).toBeLessThan(570);
    }
    for (const g of GUNS) expect(gunPivot(g).y).toBeGreaterThan(VIEW_H - 10);
  });

  it('aims at the target within the limit, and the rotated muzzle lies on the line to it', () => {
    for (const g of GUNS) {
      const target = { x: CX, y: DOOR_Y };
      const a = gunAimAngle(g, target);
      expect(Math.abs(a)).toBeLessThan(GUN_MAX_ANGLE);
      const p = gunPivot(g);
      const m = gunMuzzle(g, a);
      const cross = (m.x - p.x) * (target.y - p.y) - (m.y - p.y) * (target.x - p.x);
      expect(Math.abs(cross) / Math.hypot(target.x - p.x, target.y - p.y)).toBeLessThan(1e-6 * 1000);
      // Far to the side: clamped.
      expect(Math.abs(gunAimAngle(g, { x: g === GUN_LEFT ? -2000 : 4000, y: 500 }))).toBeCloseTo(GUN_MAX_ANGLE);
      // Recoil pushes the muzzle back toward the pivot.
      const kicked = gunMuzzle(g, 0, gunKick(g, 0, 1));
      expect(Math.hypot(kicked.x - p.x, kicked.y - p.y)).toBeLessThan(Math.hypot(gunMuzzle(g, 0).x - p.x, gunMuzzle(g, 0).y - p.y));
    }
  });
});
