/**
 * The solving pipeline: input checks → encoding → feasibility → (optional) optimisation by
 * bound tightening → or, when infeasible, a minimal explanation.
 *
 * Optimisation: after a schedule with B breaks is found, assume "Σ breaks ≤ B − 1" through
 * the totalizer output and solve again. When that is UNSAT the incumbent is optimal and the
 * result is labelled "Optimal (proven)".
 *
 * Explanation: every user constraint has a selector literal. An UNSAT answer under the
 * selectors comes with a final-conflict core; deletion-based MUS extraction (with clause-set
 * refinement) shrinks it until removing any member makes the rest satisfiable. A second,
 * smaller pass names the structural rules of a round-robin that the conflict relies on.
 */
import { LeagueEncoding, type StructuralGroup } from '../encode/encode';
import { inputIssues, type InputIssue } from '../model/issues';
import { canonicalSchedule } from '../model/construct';
import { breakBound, seasonOf } from '../model/season';
import type { Schedule, Setup } from '../model/types';
import { checkRup } from '../proof/rup';
import { Solver, type SolveResult, type SolverStats } from '../solver/cdcl';

export type Phase = 'searching' | 'improving' | 'proving' | 'explaining' | 'certifying';

export interface LiveStats extends SolverStats {
  elapsedMs: number;
  phase: Phase;
  /** Current upper bound on breaks being tested (Σ ≤ bound), if optimising. */
  bound: number | null;
}

export type LogKind = 'found' | 'improved' | 'optimal' | 'unsat' | 'shrink' | 'rules' | 'timeout';

export type EngineEvent =
  | { type: 'stats'; stats: LiveStats }
  | { type: 'solution'; schedule: Schedule; breaks: number; elapsedMs: number }
  | { type: 'log'; kind: LogKind; text: string; elapsedMs: number };

export interface Conflict {
  /** Ids of the user constraints in the minimal unsatisfiable subset. */
  constraintIds: string[];
  /** False when a deletion check ran out of time (the set is unsatisfiable, maybe not minimal). */
  minimal: boolean;
  /** Structural rules the conflict needs (empty if that analysis ran out of time). */
  structural: StructuralGroup[];
  structuralKnown: boolean;
}

export interface Certificate {
  /** True: an independent RUP checker re-derived the UNSAT step. Null: not attempted/too big. */
  verified: boolean | null;
  lemmas: number;
  ms: number;
  note: string;
}

interface OutcomeBase {
  elapsedMs: number;
  stats: SolverStats;
  vars: number;
  clauses: number;
  symmetry: string;
}

export type Outcome =
  | { status: 'invalid'; issues: InputIssue[] }
  | (OutcomeBase & { status: 'feasible'; schedule: Schedule; breaks: number })
  | (OutcomeBase & {
      status: 'optimal';
      /** solver: the next bound is UNSAT; theory: equals a proven lower bound; trivial: 0. */
      proof: 'solver' | 'theory' | 'trivial';
      schedule: Schedule;
      breaks: number;
    })
  | (OutcomeBase & { status: 'unsat'; conflict: Conflict })
  | (OutcomeBase & {
      status: 'timeout';
      schedule: Schedule | null;
      breaks: number | null;
      optimising: boolean;
    });

export interface EngineOptions {
  timeLimitMs?: number;
  now?: () => number;
  onEvent?: (e: EngineEvent) => void;
  /** Main-thread mode: yield between solver slices of `sliceMs`. */
  yieldControl?: () => Promise<void>;
  sliceMs?: number;
  /** Log a clausal proof so UNSAT steps can be certified afterwards (default true). */
  proof?: boolean;
  symmetryBreaking?: boolean;
  /** Seed the solver's phases with a constructed schedule (default true). */
  warmStart?: boolean;
  /** Stop at a known lower bound on breaks if the solver's own proof is slow (default true). */
  theoryShortcut?: boolean;
  /** Budget for the solver's proof once the incumbent meets the theoretical bound. */
  theoryProofMs?: number;
  /** Resume optimisation from a known schedule (for "keep searching"). */
  incumbent?: { schedule: Schedule; breaks: number };
  /** Extra time for the explanation phase if the main budget is nearly used up. */
  explainMinMs?: number;
}

