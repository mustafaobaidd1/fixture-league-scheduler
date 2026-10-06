import { describe, expect, it } from 'vitest';
import { checkRup } from '../proof/rup';
import { Solver } from './cdcl';
import { Cnf, parseDimacs } from './cnf';
import { luby } from './luby';
import { bruteForceCount, pigeonhole, random3Sat, rng, satisfies } from './testing';

function solverFor(cnf: Cnf, proof = false): Solver {
  const s = new Solver({ proof });
  cnf.loadInto(s);
  return s;
}

describe('luby', () => {
  it('produces the Luby sequence (Luby, Sinclair & Zuckerman 1993)', () => {
    const seq = Array.from({ length: 15 }, (_, i) => luby(2, i));
    expect(seq).toEqual([1, 1, 2, 1, 1, 2, 4, 1, 1, 2, 1, 1, 2, 4, 8]);
  });
});

describe('CDCL solver — basics', () => {
  it('solves the empty formula', () => {
    const s = new Solver();
    expect(s.solve()).toBe('sat');
  });

  it('propagates a chain of implications from a unit clause', () => {
    const s = new Solver();
    for (let i = 0; i < 6; i++) s.newVar();
    s.addClause([1]);
    for (let v = 1; v < 6; v++) s.addClause([-v, v + 1]);
    expect(s.solve()).toBe('sat');
    for (let v = 1; v <= 6; v++) expect(s.value(v)).toBe(true);
    // Unit propagation alone decided everything: no branching was needed.
    expect(s.stats.decisions).toBe(0);
  });

  it('detects a contradiction between unit clauses', () => {
    const s = new Solver();
    s.newVar();
    s.addClause([1]);
    expect(s.addClause([-1])).toBe(false);
    expect(s.solve()).toBe('unsat');
  });

  it('rejects literals of undeclared variables', () => {
    const s = new Solver();
    s.newVar();
    expect(() => s.addClause([2])).toThrow(RangeError);
    expect(() => s.addClause([0])).toThrow(RangeError);
  });

  it('ignores tautologies and duplicate literals', () => {
    const s = new Solver();
    s.newVar();
    s.newVar();
    s.addClause([1, -1, 2]);
    s.addClause([2, 2, 2]);
    expect(s.solve()).toBe('sat');
    expect(s.value(2)).toBe(true);
  });

  it('solves small satisfiable and unsatisfiable formulas', () => {
    // (a ∨ b) ∧ (¬a ∨ b) ∧ (a ∨ ¬b) is satisfied only by a = b = true.
    const sat = parseDimacs('p cnf 2 3\n1 2 0\n-1 2 0\n1 -2 0\n');
    const s1 = solverFor(sat);
    expect(s1.solve()).toBe('sat');
    expect([s1.value(1), s1.value(2)]).toEqual([true, true]);
    // Adding (¬a ∨ ¬b) makes it unsatisfiable.
    const unsat = parseDimacs('p cnf 2 4\n1 2 0\n-1 2 0\n1 -2 0\n-1 -2 0\n');
    expect(solverFor(unsat).solve()).toBe('unsat');
  });

  it('round-trips DIMACS', () => {
    const cnf = random3Sat(10, 30, rng(7));
    const back = parseDimacs(`c a comment\n${cnf.toDimacs()}`);
    expect(back.numVars).toBe(10);
    expect(back.clauses).toEqual(cnf.clauses);
  });
});

describe('CDCL solver — pigeonhole PHP(n+1, n) is UNSAT', () => {
  // PHP needs exponentially long resolution proofs (Haken 1985), so it stresses learning,
  // backjumping and clause deletion without any help from structure.
  for (let n = 1; n <= 7; n++) {
    it(`PHP(${n + 1}, ${n})`, () => {
      const s = solverFor(pigeonhole(n + 1, n), n <= 5);
      expect(s.solve()).toBe('unsat');
      if (s.proof) {
        // Certify the answer with the independent RUP checker.
        expect(checkRup(s.proof, []).ok).toBe(true);
      }
    }, 120_000);
  }

  it('PHP(n, n) is satisfiable and the model is a valid placement', () => {
    for (let n = 1; n <= 8; n++) {
      const cnf = pigeonhole(n, n);
      const s = solverFor(cnf);
      expect(s.solve()).toBe('sat');
      expect(satisfies(cnf, s.model())).toBe(true);
    }
  });
});

