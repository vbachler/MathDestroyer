import { createRng } from './rng';
import type { Rng } from './rng';
import type { Fact, Op } from './types';

/**
 * Problem sources per sector (ARCHITECTURE.md "Random problems v4"). Pure and deterministic.
 *
 * A sector is *enumerated* when its range holds at most ENUMERATION_LIMIT possible problems:
 * its pool is the full enumeration (`sectorFacts`), with the Balance rule's caps on easy facts,
 * and knowledge is tracked per fact (`statId === id`). Otherwise it is *generated*: problems are
 * drawn at random from a category of the sector (`generateFact`) and knowledge is tracked per
 * category (`statId === cat:<sectorId>:<category>`). Fact ids keep their formats
 * (`add:6+7`, `mul:7x8`, `miss:mul:7x?=56`, ...) so saved stats of enumerated facts stay valid.
 */

type Unknown = Fact['unknown'];

/** A sector with more possible problems than this is generated, not enumerated. */
export const ENUMERATION_LIMIT = 120;

export function compute(op: Op, a: number, b: number): number {
  switch (op) {
    case 'type': return a;
    case 'add': return a + b;
    case 'sub': return a - b;
    case 'mul': return a * b;
    case 'div': return a / b;
  }
}

const ID_OP: Record<Exclude<Op, 'type'>, string> = { add: '+', sub: '-', mul: 'x', div: '/' };

/** The id of a problem; it describes the actual numbers (`add:6+7`, `miss:add:?+7=13`). */
export function factIdOf(op: Op, a: number, b: number, unknown: Unknown = 'result'): string {
  if (op === 'type') return `type:${a}`;
  if (unknown === 'result') return `${op}:${a}${ID_OP[op]}${b}`;
  const left = unknown === 'a' ? '?' : String(a);
  const right = unknown === 'b' ? '?' : String(b);
  return `miss:${op}:${left}${ID_OP[op]}${right}=${compute(op, a, b)}`;
}

/** A frozen fact. `statId` defaults to the id (enumerated facts). */
export function makeFact(op: Op, a: number, b: number, unknown: Unknown = 'result', statId?: string): Fact {
  const result = compute(op, a, b);
  const id = factIdOf(op, a, b, unknown);
  const answer = unknown === 'a' ? a : unknown === 'b' ? b : result;
  return Object.freeze({ id, statId: statId ?? id, op, a, b, result, unknown, answer });
}

/** Stat id of a category of a generated sector. */
export function categoryStatId(sectorId: string, category: string): string {
  return `cat:${sectorId}:${category}`;
}

/** Sector and category of a category stat id, or null for any other id. */
export function parseCategoryStatId(statId: string): { sectorId: string; category: string } | null {
  const m = /^cat:([^:]+):([^:]+)$/.exec(statId);
  return m ? { sectorId: m[1], category: m[2] } : null;
}

type Pair = [number, number];

function pairs(aFrom: number, aTo: number, bFrom: number, bTo: number, keep: (a: number, b: number) => boolean): Pair[] {
  const out: Pair[] = [];
  for (let a = aFrom; a <= aTo; a++) {
    for (let b = bFrom; b <= bTo; b++) if (keep(a, b)) out.push([a, b]);
  }
  return out;
}

const range = (from: number, to: number): number[] =>
  from > to ? [] : Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** Units digits of a + b reach 10. */
const carries = (a: number, b: number): boolean => (a % 10) + (b % 10) >= 10;
/** a - b needs a borrow: the units digit of a is smaller than that of b. */
const borrows = (a: number, b: number): boolean => a % 10 < b % 10;

/** Trivial addition / subtraction fact: a zero operand, or (subtraction) a zero result.
 *  Other operations are never trivial (a typing fact always has b = 0). */
export function isTrivial(f: Fact): boolean {
  if (f.op !== 'add' && f.op !== 'sub') return false;
  return f.a === 0 || f.b === 0 || (f.op === 'sub' && f.result === 0);
}

/** Operand-1 fact: addition a or b = 1; subtraction b = 1 or result 1. */
export function isOperandOne(f: Fact): boolean {
  if (f.op !== 'add' && f.op !== 'sub') return false;
  return f.op === 'sub' ? f.b === 1 || f.result === 1 : f.a === 1 || f.b === 1;
}

