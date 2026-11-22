import { describe, expect, it } from 'vitest';
import { SECTORS } from '../src/core/content';
import {
  ENUMERATION_LIMIT, OPERAND_ONE_SHARE, TRIVIAL_SHARE, TRIVIAL_SHARE_SMALL, isOperandOne, isTrivial, possibleProblems,
} from '../src/core/factgen';
import {
  allFacts, categoryStatId, factById, formatProblem, formatSolved, generateFact, parseCategoryStatId, sectorCategories,
  sectorFacts, sectorKind, sectorOfStat, sectorStatIds,
} from '../src/core/facts';
import { createRng } from '../src/core/rng';
import type { Fact } from '../src/core/types';
import { fact as find } from './helpers';

const compute = (f: Fact): number => {
  switch (f.op) {
    case 'type': return f.a;
    case 'add': return f.a + f.b;
    case 'sub': return f.a - f.b;
    case 'mul': return f.a * f.b;
    case 'div': return f.a / f.b;
  }
};

const ENUMERATED = [
  'type-1', 'type-2', 'add-5', 'add-10', 'add-15', 'sub-5', 'sub-10', 'sub-15',
  'mul-a', 'mul-b', 'mul-c', 'mul-d', 'div-a', 'div-b', 'div-c', 'div-d', 'miss-mul', 'miss-div',
];
const GENERATED = ['type-3', 'add-50', 'add-100', 'sub-50', 'sub-100', 'neg-10', 'neg-20', 'miss-add', 'miss-sub'];

/** A fact is consistent: result, answer and integers. */
function consistent(f: Fact): void {
  expect(compute(f), f.id).toBe(f.result);
  expect(f.answer, f.id).toBe(f.unknown === 'a' ? f.a : f.unknown === 'b' ? f.b : f.result);
  expect(Number.isInteger(f.answer) && Number.isInteger(f.result), f.id).toBe(true);
  if (f.op === 'type') expect([f.b, f.unknown]).toEqual([0, 'result']);
}

/** The id describes the actual numbers in the documented formats. */
function idOf(f: Fact): string {
  const sym = { type: '', add: '+', sub: '-', mul: 'x', div: '/' }[f.op];
  if (f.op === 'type') return `type:${f.a}`;
  if (f.unknown === 'result') return `${f.op}:${f.a}${sym}${f.b}`;
  return `miss:${f.op}:${f.unknown === 'a' ? '?' : f.a}${sym}${f.unknown === 'b' ? '?' : f.b}=${f.result}`;
}

describe('sector kinds', () => {
  it('a sector is enumerated up to 120 possible problems, else generated', () => {
    expect(ENUMERATION_LIMIT).toBe(120);
    for (const id of ENUMERATED) {
      expect(sectorKind(id), id).toBe('enumerated');
      expect(possibleProblems(id), id).toBeLessThanOrEqual(120);
      expect(sectorCategories(id)).toEqual([]);
    }
    for (const id of GENERATED) {
      expect(sectorKind(id), id).toBe('generated');
      expect(possibleProblems(id), id).toBeGreaterThan(120);
      expect(sectorFacts(id)).toEqual([]);
      expect(sectorCategories(id).length, id).toBeGreaterThanOrEqual(2);
      expect(sectorCategories(id).length, id).toBeLessThanOrEqual(4);
    }
    expect([...ENUMERATED, ...GENERATED, 'core'].sort()).toEqual(SECTORS.map((s) => s.id).sort());
    expect(sectorKind('core')).toBeNull();
    expect(sectorKind('nope')).toBeNull();
    expect(sectorFacts('core')).toEqual([]);
    expect(sectorFacts('add-20')).toEqual([]);
  });

  it('categories of the generated sectors', () => {
    expect(Object.fromEntries(GENERATED.map((id) => [id, sectorCategories(id)]))).toEqual({
      'type-3': ['zero', 'teen', 'plain'],
      'add-50': ['carry', 'nocarry', 'easy'],
      'add-100': ['carry', 'nocarry', 'easy'],
      'sub-50': ['borrow', 'noborrow', 'easy'],
      'sub-100': ['borrow', 'noborrow', 'easy'],
      'neg-10': ['addMixed', 'addNegNeg', 'subNeg', 'subCross'],
      'neg-20': ['addMixed', 'addNegNeg', 'subNeg', 'subCross'],
      'miss-add': ['left', 'right'],
      'miss-sub': ['left', 'right'],
    });
  });
});

