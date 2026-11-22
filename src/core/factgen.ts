import { createRng } from './rng';
import type { Rng } from './rng';
import type { Fact, Op } from './types';

/**
 * Fact generation per sector. Pure and deterministic. The facts built here carry the sector id
 * as `planetId`; `content.ts` cuts them into planets and sets the real planet id. Fact ids never
 * depend on the planet, so saved stats stay valid whatever the grouping.
 */

type Unknown = Fact['unknown'];

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

export function makeFact(planetId: string, op: Op, a: number, b: number, unknown: Unknown = 'result'): Fact {
  const result = compute(op, a, b);
  let id: string;
  if (op === 'type') {
    id = `type:${a}`;
  } else if (unknown === 'result') {
    id = `${op}:${a}${ID_OP[op]}${b}`;
  } else {
    const left = unknown === 'a' ? '?' : String(a);
    const right = unknown === 'b' ? '?' : String(b);
    id = `miss:${op}:${left}${ID_OP[op]}${right}=${result}`;
  }
  const answer = unknown === 'a' ? a : unknown === 'b' ? b : result;
  return Object.freeze({ id, planetId, op, a, b, result, unknown, answer });
}

/** Fixed sample: shuffle with the given seed, take the first n, then sort into content order. */
function sample(all: Fact[], n: number, seed: number): Fact[] {
  const picked = new Set(createRng(seed).shuffle(all).slice(0, n));
  return all.filter((f) => picked.has(f));
}

function pairs(
  aFrom: number, aTo: number, bFrom: number, bTo: number,
  keep: (a: number, b: number) => boolean,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let a = aFrom; a <= aTo; a++) {
    for (let b = bFrom; b <= bTo; b++) if (keep(a, b)) out.push([a, b]);
  }
  return out;
}

/** Units digits of a + b reach 10. */
const carries = (a: number, b: number): boolean => (a % 10) + (b % 10) >= 10;
/** a - b needs a borrow: the units digit of a is smaller than that of b. */
const borrows = (a: number, b: number): boolean => a % 10 < b % 10;

/**
 * Fixed sample of n facts with `hardCount` of them needing a carry / borrow: the first
 * `hardCount` of the seeded shuffle of the `hard` ones, the rest from the seeded shuffle of
 * everything left. Returned in content order (the sector shuffle mixes them later).
 */
function hardSample(all: Fact[], n: number, seed: number, hard: (f: Fact) => boolean, hardCount: number): Fact[] {
  const rng = createRng(seed);
  const picked = new Set(rng.shuffle(all.filter(hard)).slice(0, hardCount));
  for (const f of rng.shuffle(all.filter((x) => !picked.has(x))).slice(0, n - picked.size)) picked.add(f);
  return all.filter((f) => picked.has(f));
}

/** Trivial fact: a zero operand, or (subtraction) a zero result. */
export function isTrivial(f: Fact): boolean {
  return f.a === 0 || f.b === 0 || (f.op === 'sub' && f.result === 0);
}

/** Operand-1 fact: addition a or b = 1; subtraction b = 1 or result 1. */
export function isOperandOne(f: Fact): boolean {
  return f.op === 'sub' ? f.b === 1 || f.result === 1 : f.a === 1 || f.b === 1;
}

/** Share caps of the balance rule (ARCHITECTURE.md "Balance rule"). */
export const TRIVIAL_SHARE_SMALL = 0.2;   // add-5, sub-5
export const TRIVIAL_SHARE = 0.1;         // every other addition / subtraction sector
export const OPERAND_ONE_SHARE = 0.15;    // cap outside add-5 / sub-5
/** Share of operand-1 facts actually added outside the "to 5" sectors (below the cap). */
const OPERAND_ONE_TARGET = 0.1;

type Sides = [Fact[], Fact[]];

interface ArithmeticSpec {
  /** Facts inside the sector's ordinary ranges (no trivial facts; no operand-1 facts outside
   *  the "to 5" sectors). */
  normal: Fact[];
  /** Trivial candidates: left 0 + b (sub: a − 0), right a + 0 (sub: a − a). */
  trivial: Sides;
  /** Operand-1 candidates: left 1 + b (sub: a − 1), right a + 1 (sub: a − (a − 1)). */
  one: Sides;
  small: boolean;                          // add-5 / sub-5
  sample?: { size: number; seed: number; hard: (f: Fact) => boolean };
}