export class Engine {
  private readonly now: () => number;
  private readonly start: number;
  private readonly deadline: number;
  private readonly emit: (e: EngineEvent) => void;
  private solver!: Solver;
  private enc!: LeagueEncoding;
  private phase: Phase = 'searching';
  private bound: number | null = null;
  /** Assumptions and core of the last UNSAT answer that matters (for certification). */
  private lastUnsat: number[] | null = null;
  private lastStats: SolverStats | null = null;

  constructor(
    private readonly setup: Setup,
    private readonly options: EngineOptions = {},
  ) {
    this.now = options.now ?? (() => performance.now());
    this.start = this.now();
    this.deadline = this.start + (options.timeLimitMs ?? 20_000);
    this.emit = options.onEvent ?? (() => {});
  }

  private elapsed(): number {
    return this.now() - this.start;
  }

  private log(kind: LogKind, text: string): void {
    this.emit({ type: 'log', kind, text, elapsedMs: this.elapsed() });
  }

  private publishStats(stats: SolverStats): void {
    this.lastStats = stats;
    this.emit({
      type: 'stats',
      stats: { ...stats, elapsedMs: this.elapsed(), phase: this.phase, bound: this.bound },
    });
  }

  private async solve(
    solver: Solver,
    assumptions: number[],
    deadline: number,
  ): Promise<SolveResult> {
    const slice = this.options.yieldControl ? (this.options.sliceMs ?? 40) : Infinity;
    for (;;) {
      const result = solver.solve({
        assumptions,
        deadline: Math.min(deadline, this.now() + slice),
        now: this.now,
        onProgress: (st) => this.publishStats(st),
        progressIntervalMs: 100,
      });
      if (result !== 'unknown') return result;
      if (this.now() >= deadline || !this.options.yieldControl) return 'unknown';
      await this.options.yieldControl();
    }
  }

  private base(): OutcomeBase {
    return {
      elapsedMs: this.elapsed(),
      stats: this.solver.snapshot(),
      vars: this.solver.numVars,
      clauses: this.solver.stats.clauses,
      symmetry: this.enc.symmetry.applied,
    };
  }

  async run(): Promise<Outcome> {
    const issues = inputIssues(this.setup);
    if (issues.length > 0) return { status: 'invalid', issues };

    this.solver = new Solver({ proof: this.options.proof !== false });
    this.enc = new LeagueEncoding(this.solver, this.setup, {
      symmetryBreaking: this.options.symmetryBreaking,
    });
    const selectors = [...this.enc.selectors.values()];
    const optimising = this.enc.minimiseBreaks;
    const season = seasonOf(this.setup);
    // A valid lower bound on breaks for this format, whatever the other constraints.
    const theory = optimising && this.options.theoryShortcut !== false ? breakBound(season) : null;
    if (this.options.warmStart !== false) {
      const hint = this.options.incumbent?.schedule ?? canonicalSchedule(season);
      this.enc.warmStart(hint, (lit) => this.solver.setPhase(lit));
      for (const v of this.enc.primaryVars()) this.solver.prioritise(v);
    }
    this.publishStats(this.solver.snapshot());

    let best: Schedule;
    let breaks: number;
    if (this.options.incumbent && optimising) {
      best = this.options.incumbent.schedule;
      breaks = this.options.incumbent.breaks;
    } else {
      this.phase = 'searching';
      const result = await this.solve(this.solver, selectors, this.deadline);
      if (result === 'unknown') {
        this.log('timeout', 'No answer within the time limit.');
        return { ...this.base(), status: 'timeout', schedule: null, breaks: null, optimising };
      }
      if (result === 'unsat') return this.explain(selectors);
      best = this.enc.decode((lit) => this.solver.litValue(lit));
      breaks = countBreaks(best, this.setup.teams.length);
      this.emit({ type: 'solution', schedule: best, breaks, elapsedMs: this.elapsed() });
      this.log('found', `Found a schedule with ${plural(breaks, 'break')}.`);
      if (!optimising) return { ...this.base(), status: 'feasible', schedule: best, breaks };
    }

    // Bound tightening: ask for at most B − 1 breaks until that is impossible.
    while (breaks > 0) {
      const lit = this.enc.breaksAtMost(breaks - 1);
      if (lit === null) break;
      this.bound = breaks - 1;
      const atTheory = theory !== null && breaks <= theory.value;
      this.phase = atTheory ? 'proving' : 'improving';
      // At the theoretical bound the incumbent is already optimal; give the solver's own
      // proof a short budget so a hard proof cannot hold the answer back.
      const deadline = atTheory
        ? Math.min(this.deadline, this.now() + (this.options.theoryProofMs ?? 4_000))
        : this.deadline;
      const result = await this.solve(this.solver, [...selectors, lit], deadline);
      if (result === 'sat') {
        best = this.enc.decode((l) => this.solver.litValue(l));
        breaks = countBreaks(best, this.setup.teams.length);
        this.emit({ type: 'solution', schedule: best, breaks, elapsedMs: this.elapsed() });
        this.log('improved', `Improved to ${plural(breaks, 'break')}.`);
        continue;
      }
      this.bound = null;
      if (result === 'unsat') {
        this.lastUnsat = this.solver.core.slice();
        this.log(
          'optimal',
          `At most ${breaks - 1} is impossible: ${plural(breaks, 'break')} is optimal.`,
        );
        return { ...this.base(), status: 'optimal', proof: 'solver', schedule: best, breaks };
      }
      if (atTheory && theory !== null) {
        this.log(
          'optimal',
          `${plural(breaks, 'break')} equals the theoretical minimum (${theory.source}).`,
        );
        return { ...this.base(), status: 'optimal', proof: 'theory', schedule: best, breaks };
      }
      this.log('timeout', `Stopped while testing at most ${breaks - 1} breaks.`);
      return { ...this.base(), status: 'timeout', schedule: best, breaks, optimising: true };
    }
    this.bound = null;
    this.log('optimal', 'No breaks at all: optimal.');
    return { ...this.base(), status: 'optimal', proof: 'trivial', schedule: best, breaks };
  }

