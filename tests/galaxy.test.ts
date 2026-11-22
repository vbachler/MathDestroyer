import { describe, expect, it } from 'vitest';
import { SECTORS, SYSTEMS, sectorById } from '../src/core/content';
import {
  MAX_SECTOR_OVERLAP, MIN_SYSTEM_SPACING, WORLD_H, WORLD_W, discOverlap, hueDistance, planetHold,
  sectorMastery, sectorRadius, systemMastery, underAttack,
} from '../src/core/galaxy';
import { hasNameBand, placeSectors, scatterSystems } from '../src/core/layout';
import { DAY, NOW, planetIds, progress } from './helpers';

describe('galaxy layout', () => {
  it('is deterministic', () => {
    const slots = SECTORS.map((s) => ({ radius: s.radius, group: s.skill }));
    expect(placeSectors(slots)).toEqual(placeSectors(slots));
    const disc = { x: 1000, y: 1000, radius: 300 };
    expect(scatterSystems(disc, 4, [], 7)).toEqual(scatterSystems(disc, 4, [], 7));
    // The content uses exactly this placement (core first, then galaxy order).
    const order = [SECTORS[SECTORS.length - 1], ...SECTORS.slice(0, -1)];
    const placed = placeSectors(order.map((s) => ({ radius: s.radius, group: s.skill })));
    order.forEach((s, i) => expect([s.x, s.y]).toEqual([placed[i].x, placed[i].y]));
  });

  it('keeps every sector disc and system inside the 4800x2700 world', () => {
    expect([WORLD_W, WORLD_H]).toEqual([4800, 2700]);
    for (const s of SECTORS) {
      expect(s.x - s.radius).toBeGreaterThanOrEqual(0);
      expect(s.x + s.radius).toBeLessThanOrEqual(WORLD_W);
      expect(s.y - s.radius).toBeGreaterThanOrEqual(0);
      expect(s.y + s.radius).toBeLessThanOrEqual(WORLD_H);
    }
    for (const y of SYSTEMS) {
      expect(y.x).toBeGreaterThanOrEqual(0);
      expect(y.x).toBeLessThanOrEqual(WORLD_W);
      expect(y.y).toBeGreaterThanOrEqual(0);
      expect(y.y).toBeLessThanOrEqual(WORLD_H);
    }
  });

  it('radius grows with the system count', () => {
    expect(sectorRadius(2)).toBeGreaterThan(sectorRadius(1));
    for (const s of SECTORS) expect(s.radius).toBe(sectorRadius(s.systems.length));
  });

  it('no two sector discs overlap by more than ~15%', () => {
    for (let i = 0; i < SECTORS.length; i++) {
      for (let j = i + 1; j < SECTORS.length; j++) {
        expect(discOverlap(SECTORS[i], SECTORS[j]), `${SECTORS[i].id} / ${SECTORS[j].id}`).toBeLessThanOrEqual(MAX_SECTOR_OVERLAP);
      }
    }
    expect(discOverlap({ x: 0, y: 0, radius: 10 }, { x: 100, y: 0, radius: 10 })).toBe(0);
    expect(discOverlap({ x: 0, y: 0, radius: 10 }, { x: 0, y: 0, radius: 10 })).toBe(1);
  });

  it('systems are at least 70 units apart and lie inside (or very near) their sector', () => {
    expect(MIN_SYSTEM_SPACING).toBe(70);
    for (let i = 0; i < SYSTEMS.length; i++) {
      for (let j = i + 1; j < SYSTEMS.length; j++) {
        const d = Math.hypot(SYSTEMS[i].x - SYSTEMS[j].x, SYSTEMS[i].y - SYSTEMS[j].y);
        expect(d, `${SYSTEMS[i].id} / ${SYSTEMS[j].id}`).toBeGreaterThanOrEqual(MIN_SYSTEM_SPACING);
      }
    }
    for (const y of SYSTEMS) {
      const s = sectorById(y.sectorId)!;
      expect(Math.hypot(y.x - s.x, y.y - s.y)).toBeLessThanOrEqual(s.radius);
    }
  });

  it('every sector keeps a band free for its name', () => {
    for (const s of SECTORS) expect(hasNameBand(s, s.systems), s.id).toBe(true);
    expect(hasNameBand({ x: 0, y: 0, radius: 300 }, [-0.6, -0.35, 0, 0.35, 0.6].map((k) => ({ x: 0, y: k * 300 })))).toBe(false);
  });

  it('the core sits at the centre and the skills spiral around it', () => {
    const core = sectorById('core')!;
    expect([core.x, core.y]).toEqual([WORLD_W / 2, WORLD_H / 2]);
    // Sectors of one skill stay together: each one's nearest other sector of the same skill is close.
    for (const s of SECTORS) {
      const same = SECTORS.filter((o) => o.skill === s.skill && o !== s);
      if (same.length === 0) continue;
      const nearest = Math.min(...same.map((o) => Math.hypot(o.x - s.x, o.y - s.y)));
      expect(nearest, s.id).toBeLessThanOrEqual(s.radius + Math.max(...same.map((o) => o.radius)) + 200);
    }
  });

  it('hues: one family per skill, different skills clearly apart', () => {
    for (const a of SECTORS) {
      for (const b of SECTORS) {
        if (a === b) continue;
        if (a.skill === b.skill) {
          expect(hueDistance(a.hue, b.hue)).toBeLessThanOrEqual(20);
          expect(hueDistance(a.hue, b.hue)).toBeGreaterThan(0);
        } else {
          expect(hueDistance(a.hue, b.hue), `${a.id} / ${b.id}`).toBeGreaterThanOrEqual(25);
        }
      }
    }
    for (const y of SYSTEMS) {
      expect(y.sunHue).toBeGreaterThanOrEqual(0);
      expect(y.sunHue).toBeLessThan(360);
    }
    expect(hueDistance(350, 10)).toBe(20);
  });
});

