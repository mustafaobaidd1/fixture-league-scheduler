import type { ClauseSink, Solver } from './cdcl';

/** An in-memory CNF formula: a variable counter and a list of clauses (signed literals). */
export class Cnf implements ClauseSink {
  numVars = 0;
  readonly clauses: number[][] = [];

  newVar(): number {
    return ++this.numVars;
  }

  addClause(lits: ArrayLike<number>): void {
    this.clauses.push(Array.from(lits));
  }

  /** Copies every variable and clause into a solver. Returns false if it became UNSAT. */
  loadInto(solver: Solver): boolean {
    while (solver.numVars < this.numVars) solver.newVar();
    let ok = true;
    for (const c of this.clauses) ok = solver.addClause(c) && ok;
    return ok;
  }

  toDimacs(): string {
    const lines = [`p cnf ${this.numVars} ${this.clauses.length}`];
    for (const c of this.clauses) lines.push(`${c.join(' ')} 0`);
    return lines.join('\n') + '\n';
  }
}

/** Parses DIMACS CNF text. Comment lines start with "c"; clauses end with 0. */
export function parseDimacs(text: string): Cnf {
  const cnf = new Cnf();
  let current: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('c') || line.startsWith('%')) continue;
    if (line.startsWith('p')) {
      const parts = line.split(/\s+/);
      if (parts[1] !== 'cnf') throw new Error('Only "p cnf" headers are supported');
      cnf.numVars = Number(parts[2]);
      continue;
    }
    for (const tok of line.split(/\s+/)) {
      const lit = Number(tok);
      if (!Number.isInteger(lit)) throw new Error(`Bad token "${tok}"`);
      if (lit === 0) {
        cnf.addClause(current);
        current = [];
      } else {
        current.push(lit);
        cnf.numVars = Math.max(cnf.numVars, Math.abs(lit));
      }
    }
  }
  if (current.length > 0) cnf.addClause(current);
  return cnf;
}