/** Share caps of the balance rule (ARCHITECTURE.md "Balance rule"). */
export const TRIVIAL_SHARE_SMALL = 0.2;   // add-5, sub-5
export const TRIVIAL_SHARE = 0.1;         // every other addition / subtraction sector
export const OPERAND_ONE_SHARE = 0.15;    // cap outside add-5 / sub-5
/** Share of operand-1 facts actually added outside the "to 5" sectors (below the cap). */
const OPERAND_ONE_TARGET = 0.1;

/** Easy candidates of an addition / subtraction range: [left side, right side]. */
type Sides = [Pair[], Pair[]];
interface Easy { trivial: Sides; one: Sides; }

/** 0 + b / a + 0 and 1 + b / a + 1 with the sum in [lo, hi], a <= aTo, b <= bTo. */
function addEasy(lo: number, hi: number, aTo: number, bTo: number): Easy {
  return {
    trivial: [range(lo, Math.min(hi, bTo)).map((b): Pair => [0, b]), range(lo, Math.min(hi, aTo)).map((a): Pair => [a, 0])],
    one: [range(lo - 1, Math.min(hi - 1, bTo)).map((b): Pair => [1, b]), range(lo - 1, Math.min(hi - 1, aTo)).map((a): Pair => [a, 1])],
  };
}

/** a − 0 / a − a and a − 1 / a − (a − 1) for a in [aFrom, aTo], b <= bTo. */
function subEasy(aFrom: number, aTo: number, bTo: number): Easy {
  return {
    trivial: [range(aFrom, aTo).map((a): Pair => [a, 0]), range(aFrom, Math.min(aTo, bTo)).map((a): Pair => [a, a])],
    one: [range(aFrom, aTo).map((a): Pair => [a, 1]), range(aFrom, Math.min(aTo, bTo + 1)).map((a): Pair => [a, a - 1])],
  };
}

// ---------------------------------------------------------------- enumerated sectors

interface ArithmeticSpec {
  op: 'add' | 'sub';
  /** Problems inside the ordinary ranges (no trivial ones; no operand-1 ones outside "to 5"). */
  normal: Pair[];
  easy: Easy;
  small: boolean;     // add-5 / sub-5
  seed: number;       // picks the easy facts (unchanged since v3, so their ids are too)
}

const NO_SIDES: Sides = [[], []];

/** The small addition / subtraction sectors, enumerated under the Balance rule. */
function smallArithmetic(id: string): ArithmeticSpec | null {
  switch (id) {
    case 'add-5':
      return { op: 'add', normal: pairs(1, 4, 1, 4, (a, b) => a + b >= 2 && a + b <= 5),
        easy: { ...addEasy(1, 5, 5, 5), one: NO_SIDES }, small: true, seed: 101 };
    case 'add-10':
      return { op: 'add', normal: pairs(2, 8, 2, 8, (a, b) => a + b >= 6 && a + b <= 10), easy: addEasy(6, 10, 10, 10), small: false, seed: 102 };
    case 'add-15':
      return { op: 'add', normal: pairs(2, 13, 2, 13, (a, b) => a + b >= 11 && a + b <= 15), easy: addEasy(11, 15, 13, 13), small: false, seed: 103 };
    case 'sub-5':
      return { op: 'sub', normal: pairs(2, 5, 1, 4, (a, b) => b < a), easy: { ...subEasy(2, 5, 5), one: NO_SIDES }, small: true, seed: 111 };
    case 'sub-10':
      return { op: 'sub', normal: pairs(6, 10, 2, 8, (a, b) => b <= a - 2), easy: subEasy(6, 10, 10), small: false, seed: 112 };
    case 'sub-15':
      return { op: 'sub', normal: pairs(11, 15, 2, 13, (a, b) => b <= a - 2), easy: subEasy(11, 15, 13), small: false, seed: 113 };
    default:
      return null;
  }
}

/** n pairs taken alternately left / right from the seeded shuffles of both sides. */
function balancedPick(rng: Rng, [left, right]: Sides, n: number): Pair[] {
  const l = rng.shuffle(left);
  const r = rng.shuffle(right);
  const out: Pair[] = [];
  while (out.length < n && (l.length > 0 || r.length > 0)) {
    const fromLeft = out.length % 2 === 0 ? l.length > 0 : r.length === 0;
    out.push((fromLeft ? l : r).shift() as Pair);
  }
  return out;
}

/**
 * The whole ordinary range plus a few easy facts under the Balance rule: trivial facts
 * floor(share x size) (at least 1; 20% in "to 5", else 10%), operand-1 facts floor(10% x size)
 * outside "to 5", picked alternately left / right by the sector seed. 0 + 0 and 0 − 0 never appear.
 */