describe('CDCL solver — random 3-SAT near the phase transition agrees with brute force', () => {
  // m/n ≈ 4.26 is where random 3-SAT flips from mostly SAT to mostly UNSAT
  // (Mitchell, Selman & Levesque 1992; Crawford & Auton 1996), the hardest region.
  it('n = 20, m = 85: 300 instances', () => {
    const rand = rng(20261006);
    let sat = 0;
    let unsat = 0;
    for (let i = 0; i < 300; i++) {
      const cnf = random3Sat(20, 85, rand);
      const expected = bruteForceCount(cnf) > 0;
      const s = solverFor(cnf);
      const result = s.solve();
      expect(result).toBe(expected ? 'sat' : 'unsat');
      if (result === 'sat') {
        expect(satisfies(cnf, s.model())).toBe(true);
        sat++;
      } else {
        unsat++;
      }
    }
    // Both outcomes occur in meaningful numbers, so the test exercises both code paths.
    expect(sat).toBeGreaterThan(50);
    expect(unsat).toBeGreaterThan(50);
  }, 60_000);

  it('every UNSAT answer on smaller instances carries a valid RUP proof', () => {
    const rand = rng(99);
    let certified = 0;
    for (let i = 0; i < 120; i++) {
      const cnf = random3Sat(14, 60, rand);
      const s = solverFor(cnf, true);
      if (s.solve() === 'unsat') {
        expect(bruteForceCount(cnf)).toBe(0);
        expect(checkRup(s.proof!, []).ok).toBe(true);
        certified++;
      }
    }
    expect(certified).toBeGreaterThan(20);
  });
});

describe('CDCL solver — assumptions and final conflicts', () => {
  it('returns a core that is a subset of the assumptions and is itself UNSAT', () => {
    // x1 → x2 → x3, and ¬x3. Assumptions {x1, x4, x5}: only x1 is to blame.
    const s = new Solver();
    for (let i = 0; i < 5; i++) s.newVar();
    s.addClause([-1, 2]);
    s.addClause([-2, 3]);
    s.addClause([-3]);
    expect(s.solve({ assumptions: [4, 1, 5] })).toBe('unsat');
    expect(s.core).toEqual([1]);
    // The solver is still usable and satisfiable without the bad assumption.
    expect(s.solve({ assumptions: [4, 5] })).toBe('sat');
    expect(s.value(4) && s.value(5)).toBe(true);
  });

  it('finds cores that need several assumptions', () => {
    // a ∧ b → c, and ¬c: the core must contain both a and b but not d.
    const s = new Solver();
    for (let i = 0; i < 4; i++) s.newVar();
    s.addClause([-1, -2, 3]);
    s.addClause([-3]);
    expect(s.solve({ assumptions: [4, 1, 2] })).toBe('unsat');
    expect([...s.core].sort()).toEqual([1, 2]);
  });

  it('cores on random formulas are UNSAT on their own', () => {
    const rand = rng(5);
    let checked = 0;
    for (let i = 0; i < 60; i++) {
      const cnf = random3Sat(25, 125, rand);
      // Selector-guarded clauses: clause c only applies when its selector is assumed.
      const s = new Solver();
      for (let v = 0; v < 25; v++) s.newVar();
      const selectors = cnf.clauses.map((c) => {
        const sel = s.newVar();
        s.addClause([...c, -sel]);
        return sel;
      });
      if (s.solve({ assumptions: selectors }) !== 'unsat') continue;
      const core = s.core;
      expect(core.every((l) => selectors.includes(l))).toBe(true);
      expect(s.solve({ assumptions: core })).toBe('unsat');
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });

  it('supports adding clauses between calls (incremental use)', () => {
    const s = new Solver();
    for (let i = 0; i < 3; i++) s.newVar();
    s.addClause([1, 2, 3]);
    expect(s.solve()).toBe('sat');
    s.addClause([-1]);
    s.addClause([-2]);
    expect(s.solve()).toBe('sat');
    expect(s.value(3)).toBe(true);
    s.addClause([-3]);
    expect(s.solve()).toBe('unsat');
  });

  it('stops with "unknown" when the conflict budget runs out, then can finish', () => {
    const s = solverFor(pigeonhole(8, 7));
    expect(s.solve({ conflictBudget: 50 })).toBe('unknown');
    expect(s.solve()).toBe('unsat');
  }, 120_000);

  it('reports progress while searching', () => {
    let t = 0;
    const seen: number[] = [];
    const s = solverFor(pigeonhole(7, 6));
    s.solve({
      now: () => (t += 10),
      progressIntervalMs: 50,
      onProgress: (st) => seen.push(st.conflicts),
    });
    expect(seen.length).toBeGreaterThan(1);
    expect(seen[seen.length - 1]).toBe(s.stats.conflicts);
  });
});