  // ---------------------------------------------------------------------------------------
  // Explaining infeasibility
  // ---------------------------------------------------------------------------------------

  private async explain(selectors: number[]): Promise<Outcome> {
    this.phase = 'explaining';
    const idOf = new Map<number, string>();
    for (const [id, lit] of this.enc.selectors) idOf.set(lit, id);
    const order = new Map(selectors.map((s, i) => [s, i]));
    const byOrder = (a: number, b: number) => (order.get(a) ?? 0) - (order.get(b) ?? 0);

    const minMs = this.options.explainMinMs ?? 6_000;
    const deadline = Math.max(this.deadline, this.now() + minMs);
    let core = this.solver.core.filter((l) => idOf.has(l)).sort(byOrder);
    this.lastUnsat = core.slice();
    this.log(
      'unsat',
      `No schedule exists. Core of ${core.length} constraint${core.length === 1 ? '' : 's'}.`,
    );

    // Deletion-based MUS extraction with clause-set refinement.
    const necessary: number[] = [];
    let minimal = true;
    for (;;) {
      const candidate = core.find((l) => !necessary.includes(l));
      if (candidate === undefined) break;
      const rest = core.filter((l) => l !== candidate);
      const result = await this.solve(this.solver, rest, deadline);
      if (result === 'unsat') {
        const refined = new Set(this.solver.core);
        core = rest.filter((l) => refined.has(l));
        this.lastUnsat = core.slice();
        this.log('shrink', `Still impossible without one rule: ${core.length} left to check.`);
      } else {
        if (result === 'unknown') minimal = false;
        necessary.push(candidate);
      }
    }
    const constraintIds = core.sort(byOrder).map((l) => idOf.get(l) as string);
    const structural = await this.structuralRules(constraintIds, deadline);
    if (structural.known) {
      this.log('rules', `Rules involved: ${structural.groups.join(', ') || 'none'}.`);
    }
    return {
      ...this.base(),
      status: 'unsat',
      conflict: {
        constraintIds,
        minimal,
        structural: structural.groups,
        structuralKnown: structural.known,
      },
    };
  }

