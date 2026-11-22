import { describe, expect, it } from 'vitest';
import {
  approach, boardingMissPoint, brightness, CX, depthOrder, DOOR_Y, FAR_SCALE, floorPoint, GAIT, gaitHz, gaitPose,
  NEAR_Y, perspectiveScale, VIEW_W,
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

  it('misses land beside the target', () => {
    const p = boardingMissPoint({ x: 600, y: 500 }, 0.2);
    expect(Math.abs(p.x - 600)).toBeGreaterThanOrEqual(50);
    expect(boardingMissPoint(null, 0.5).y).toBeLessThan(DOOR_Y);
  });
});
