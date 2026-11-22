import { describe, expect, it } from 'vitest';
import {
  MODULES, buyModule, headStartUpgradeCount, hullBonusHp, missionCredits, nextModuleCost, targetingMultiplier,
} from '../src/core/economy';
import { defaultSave } from '../src/core/save';

describe('economy', () => {
  it('defines the station modules with the documented costs', () => {
    expect(Object.fromEntries(MODULES.map((m) => [m.id, m.costs]))).toEqual({
      hull: [150, 400, 900],
      headStart: [100, 300, 700],
      targeting: [120, 350, 800],
    });
    for (const m of MODULES) {
      expect(m.nameKey).toBe(`meta.module.${m.id}.name`);
      expect(m.descKey).toBe(`meta.module.${m.id}.desc`);
    }
  });

  it('module effects', () => {
    expect(hullBonusHp(2)).toBe(2);
    expect([0, 1, 2, 3].map(headStartUpgradeCount)).toEqual([0, 1, 2, 3]);
    expect(targetingMultiplier(0)).toBe(1);
    expect(targetingMultiplier(3)).toBeCloseTo(1.3);
  });

  it('missionCredits follows the formula', () => {
    expect(missionCredits({ score: 0, won: false, domesStanding: 0, salvageTier: 0 })).toBe(0);
    expect(missionCredits({ score: 250, won: true, domesStanding: 4, salvageTier: 0 })).toBe(75);
    expect(missionCredits({ score: 250, won: true, domesStanding: 4, salvageTier: 2 })).toBe(105);
    expect(missionCredits({ score: 123, won: false, domesStanding: 1, salvageTier: 1 })).toBe(Math.round((12.3 + 5) * 1.2));
    expect(missionCredits({ score: 5, won: false, domesStanding: 0, salvageTier: 0 })).toBe(1); // round(0.5)
  });

  it('buyModule spends credits and raises the tier', () => {
    const save = { ...defaultSave(), credits: 500 };
    const after = buyModule(save, 'hull');
    expect(after).not.toBeNull();
    expect(after!.credits).toBe(350);
    expect(after!.modules.hull).toBe(1);
    expect(save.credits).toBe(500);
    expect(save.modules.hull).toBeUndefined();
    expect(nextModuleCost(after!.modules, 'hull')).toBe(400);
  });

  it('buyModule returns null when unaffordable, maxed or unknown', () => {
    expect(buyModule({ ...defaultSave(), credits: 99 }, 'headStart')).toBeNull();
    expect(buyModule({ ...defaultSave(), credits: 100 }, 'headStart')).not.toBeNull();
    expect(buyModule({ ...defaultSave(), credits: 99999, modules: { hull: 3 } }, 'hull')).toBeNull();
    expect(buyModule({ ...defaultSave(), credits: 99999 }, 'warpDrive')).toBeNull();
    expect(buyModule({ ...defaultSave(), credits: 99999 }, 'reactor')).toBeNull();
  });
});