describe('enumerated sectors', () => {
  it('pool sizes: the full enumeration of each range (Balance caps on easy facts)', () => {
    const sizes = Object.fromEntries(ENUMERATED.map((id) => [id, sectorFacts(id).length]));
    expect(sizes).toEqual({
      'type-1': 10, 'type-2': 90, 'add-5': 12, 'add-10': 29, 'add-15': 62, 'sub-5': 12, 'sub-10': 29, 'sub-15': 62,
      'mul-a': 30, 'mul-b': 20, 'mul-c': 20, 'mul-d': 20, 'div-a': 30, 'div-b': 20, 'div-c': 20, 'div-d': 20,
      'miss-mul': 90, 'miss-div': 90,
    });
    expect(allFacts()).toHaveLength(666);
  });

  it('holds every problem of the ordinary range, not a sample', () => {
    const ids = (id: string) => new Set(sectorFacts(id).map((f) => f.id));
    const each = (a0: number, a1: number, b0: number, b1: number, keep: (a: number, b: number) => boolean,
      id: (a: number, b: number) => string): string[] => {
      const out: string[] = [];
      for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) if (keep(a, b)) out.push(id(a, b));
      return out;
    };
    const expectAll = (sectorId: string, list: string[]) => {
      const have = ids(sectorId);
      for (const x of list) expect(have.has(x), `${sectorId} ${x}`).toBe(true);
    };
    const add = (a: number, b: number) => `add:${a}+${b}`;
    const sub = (a: number, b: number) => `sub:${a}-${b}`;
    expect([...ids('type-1')].sort()).toEqual(each(0, 9, 0, 0, () => true, (a) => `type:${a}`).sort());
    expect([...ids('type-2')].sort()).toEqual(each(10, 99, 0, 0, () => true, (a) => `type:${a}`).sort());
    expectAll('add-5', each(1, 4, 1, 4, (a, b) => a + b >= 2 && a + b <= 5, add));
    expectAll('add-10', each(2, 8, 2, 8, (a, b) => a + b >= 6 && a + b <= 10, add));
    expectAll('add-15', each(2, 13, 2, 13, (a, b) => a + b >= 11 && a + b <= 15, add));
    expectAll('sub-5', each(2, 5, 1, 4, (a, b) => b < a, sub));
    expectAll('sub-10', each(6, 10, 2, 8, (a, b) => b <= a - 2, sub));
    expectAll('sub-15', each(11, 15, 2, 13, (a, b) => b <= a - 2, sub));
    expect([...ids('miss-mul')].sort()).toEqual(each(2, 10, 1, 10, () => true, (a, b) => `miss:mul:${a}x?=${a * b}`).sort());
    expect([...ids('miss-div')].sort()).toEqual(each(2, 10, 1, 10, () => true, (n, k) => `miss:div:${n * k}/?=${k}`).sort());
    const mul = ['mul-a', 'mul-b', 'mul-c', 'mul-d'].flatMap(sectorFacts);
    const div = ['div-a', 'div-b', 'div-c', 'div-d'].flatMap(sectorFacts);
    for (let n = 2; n <= 10; n++) {
      expect(mul.filter((f) => f.a === n).map((f) => [f.a, f.b])).toEqual(Array.from({ length: 10 }, (_, k) => [n, k + 1]));
      expect(div.filter((f) => f.b === n).map((f) => [f.a, f.b, f.result])).toEqual(
        Array.from({ length: 10 }, (_, k) => [n * (k + 1), n, k + 1]));
    }
  });

  it('balance rule: caps on trivial and operand-1 facts, left/right balance, ranges kept, no 0 + 0', () => {
    const minuendOrSum: Record<string, [number, number]> = {
      'add-5': [1, 5], 'add-10': [6, 10], 'add-15': [11, 15], 'sub-5': [2, 5], 'sub-10': [6, 10], 'sub-15': [11, 15],
    };
    for (const [id, [lo, hi]] of Object.entries(minuendOrSum)) {
      const facts = sectorFacts(id);
      const small = id.endsWith('-5');
      const trivial = facts.filter(isTrivial);
      expect(trivial.length, id).toBeGreaterThanOrEqual(1);
      expect(trivial.length / facts.length, id).toBeLessThanOrEqual(small ? TRIVIAL_SHARE_SMALL : TRIVIAL_SHARE);
      if (!small) {
        const ones = facts.filter(isOperandOne);
        expect(ones.length, id).toBeGreaterThanOrEqual(1);
        expect(ones.length / facts.length, id).toBeLessThanOrEqual(OPERAND_ONE_SHARE);
      }
      const left = trivial.filter((f) => (f.op === 'add' ? f.a === 0 : f.b === 0)).length;
      expect(Math.abs(left - (trivial.length - left)), id).toBeLessThanOrEqual(1);
      for (const f of facts) {
        const v = f.op === 'add' ? f.result : f.a;
        expect(v >= lo && v <= hi, f.id).toBe(true);
        expect(f.a >= 0 && f.b >= 0 && f.result >= 0, f.id).toBe(true);
        expect(f.a === 0 && f.b === 0, f.id).toBe(false);
      }
    }
    expect(factById('add:0+0')).toBeUndefined();
    expect(factById('sub:0-0')).toBeUndefined();
  });

  it('every fact is consistent, uses its id as statId and the documented id format', () => {
    const ids = allFacts().map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of allFacts()) {
      consistent(f);
      expect(f.statId).toBe(f.id);
      expect(f.id).toBe(idOf(f));
      expect(Object.isFrozen(f)).toBe(true);
    }
  });

  it('pins ids that saved stats are keyed by', () => {
    const pinned: Array<[string, number]> = [
      ['type:7', 7], ['type:0', 0], ['type:42', 42],
      ['add:1+1', 2], ['add:2+3', 5], ['add:6+3', 9], ['add:6+7', 13],
      ['sub:5-4', 1], ['sub:9-4', 5], ['sub:15-8', 7],
      ['mul:7x8', 56], ['mul:2x1', 2], ['mul:10x10', 100],
      ['div:56/7', 8], ['div:100/10', 10], ['div:18/9', 2],
      ['miss:mul:3x?=12', 4], ['miss:div:18/?=6', 3],
    ];
    for (const [id, answer] of pinned) expect(factById(id)?.answer, id).toBe(answer);
  });

  it('returns fresh arrays (callers cannot corrupt the cache)', () => {
    const a = sectorFacts('mul-b');
    a.pop();
    expect(sectorFacts('mul-b')).toHaveLength(20);
    const all = allFacts();
    all.pop();
    expect(allFacts()).toHaveLength(all.length + 1);
  });
});