function balanced(spec: ArithmeticSpec): Pair[] {
  const rng = createRng(spec.seed);
  const share = spec.small ? TRIVIAL_SHARE_SMALL : TRIVIAL_SHARE;
  const minTrivial = spec.easy.trivial[0].length + spec.easy.trivial[1].length > 0 ? 1 : 0;
  // The easy facts are added on top: grow until the counts agree with the final size.
  let trivialN = 0;
  let oneN = 0;
  for (let guard = 0; guard < 20; guard++) {
    const total = spec.normal.length + trivialN + oneN;
    const t = Math.max(minTrivial, Math.floor(share * total));
    const o = spec.small ? 0 : Math.floor(OPERAND_ONE_TARGET * total);
    if (t === trivialN && o === oneN) break;
    [trivialN, oneN] = [t, o];
  }
  const trivial = balancedPick(rng, spec.easy.trivial, trivialN);
  const one = balancedPick(rng, spec.easy.one, oneN);
  return [...spec.normal, ...trivial, ...one];
}

/** Times tables of a multiplication / division sector. */
const TABLES: Readonly<Record<string, readonly number[]>> = {
  'mul-a': [2, 5, 10], 'mul-b': [3, 4], 'mul-c': [6, 7], 'mul-d': [8, 9],
  'div-a': [2, 5, 10], 'div-b': [3, 4], 'div-c': [6, 7], 'div-d': [8, 9],
};

/** Facts of one times table: n x 1..10 or (n*k) / n for k in 1..10. */
function tableFacts(op: 'mul' | 'div', n: number): Fact[] {
  return Array.from({ length: 10 }, (_, i) => (op === 'mul' ? makeFact('mul', n, i + 1) : makeFact('div', n * (i + 1), n)));
}

const byOperands = (x: Fact, y: Fact): number => x.a - y.a || x.b - y.b;

/** Full pool of an enumerated sector in content order, or null when the sector is not enumerated. */
function enumeratedPool(sectorId: string): Fact[] | null {
  const spec = smallArithmetic(sectorId);
  if (spec) return balanced(spec).map(([a, b]) => makeFact(spec.op, a, b)).sort(byOperands);
  const tables = TABLES[sectorId];
  if (tables) return tables.flatMap((n) => tableFacts(sectorId.startsWith('mul') ? 'mul' : 'div', n));
  switch (sectorId) {
    case 'type-1':
      return range(0, 9).map((n) => makeFact('type', n, 0));
    case 'type-2':
      return range(10, 99).map((n) => makeFact('type', n, 0));
    case 'miss-mul':      // a x ? = c, tables 2..10
      return pairs(2, 10, 1, 10, () => true).map(([a, b]) => makeFact('mul', a, b, 'b'));
    case 'miss-div':      // c / ? = k: dividend c = n*k, unknown divisor n (2..10), quotient k (1..10)
      return pairs(2, 10, 1, 10, () => true).map(([n, k]) => makeFact('div', n * k, n, 'b'));
    default:
      return null;
  }
}

/** Every problem of an enumerated sector's range before the Balance caps (for the size rule). */
function enumeratedRangeSize(sectorId: string): number {
  const spec = smallArithmetic(sectorId);
  if (!spec) return enumeratedPool(sectorId)?.length ?? 0;
  const { trivial, one } = spec.easy;
  return spec.normal.length + trivial[0].length + trivial[1].length + one[0].length + one[1].length;
}

// ---------------------------------------------------------------- generated sectors

/** One category of a generated sector: every problem it can produce, and its base share. */
export interface CategoryDef {
  name: string;
  /** Base probability of the category before the adaptive weighting (shares sum to 1). */
  share: number;
  /** Bounds on the final probability after weighting (Balance rule as probabilities). */
  min?: number;
  max?: number;
}

interface CategorySource extends CategoryDef {
  op: Op;
  unknown: Unknown;
  problems: () => Pair[];
}

/** Easy facts of the generated addition / subtraction sectors: at most 10% of the problems. */
export const EASY_MAX_SHARE = TRIVIAL_SHARE;
/** At least half of the problems need a carry / borrow where that applies. */
export const HARD_MIN_SHARE = 0.5;

const sidesOf = (e: Easy): Pair[] => [...e.trivial[0], ...e.trivial[1], ...e.one[0], ...e.one[1]];

/**
 * Addition to 50 / 100: `carry` (units digits reach 10, e.g. 27 + 15), `nocarry` (e.g. 23 + 14)
 * and `easy` (an operand 0 or 1, e.g. 0 + 37, 48 + 1). Ranges as in "Galaxy map v3"; easy facts
 * keep the sum range and operand upper bounds.
 */
