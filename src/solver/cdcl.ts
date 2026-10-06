/**
 * A conflict-driven clause-learning (CDCL) SAT solver, written from scratch.
 *
 * Techniques (with the papers they come from):
 * - two watched literals with blocker literals for unit propagation (Moskewicz et al. 2001,
 *   Chaff; blockers from Sörensson & Eén / MiniSat 2.2), plus implicit binary clauses;
 * - conflict analysis with first-UIP learning (Marques-Silva & Sakallah 1999; Zhang et al.
 *   2001) and recursive learnt-clause minimisation (Sörensson & Biere 2009);
 * - non-chronological backjumping to the second-highest level of the learnt clause;
 * - VSIDS branching (Chaff) in its exponential form (MiniSat), kept in a binary heap;
 * - phase saving (Pipatsrisawat & Darwiche 2007);
 * - Luby restarts with a unit of 100 conflicts (Luby, Sinclair & Zuckerman 1993);
 * - learnt-clause deletion ranked by literal block distance, keeping "glue" clauses
 *   (Audemard & Simon 2009, Glucose);
 * - incremental solving under assumptions, with the final conflict expressed as a subset
 *   of the assumptions (Eén & Sörensson 2003).
 *
 * Public literals are DIMACS-style signed integers over 1-based variables. Internally a
 * literal is 2·v + sign over 0-based variables, so negation is `lit ^ 1`.
 */
import { AXIOM, LEMMA, ProofLog } from '../proof/log';
import { luby } from './luby';

export type SolveResult = 'sat' | 'unsat' | 'unknown';

export interface SolverStats {
  vars: number;
  clauses: number;
  conflicts: number;
  decisions: number;
  propagations: number;
  restarts: number;
  /** Learnt clauses currently stored (long and binary). */
  learnts: number;
  /** Learnt clauses derived since the solver was created (including units). */
  learntTotal: number;
  deleted: number;
}

export interface SolveOptions {
  /** Literals assumed true for this call only. */
  assumptions?: ArrayLike<number>;
  /** Give up with 'unknown' after this many conflicts in this call. */
  conflictBudget?: number;
  /** Give up with 'unknown' once `now()` passes this time stamp (milliseconds). */
  deadline?: number;
  /** Cooperative cancellation, polled every 64 conflicts. */
  shouldStop?: () => boolean;
  /** Called with fresh statistics at most every `progressIntervalMs`. */
  onProgress?: (stats: SolverStats) => void;
  progressIntervalMs?: number;
  now?: () => number;
}

export interface ClauseSink {
  newVar(): number;
  addClause(lits: ArrayLike<number>): void;
}

const NONE = -1;
/** Conflict in an implicit binary clause; its literals are in confA / confB. */
const CONF_BIN = -2;
/** Clause header: [size, flags | lbd << 3, activity (float32)]. */
const HDR = 3;
const LEARNT = 1;
const DELETED = 2;
const RELOC = 4;

const VAR_DECAY = 0.95;
const CLA_DECAY = 0.999;
const RESTART_UNIT = 100;
const FIRST_REDUCE = 2000;
const REDUCE_INC = 300;

const toInternal = (lit: number): number => (lit > 0 ? (lit - 1) << 1 : ((-lit - 1) << 1) | 1);
const toExternal = (lit: number): number => ((lit & 1) === 1 ? -((lit >> 1) + 1) : (lit >> 1) + 1);

export class Solver implements ClauseSink {
  // ---- variables ----
  private nVars = 0;
  private cap = 0;
  /** Per internal literal: 1 true, -1 false, 0 unassigned. */
  private assigns = new Int8Array(0);
  private level = new Int32Array(0);
  /** Clause ref (>= 0), NONE, or a binary reason encoded as -2 - otherLiteral. */
  private reason = new Int32Array(0);
  private activity = new Float64Array(0);
  /** Saved phase: 1 true, -1 false, 0 never assigned (defaults to false). */
  private phase = new Int8Array(0);
  private seen = new Uint8Array(0);
  private lbdStamp = new Int32Array(0);
  private lbdCounter = 0;

  // ---- trail ----
  private trail = new Int32Array(0);
  private trailLen = 0;
  private qhead = 0;
  private trailLim = new Int32Array(0);
  private nLevels = 0;