/** Independent definition of each generated sector's range and categories. */
const CHECK: Record<string, (f: Fact, category: string) => boolean> = {
  'type-3': (f, c) => {
    const zero = String(f.a).includes('0');
    const teen = f.a % 100 >= 11 && f.a % 100 <= 19;
    const inRange = f.op === 'type' && f.a >= 100 && f.a <= 999;
    return inRange && (c === 'zero' ? zero : c === 'teen' ? !zero && teen : !zero && !teen);
  },
  'add-50': (f, c) => addCheck(f, c, 6, 44, 3, 29, 16, 50),
  'add-100': (f, c) => addCheck(f, c, 12, 88, 6, 59, 51, 100),
  'sub-50': (f, c) => subCheck(f, c, 16, 50, 3, 29),
  'sub-100': (f, c) => subCheck(f, c, 51, 100, 6, 59),
  'neg-10': (f, c) => negCheck(f, c, 10, 0),
  'neg-20': (f, c) => negCheck(f, c, 20, 10),
  'miss-add': (f, c) => f.op === 'add' && f.a >= 1 && f.b >= 1 && f.result <= 20 && f.unknown === (c === 'left' ? 'a' : 'b'),
  'miss-sub': (f, c) => f.op === 'sub' && f.a <= 20 && f.b >= 1 && f.result >= 0 && f.unknown === (c === 'left' ? 'a' : 'b'),
};