/** n facts taken alternately left / right from the seeded shuffles of both sides. */
function balancedPick(rng: Rng, [left, right]: Sides, n: number): Fact[] {
  const l = rng.shuffle(left);
  const r = rng.shuffle(right);
  const out: Fact[] = [];
  while (out.length < n && (l.length > 0 || r.length > 0)) {
    const fromLeft = out.length % 2 === 0 ? l.length > 0 : r.length === 0;
    out.push((fromLeft ? l : r).shift() as Fact);
  }
  return out;
}

/**
 * One addition / subtraction sector under the balance rule, already in planet order: the
 * facts are shuffled with the sector seed and the trivial ones are spread so that no planet
 * (a chunkSizes() cut) holds more than one.
 */
function balanced(spec: ArithmeticSpec, seed: number): Fact[] {
  const rng = createRng(seed);
  const share = spec.small ? TRIVIAL_SHARE_SMALL : TRIVIAL_SHARE;
  const minTrivial = spec.trivial[0].length + spec.trivial[1].length > 0 ? 1 : 0;
  const counts = (total: number): [number, number] =>
    [Math.max(minTrivial, Math.floor(share * total)), spec.small ? 0 : Math.floor(OPERAND_ONE_TARGET * total)];
  let trivialN: number;
  let oneN: number;
  let normal: Fact[];
  if (spec.sample) {
    const { size, seed: sampleSeed, hard } = spec.sample;
    [trivialN, oneN] = counts(size);
    normal = hardSample(spec.normal, size - trivialN - oneN, sampleSeed, hard, Math.ceil(size / 2));
  } else {
    // The easy facts are added on top: grow until the counts agree with the final size.
    trivialN = 0;
    oneN = 0;
    for (let guard = 0; guard < 20; guard++) {
      const [t, o] = counts(spec.normal.length + trivialN + oneN);
      if (t === trivialN && o === oneN) break;
      [trivialN, oneN] = [t, o];
    }
    normal = spec.normal;
  }
  trivialN = Math.min(trivialN, chunkSizes(normal.length + trivialN + oneN).length);
  const trivial = balancedPick(rng, spec.trivial, trivialN);
  const rest = rng.shuffle([...normal, ...balancedPick(rng, spec.one, oneN)]);
  const sizes = chunkSizes(rest.length + trivial.length);
  const planetOf = new Map(trivial.map((f, i) => [Math.floor((i * sizes.length) / trivial.length), f]));
  const out: Fact[] = [];
  let at = 0;
  sizes.forEach((size, planet) => {
    const t = planetOf.get(planet);
    const chunk = rest.slice(at, at + size - (t ? 1 : 0));
    at += chunk.length;
    if (t) chunk.splice(rng.int(0, chunk.length), 0, t);
    out.push(...chunk);
  });
  return out;
}

/** Seeds of the within-sector shuffle of the addition and subtraction sectors. */
const SHUFFLE_SEEDS: Readonly<Record<string, number>> = {
  'add-5': 101, 'add-10': 102, 'add-15': 103, 'add-50': 104, 'add-100': 105,
  'sub-5': 111, 'sub-10': 112, 'sub-15': 113, 'sub-50': 114, 'sub-100': 115,
};

const range = (from: number, to: number): number[] =>
  from > to ? [] : Array.from({ length: to - from + 1 }, (_, i) => from + i);

/**
 * Addition and subtraction sectors (ARCHITECTURE.md, revised after play-testing, with the
 * balance rule). Sums and minuends keep the sector ranges and upper bounds; only the operand
 * lower bounds are relaxed for the few easy facts. 0 + 0 and 0 − 0 never appear.
 */