  // ---- decision heap (max-heap on activity) ----
  private heap = new Int32Array(0);
  private heapIdx = new Int32Array(0);
  private heapSize = 0;
  private varInc = 1;

  // ---- clauses ----
  private mem = new Int32Array(1 << 16);
  private memF = new Float32Array(this.mem.buffer);
  private memTop = 0;
  private wasted = 0;
  private clauses: number[] = [];
  private learnts: number[] = [];
  private claInc = 1;
  private watches: (Int32Array | null)[] = [];
  private watchLen = new Int32Array(0);
  private bins: (Int32Array | null)[] = [];
  private binLen = new Int32Array(0);
  private binOriginal = 0;
  private binLearnt = 0;

  // ---- search state ----
  private ok = true;
  private confA = 0;
  private confB = 0;
  private learnt: number[] = [];
  private toClear: number[] = [];
  private stack: number[] = [];
  private btLevel = 0;
  private learntLbd = 0;
  private lubyIndex = 0;
  private nextReduce = FIRST_REDUCE;
  private reduceInterval = FIRST_REDUCE;
  private simpAssigns = -1;
  private modelVals = new Int8Array(0);

  /** After an 'unsat' answer under assumptions: a subset of the assumptions that cannot all hold. */
  core: number[] = [];
  readonly stats: SolverStats = {
    vars: 0,
    clauses: 0,
    conflicts: 0,
    decisions: 0,
    propagations: 0,
    restarts: 0,
    learnts: 0,
    learntTotal: 0,
    deleted: 0,
  };
  readonly proof: ProofLog | null;

  constructor(options: { proof?: boolean | ProofLog } = {}) {
    this.proof =
      options.proof instanceof ProofLog ? options.proof : options.proof ? new ProofLog() : null;
  }

  get numVars(): number {
    return this.nVars;
  }

  /** False once the clause set is unsatisfiable without any assumptions. */
  get okay(): boolean {
    return this.ok;
  }

  newVar(): number {
    if (this.nVars === this.cap) this.grow(Math.max(64, this.cap * 2));
    const v = this.nVars++;
    this.level[v] = 0;
    this.reason[v] = NONE;
    this.activity[v] = 0;
    this.phase[v] = 0;
    this.watches.push(null, null);
    this.bins.push(null, null);
    this.heapInsert(v);
    this.stats.vars = this.nVars;
    return v + 1;
  }

