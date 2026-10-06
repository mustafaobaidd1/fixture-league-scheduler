/**
 * Cardinality constraints as CNF.
 *
 * Every encoder takes an optional `guard` literal g: the constraint then only applies when g
 * is true. Only the clauses that *restrict* the inputs carry ¬g; the clauses that merely
 * define auxiliary counter variables are always satisfiable, so they are added unguarded.
 * Guards are how each user constraint gets its selector literal.
 *
 * - pairwise at-most-one: C(n, 2) binary clauses, no auxiliary variables;
 * - sequential counter (Sinz 2005, "Towards an optimal CNF encoding of Boolean cardinality
 *   constraints"): O(n·k) clauses and auxiliaries, arc-consistent under unit propagation;
 * - totalizer (Bailleux & Boufkhad 2003, "Efficient CNF encoding of Boolean cardinality
 *   constraints"): a tree of unary adders whose outputs o_j mean "at least j inputs are true";
 *   assuming ¬o_(k+1) enforces "at most k", which is how break minimisation tightens bounds.
 */
import type { ClauseSink } from './cdcl';

function guarded(sink: ClauseSink, lits: number[], guard?: number): void {
  if (guard !== undefined) lits.push(-guard);
  sink.addClause(lits);
}

export function atLeastOne(sink: ClauseSink, lits: number[], guard?: number): void {
  guarded(sink, lits.slice(), guard);
}

export function atMostOnePairwise(sink: ClauseSink, lits: number[], guard?: number): void {
  for (let i = 0; i < lits.length; i++) {
    for (let j = i + 1; j < lits.length; j++) guarded(sink, [-lits[i], -lits[j]], guard);
  }
}

/** Sequential ("ladder") at-most-one: s_i means "one of x_1..x_i is true". */
export function atMostOneSequential(sink: ClauseSink, lits: number[], guard?: number): void {
  const n = lits.length;
  if (n <= 1) return;
  const s: number[] = [];
  for (let i = 0; i < n - 1; i++) s.push(sink.newVar());
  sink.addClause([-lits[0], s[0]]);
  for (let i = 1; i < n - 1; i++) {
    sink.addClause([-lits[i], s[i]]);
    sink.addClause([-s[i - 1], s[i]]);
    guarded(sink, [-lits[i], -s[i - 1]], guard);
  }
  guarded(sink, [-lits[n - 1], -s[n - 2]], guard);
}

/** Pairwise for small groups (binary clauses propagate fastest), ladder for larger ones. */
export function atMostOne(
  sink: ClauseSink,
  lits: number[],
  guard?: number,
  pairwiseUpTo = 8,
): void {
  if (lits.length <= pairwiseUpTo) atMostOnePairwise(sink, lits, guard);
  else atMostOneSequential(sink, lits, guard);
}

export function exactlyOne(sink: ClauseSink, lits: number[], guard?: number, pairwiseUpTo = 8) {
  atLeastOne(sink, lits, guard);
  atMostOne(sink, lits, guard, pairwiseUpTo);
}

/**
 * Sinz's sequential counter for Σ x_i ≤ k. Register s[i][j] (i < n−1, j < k) means
 * "at least j+1 of x_0..x_i are true"; overflow clauses forbid a (k+1)-th true input.
 */
export function atMostKSequential(
  sink: ClauseSink,
  lits: number[],
  k: number,
  guard?: number,
): void {
  const n = lits.length;
  if (k < 0) {
    guarded(sink, [], guard);
    return;
  }
  if (k >= n) return;
  if (k === 0) {
    for (const x of lits) guarded(sink, [-x], guard);
    return;
  }
  const s: number[][] = [];
  for (let i = 0; i < n - 1; i++) {
    const row: number[] = [];
    for (let j = 0; j < k; j++) row.push(sink.newVar());
    s.push(row);
  }
  sink.addClause([-lits[0], s[0][0]]);
  for (let j = 1; j < k; j++) sink.addClause([-s[0][j]]);
  for (let i = 1; i < n - 1; i++) {
    sink.addClause([-lits[i], s[i][0]]);
    sink.addClause([-s[i - 1][0], s[i][0]]);
    for (let j = 1; j < k; j++) {
      sink.addClause([-lits[i], -s[i - 1][j - 1], s[i][j]]);
      sink.addClause([-s[i - 1][j], s[i][j]]);
    }
    guarded(sink, [-lits[i], -s[i - 1][k - 1]], guard);
  }
  guarded(sink, [-lits[n - 1], -s[n - 2][k - 1]], guard);
}

/** Σ x_i ≥ k. Small k are encoded directly; larger k as "at most n − k of the negations". */
export function atLeastK(sink: ClauseSink, lits: number[], k: number, guard?: number): void {
  const n = lits.length;
  if (k <= 0) return;
  if (k > n) {
    guarded(sink, [], guard);
    return;
  }
  if (k === 1) {
    atLeastOne(sink, lits, guard);
    return;
  }
  if (k === 2) {
    // At least two are true ⟺ for every i, some *other* input is true.
    for (let i = 0; i < n; i++) {
      guarded(
        sink,
        lits.filter((_, j) => j !== i),
        guard,
      );
    }
    return;
  }
  atMostKSequential(
    sink,
    lits.map((x) => -x),
    n - k,
    guard,
  );
}

export function exactlyK(sink: ClauseSink, lits: number[], k: number, guard?: number): void {
  atMostKSequential(sink, lits, k, guard);
  atLeastK(sink, lits, k, guard);
}

/**
 * Totalizer over `inputs` (duplicates count twice), keeping at most `cap` outputs.
 * outputs[j] is implied by "at least j+1 inputs are true"; with a cap, outputs[cap−1]
 * saturates and stands for "at least cap".
 */
export class Totalizer {
  readonly outputs: number[];
  readonly size: number;

  constructor(
    sink: ClauseSink,
    readonly inputs: number[],
    readonly cap: number,
  ) {
    this.size = inputs.length;
    this.outputs = inputs.length === 0 ? [] : this.build(sink, 0, inputs.length);
  }

  private build(sink: ClauseSink, lo: number, hi: number): number[] {
    if (hi - lo === 1) return [this.inputs[lo]];
    const mid = (lo + hi) >> 1;
    const a = this.build(sink, lo, mid);
    const b = this.build(sink, mid, hi);
    const m = Math.min(a.length + b.length, Math.max(1, this.cap));
    const r: number[] = [];
    for (let t = 0; t < m; t++) r.push(sink.newVar());
    for (let i = 0; i <= a.length; i++) {
      for (let j = 0; j <= b.length; j++) {
        if (i + j === 0) continue;
        const clause: number[] = [];
        if (i > 0) clause.push(-a[i - 1]);
        if (j > 0) clause.push(-b[j - 1]);
        clause.push(r[Math.min(i + j, m) - 1]);
        sink.addClause(clause);
      }
    }
    // Unary order: "at least t+1" implies "at least t". Sound for the one-sided encoding
    // and it lets a single assumption ¬o_k propagate to every higher output.
    for (let t = 1; t < m; t++) sink.addClause([-r[t], r[t - 1]]);
    return r;
  }

  /**
   * The literal to assume (or assert) for Σ inputs ≤ k, or null when the bound is vacuous.
   * Throws if k is beyond the encoded range.
   */
  atMost(k: number): number | null {
    if (k >= this.size) return null;
    if (k < 0) throw new RangeError('A sum cannot be at most a negative number');
    if (k >= this.outputs.length) throw new RangeError(`Totalizer capped at ${this.cap}`);
    return -this.outputs[k];
  }
}