function arithmeticSpec(id: string): ArithmeticSpec | null {
  const A = (a: number, b: number): Fact => makeFact(id, 'add', a, b);
  const S = (a: number, b: number): Fact => makeFact(id, 'sub', a, b);
  const add = (list: Array<[number, number]>): Fact[] => list.map(([a, b]) => A(a, b));
  const sub = (list: Array<[number, number]>): Fact[] => list.map(([a, b]) => S(a, b));
  const carry = (f: Fact): boolean => carries(f.a, f.b);
  const borrow = (f: Fact): boolean => borrows(f.a, f.b);
  /** 0 + b / a + 0 and 1 + b / a + 1 with the sum in [lo, hi], a <= aTo, b <= bTo. */
  const addEasy = (lo: number, hi: number, aTo: number, bTo: number): { trivial: Sides; one: Sides } => ({
    trivial: [range(lo, Math.min(hi, bTo)).map((b) => A(0, b)), range(lo, Math.min(hi, aTo)).map((a) => A(a, 0))],
    one: [range(lo - 1, Math.min(hi - 1, bTo)).map((b) => A(1, b)), range(lo - 1, Math.min(hi - 1, aTo)).map((a) => A(a, 1))],
  });
  /** a − 0 / a − a and a − 1 / a − (a − 1) for a in [aFrom, aTo], b <= bTo. */
  const subEasy = (aFrom: number, aTo: number, bTo: number): { trivial: Sides; one: Sides } => ({
    trivial: [range(aFrom, aTo).map((a) => S(a, 0)), range(aFrom, Math.min(aTo, bTo)).map((a) => S(a, a))],
    one: [range(aFrom, aTo).map((a) => S(a, 1)), range(aFrom, Math.min(aTo, bTo + 1)).map((a) => S(a, a - 1))],
  });
  const none: Sides = [[], []];
  switch (id) {
    case 'add-5':
      return { normal: add(pairs(1, 4, 1, 4, (a, b) => a + b >= 2 && a + b <= 5)), ...addEasy(1, 5, 5, 5), one: none, small: true };
    case 'add-10':
      return { normal: add(pairs(2, 8, 2, 8, (a, b) => a + b >= 6 && a + b <= 10)), ...addEasy(6, 10, 10, 10), small: false };
    case 'add-15':
      return { normal: add(pairs(2, 13, 2, 13, (a, b) => a + b >= 11 && a + b <= 15)), ...addEasy(11, 15, 13, 13), small: false };
    case 'add-50':
      return { normal: add(pairs(6, 44, 3, 29, (a, b) => a + b >= 16 && a + b <= 50)), ...addEasy(16, 50, 44, 29),
        small: false, sample: { size: 42, seed: 11, hard: carry } };
    case 'add-100':
      return { normal: add(pairs(12, 88, 6, 59, (a, b) => a + b >= 51 && a + b <= 100)), ...addEasy(51, 100, 88, 59),
        small: false, sample: { size: 42, seed: 12, hard: carry } };
    case 'sub-5':
      return { normal: sub(pairs(2, 5, 1, 4, (a, b) => b < a)), ...subEasy(2, 5, 5), one: none, small: true };
    case 'sub-10':
      return { normal: sub(pairs(6, 10, 2, 8, (a, b) => b <= a - 2)), ...subEasy(6, 10, 10), small: false };
    case 'sub-15':
      return { normal: sub(pairs(11, 15, 2, 13, (a, b) => b <= a - 2)), ...subEasy(11, 15, 13), small: false };
    case 'sub-50':
      return { normal: sub(pairs(16, 50, 3, 29, (a, b) => b <= a - 3)), ...subEasy(16, 50, 29),
        small: false, sample: { size: 42, seed: 13, hard: borrow } };
    // b <= a - 3 as in sub-50 (the spec's ranges alone would allow 51 - 59 < 0).
    case 'sub-100':
      return { normal: sub(pairs(51, 100, 6, 59, (a, b) => b <= a - 3)), ...subEasy(51, 100, 59),
        small: false, sample: { size: 42, seed: 14, hard: borrow } };
    default:
      return null;
  }
}

function negatives(id: string, lim: number, inner: number, seed: number): Fact[] {
  const all: Fact[] = [];
  for (const op of ['add', 'sub'] as const) {
    for (const [a, b] of pairs(-lim, lim, -lim, lim, () => true)) {
      const r = compute(op, a, b);
      const anyNegative = a < 0 || b < 0 || r < 0;
      // Results stay inside the range; the larger sector only holds facts that use at least one
      // operand outside the smaller sector's range, so ids never collide.
      const outsideInner = Math.abs(a) > inner || Math.abs(b) > inner;
      if (anyNegative && Math.abs(r) <= lim && outsideInner) all.push(makeFact(id, op, a, b));
    }
  }
  return sample(all, 40, seed);
}