function addCheck(f: Fact, c: string, a0: number, a1: number, b0: number, b1: number, lo: number, hi: number): boolean {
  if (f.op !== 'add' || f.unknown !== 'result' || f.result < lo || f.result > hi || f.a > a1 || f.b > b1) return false;
  const carry = (f.a % 10) + (f.b % 10) >= 10;
  if (c === 'easy') return f.a <= 1 || f.b <= 1;
  return f.a >= a0 && f.b >= b0 && (c === 'carry' ? carry : !carry);
}

function subCheck(f: Fact, c: string, a0: number, a1: number, b0: number, b1: number): boolean {
  if (f.op !== 'sub' || f.unknown !== 'result' || f.a < a0 || f.a > a1 || f.b > b1 || f.result < 0) return false;
  const borrow = f.a % 10 < f.b % 10;
  if (c === 'easy') return f.b === 0 || f.b === 1 || f.result === 0 || f.result === 1;
  return f.b >= b0 && f.b <= f.a - 3 && (c === 'borrow' ? borrow : !borrow);
}

function negCheck(f: Fact, c: string, lim: number, inner: number): boolean {
  const { a, b, result: r } = f;
  const ok = f.unknown === 'result' && a !== 0 && b !== 0 && [a, b, r].every((x) => Math.abs(x) <= lim)
    && (a < 0 || b < 0 || r < 0) && (Math.abs(a) > inner || Math.abs(b) > inner);
  if (!ok) return false;
  switch (c) {
    case 'addMixed': return f.op === 'add' && (a < 0) !== (b < 0);
    case 'addNegNeg': return f.op === 'add' && a < 0 && b < 0;
    case 'subNeg': return f.op === 'sub' && b < 0;
    case 'subCross': return f.op === 'sub' && b > 0 && r < 0;
    default: return false;
  }
}

describe('generated sectors', () => {
  it('every draw lies inside the sector range and its category (many seeded draws)', () => {
    for (const sectorId of GENERATED) {
      for (const category of sectorCategories(sectorId)) {
        const rng = createRng(1000 + category.length);
        const seen = new Set<string>();
        for (let i = 0; i < 400; i++) {
          const f = generateFact(sectorId, category, rng);
          expect(CHECK[sectorId](f, category), `${sectorId}/${category}: ${f.id}`).toBe(true);
          consistent(f);
          expect(f.id).toBe(idOf(f));
          expect(f.statId).toBe(`cat:${sectorId}:${category}`);
          seen.add(f.id);
        }
        expect(seen.size, `${sectorId}/${category}`).toBeGreaterThan(20);   // real variety
      }
    }
  });

  it('is deterministic for a seed and differs between seeds', () => {
    const draw = (seed: number) => {
      const rng = createRng(seed);
      return Array.from({ length: 20 }, () => generateFact('add-100', 'carry', rng).id);
    };
    expect(draw(7)).toEqual(draw(7));
    expect(draw(7)).not.toEqual(draw(8));
  });

  it('rejects unknown sectors and categories', () => {
    const rng = createRng(1);
    expect(() => generateFact('add-100', 'borrow', rng)).toThrow();
    expect(() => generateFact('add-10', 'carry', rng)).toThrow();
    expect(() => generateFact('nope', 'x', rng)).toThrow();
  });

  it('category stat ids round-trip and map to their sector', () => {
    expect(categoryStatId('add-100', 'carry')).toBe('cat:add-100:carry');
    expect(parseCategoryStatId('cat:add-100:carry')).toEqual({ sectorId: 'add-100', category: 'carry' });
    expect(parseCategoryStatId('add:6+7')).toBeNull();
    expect(sectorStatIds('sub-50')).toEqual(['cat:sub-50:borrow', 'cat:sub-50:noborrow', 'cat:sub-50:easy']);
    expect(sectorStatIds('mul-b')).toEqual(sectorFacts('mul-b').map((f) => f.id));
    expect(sectorStatIds('core')).toEqual([]);
    expect(sectorOfStat('cat:sub-50:borrow')).toBe('sub-50');
    expect(sectorOfStat('cat:sub-50:carry')).toBeUndefined();
    expect(sectorOfStat('mul:7x8')).toBe('mul-c');
    expect(sectorOfStat('type:42')).toBe('type-2');
    expect(sectorOfStat('add:86+3')).toBeUndefined();
    expect(sectorOfStat('miss:add:?+7=13')).toBeUndefined();   // an old sample id: miss-add is generated now
  });
});