function additionCategories(aFrom: number, aTo: number, bFrom: number, bTo: number, lo: number, hi: number): CategorySource[] {
  const normal = (): Pair[] => pairs(aFrom, aTo, bFrom, bTo, (a, b) => a + b >= lo && a + b <= hi);
  return [
    { name: 'carry', share: 0.55, min: HARD_MIN_SHARE, op: 'add', unknown: 'result', problems: () => normal().filter(([a, b]) => carries(a, b)) },
    { name: 'nocarry', share: 0.37, op: 'add', unknown: 'result', problems: () => normal().filter(([a, b]) => !carries(a, b)) },
    { name: 'easy', share: 0.08, max: EASY_MAX_SHARE, op: 'add', unknown: 'result', problems: () => sidesOf(addEasy(lo, hi, aTo, bTo)) },
  ];
}

/**
 * Subtraction from 50 / 100: `borrow` (units digit of a smaller than of b, e.g. 42 − 17),
 * `noborrow` (e.g. 48 − 13) and `easy` (a − 0, a − a, a − 1, a − (a − 1)). b <= a − 3 in the
 * ordinary range; easy facts keep the minuend range and the subtrahend upper bound.
 */
function subtractionCategories(aFrom: number, aTo: number, bFrom: number, bTo: number): CategorySource[] {
  const normal = (): Pair[] => pairs(aFrom, aTo, bFrom, bTo, (a, b) => b <= a - 3);
  return [
    { name: 'borrow', share: 0.55, min: HARD_MIN_SHARE, op: 'sub', unknown: 'result', problems: () => normal().filter(([a, b]) => borrows(a, b)) },
    { name: 'noborrow', share: 0.37, op: 'sub', unknown: 'result', problems: () => normal().filter(([a, b]) => !borrows(a, b)) },
    { name: 'easy', share: 0.08, max: EASY_MAX_SHARE, op: 'sub', unknown: 'result', problems: () => sidesOf(subEasy(aFrom, aTo, bTo)) },
  ];
}

/**
 * Negative numbers within ±lim (operands nonzero, |result| <= lim, something negative; in
 * `neg-20` at least one operand beyond ±10), by operation and sign pattern:
 * `addMixed` one negative and one positive addend (−4 + 6, 5 + (−8)); `addNegNeg` both addends
 * negative (−4 + (−6)); `subNeg` subtracting a negative (5 − (−3)); `subCross` subtracting a
 * positive number with a negative result (3 − 7, −2 − 5).
 */
function negativeCategories(lim: number, inner: number): CategorySource[] {
  const all = (op: 'add' | 'sub'): Pair[] => pairs(-lim, lim, -lim, lim, (a, b) => {
    const r = compute(op, a, b);
    return a !== 0 && b !== 0 && Math.abs(r) <= lim && (a < 0 || b < 0 || r < 0) && (Math.abs(a) > inner || Math.abs(b) > inner);
  });
  return [
    { name: 'addMixed', share: 0.3, op: 'add', unknown: 'result', problems: () => all('add').filter(([a, b]) => (a < 0) !== (b < 0)) },
    { name: 'addNegNeg', share: 0.2, op: 'add', unknown: 'result', problems: () => all('add').filter(([a, b]) => a < 0 && b < 0) },
    { name: 'subNeg', share: 0.25, op: 'sub', unknown: 'result', problems: () => all('sub').filter(([, b]) => b < 0) },
    { name: 'subCross', share: 0.25, op: 'sub', unknown: 'result', problems: () => all('sub').filter(([, b]) => b > 0) },
  ];
}

