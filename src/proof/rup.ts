/**
 * Independent RUP proof checker.
 *
 * Replays a ProofLog in order. Axioms are added as given. Each lemma C must follow from the
 * clauses before it by reverse unit propagation: assign ¬l for every l ∈ C, propagate, and
 * reach a conflict. The final target clause is checked the same way — the empty clause for
 * a plain UNSAT answer, or ¬a₁ ∨ … ∨ ¬a_k for "UNSAT under assumptions a₁ … a_k".
 *
 * This file shares no code with the solver: clauses are separate arrays, there are no
 * blocker literals, no binary special case and no clause deletion. A bug would have to occur
 * twice, in two different implementations, to certify a wrong answer.
 */
import { AXIOM, type ProofLog } from './log';

export interface RupReport {
  ok: boolean;
  /** Lemmas re-derived (including the target). */
  checked: number;
  /** Index of the first lemma that failed, if any (0-based among lemmas). */
  failedAt?: number;
  /** True when the check was cut short by the deadline (ok is then false). */
  timedOut?: boolean;
}

export function checkRup(
  log: ProofLog,
  target: ArrayLike<number>,
  options: { end?: number; deadline?: number; now?: () => number } = {},
): RupReport {
  if (log.truncated) return { ok: false, checked: 0 };
  const now = options.now ?? (() => performance.now());
  const deadline = options.deadline ?? Infinity;

  let maxVar = 0;
  for (const { lits } of log.records(options.end)) {
    for (let i = 0; i < lits.length; i++) maxVar = Math.max(maxVar, Math.abs(lits[i]));
  }
  for (let i = 0; i < target.length; i++) maxVar = Math.max(maxVar, Math.abs(target[i]));

  const checker = new UnitPropagator(maxVar);
  let lemmaIndex = 0;
  let checked = 0;
  for (const { kind, lits } of log.records(options.end)) {
    if (kind === AXIOM) {
      checker.add(lits);
      continue;
    }
    if ((lemmaIndex & 255) === 0 && now() > deadline) {
      return { ok: false, checked, timedOut: true };
    }
    if (!checker.implies(lits)) return { ok: false, checked, failedAt: lemmaIndex };
    checker.add(lits);
    checked++;
    lemmaIndex++;
  }
  if (!checker.implies(target)) return { ok: false, checked, failedAt: lemmaIndex };
  return { ok: true, checked: checked + 1 };
}

class UnitPropagator {
  /** Per variable (1-based): 1 true, -1 false, 0 unassigned. */
  private readonly val: Int8Array;
  private readonly trail: number[] = [];
  private head = 0;
  private readonly clauses: Int32Array[] = [];
  /** watchers[code(lit)]: clauses currently watching lit (visited when lit becomes false). */
  private readonly watchers: number[][];
  private inconsistent = false;

  constructor(maxVar: number) {
    this.val = new Int8Array(maxVar + 1);
    this.watchers = Array.from({ length: 2 * maxVar + 2 }, () => []);
  }

  private code(lit: number): number {
    return lit > 0 ? 2 * lit : -2 * lit + 1;
  }

  private value(lit: number): number {
    const v = this.val[Math.abs(lit)];
    return lit > 0 ? v : -v;
  }

  private assign(lit: number): void {
    this.val[Math.abs(lit)] = lit > 0 ? 1 : -1;
    this.trail.push(lit);
  }

  /** Adds a clause permanently (at the root). */
  add(input: ArrayLike<number>): void {
    if (this.inconsistent) return;
    const lits = Int32Array.from(input);
    if (lits.length === 0) {
      this.inconsistent = true;
      return;
    }
    // Put the "best" literals first: true, then unassigned, then false.
    const rank = (l: number) => (this.value(l) === 1 ? 0 : this.value(l) === 0 ? 1 : 2);
    lits.sort((a, b) => rank(a) - rank(b));
    if (this.value(lits[0]) === -1) {
      this.inconsistent = true;
      return;
    }
    if (lits.length === 1 || this.value(lits[1]) === -1) {
      if (this.value(lits[0]) === 0) {
        this.assign(lits[0]);
        if (!this.propagate()) this.inconsistent = true;
      }
      if (lits.length === 1) return;
    }
    const idx = this.clauses.length;
    this.clauses.push(lits);
    this.watchers[this.code(lits[0])].push(idx);
    this.watchers[this.code(lits[1])].push(idx);
  }

  /** Does unit propagation from ¬clause reach a conflict? (Root state is restored.) */
  implies(clause: ArrayLike<number>): boolean {
    if (this.inconsistent) return true;
    const mark = this.trail.length;
    let conflict = false;
    for (let i = 0; i < clause.length && !conflict; i++) {
      const l = clause[i];
      const v = this.value(l);
      if (v === 1) {
        conflict = true; // a literal of the clause is already implied at the root
      } else if (v === 0) {
        this.assign(-l);
      }
    }
    if (!conflict) conflict = !this.propagate();
    // Undo the temporary assignments.
    for (let i = this.trail.length - 1; i >= mark; i--) this.val[Math.abs(this.trail[i])] = 0;
    this.trail.length = mark;
    this.head = mark;
    return conflict;
  }

  /** Returns false on conflict. */
  private propagate(): boolean {
    while (this.head < this.trail.length) {
      const falseLit = -this.trail[this.head++];
      const list = this.watchers[this.code(falseLit)];
      let keep = 0;
      for (let w = 0; w < list.length; w++) {
        const idx = list[w];
        const c = this.clauses[idx];
        if (c[0] === falseLit) {
          c[0] = c[1];
          c[1] = falseLit;
        }
        if (this.value(c[0]) === 1) {
          list[keep++] = idx;
          continue;
        }
        let found = -1;
        for (let k = 2; k < c.length; k++) {
          if (this.value(c[k]) !== -1) {
            found = k;
            break;
          }
        }
        if (found >= 0) {
          c[1] = c[found];
          c[found] = falseLit;
          this.watchers[this.code(c[1])].push(idx);
          continue;
        }
        list[keep++] = idx;
        if (this.value(c[0]) === -1) {
          for (let r = w + 1; r < list.length; r++) list[keep++] = list[r];
          list.length = keep;
          return false;
        }
        this.assign(c[0]);
      }
      list.length = keep;
    }
    return true;
  }
}