describe('formatProblem', () => {
  const fact = (p: Partial<Fact>): Fact => ({
    id: 'x', statId: 'x', op: 'add', a: 0, b: 0, result: 0, unknown: 'result', answer: 0, ...p,
  });

  it('formats multiplication and division per locale', () => {
    const mul = find('mul:7x8');
    expect(formatProblem(mul, 'hr')).toBe('7 · 8');
    expect(formatProblem(mul, 'en')).toBe('7 × 8');
    const div = find('div:56/7');
    expect(formatProblem(div, 'hr')).toBe('56 : 7');
    expect(formatProblem(div, 'en')).toBe('56 ÷ 7');
  });

  it('formats addition, subtraction and typing', () => {
    expect(formatProblem(find('add:6+7'), 'hr')).toBe('6 + 7');
    expect(formatProblem(find('sub:9-4'), 'en')).toBe('9 − 4');
    expect(formatProblem(find('type:7'), 'hr')).toBe('7');
  });

  it('formats missing-number forms with ? and the result', () => {
    const missMul = fact({ op: 'mul', a: 7, b: 8, result: 56, unknown: 'b', answer: 8 });
    expect(formatProblem(missMul, 'hr')).toBe('7 · ? = 56');
    expect(formatProblem(missMul, 'en')).toBe('7 × ? = 56');
    const missAdd = fact({ op: 'add', a: 6, b: 7, result: 13, unknown: 'a', answer: 6 });
    expect(formatProblem(missAdd, 'hr')).toBe('? + 7 = 13');
    const missDiv = fact({ op: 'div', a: 56, b: 7, result: 8, unknown: 'b', answer: 7 });
    expect(formatProblem(missDiv, 'hr')).toBe('56 : ? = 8');
    expect(formatProblem(missDiv, 'en')).toBe('56 ÷ ? = 8');
    const rng = createRng(4);
    for (let i = 0; i < 50; i++) {
      const right = generateFact('miss-sub', 'right', rng);
      expect(formatProblem(right, 'en')).toBe(`${right.a} − ? = ${right.result}`);
      const left = generateFact('miss-sub', 'left', rng);
      expect(formatProblem(left, 'en')).toBe(`? − ${left.b} = ${left.result}`);
    }
  });

  it('formats negatives with the real minus and brackets on the right operand', () => {
    expect(formatProblem(fact({ op: 'sub', a: 5, b: -3, result: 8, answer: 8 }), 'hr')).toBe('5 − (−3)');
    expect(formatProblem(fact({ op: 'add', a: -4, b: 6, result: 2, answer: 2 }), 'en')).toBe('−4 + 6');
    expect(formatProblem(fact({ op: 'add', a: -4, b: -6, result: -10, answer: -10 }), 'en')).toBe('−4 + (−6)');
    const rng = createRng(5);
    for (let i = 0; i < 200; i++) {
      const f = generateFact('neg-20', rng.pick(sectorCategories('neg-20')), rng);
      const s = formatProblem(f, 'hr');
      expect(s).not.toContain('-');
      if (f.b < 0) expect(s).toContain('(−');
    }
  });

  it('formatSolved shows the complete fact', () => {
    expect(formatSolved(fact({ op: 'mul', a: 7, b: 8, result: 56, unknown: 'b', answer: 8 }), 'hr')).toBe('7 · 8 = 56');
    expect(formatSolved(fact({ op: 'sub', a: 5, b: -3, result: 8, answer: 8 }), 'en')).toBe('5 − (−3) = 8');
  });
});
