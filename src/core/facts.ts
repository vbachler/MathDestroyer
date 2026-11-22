import { PLANETS, planetFactList } from './content';
import { formatNumber, opSymbol } from './i18n';
import type { Fact, Locale } from './types';

/** Facts of one planet in its fixed order. Deterministic: the same list on every call and
 *  every run; [] for the core planet and unknown ids. Returns a fresh array. */
export function factsForPlanet(planetId: string): Fact[] {
  return planetFactList(planetId).slice();
}

let all: readonly Fact[] | null = null;
let index: Map<string, Fact> | null = null;

/** Every fact of the game, in galaxy order. */
export function allFacts(): Fact[] {
  if (!all) all = PLANETS.flatMap((p) => planetFactList(p.id));
  return all.slice();
}

export function factById(id: string): Fact | undefined {
  if (!index) index = new Map(allFacts().map((f) => [f.id, f]));
  return index.get(id);
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
