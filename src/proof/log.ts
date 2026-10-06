/**
 * A clausal proof log: the sequence of clauses a solver added (axioms) and derived (lemmas).
 *
 * Every lemma a CDCL solver learns is implied by the clauses before it by *reverse unit
 * propagation* (RUP): assigning the negation of the lemma and unit-propagating yields a
 * conflict. Replaying the log with an independent checker therefore certifies an UNSAT
 * answer without trusting the solver. Literals are DIMACS-style signed integers.
 */
export const AXIOM = 1;
export const LEMMA = 2;

export class ProofLog {
  private data = new Int32Array(1 << 14);
  private length = 0;
  /** Set when the log hit its size limit; a truncated log cannot certify anything. */
  truncated = false;
  axioms = 0;
  lemmas = 0;

  constructor(private readonly limit = 6_000_000) {}

  add(kind: typeof AXIOM | typeof LEMMA, lits: ArrayLike<number>): void {
    if (this.truncated) return;
    const need = this.length + 2 + lits.length;
    if (need > this.limit) {
      this.truncated = true;
      return;
    }
    if (need > this.data.length) {
      let cap = this.data.length;
      while (cap < need) cap *= 2;
      const next = new Int32Array(Math.min(cap, this.limit));
      next.set(this.data.subarray(0, this.length));
      this.data = next;
    }
    this.data[this.length++] = kind;
    this.data[this.length++] = lits.length;
    for (let i = 0; i < lits.length; i++) this.data[this.length++] = lits[i];
    if (kind === AXIOM) this.axioms++;
    else this.lemmas++;
  }

  /** Number of stored integers (a cheap size measure). */
  get size(): number {
    return this.length;
  }

  /** A position marker: replaying up to a mark reproduces the clause set at that moment. */
  mark(): number {
    return this.length;
  }

  /** Iterates records up to `end` (default: everything logged so far). */
  *records(end = this.length): Generator<{ kind: number; lits: Int32Array }> {
    let i = 0;
    while (i < end) {
      const kind = this.data[i];
      const len = this.data[i + 1];
      yield { kind, lits: this.data.subarray(i + 2, i + 2 + len) };
      i += 2 + len;
    }
  }
}