  /** Finds a minimal set of structural rules that, with the given constraints, is UNSAT. */
  private async structuralRules(
    constraintIds: string[],
    deadline: number,
  ): Promise<{ groups: StructuralGroup[]; known: boolean }> {
    const keep = new Set(constraintIds);
    const reduced: Setup = {
      ...this.setup,
      constraints: this.setup.constraints.map((c) => ({ ...c, enabled: keep.has(c.id) })),
    };
    const solver = new Solver();
    const enc = new LeagueEncoding(solver, reduced, { structuralSelectors: true });
    const user = [...enc.selectors.values()];
    const groupOf = new Map<number, StructuralGroup>();
    for (const [g, lit] of enc.structural) groupOf.set(lit, g);
    let groups = [...enc.structural.values()];
    const budget = Math.min(deadline, this.now() + 4_000);

    const first = await this.solve(solver, [...user, ...groups], budget);
    if (first !== 'unsat') return { groups: [], known: false };
    const firstCore = new Set(solver.core);
    groups = groups.filter((g) => firstCore.has(g));
    const necessary: number[] = [];
    for (;;) {
      const candidate = groups.find((g) => !necessary.includes(g));
      if (candidate === undefined) break;
      const rest = groups.filter((g) => g !== candidate);
      const result = await this.solve(solver, [...user, ...rest], budget);
      if (result === 'unsat') {
        const refined = new Set(solver.core);
        groups = rest.filter((g) => refined.has(g));
      } else if (result === 'sat') {
        necessary.push(candidate);
      } else {
        return { groups: [], known: false };
      }
    }
    return { groups: groups.map((g) => groupOf.get(g) as StructuralGroup), known: true };
  }

  // ---------------------------------------------------------------------------------------
  // Certification
  // ---------------------------------------------------------------------------------------

  /**
   * Re-derives the last decisive UNSAT step (optimality bound or conflict core) with the
   * independent RUP checker. The target clause is the negation of that step's core.
   */
  certify(budgetMs = 4_000): Certificate {
    const proof = this.solver?.proof;
    if (!proof || this.lastUnsat === null) {
      return { verified: null, lemmas: 0, ms: 0, note: 'Nothing to certify.' };
    }
    if (proof.truncated) {
      return {
        verified: null,
        lemmas: proof.lemmas,
        ms: 0,
        note: 'The proof is too large to keep in memory.',
      };
    }
    this.phase = 'certifying';
    const t0 = this.now();
    const report = checkRup(
      proof,
      this.lastUnsat.map((l) => -l),
      { deadline: t0 + budgetMs, now: this.now },
    );
    const ms = this.now() - t0;
    if (report.timedOut) {
      return {
        verified: null,
        lemmas: proof.lemmas,
        ms,
        note: `Checking ${proof.lemmas.toLocaleString('en')} lemmas would take longer than ${Math.round(budgetMs / 1000)} s.`,
      };
    }
    return {
      verified: report.ok,
      lemmas: proof.lemmas,
      ms,
      note: report.ok
        ? `${proof.lemmas.toLocaleString('en')} learnt clauses re-derived by unit propagation.`
        : `Lemma ${report.failedAt} failed the check.`,
    };
  }

  get statsSnapshot(): SolverStats | null {
    return this.lastStats;
  }
}

function plural(k: number, word: string): string {
  return `${k} ${word}${k === 1 ? '' : 's'}`;
}

/** Breaks in a schedule: consecutive rounds at the same venue (a bye resets the run). */
export function countBreaks(schedule: Schedule, n: number): number {
  const last = new Array<number>(n).fill(0); // 1 home, -1 away, 0 resting / start
  let breaks = 0;
  for (const round of schedule.rounds) {
    const now = new Array<number>(n).fill(0);
    for (const m of round.matches) {
      now[m.home] = 1;
      now[m.away] = -1;
    }
    for (let t = 0; t < n; t++) {
      if (now[t] !== 0 && now[t] === last[t]) breaks++;
      last[t] = now[t];
    }
  }
  return breaks;
}

export async function runEngine(setup: Setup, options: EngineOptions = {}): Promise<Outcome> {
  return new Engine(setup, options).run();
}

/** Convenience for tests and scripts: the season's shape for a setup. */
export { seasonOf };
