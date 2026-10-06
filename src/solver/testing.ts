/** Test helpers shared by the solver test files (not used by the app). */
import { Cnf } from './cnf';

/** Small seeded PRNG (mulberry32) so random tests are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform random 3-SAT: m clauses over n variables, three distinct variables per clause. */
export function random3Sat(n: number, m: number, rand: () => number): Cnf {
  const cnf = new Cnf();
  cnf.numVars = n;
  for (let c = 0; c < m; c++) {
    const vars = new Set<number>();
    while (vars.size < 3) vars.add(1 + Math.floor(rand() * n));
    cnf.addClause([...vars].map((v) => (rand() < 0.5 ? v : -v)));
  }
  return cnf;
}

/** Pigeonhole PHP(p, h): p pigeons, h holes, every pigeon in a hole, no hole shared. */
export function pigeonhole(p: number, h: number): Cnf {
  const cnf = new Cnf();
  cnf.numVars = p * h;
  const x = (i: number, j: number) => i * h + j + 1;
  for (let i = 0; i < p; i++) cnf.addClause(Array.from({ length: h }, (_, j) => x(i, j)));
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < p; i++) for (let k = i + 1; k < p; k++) cnf.addClause([-x(i, j), -x(k, j)]);
  }
  return cnf;
}

/**
 * Exhaustive satisfiability for up to ~22 variables using truth tables as bitsets: bit a of
 * the table for variable v is set iff assignment a makes v true. A formula is the AND of
 * its clauses' ORs, evaluated 32 assignments at a time. Obviously correct, independent of
 * the solver.
 */
export function bruteForceCount(cnf: Cnf): number {
  const n = cnf.numVars;
  const words = Math.max(1, (1 << n) >>> 5);
  const lowPatterns = [0xaaaaaaaa, 0xcccccccc, 0xf0f0f0f0, 0xff00ff00, 0xffff0000];
  const table = (v: number, w: number): number => {
    const bit = v - 1;
    if (bit < 5) return lowPatterns[bit] | 0;
    return (w >>> (bit - 5)) & 1 ? -1 : 0;
  };
  const acc = new Int32Array(words).fill(-1);
  if (n < 5) {
    // Only the low 2^n bits of the single word are real assignments.
    acc[0] = (1 << (1 << n)) - 1 || -1;
  }
  for (const clause of cnf.clauses) {
    for (let w = 0; w < words; w++) {
      if (acc[w] === 0) continue;
      let or = 0;
      for (const lit of clause) {
        const t = table(Math.abs(lit), w);
        or |= lit > 0 ? t : ~t;
      }
      acc[w] &= or;
    }
  }
  let count = 0;
  for (let w = 0; w < words; w++) {
    let x = acc[w] >>> 0;
    while (x !== 0) {
      x &= x - 1;
      count++;
    }
  }
  return count;
}

/** Does the assignment (indexed by 0-based variable, 1 = true) satisfy every clause? */
export function satisfies(cnf: Cnf, model: Int8Array): boolean {
  return cnf.clauses.every((c) =>
    c.some((lit) => (lit > 0 ? model[lit - 1] === 1 : model[-lit - 1] === -1)),
  );
}
