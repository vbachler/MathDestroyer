import { describe, expect, it } from 'vitest';
import { PLANETS, SECTORS, SYSTEMS, planetsOfSector, sectorById } from '../src/core/content';
import { factsForPlanet } from '../src/core/facts';
import {
  MAX_SECTOR_OVERLAP, MIN_SYSTEM_SPACING, WORLD_H, WORLD_W, discOverlap, hueDistance, planetHold,
  sectorMastery, sectorRadius, systemMastery, underAttack,
} from '../src/core/galaxy';
import { placeSectors, scatterSystems } from '../src/core/layout';
import type { FactStats } from '../src/core/types';
import { NOW, stat, statsFor } from './helpers';

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

describe('territory', () => {
  const pid = planetsOfSector('add-5')[0].id;
  const facts = factsForPlanet(pid);

  it('planetHold: < 0.2 hostile, < 0.6 contested, else secured', () => {
    expect(planetHold(pid, {})).toBe('hostile');
    expect(planetHold(pid, statsFor([pid], 1))).toBe('contested');      // 0.2
    expect(planetHold(pid, statsFor([pid], 2))).toBe('contested');      // 0.4
    expect(planetHold(pid, statsFor([pid], 3))).toBe('secured');        // 0.6
    expect(planetHold(pid, statsFor([pid], 5))).toBe('secured');
  });

  it('underAttack: not hostile and at least 2 due facts', () => {
    const stats: Record<string, FactStats> = statsFor([pid], 3);
    expect(underAttack(pid, stats, NOW)).toBe(false);
    stats[facts[0].id] = stat(3, { dueAt: NOW - 1 });
    expect(underAttack(pid, stats, NOW)).toBe(false);
    stats[facts[1].id] = stat(3, { dueAt: NOW });
    expect(underAttack(pid, stats, NOW)).toBe(true);
    const hostile = statsFor([pid], 0, { dueAt: NOW - 1 });
    expect(underAttack(pid, hostile, NOW)).toBe(false);
  });

  it('systemMastery and sectorMastery are means over planets', () => {
    const system = SYSTEMS.find((s) => s.sectorId === 'type-2')!;
    const first = system.planets[0].id;
    expect(systemMastery(system.id, {})).toBe(0);
    expect(systemMastery(system.id, statsFor([first], 5))).toBeCloseTo(1 / system.planets.length);
    expect(systemMastery('nope', {})).toBe(0);
    const sectorPlanets = planetsOfSector('type-2').map((p) => p.id);
    expect(sectorMastery('type-2', statsFor(sectorPlanets, 5))).toBe(1);
    expect(sectorMastery('type-2', statsFor([first], 5))).toBeCloseTo(1 / sectorPlanets.length);
    expect(sectorMastery('nope', {})).toBe(0);
    expect(PLANETS.length).toBe(153);
  });
});