  /** Adds a clause at decision level 0. Returns false if the formula became unsatisfiable. */
  addClause(lits: ArrayLike<number>): boolean {
    if (this.proof) this.proof.add(AXIOM, lits);
    if (!this.ok) return false;
    const ps: number[] = [];
    for (let i = 0; i < lits.length; i++) {
      const x = lits[i];
      if (x === 0 || !Number.isInteger(x) || Math.abs(x) > this.nVars) {
        throw new RangeError(`Literal ${x} is not a declared variable`);
      }
      ps.push(toInternal(x));
    }
    ps.sort((a, b) => a - b);
    let j = 0;
    let prev = -1;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      const val = this.assigns[p];
      if (val === 1 || p === (prev ^ 1)) return true; // satisfied at level 0, or a tautology
      if (val !== -1 && p !== prev) {
        ps[j++] = p;
        prev = p;
      }
    }
    ps.length = j;
    this.stats.clauses++;
    if (j === 0) {
      this.ok = false;
      return false;
    }
    if (j === 1) {
      this.enqueue(ps[0], NONE);
      if (this.propagate() !== NONE) this.ok = false;
      return this.ok;
    }
    if (j === 2) {
      this.addBinary(ps[0], ps[1]);
      this.binOriginal++;
      return true;
    }
    const c = this.alloc(ps, false, 0);
    this.clauses.push(c);
    this.attach(c);
    return true;
  }

  /**
   * Sets the saved phase of a variable, i.e. the value it gets when the solver next branches on
   * it. Used to warm-start search from a known schedule; it never affects correctness.
   */
  setPhase(lit: number): void {
    const v = Math.abs(lit) - 1;
    if (v < 0 || v >= this.nVars) throw new RangeError(`Bad literal ${lit}`);
    this.phase[v] = lit > 0 ? 1 : -1;
  }

  /**
   * Raises a variable's branching activity so it is decided before auxiliaries. With phases
   * from a warm start, deciding the primary variables first lets propagation fill in counters
   * and other definitional variables consistently.
   */
  prioritise(v: number, amount = 1): void {
    if (v < 1 || v > this.nVars) throw new RangeError(`Bad variable ${v}`);
    this.activity[v - 1] += amount;
    if (this.heapIdx[v - 1] >= 0) this.heapUp(this.heapIdx[v - 1]);
  }

  /** The value of variable v (1-based) in the last model. */
  value(v: number): boolean {
    return this.modelVals[v - 1] === 1;
  }

  /** True if the signed literal is true in the last model. */
  litValue(lit: number): boolean {
    const val = this.modelVals[Math.abs(lit) - 1];
    return lit > 0 ? val === 1 : val === -1;
  }

  /** A copy of the last model, indexed by 0-based variable: 1 true, -1 false. */
  model(): Int8Array {
    return this.modelVals.slice();
  }

  solve(options: SolveOptions = {}): SolveResult {
    this.core = [];
    if (!this.ok) return 'unsat';
    const assumptions: number[] = [];
    const given = options.assumptions ?? [];
    for (let i = 0; i < given.length; i++) {
      const x = given[i];
      if (x === 0 || Math.abs(x) > this.nVars) throw new RangeError(`Bad assumption ${x}`);
      assumptions.push(toInternal(x));
    }
    const now = options.now ?? (() => performance.now());
    const ctx: SearchContext = {
      assumptions,
      conflictLimit:
        options.conflictBudget !== undefined
          ? this.stats.conflicts + options.conflictBudget
          : Infinity,
      deadline: options.deadline ?? Infinity,
      shouldStop: options.shouldStop,
      onProgress: options.onProgress,
      progressInterval: options.progressIntervalMs ?? 100,
      lastProgress: now(),
      now,
      stopped: false,
    };
    let status: SolveResult;
    for (;;) {
      const budget = luby(2, this.lubyIndex) * RESTART_UNIT;
      status = this.search(budget, ctx);
      if (status !== 'unknown' || ctx.stopped) break;
      this.lubyIndex++;
      this.stats.restarts++;
    }
    this.cancelUntil(0);
    options.onProgress?.(this.snapshot());
    return status;
  }

  /** Current statistics (a copy). */
  snapshot(): SolverStats {
    this.stats.learnts = this.learnts.length + this.binLearnt;
    return { ...this.stats };
  }

  // =====================================================================================
  // Search
  // =====================================================================================

  private search(nofConflicts: number, ctx: SearchContext): SolveResult {
    let conflictC = 0;
    for (;;) {
      const confl = this.propagate();
      if (confl !== NONE) {
        this.stats.conflicts++;
        conflictC++;
        if (this.nLevels === 0) {
          this.ok = false;
          if (this.proof) this.proof.add(LEMMA, []);
          return 'unsat';
        }
        this.analyze(confl);
        this.cancelUntil(this.btLevel);
        this.recordLearnt();
        this.varInc /= VAR_DECAY;
        this.claInc /= CLA_DECAY;
        if ((this.stats.conflicts & 63) === 0 && this.checkStop(ctx)) {
          this.cancelUntil(0);
          return 'unknown';
        }
      } else {
        if (conflictC >= nofConflicts || this.stats.conflicts >= ctx.conflictLimit) {
          if (this.stats.conflicts >= ctx.conflictLimit) ctx.stopped = true;
          this.cancelUntil(0);
          return 'unknown';
        }
        if (this.nLevels === 0 && this.trailLen !== this.simpAssigns) this.simplify();
        if (this.stats.conflicts >= this.nextReduce) {
          this.reduceDB();
          this.reduceInterval += REDUCE_INC;
          this.nextReduce = this.stats.conflicts + this.reduceInterval;
        }
        let next = NONE;
        while (this.nLevels < ctx.assumptions.length) {
          const p = ctx.assumptions[this.nLevels];
          const val = this.assigns[p];
          if (val === 1) {
            this.newDecisionLevel(); // already satisfied: an empty level keeps indices aligned
          } else if (val === -1) {
            this.analyzeFinal(p ^ 1);
            return 'unsat';
          } else {
            next = p;
            break;
          }
        }
        if (next === NONE) {
          next = this.pickBranchLit();
          if (next === NONE) {
            this.saveModel();
            return 'sat';
          }
          this.stats.decisions++;
          if ((this.stats.decisions & 1023) === 0 && this.checkStop(ctx)) {
            this.cancelUntil(0);
            return 'unknown';
          }
        }
        this.newDecisionLevel();
        this.enqueue(next, NONE);
      }
    }
  }

  private checkStop(ctx: SearchContext): boolean {
    const t = ctx.now();
    if (ctx.onProgress && t - ctx.lastProgress >= ctx.progressInterval) {
      ctx.lastProgress = t;
      ctx.onProgress(this.snapshot());
    }
    if (t > ctx.deadline || (ctx.shouldStop !== undefined && ctx.shouldStop())) {
      ctx.stopped = true;
      return true;
    }
    return false;
  }

  private saveModel(): void {
    if (this.modelVals.length !== this.nVars) this.modelVals = new Int8Array(this.nVars);
    for (let v = 0; v < this.nVars; v++) this.modelVals[v] = this.assigns[v << 1];
  }

  private newDecisionLevel(): void {
    this.trailLim[this.nLevels++] = this.trailLen;
  }

  private enqueue(lit: number, from: number): void {
    const v = lit >> 1;
    this.assigns[lit] = 1;
    this.assigns[lit ^ 1] = -1;
    this.level[v] = this.nLevels;
    this.reason[v] = from;
    this.trail[this.trailLen++] = lit;
  }

  private cancelUntil(lvl: number): void {
    if (this.nLevels <= lvl) return;
    const stop = this.trailLim[lvl];
    for (let c = this.trailLen - 1; c >= stop; c--) {
      const lit = this.trail[c];
      const v = lit >> 1;
      this.assigns[lit] = 0;
      this.assigns[lit ^ 1] = 0;
      this.reason[v] = NONE;
      this.phase[v] = (lit & 1) === 1 ? -1 : 1;
      if (this.heapIdx[v] < 0) this.heapInsert(v);
    }
    this.trailLen = stop;
    this.qhead = stop;
    this.nLevels = lvl;
  }

  private pickBranchLit(): number {
    while (this.heapSize > 0) {
      const v = this.heapPop();
      if (this.assigns[v << 1] === 0) return this.phase[v] === 1 ? v << 1 : (v << 1) | 1;
    }
    return NONE;
  }

  // =====================================================================================
  // Propagation (two watched literals, blockers, implicit binaries)
  // =====================================================================================

  private propagate(): number {
    const assigns = this.assigns;
    const mem = this.mem;
    let confl = NONE;
    while (this.qhead < this.trailLen) {
      const p = this.trail[this.qhead++];
      this.stats.propagations++;
      const falseLit = p ^ 1;

      // Binary clauses (¬p ∨ q): p true forces q.
      const bl = this.bins[p];
      if (bl !== null) {
        const bn = this.binLen[p];
        for (let k = 0; k < bn; k++) {
          const q = bl[k];
          const vq = assigns[q];
          if (vq === 1) continue;
          if (vq === -1) {
            confl = CONF_BIN;
            this.confA = q;
            this.confB = falseLit;
            break;
          }
          this.enqueue(q, -2 - falseLit);
        }
        if (confl !== NONE) {
          this.qhead = this.trailLen;
          break;
        }
      }

      const ws = this.watches[p];
      if (ws === null) continue;
      const n = this.watchLen[p];
      let i = 0;
      let j = 0;
      while (i < n) {
        const cr = ws[i];
        const blocker = ws[i + 1];
        if (assigns[blocker] === 1) {
          ws[j++] = cr;
          ws[j++] = blocker;
          i += 2;
          continue;
        }
        const b = cr + HDR;
        let first = mem[b];
        if (first === falseLit) {
          first = mem[b + 1];
          mem[b] = first;
          mem[b + 1] = falseLit;
        }
        i += 2;
        if (first !== blocker && assigns[first] === 1) {
          ws[j++] = cr;
          ws[j++] = first;
          continue;
        }
        const size = mem[cr];
        let moved = false;
        for (let k = 2; k < size; k++) {
          const lk = mem[b + k];
          if (assigns[lk] !== -1) {
            mem[b + 1] = lk;
            mem[b + k] = falseLit;
            this.pushWatch(lk ^ 1, cr, first);
            moved = true;
            break;
          }
        }
        if (moved) continue;
        ws[j++] = cr;
        ws[j++] = first;
        if (assigns[first] === -1) {
          confl = cr;
          this.qhead = this.trailLen;
          while (i < n) ws[j++] = ws[i++];
        } else {
          this.enqueue(first, cr);
        }
      }
      this.watchLen[p] = j;
      if (confl !== NONE) break;
    }
    return confl;
  }

  // =====================================================================================
  // Conflict analysis
  // =====================================================================================

  private analyze(conflict: number): void {
    const out = this.learnt;
    out.length = 0;
    out.push(0);
    const seen = this.seen;
    const level = this.level;
    const mem = this.mem;
    const curLevel = this.nLevels;
    let pathC = 0;
    let p = NONE;
    let index = this.trailLen - 1;
    let confl = conflict;

    do {
      if (confl >= 0) {
        if ((mem[confl + 1] & LEARNT) !== 0) this.bumpClause(confl);
        const b = confl + HDR;
        const size = mem[confl];
        for (let k = p === NONE ? 0 : 1; k < size; k++) {
          const q = mem[b + k];
          const v = q >> 1;
          if (seen[v] === 0 && level[v] > 0) {
            this.bumpVar(v);
            seen[v] = 1;
            if (level[v] >= curLevel) pathC++;
            else out.push(q);
          }
        }
      } else {
        // Binary conflict (both literals) or binary reason (the other literal only).
        const a = p === NONE ? this.confA : -2 - confl;
        const extra = p === NONE ? this.confB : NONE;
        for (let t = 0; t < 2; t++) {
          const q = t === 0 ? a : extra;
          if (q === NONE) continue;
          const v = q >> 1;
          if (seen[v] === 0 && level[v] > 0) {
            this.bumpVar(v);
            seen[v] = 1;
            if (level[v] >= curLevel) pathC++;
            else out.push(q);
          }
        }
      }
      while (seen[this.trail[index--] >> 1] === 0);
      p = this.trail[index + 1];
      confl = this.reason[p >> 1];
      seen[p >> 1] = 0;
      pathC--;
    } while (pathC > 0);
    out[0] = p ^ 1;

    // Recursive minimisation: drop literals implied by the rest of the clause.
    const toClear = this.toClear;
    toClear.length = 0;
    for (let i = 0; i < out.length; i++) toClear.push(out[i]);
    let abstract = 0;
    for (let i = 1; i < out.length; i++) abstract |= 1 << (level[out[i] >> 1] & 31);
    let j = 1;
    for (let i = 1; i < out.length; i++) {
      const v = out[i] >> 1;
      if (this.reason[v] === NONE || !this.litRedundant(out[i], abstract)) out[j++] = out[i];
    }
    out.length = j;
    for (let i = 0; i < toClear.length; i++) seen[toClear[i] >> 1] = 0;

    // Backjump level: the highest level among the other literals, moved to position 1.
    if (out.length === 1) {
      this.btLevel = 0;
    } else {
      let maxI = 1;
      for (let i = 2; i < out.length; i++) {
        if (level[out[i] >> 1] > level[out[maxI] >> 1]) maxI = i;
      }
      const tmp = out[maxI];
      out[maxI] = out[1];
      out[1] = tmp;
      this.btLevel = level[tmp >> 1];
    }
    this.learntLbd = this.computeLbd(out, out.length);
  }

  private litRedundant(p: number, abstractLevels: number): boolean {
    const stack = this.stack;
    stack.length = 0;
    stack.push(p);
    const top = this.toClear.length;
    const seen = this.seen;
    const level = this.level;
    const mem = this.mem;
    while (stack.length > 0) {
      const q = stack.pop() as number;
      const r = this.reason[q >> 1];
      let count: number;
      let base = 0;
      if (r >= 0) {
        count = mem[r] - 1;
        base = r + HDR + 1;
      } else {
        count = 1;
      }
      for (let k = 0; k < count; k++) {
        const l = r >= 0 ? mem[base + k] : -2 - r;
        const v = l >> 1;
        if (seen[v] === 0 && level[v] > 0) {
          if (this.reason[v] !== NONE && ((1 << (level[v] & 31)) & abstractLevels) !== 0) {
            seen[v] = 1;
            stack.push(l);
            this.toClear.push(l);
          } else {
            for (let t = top; t < this.toClear.length; t++) seen[this.toClear[t] >> 1] = 0;
            this.toClear.length = top;
            return false;
          }
        }
      }
    }
    return true;
  }

  private computeLbd(lits: ArrayLike<number>, n: number): number {
    const stamp = ++this.lbdCounter;
    let count = 0;
    for (let i = 0; i < n; i++) {
      const l = this.level[lits[i] >> 1];
      if (this.lbdStamp[l] !== stamp) {
        this.lbdStamp[l] = stamp;
        count++;
      }
    }
    return count;
  }

  private recordLearnt(): void {
    const out = this.learnt;
    this.stats.learntTotal++;
    if (this.proof) this.proof.add(LEMMA, out.map(toExternal));
    if (out.length === 1) {
      this.enqueue(out[0], NONE);
    } else if (out.length === 2) {
      this.addBinary(out[0], out[1]);
      this.binLearnt++;
      this.enqueue(out[0], -2 - out[1]);
    } else {
      const c = this.alloc(out, true, this.learntLbd);
      this.learnts.push(c);
      this.attach(c);
      this.bumpClause(c);
      this.enqueue(out[0], c);
    }
  }

  /** Collects the assumptions responsible for `p` (the negation of a failed assumption). */
  private analyzeFinal(p: number): void {
    const core = [toExternal(p ^ 1)];
    this.core = core;
    if (this.nLevels === 0) return;
    const seen = this.seen;
    const mem = this.mem;
    seen[p >> 1] = 1;
    for (let i = this.trailLen - 1; i >= this.trailLim[0]; i--) {
      const lit = this.trail[i];
      const x = lit >> 1;
      if (seen[x] === 0) continue;
      const r = this.reason[x];
      if (r === NONE) {
        core.push(toExternal(lit));
      } else if (r >= 0) {
        const b = r + HDR;
        const size = mem[r];
        for (let k = 1; k < size; k++) {
          const v = mem[b + k] >> 1;
          if (this.level[v] > 0) seen[v] = 1;
        }
      } else {
        const v = (-2 - r) >> 1;
        if (this.level[v] > 0) seen[v] = 1;
      }
      seen[x] = 0;
    }
    seen[p >> 1] = 0;
  }

  // =====================================================================================
  // Activities and the decision heap
  // =====================================================================================

  private bumpVar(v: number): void {
    const act = this.activity;
    if ((act[v] += this.varInc) > 1e100) {
      for (let i = 0; i < this.nVars; i++) act[i] *= 1e-100;
      this.varInc *= 1e-100;
    }
    if (this.heapIdx[v] >= 0) this.heapUp(this.heapIdx[v]);
  }

  private bumpClause(c: number): void {
    if ((this.memF[c + 2] += this.claInc) > 1e20) {
      for (const l of this.learnts) this.memF[l + 2] *= 1e-20;
      this.claInc *= 1e-20;
    }
  }

  private heapInsert(v: number): void {
    this.heapIdx[v] = this.heapSize;
    this.heap[this.heapSize++] = v;
    this.heapUp(this.heapSize - 1);
  }

  private heapPop(): number {
    const heap = this.heap;
    const top = heap[0];
    const last = heap[--this.heapSize];
    this.heapIdx[top] = -1;
    if (this.heapSize > 0) {
      heap[0] = last;
      this.heapIdx[last] = 0;
      this.heapDown(0);
    }
    return top;
  }

  private heapUp(i: number): void {
    const heap = this.heap;
    const act = this.activity;
    const v = heap[i];
    const a = act[v];
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const pv = heap[parent];
      if (act[pv] >= a) break;
      heap[i] = pv;
      this.heapIdx[pv] = i;
      i = parent;
    }
    heap[i] = v;
    this.heapIdx[v] = i;
  }

  private heapDown(i: number): void {
    const heap = this.heap;
    const act = this.activity;
    const n = this.heapSize;
    const v = heap[i];
    const a = act[v];
    for (;;) {
      let child = 2 * i + 1;
      if (child >= n) break;
      if (child + 1 < n && act[heap[child + 1]] > act[heap[child]]) child++;
      if (act[heap[child]] <= a) break;
      heap[i] = heap[child];
      this.heapIdx[heap[i]] = i;
      i = child;
    }
    heap[i] = v;
    this.heapIdx[v] = i;
  }

  // =====================================================================================
  // Clause storage
  // =====================================================================================

  private alloc(lits: ArrayLike<number>, learnt: boolean, lbd: number): number {
    const size = lits.length;
    const need = this.memTop + HDR + size;
    if (need > this.mem.length) {
      let cap = this.mem.length;
      while (cap < need) cap *= 2;
      const next = new Int32Array(cap);
      next.set(this.mem.subarray(0, this.memTop));
      this.mem = next;
      this.memF = new Float32Array(next.buffer);
    }
    const c = this.memTop;
    this.mem[c] = size;
    this.mem[c + 1] = (learnt ? LEARNT : 0) | (lbd << 3);
    this.memF[c + 2] = 0;
    for (let i = 0; i < size; i++) this.mem[c + HDR + i] = lits[i];
    this.memTop = need;
    return c;
  }

  private attach(c: number): void {
    const w0 = this.mem[c + HDR];
    const w1 = this.mem[c + HDR + 1];
    this.pushWatch(w0 ^ 1, c, w1);
    this.pushWatch(w1 ^ 1, c, w0);
  }

  private pushWatch(lit: number, cr: number, blocker: number): void {
    let arr = this.watches[lit];
    const len = this.watchLen[lit];
    if (arr === null) {
      arr = new Int32Array(8);
      this.watches[lit] = arr;
    } else if (len + 2 > arr.length) {
      const next = new Int32Array(arr.length * 2);
      next.set(arr);
      this.watches[lit] = next;
      arr = next;
    }
    arr[len] = cr;
    arr[len + 1] = blocker;
    this.watchLen[lit] = len + 2;
  }

  private addBinary(a: number, b: number): void {
    this.pushBin(a ^ 1, b);
    this.pushBin(b ^ 1, a);
  }

  private pushBin(lit: number, implied: number): void {
    let arr = this.bins[lit];
    const len = this.binLen[lit];
    if (arr === null) {
      arr = new Int32Array(4);
      this.bins[lit] = arr;
    } else if (len === arr.length) {
      const next = new Int32Array(arr.length * 2);
      next.set(arr);
      this.bins[lit] = next;
      arr = next;
    }
    arr[len] = implied;
    this.binLen[lit] = len + 1;
  }

  private locked(c: number): boolean {
    const first = this.mem[c + HDR];
    return this.assigns[first] === 1 && this.reason[first >> 1] === c;
  }

  private removeClause(c: number): void {
    this.mem[c + 1] |= DELETED;
    this.wasted += HDR + this.mem[c];
    this.stats.deleted++;
  }

  /** Halves the learnt clause database, keeping glue clauses (LBD ≤ 2) and reasons. */
  private reduceDB(): void {
    const mem = this.mem;
    const memF = this.memF;
    const ls = this.learnts;
    ls.sort((a, b) => {
      const la = mem[a + 1] >>> 3;
      const lb = mem[b + 1] >>> 3;
      if (la !== lb) return lb - la;
      return memF[a + 2] - memF[b + 2];
    });
    const limit = ls.length >> 1;
    let j = 0;
    for (let i = 0; i < ls.length; i++) {
      const c = ls[i];
      if (i < limit && mem[c + 1] >>> 3 > 2 && !this.locked(c)) this.removeClause(c);
      else ls[j++] = c;
    }
    ls.length = j;
    this.purgeWatches();
    if (this.wasted > this.memTop / 4) this.collectGarbage();
  }

  /** At level 0: deletes clauses satisfied by permanent assignments. */
  private simplify(): void {
    if (this.propagate() !== NONE) {
      this.ok = false;
      return;
    }
    const mem = this.mem;
    const sweep = (list: number[]): void => {
      let j = 0;
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        let sat = false;
        const size = mem[c];
        for (let k = 0; k < size; k++) {
          if (this.assigns[mem[c + HDR + k]] === 1) {
            sat = true;
            break;
          }
        }
        if (sat && !this.locked(c)) this.removeClause(c);
        else list[j++] = c;
      }
      list.length = j;
    };
    sweep(this.learnts);
    sweep(this.clauses);
    this.purgeWatches();
    if (this.wasted > this.memTop / 4) this.collectGarbage();
    this.simpAssigns = this.trailLen;
  }

  private purgeWatches(): void {
    const mem = this.mem;
    for (let lit = 0; lit < 2 * this.nVars; lit++) {
      const ws = this.watches[lit];
      if (ws === null) continue;
      const n = this.watchLen[lit];
      let j = 0;
      for (let i = 0; i < n; i += 2) {
        if ((mem[ws[i] + 1] & DELETED) === 0) {
          ws[j++] = ws[i];
          ws[j++] = ws[i + 1];
        }
      }
      this.watchLen[lit] = j;
    }
  }

  /** Compacts the clause arena, leaving forwarding pointers to remap references. */
  private collectGarbage(): void {
    const old = this.mem;
    const oldF = this.memF;
    const live = this.memTop - this.wasted;
    let cap = 1 << 16;
    while (cap < live * 1.5) cap *= 2;
    const mem = new Int32Array(cap);
    const memF = new Float32Array(mem.buffer);
    let top = 0;
    const move = (c: number): number => {
      if ((old[c + 1] & RELOC) !== 0) return old[c + 2];
      const size = old[c];
      mem[top] = size;
      mem[top + 1] = old[c + 1];
      memF[top + 2] = oldF[c + 2];
      for (let k = 0; k < size; k++) mem[top + HDR + k] = old[c + HDR + k];
      old[c + 1] |= RELOC;
      old[c + 2] = top;
      const moved = top;
      top += HDR + size;
      return moved;
    };
    for (let i = 0; i < this.clauses.length; i++) this.clauses[i] = move(this.clauses[i]);
    for (let i = 0; i < this.learnts.length; i++) this.learnts[i] = move(this.learnts[i]);
    for (let i = 0; i < this.trailLen; i++) {
      const v = this.trail[i] >> 1;
      const r = this.reason[v];
      if (r >= 0) this.reason[v] = (old[r + 1] & RELOC) !== 0 ? old[r + 2] : NONE;
    }
    for (let lit = 0; lit < 2 * this.nVars; lit++) {
      const ws = this.watches[lit];
      if (ws === null) continue;
      const n = this.watchLen[lit];
      for (let i = 0; i < n; i += 2) ws[i] = old[ws[i] + 2];
    }
    this.mem = mem;
    this.memF = memF;
    this.memTop = top;
    this.wasted = 0;
  }

  private grow(cap: number): void {
    const growI8 = (a: Int8Array, n: number) => {
      const b = new Int8Array(n);
      b.set(a);
      return b;
    };
    const growI32 = (a: Int32Array, n: number) => {
      const b = new Int32Array(n);
      b.set(a);
      return b;
    };
    this.assigns = growI8(this.assigns, 2 * cap);
    this.level = growI32(this.level, cap);
    this.reason = growI32(this.reason, cap);
    const act = new Float64Array(cap);
    act.set(this.activity);
    this.activity = act;
    this.phase = growI8(this.phase, cap);
    const seen = new Uint8Array(cap);
    seen.set(this.seen);
    this.seen = seen;
    this.lbdStamp = growI32(this.lbdStamp, cap + 1);
    this.trail = growI32(this.trail, cap);
    this.trailLim = growI32(this.trailLim, cap + 1);
    this.heap = growI32(this.heap, cap);
    this.heapIdx = growI32(this.heapIdx, cap);
    this.watchLen = growI32(this.watchLen, 2 * cap);
    this.binLen = growI32(this.binLen, 2 * cap);
    this.cap = cap;
  }
}

interface SearchContext {
  assumptions: number[];
  conflictLimit: number;
  deadline: number;
  shouldStop?: () => boolean;
  onProgress?: (stats: SolverStats) => void;
  progressInterval: number;
  lastProgress: number;
  now: () => number;
  stopped: boolean;
}
