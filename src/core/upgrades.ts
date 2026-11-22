import type { Rng } from './rng';

/** In-mission upgrade. Free: after each cleared wave the player picks one of three offers. */
export interface UpgradeDef { id: UpgradeId; nameKey: string; maxTier: number; }
export interface UpgradeOffer { def: UpgradeDef; nextTier: number; }

export type UpgradeId = 'slowField' | 'autoTurret' | 'overcharge' | 'salvage' | 'repairDrone' | 'shield';

export const UPGRADE_MAX_TIER = 3;

function def(id: UpgradeId): UpgradeDef {
  return { id, nameKey: `battle.upgrade.${id}.name`, maxTier: UPGRADE_MAX_TIER };
}

export const UPGRADES: UpgradeDef[] = [
  def('slowField'),
  def('autoTurret'),
  def('overcharge'),
  def('salvage'),
  def('repairDrone'),
  def('shield'),
];

/** Effect tables, index = tier - 1. */
export const SLOW_FIELD_SPEED = [0.9, 0.82, 0.75];
export const AUTO_TURRET_COOLDOWN_MS = [7000, 5000, 3500];
export const OVERCHARGE_SCORE = [1.25, 1.5, 2];
export const SALVAGE_CREDIT_BONUS = [0.2, 0.4, 0.6];
export const OFFERS_PER_BREAK = 3;

export function upgradeById(id: string): UpgradeDef | undefined {
  return UPGRADES.find((u) => u.id === id);
}

const tierOf = (owned: Record<string, number>, id: UpgradeId): number => owned[id] ?? 0;

/** Combined effect of the owned upgrade tiers. */
export interface UpgradeEffects {
  speedMult: number;                 // enemy speed multiplier
  turretCooldownMs: number | null;   // null = no auto-turret
  scoreMult: number;
  salvageTier: number;               // feeds missionCredits
  repairPerWave: number;             // dome hp repaired at each wave start
  shieldPerWave: number;             // impacts absorbed per wave
}

export function upgradeEffects(owned: Record<string, number>): UpgradeEffects {
  const slow = tierOf(owned, 'slowField');
  const turret = tierOf(owned, 'autoTurret');
  const over = tierOf(owned, 'overcharge');
  return {
    speedMult: slow > 0 ? SLOW_FIELD_SPEED[slow - 1] : 1,
    turretCooldownMs: turret > 0 ? AUTO_TURRET_COOLDOWN_MS[turret - 1] : null,
    scoreMult: over > 0 ? OVERCHARGE_SCORE[over - 1] : 1,
    salvageTier: tierOf(owned, 'salvage'),
    repairPerWave: tierOf(owned, 'repairDrone'),
    shieldPerWave: tierOf(owned, 'shield'),
  };
}

/** Offer for the next tier of `d`, or null when it is already at max tier. */
export function offerFor(d: UpgradeDef, owned: Record<string, number>): UpgradeOffer | null {
  const tier = owned[d.id] ?? 0;
  if (tier >= d.maxTier) return null;
  return { def: d, nextTier: tier + 1 };
}

/** Picks up to `count` distinct upgrade ids that are not at max tier. */
export function pickOfferIds(owned: Record<string, number>, rng: Rng, count = OFFERS_PER_BREAK): string[] {
  const open = UPGRADES.filter((u) => (owned[u.id] ?? 0) < u.maxTier).map((u) => u.id);
  return rng.shuffle(open).slice(0, count);
}

/** headStart module: `count` distinct random upgrades at tier 1, chosen with the mission RNG. */
export function headStartUpgrades(count: number, rng: Rng): Record<string, number> {
  const out: Record<string, number> = {};
  if (count <= 0) return out;
  for (const id of rng.shuffle(UPGRADES.map((u) => u.id)).slice(0, count)) out[id] = 1;
  return out;
}