describe('territory (planet progress)', () => {
  const [p1, p2, p3] = planetIds('add-5');

  it('planetHold: level 0 hostile, 1..2 contested, 3+ secured', () => {
    const hold = (level: number) => planetHold(p1, { planets: { [p1]: progress(level) } });
    expect(planetHold(p1, { planets: {} })).toBe('hostile');
    expect([0, 1, 2, 3, 4, 5].map(hold)).toEqual(['hostile', 'contested', 'contested', 'secured', 'secured', 'secured']);
    expect(planetHold('nope', { planets: {} })).toBe('hostile');
  });

  it('underAttack: level >= 1 and now >= dueAt', () => {
    const at = (level: number, dueAt: number) => underAttack(p1, { planets: { [p1]: progress(level, { dueAt }) } }, NOW);
    expect(at(0, NOW - 1)).toBe(false);
    expect(at(1, NOW + 1)).toBe(false);
    expect(at(1, NOW)).toBe(true);
    expect(at(5, NOW - DAY)).toBe(true);
    expect(underAttack(p1, { planets: {} }, NOW)).toBe(false);
  });

  it('systemMastery and sectorMastery are means of planet mastery over their planets', () => {
    const system = sectorById('add-5')!.systems[0];
    const n = system.planets.length;
    const save = { planets: { [p1]: progress(5), [p2]: progress(2) } };
    expect(system.planets.map((p) => p.id).slice(0, 2)).toEqual([p1, p2]);
    expect(systemMastery(system.id, save)).toBeCloseTo((1 + 0.4) / n);
    expect(systemMastery(system.id, { planets: {} })).toBe(0);
    expect(systemMastery('nope', save)).toBe(0);
    const all = planetIds('add-5');
    expect(sectorMastery('add-5', save)).toBeCloseTo(1.4 / all.length);
    expect(sectorMastery('add-5', { planets: Object.fromEntries(all.map((id) => [id, progress(5)])) })).toBe(1);
    expect(sectorMastery('nope', save)).toBe(0);
    expect(p3).toBeDefined();
  });
});
