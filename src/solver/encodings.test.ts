import { describe, expect, it } from 'vitest';
import { Solver } from './cdcl';
import {
  atLeastK,
  atMostKSequential,
  atMostOnePairwise,
  atMostOneSequential,
  exactlyK,
  exactlyOne,
  Totalizer,
} from './encodings';

type Encoder = (s: Solver, xs: number[], guard?: number) => void;

const popcount = (mask: number) => {
  let c = 0;
  for (let m = mask; m !== 0; m &= m - 1) c++;
  return c;
};

/**
 * For every assignment of the n inputs, the encoding (with fresh auxiliaries) must be
 * satisfiable exactly when the cardinality relation holds. Inputs are fixed through
 * assumptions so one solver instance answers all 2^n questions.
 */
function matchesBruteForce(n: number, encode: Encoder, holds: (count: number) => boolean) {
  const s = new Solver();
  const xs = Array.from({ length: n }, () => s.newVar());
  encode(s, xs);
  for (let mask = 0; mask < 1 << n; mask++) {
    const assumptions = xs.map((x, i) => ((mask >> i) & 1 ? x : -x));
    const expected = holds(popcount(mask));
    const got = s.solve({ assumptions });
    if ((got === 'sat') !== expected) {
      throw new Error(`n=${n} mask=${mask.toString(2)}: expected ${expected}, got ${got}`);
    }
  }
}

/** With the guard false the constraint must vanish: every input assignment is allowed. */
function guardDisables(n: number, encode: Encoder) {
  const s = new Solver();
  const xs = Array.from({ length: n }, () => s.newVar());
  const g = s.newVar();
  encode(s, xs, g);
  for (let mask = 0; mask < 1 << n; mask++) {
    const assumptions = [-g, ...xs.map((x, i) => ((mask >> i) & 1 ? x : -x))];
    expect(s.solve({ assumptions })).toBe('sat');
  }
}

describe('at-most-one and exactly-one', () => {
  it('pairwise at-most-one matches brute force for n ≤ 7', () => {
    for (let n = 1; n <= 7; n++) matchesBruteForce(n, atMostOnePairwise, (c) => c <= 1);
  });
  it('sequential (ladder) at-most-one matches brute force for n ≤ 7', () => {
    for (let n = 1; n <= 7; n++) matchesBruteForce(n, atMostOneSequential, (c) => c <= 1);
  });
  it('exactly-one matches brute force for n ≤ 7, with both AMO styles', () => {
    for (let n = 1; n <= 7; n++) {
      matchesBruteForce(
        n,
        (s, xs, g) => exactlyOne(s, xs, g, 100),
        (c) => c === 1,
      );
      matchesBruteForce(
        n,
        (s, xs, g) => exactlyOne(s, xs, g, 0),
        (c) => c === 1,
      );
    }
  });
  it('guards switch the constraints off', () => {
    guardDisables(5, atMostOnePairwise);
    guardDisables(5, atMostOneSequential);
    guardDisables(5, (s, xs, g) => exactlyOne(s, xs, g));
  });
});

describe('at-most-k / at-least-k / exactly-k (Sinz sequential counter)', () => {
  it('matches brute force for every n ≤ 7 and every k', () => {
    for (let n = 1; n <= 7; n++) {
      for (let k = 0; k <= n; k++) {
        matchesBruteForce(
          n,
          (s, xs, g) => atMostKSequential(s, xs, k, g),
          (c) => c <= k,
        );
        matchesBruteForce(
          n,
          (s, xs, g) => atLeastK(s, xs, k, g),
          (c) => c >= k,
        );
        matchesBruteForce(
          n,
          (s, xs, g) => exactlyK(s, xs, k, g),
          (c) => c === k,
        );
      }
    }
  });
  it('guards switch them off', () => {
    for (let k = 0; k <= 4; k++) {
      guardDisables(4, (s, xs, g) => atMostKSequential(s, xs, k, g));
      guardDisables(4, (s, xs, g) => exactlyK(s, xs, k, g));
    }
  });
  it('out-of-range bounds behave like the arithmetic', () => {
    matchesBruteForce(
      3,
      (s, xs, g) => atMostKSequential(s, xs, -1, g),
      () => false,
    );
    matchesBruteForce(
      3,
      (s, xs, g) => atLeastK(s, xs, 4, g),
      () => false,
    );
    matchesBruteForce(
      3,
      (s, xs, g) => atLeastK(s, xs, 0, g),
      () => true,
    );
  });
});

describe('totalizer (Bailleux & Boufkhad 2003)', () => {
  it('assuming ¬o_(k+1) enforces Σx ≤ k, for every n ≤ 7, k and cap', () => {
    for (let n = 1; n <= 7; n++) {
      for (let cap = 1; cap <= n; cap++) {
        const s = new Solver();
        const xs = Array.from({ length: n }, () => s.newVar());
        const tot = new Totalizer(s, xs, cap);
        for (let k = 0; k < cap; k++) {
          const bound = tot.atMost(k)!;
          for (let mask = 0; mask < 1 << n; mask++) {
            const assumptions = [bound, ...xs.map((x, i) => ((mask >> i) & 1 ? x : -x))];
            const expected = popcount(mask) <= k;
            expect(s.solve({ assumptions }) === 'sat').toBe(expected);
          }
        }
      }
    }
  });

  it('counts duplicated inputs twice (used for mirrored seasons)', () => {
    const s = new Solver();
    const a = s.newVar();
    const b = s.newVar();
    const tot = new Totalizer(s, [a, a, b], 3);
    // a alone already makes the sum 2.
    expect(s.solve({ assumptions: [a, -b, tot.atMost(1)!] })).toBe('unsat');
    expect(s.solve({ assumptions: [a, -b, tot.atMost(2)!] })).toBe('sat');
    expect(s.solve({ assumptions: [a, b, tot.atMost(2)!] })).toBe('unsat');
  });

  it('reports vacuous and out-of-range bounds', () => {
    const s = new Solver();
    const xs = [s.newVar(), s.newVar(), s.newVar()];
    const tot = new Totalizer(s, xs, 2);
    expect(tot.atMost(3)).toBeNull();
    expect(() => tot.atMost(2)).toThrow(RangeError);
    expect(() => tot.atMost(-1)).toThrow(RangeError);
  });
});
