import { describe, expect, it } from 'vitest';
import { PLANETS, planetsOfSector, sectorOfPlanet } from '../src/core/content';
import { allFacts, factById, factsForPlanet, formatProblem, formatSolved } from '../src/core/facts';
import type { Fact } from '../src/core/types';

const compute = (f: Fact): number => {
  switch (f.op) {
    case 'type': return f.a;
    case 'add': return f.a + f.b;
    case 'sub': return f.a - f.b;
    case 'mul': return f.a * f.b;
    case 'div': return f.a / f.b;
  }
};

const find = (id: string): Fact => {
  const f = factById(id);
  if (!f) throw new Error(`missing ${id}`);
  return f;
};
/** Every fact of a sector, in planet order. */
const sector = (sectorId: string): Fact[] => planetsOfSector(sectorId).flatMap((p) => factsForPlanet(p.id));

describe('facts', () => {
  it('fact ids are unique across the whole game', () => {
    const ids = allFacts().map((f) => f.id);
    expect(ids.length).toBeGreaterThan(500);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('factsForPlanet is deterministic', () => {
    for (const p of PLANETS) {
      expect(JSON.stringify(factsForPlanet(p.id))).toBe(JSON.stringify(factsForPlanet(p.id)));
    }
  });

  it('every fact is consistent: result, answer, integers, planetId', () => {
    for (const p of PLANETS) {
      for (const f of factsForPlanet(p.id)) {
        expect(f.planetId).toBe(p.id);
        expect(compute(f)).toBe(f.result);
        const expected = f.unknown === 'a' ? f.a : f.unknown === 'b' ? f.b : f.result;
        expect(f.answer).toBe(expected);
        expect(Number.isInteger(f.answer)).toBe(true);
        expect(Number.isInteger(f.result)).toBe(true);
        if (f.op === 'type') {
          expect(f.b).toBe(0);
          expect(f.unknown).toBe('result');
        }
      }
    }
  });

  it('sector sizes and ranges follow the spec', () => {
    expect(sector('type-1').map((f) => f.a)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const t2 = sector('type-2');
    expect(t2).toHaveLength(30);
    expect(t2.every((f) => f.a >= 10 && f.a <= 99)).toBe(true);
    const t3 = sector('type-3');
    expect(t3).toHaveLength(30);
    expect(t3.every((f) => f.a >= 100 && f.a <= 999)).toBe(true);

    for (const id of ['add-5', 'add-10', 'add-15', 'add-50', 'add-100']) {
      expect(sector(id).every((f) => f.op === 'add' && f.a >= 0 && f.b >= 0 && f.result === f.a + f.b && f.result > 0), id).toBe(true);
    }
    expect(factById('add:0+0')).toBeUndefined();
    for (const id of ['sub-5', 'sub-10', 'sub-15', 'sub-50', 'sub-100']) {
      expect(sector(id).every((f) => f.op === 'sub' && f.b >= 0 && f.result >= 0 && f.a > 0), id).toBe(true);
    }
    expect(sector('add-20')).toEqual([]);
    expect(sector('sub-20')).toEqual([]);

    const mul = ['mul-a', 'mul-b', 'mul-c', 'mul-d'].flatMap(sector);
    const div = ['div-a', 'div-b', 'div-c', 'div-d'].flatMap(sector);
    for (let n = 2; n <= 10; n++) {
      expect(mul.filter((f) => f.a === n).map((f) => [f.a, f.b])).toEqual(Array.from({ length: 10 }, (_, k) => [n, k + 1]));
      expect(div.filter((f) => f.b === n).map((f) => [f.a, f.b, f.result])).toEqual(
        Array.from({ length: 10 }, (_, k) => [n * (k + 1), n, k + 1]));
    }
    expect(mul).toHaveLength(90);
    expect(div).toHaveLength(90);
    expect(factById('mul:7x8')?.answer).toBe(56);
    expect(factById('div:56/7')?.answer).toBe(8);

    for (const [id, lim] of [['neg-10', 10], ['neg-20', 20]] as const) {
      const neg = sector(id);
      expect(neg).toHaveLength(40);
      for (const f of neg) {
        expect(['add', 'sub']).toContain(f.op);
        expect(f.a < 0 || f.b < 0 || f.result < 0).toBe(true);
        expect(Math.abs(f.a)).toBeLessThanOrEqual(lim);
        expect(Math.abs(f.b)).toBeLessThanOrEqual(lim);
        expect(Math.abs(f.result)).toBeLessThanOrEqual(lim);
      }
    }

    for (const id of ['miss-add', 'miss-sub', 'miss-mul', 'miss-div']) {
      const list = sector(id);
      expect(list).toHaveLength(40);
      expect(list.every((f) => f.unknown !== 'result' && f.id.startsWith('miss:'))).toBe(true);
    }
    expect(sector('miss-add').every((f) => f.op === 'add' && f.result <= 20)).toBe(true);
    expect(sector('miss-add').some((f) => f.unknown === 'a')).toBe(true);
    expect(sector('miss-add').some((f) => f.unknown === 'b')).toBe(true);
    expect(sector('miss-sub').every((f) => f.op === 'sub' && f.unknown === 'b' && f.a <= 20 && f.result >= 0)).toBe(true);
    expect(sector('miss-mul').every((f) => f.op === 'mul' && f.unknown === 'b' && f.a >= 2 && f.a <= 10)).toBe(true);
    expect(sector('miss-div').every((f) => f.op === 'div' && f.unknown === 'b' && f.b >= 2 && f.b <= 10)).toBe(true);

    expect(sector('core')).toEqual([]);
    expect(factsForPlanet('unknown-planet')).toEqual([]);
  });

  it('uses the documented id formats', () => {
    const sectorOf = (factId: string) => sectorOfPlanet(factById(factId)!.planetId)?.id;
    expect(sectorOf('type:7')).toBe('type-1');
    expect(sectorOf('add:2+3')).toBe('add-5');
    expect(sectorOf('add:6+3')).toBe('add-10');
    expect(sectorOf('add:6+7')).toBe('add-15');
    expect(sectorOf('sub:5-4')).toBe('sub-5');
    expect(sectorOf('sub:9-4')).toBe('sub-10');
    expect(sectorOf('sub:15-8')).toBe('sub-15');
    expect(sectorOf('mul:7x8')).toBe('mul-c');
    expect(sectorOf('div:56/7')).toBe('div-c');
    const missMul = sector('miss-mul')[0];
    expect(missMul.id).toBe(`miss:mul:${missMul.a}x?=${missMul.result}`);
    const missAddA = sector('miss-add').find((f) => f.unknown === 'a')!;
    expect(missAddA.id).toBe(`miss:add:?+${missAddA.b}=${missAddA.result}`);
    expect(factById('nope')).toBeUndefined();
  });

  it('returns a fresh array each call (callers cannot corrupt the cache)', () => {
    const a = factsForPlanet('mul-b.1');
    a.pop();
    expect(factsForPlanet('mul-b.1')).toHaveLength(5);
    const all = allFacts();
    all.pop();
    expect(allFacts()).toHaveLength(all.length + 1);
  });
});

describe('formatProblem', () => {
  const fact = (p: Partial<Fact>): Fact => ({
    id: 'x', planetId: 'x', op: 'add', a: 0, b: 0, result: 0, unknown: 'result', answer: 0, ...p,
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
    for (const f of sector('miss-sub')) {
      expect(formatProblem(f, 'en')).toBe(`${f.a} − ? = ${f.result}`);
    }
  });

  it('formats negatives with the real minus and brackets on the right operand', () => {
    expect(formatProblem(fact({ op: 'sub', a: 5, b: -3, result: 8, answer: 8 }), 'hr')).toBe('5 − (−3)');
    expect(formatProblem(fact({ op: 'add', a: -4, b: 6, result: 2, answer: 2 }), 'en')).toBe('−4 + 6');
    expect(formatProblem(fact({ op: 'add', a: -4, b: -6, result: -10, answer: -10 }), 'en')).toBe('−4 + (−6)');
    for (const f of sector('neg-20')) {
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
