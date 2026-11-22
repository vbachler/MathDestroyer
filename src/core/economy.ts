import type { SaveData } from './save';

export interface ModuleDef { id: string; nameKey: string; descKey: string; maxTier: number; costs: number[]; }

export type ModuleId = 'hull' | 'headStart' | 'targeting';

function def(id: ModuleId, costs: number[]): ModuleDef {
  return {
    id,
    nameKey: `meta.module.${id}.name`,
    descKey: `meta.module.${id}.desc`,
    maxTier: costs.length,
    costs,
  };
}

export const MODULES: ModuleDef[] = [
  def('hull', [150, 400, 900]),
  def('headStart', [100, 300, 700]),
  def('targeting', [120, 350, 800]),
];

export function moduleById(id: string): ModuleDef | undefined {
  return MODULES.find((m) => m.id === id);
}

/** Owned tier of a station module (0 if not owned). */
export function moduleTier(modules: Record<string, number>, id: ModuleId): number {
  return modules[id] ?? 0;
}

/** hull: +1 dome hp per tier. */
export function hullBonusHp(tier: number): number {
  return tier;
}

/** headStart: start each mission with 1 / 2 / 3 random upgrades at tier 1. */
export function headStartUpgradeCount(tier: number): number {
  return tier;
}

/** targeting: fast-answer threshold multiplier for scoring only (1.1 / 1.2 / 1.3). */
export function targetingMultiplier(tier: number): number {
  return 1 + 0.1 * tier;
}

/** Price of the next tier, or null when maxed or unknown. */
export function nextModuleCost(modules: Record<string, number>, moduleId: string): number | null {
  const m = moduleById(moduleId);
  if (!m) return null;
  const tier = modules[moduleId] ?? 0;
  return tier >= m.maxTier ? null : m.costs[tier];
}

export function missionCredits(args: { score: number; won: boolean; domesStanding: number;
                                       salvageTier: number; }): number {
  const { score, won, domesStanding, salvageTier } = args;
  return Math.round((score / 10 + (won ? 30 : 0) + 5 * domesStanding) * (1 + 0.2 * salvageTier));
}

/** Buys the next tier. Returns a new SaveData, or null if unaffordable, maxed or unknown. */
export function buyModule(save: SaveData, moduleId: string): SaveData | null {
  const cost = nextModuleCost(save.modules, moduleId);
  if (cost === null || save.credits < cost) return null;
  return {
    ...save,
    credits: save.credits - cost,
    modules: { ...save.modules, [moduleId]: (save.modules[moduleId] ?? 0) + 1 },
  };
}