/** Times tables of a multiplication / division sector, in system order. */
export const TABLES: Readonly<Record<string, readonly number[]>> = {
  'mul-a': [2, 5, 10], 'mul-b': [3, 4], 'mul-c': [6, 7], 'mul-d': [8, 9],
  'div-a': [2, 5, 10], 'div-b': [3, 4], 'div-c': [6, 7], 'div-d': [8, 9],
};

/** Facts of one times table: n x 1..10 or (n*k) / n for k in 1..10. */
export function tableFacts(id: string, op: 'mul' | 'div', n: number): Fact[] {
  return Array.from({ length: 10 }, (_, i) =>
    op === 'mul' ? makeFact(id, 'mul', n, i + 1) : makeFact(id, 'div', n * (i + 1), n));
}

/**
 * Every fact of a sector in its fixed planet order (an unknown sector or `core` -> []).
 * Ranges and samples follow ARCHITECTURE.md "Galaxy map v3". Addition and subtraction sectors
 * are shuffled with a fixed seed so each planet mixes easier and harder facts; the other
 * samples use the same seeds as before, so their fact ids are unchanged.
 */
export function sectorFacts(sectorId: string): Fact[] {
  const of = (op: Op, list: Array<[number, number]>, unknown: Unknown = 'result'): Fact[] =>
    list.map(([a, b]) => makeFact(sectorId, op, a, b, unknown));
  const spec = arithmeticSpec(sectorId);
  if (spec) return balanced(spec, SHUFFLE_SEEDS[sectorId]);
  const tables = TABLES[sectorId];
  if (tables) {
    const op = sectorId.startsWith('mul') ? 'mul' : 'div';
    return tables.flatMap((n) => tableFacts(sectorId, op, n));
  }
  switch (sectorId) {
    case 'type-1':
      return Array.from({ length: 10 }, (_, i) => makeFact(sectorId, 'type', i, 0));
    case 'type-2':
      return sample(Array.from({ length: 90 }, (_, i) => makeFact(sectorId, 'type', 10 + i, 0)), 30, 1);
    case 'type-3':
      return sample(Array.from({ length: 900 }, (_, i) => makeFact(sectorId, 'type', 100 + i, 0)), 30, 2);
    case 'neg-10':
      return negatives(sectorId, 10, -1, 5);
    case 'neg-20':
      return negatives(sectorId, 20, 10, 6);
    case 'miss-add': {
      const list = pairs(1, 19, 1, 19, (a, b) => a + b <= 20);
      return sample([...of('add', list, 'a'), ...of('add', list, 'b')], 40, 7);
    }
    case 'miss-sub':
      return sample(of('sub', pairs(2, 20, 1, 20, (a, b) => b <= a), 'b'), 40, 8);
    case 'miss-mul':
      return sample(of('mul', pairs(2, 10, 1, 10, () => true), 'b'), 40, 9);
    case 'miss-div': {
      // c / ? = a: dividend c = n*k, unknown divisor n (2..10), quotient k (1..10).
      const list = pairs(2, 10, 1, 10, () => true).map(([n, k]): [number, number] => [n * k, n]);
      return sample(of('div', list, 'b'), 40, 10);
    }
    default:
      return [];
  }
}

/** Planet sizes for n facts: about n / 6 planets, sizes as even as possible, larger chunks
 *  first. Every chunk has 5..8 facts whenever that is possible (n = 5..8 or n >= 10). */
export function chunkSizes(n: number): number[] {
  if (n <= 0) return [];
  const fewest = Math.ceil(n / 8);
  const most = Math.max(fewest, Math.floor(n / 5));
  const k = Math.min(most, Math.max(fewest, Math.round(n / 6)));
  const base = Math.floor(n / k);
  const extra = n % k;
  return Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0));
}

/** Systems for p planets: about 4 planets each, 3..5 per system (fewer only when p < 3),
 *  sizes as even as possible, larger first. */
export function groupSizes(p: number): number[] {
  if (p <= 0) return [];
  const k = Math.max(1, Math.ceil(p / 5), Math.min(Math.round(p / 4), Math.floor(p / 3)));
  const base = Math.floor(p / k);
  const extra = p % k;
  return Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0));
}
