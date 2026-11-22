import { SECTORS } from './content';
import { categoryStatId, parseCategoryStatId, sectorCategories, sectorFacts, sectorKind } from './factgen';
import { formatNumber, opSymbol } from './i18n';
import type { Fact, Locale } from './types';

export {
  categoryDefs, categoryStatId, generateFact, parseCategoryStatId, sectorCategories, sectorFacts, sectorKind,
} from './factgen';
export type { CategoryDef, SectorKind } from './factgen';

let all: readonly Fact[] | null = null;
let index: Map<string, Fact> | null = null;
let sectorOfId: Map<string, string> | null = null;

function build(): void {
  const facts: Fact[] = [];
  sectorOfId = new Map();
  for (const sector of SECTORS) {
    for (const f of sectorFacts(sector.id)) {
      facts.push(f);
      sectorOfId.set(f.id, sector.id);
    }
  }
  all = facts;
  index = new Map(facts.map((f) => [f.id, f]));
}

/** Every fact of every enumerated sector once, in galaxy order. Returns a fresh array. */
export function allFacts(): Fact[] {
  if (!all) build();
  return (all ?? []).slice();
}

/** An enumerated fact by id (generated problems have no fixed id). */
export function factById(id: string): Fact | undefined {
  if (!index) build();
  return index?.get(id);
}

/** Stat ids that hold a sector's knowledge: its fact ids (enumerated) or category ids (generated). */
export function sectorStatIds(sectorId: string): string[] {
  if (sectorKind(sectorId) === 'generated') return sectorCategories(sectorId).map((c) => categoryStatId(sectorId, c));
  return sectorFacts(sectorId).map((f) => f.statId);
}

/** The sector a stat id belongs to, or undefined for ids no sector holds (e.g. removed facts). */
export function sectorOfStat(statId: string): string | undefined {
  const cat = parseCategoryStatId(statId);
  if (cat) return sectorCategories(cat.sectorId).includes(cat.category) ? cat.sectorId : undefined;
  if (!sectorOfId) build();
  return sectorOfId?.get(statId);
}

/**
 * Text shown on the enemy: `7 · 8` (hr) / `7 × 8` (en), `7 · ? = 56`, `5 − (−3)`.
 * No `= ?` suffix when the unknown is the result. `type` facts show the number itself.
 */
export function formatProblem(fact: Fact, locale: Locale): string {
  if (fact.op === 'type') return formatNumber(fact.a, locale);
  const left = fact.unknown === 'a' ? '?' : formatNumber(fact.a, locale);
  let right: string;
  if (fact.unknown === 'b') right = '?';
  else if (fact.b < 0) right = `(${formatNumber(fact.b, locale)})`;
  else right = formatNumber(fact.b, locale);
  const expr = `${left} ${opSymbol(fact.op, locale)} ${right}`;
  return fact.unknown === 'result' ? expr : `${expr} = ${formatNumber(fact.result, locale)}`;
}

/** Complete fact with every part filled in, e.g. `7 · 8 = 56` (also for `7 · ? = 56`). For explanations. */
export function formatSolved(fact: Fact, locale: Locale): string {
  if (fact.op === 'type') return formatNumber(fact.a, locale);
  const right = fact.b < 0 ? `(${formatNumber(fact.b, locale)})` : formatNumber(fact.b, locale);
  return `${formatNumber(fact.a, locale)} ${opSymbol(fact.op, locale)} ${right} = ${formatNumber(fact.result, locale)}`;
}
