import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import {
  UPGRADES, headStartUpgrades, offerFor, pickOfferIds, upgradeById, upgradeEffects,
} from '../src/core/upgrades';

describe('upgrades', () => {
  it('defines the six free upgrades, max tier 3, no costs or descriptions', () => {
    expect(UPGRADES.map((u) => u.id)).toEqual(['slowField', 'autoTurret', 'overcharge', 'salvage', 'repairDrone', 'shield']);
    for (const u of UPGRADES) {
      expect(u).toEqual({ id: u.id, nameKey: `battle.upgrade.${u.id}.name`, maxTier: 3 });
    }
    expect(upgradeById('collector')).toBeUndefined();
  });

  it('upgradeEffects maps tiers to effects', () => {
    expect(upgradeEffects({})).toEqual({
      speedMult: 1, turretCooldownMs: null, scoreMult: 1, salvageTier: 0, repairPerWave: 0, shieldPerWave: 0,
    });
    expect(upgradeEffects({ slowField: 1, autoTurret: 1, overcharge: 1, salvage: 1, repairDrone: 1, shield: 1 })).toEqual({
      speedMult: 0.9, turretCooldownMs: 7000, scoreMult: 1.25, salvageTier: 1, repairPerWave: 1, shieldPerWave: 1,
    });
    expect(upgradeEffects({ slowField: 2, autoTurret: 2, overcharge: 2, shield: 2 })).toMatchObject({
      speedMult: 0.82, turretCooldownMs: 5000, scoreMult: 1.5, shieldPerWave: 2,
    });
    expect(upgradeEffects({ slowField: 3, autoTurret: 3, overcharge: 3, shield: 3, repairDrone: 3 })).toMatchObject({
      speedMult: 0.75, turretCooldownMs: 3500, scoreMult: 2, shieldPerWave: 3, repairPerWave: 3,
    });
  });

  it('offerFor gives the next tier, null at max', () => {
    const slow = upgradeById('slowField')!;
    expect(offerFor(slow, {})).toEqual({ def: slow, nextTier: 1 });
    expect(offerFor(slow, { slowField: 1 })).toEqual({ def: slow, nextTier: 2 });
    expect(offerFor(slow, { slowField: 3 })).toBeNull();
  });

  it('pickOfferIds returns 3 distinct upgrades not at max tier', () => {
    for (let seed = 1; seed < 50; seed++) {
      const ids = pickOfferIds({ overcharge: 3, salvage: 3 }, createRng(seed));
      expect(ids).toHaveLength(3);
      expect(new Set(ids).size).toBe(3);
      expect(ids).not.toContain('overcharge');
      expect(ids).not.toContain('salvage');
    }
    const almostAll = { slowField: 3, autoTurret: 3, overcharge: 3, salvage: 3, repairDrone: 3 };
    expect(pickOfferIds(almostAll, createRng(1))).toEqual(['shield']);
    expect(pickOfferIds({ ...almostAll, shield: 3 }, createRng(1))).toEqual([]);
  });

  it('headStartUpgrades picks `count` distinct upgrades at tier 1, deterministic per seed', () => {
    expect(headStartUpgrades(0, createRng(1))).toEqual({});
    for (const count of [1, 2, 3]) {
      const a = headStartUpgrades(count, createRng(42));
      expect(Object.keys(a)).toHaveLength(count);
      expect(Object.values(a).every((t) => t === 1)).toBe(true);
      expect(Object.keys(a).every((id) => upgradeById(id))).toBe(true);
      expect(headStartUpgrades(count, createRng(42))).toEqual(a);
    }
  });
});