/** The categories of each generated sector, in display order. */
function generatedSpec(sectorId: string): CategorySource[] | null {
  switch (sectorId) {
    // Three-digit numbers: `zero` has a zero digit (105, 340, 500: the zero is easy to drop or
    // misplace), `teen` ends in 11..19 (said in a different order than written), `plain` the rest.
    case 'type-3': {
      const n = range(100, 999);
      const zero = (x: number): boolean => String(x).includes('0');
      const teen = (x: number): boolean => x % 100 >= 11 && x % 100 <= 19;
      const typed = (keep: (x: number) => boolean) => (): Pair[] => n.filter(keep).map((x): Pair => [x, 0]);
      return [
        { name: 'zero', share: 0.4, op: 'type', unknown: 'result', problems: typed(zero) },
        { name: 'teen', share: 0.2, op: 'type', unknown: 'result', problems: typed((x) => !zero(x) && teen(x)) },
        { name: 'plain', share: 0.4, op: 'type', unknown: 'result', problems: typed((x) => !zero(x) && !teen(x)) },
      ];
    }
    case 'add-50': return additionCategories(6, 44, 3, 29, 16, 50);
    case 'add-100': return additionCategories(12, 88, 6, 59, 51, 100);
    case 'sub-50': return subtractionCategories(16, 50, 3, 29);
    case 'sub-100': return subtractionCategories(51, 100, 6, 59);
    case 'neg-10': return negativeCategories(10, 0);
    case 'neg-20': return negativeCategories(20, 10);
    // ? + b = c (`left`) and a + ? = c (`right`), a, b >= 1, sums up to 20.
    case 'miss-add': {
      const list = (): Pair[] => pairs(1, 19, 1, 19, (a, b) => a + b <= 20);
      return [
        { name: 'left', share: 0.5, op: 'add', unknown: 'a', problems: list },
        { name: 'right', share: 0.5, op: 'add', unknown: 'b', problems: list },
      ];
    }
    // ? − b = c (`left`) and a − ? = c (`right`), a up to 20, b >= 1, result >= 0.
    case 'miss-sub': {
      const list = (): Pair[] => pairs(2, 20, 1, 20, (a, b) => b <= a);
      return [
        { name: 'left', share: 0.5, op: 'sub', unknown: 'a', problems: list },
        { name: 'right', share: 0.5, op: 'sub', unknown: 'b', problems: list },
      ];
    }
    default:
      return null;
  }
}

const problemCache = new Map<string, Pair[]>();

function categoryProblems(sectorId: string, source: CategorySource): Pair[] {
  const key = `${sectorId}:${source.name}`;
  let list = problemCache.get(key);
  if (!list) {
    list = source.problems();
    problemCache.set(key, list);
  }
  return list;
}

// ---------------------------------------------------------------- public API

export type SectorKind = 'enumerated' | 'generated';

/** Number of possible problems of a sector's range (0 for the core and unknown ids). */
export function possibleProblems(sectorId: string): number {
  const gen = generatedSpec(sectorId);
  if (gen) return gen.reduce((n, c) => n + categoryProblems(sectorId, c).length, 0);
  return enumeratedRangeSize(sectorId);
}

/** 'enumerated' for at most ENUMERATION_LIMIT possible problems, else 'generated'; null for the
 *  core and unknown ids. */
export function sectorKind(sectorId: string): SectorKind | null {
  if (!kindCache.has(sectorId)) {
    const n = possibleProblems(sectorId);
    kindCache.set(sectorId, n === 0 ? null : n <= ENUMERATION_LIMIT ? 'enumerated' : 'generated');
  }
  return kindCache.get(sectorId) ?? null;
}

const kindCache = new Map<string, SectorKind | null>();

const poolCache = new Map<string, readonly Fact[]>();

/**
 * Full pool of an enumerated sector (Balance caps applied), in content order; [] for generated
 * sectors, the core and unknown ids. Returns a fresh array.
 */
export function sectorFacts(sectorId: string): Fact[] {
  if (sectorKind(sectorId) !== 'enumerated') return [];
  let pool = poolCache.get(sectorId);
  if (!pool) {
    pool = Object.freeze(enumeratedPool(sectorId) ?? []);
    poolCache.set(sectorId, pool);
  }
  return pool.slice();
}

/** Categories of a generated sector in display order, with their shares; [] otherwise. */
export function categoryDefs(sectorId: string): CategoryDef[] {
  if (sectorKind(sectorId) !== 'generated') return [];
  return (generatedSpec(sectorId) ?? []).map(({ name, share, min, max }) => ({ name, share, min, max }));
}

/** Category names of a generated sector ([] for enumerated sectors and unknown ids). */
export function sectorCategories(sectorId: string): string[] {
  return categoryDefs(sectorId).map((c) => c.name);
}

/** A random problem of one category of a generated sector, with `statId` `cat:<sectorId>:<category>`.
 *  Throws for an unknown sector or category. */
export function generateFact(sectorId: string, category: string, rng: Rng): Fact {
  const source = sectorKind(sectorId) === 'generated' ? generatedSpec(sectorId)?.find((c) => c.name === category) : undefined;
  if (!source) throw new Error(`no category ${category} in sector ${sectorId}`);
  const [a, b] = rng.pick(categoryProblems(sectorId, source));
  return makeFact(source.op, a, b, source.unknown, categoryStatId(sectorId, category));
}
