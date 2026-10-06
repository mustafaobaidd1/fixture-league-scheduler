/**
 * CNF encoding of a round-robin season with user constraints.
 *
 * Variables
 *   m(p, r)  pair p = {i, j} meets in round r (pairs with the dummy team are byes)
 *   h(t, r)  team t plays at home in round r
 *   y(i,j,r) i hosts j in round r (free double round-robin only)
 *   b(t, q)  team t has a break at the transition from round q−1 to round q
 * A mirrored second half reuses the first half's variables: m(p, r+R) = m(p, r) and
 * h(t, r+R) = ¬h(t, r), so mirroring costs no clauses at all.
 *
 * Structural rules (each a group, optionally guarded by a selector for explanations)
 *   onePerRound     a team plays at most one match per round
 *   playEveryRound  a team plays (or has the bye) in every round
 *   pairsMeet       every pair meets once per leg / every team hosts every other team once
 *   oneHome         a match has exactly one home team: m → h_i ⊕ h_j
 *   mirror          (only when explaining) the second half mirrors the first
 *
 * Every user constraint gets a selector literal s; its clauses are (¬s ∨ …). Solving
 * under the assumptions {s₁, …, s_k} switches them on; a failed solve returns the subset of
 * selectors that cannot hold together.
 */
import type { ClauseSink } from '../solver/cdcl';
import {
  atLeastOne,
  atMostKSequential,
  atMostOne,
  exactlyK,
  exactlyOne,
  Totalizer,
} from '../solver/encodings';
import { roundIndex, seasonOf, type Season } from '../model/season';
import type { Constraint, Schedule, Setup } from '../model/types';

export type StructuralGroup = 'onePerRound' | 'playEveryRound' | 'pairsMeet' | 'oneHome' | 'mirror';

export interface EncodeOptions {
  /** Guard each structural rule with its own selector (used to name the rules in a conflict). */
  structuralSelectors?: boolean;
  /** Add symmetry-breaking clauses where they are provably valid (default true). */
  symmetryBreaking?: boolean;
  /** At-most-one groups up to this size are pairwise; larger ones use the ladder encoding. */
  pairwiseUpTo?: number;
}

export interface SymmetryInfo {
  /** Teams not mentioned by any active constraint (they are interchangeable). */
  interchangeable: number[];
  /** Every active constraint is unchanged when all venues are swapped. */
  venueSwapInvariant: boolean;
  /** Which symmetry-breaking scheme was applied. */
  applied: 'none' | 'opponent-order' | 'first-round' | 'lex-rows';
  venueFixed: boolean;
}

export class LeagueEncoding {
  readonly season: Season;
  readonly teamIndex = new Map<string, number>();
  /** Constraint id → selector literal (only for enabled constraints that need one). */
  readonly selectors = new Map<string, number>();
  readonly structural = new Map<StructuralGroup, number>();
  readonly minimiseBreaks: boolean;
  readonly symmetry: SymmetryInfo;
  /** Break literals for the objective; a mirrored second half repeats the first half's. */
  readonly breakLits: number[] = [];
  readonly teamBreakLits: number[][] = [];

  private readonly N: number;
  private readonly T: number;
  /** Rounds that own variables (the first leg when the mirror is shared). */
  private readonly baseT: number;
  private readonly sharedMirror: boolean;
  private readonly mVars: Int32Array;
  private readonly hVars: Int32Array;
  /** Free double round-robin: y(i, j, r) "i hosts j in round r" at ((i·n + j)·T + r). */
  private yVars: Int32Array | null = null;
  private readonly pairwiseUpTo: number;
  private totalizer: Totalizer | null = null;
  private breaksBuilt = false;

  constructor(
    private readonly sink: ClauseSink,
    setup: Setup,
    options: EncodeOptions = {},
  ) {
    const s = seasonOf(setup);
    this.season = s;
    this.N = s.N;
    this.T = s.T;
    setup.teams.forEach((t, i) => this.teamIndex.set(t.id, i));
    this.pairwiseUpTo = options.pairwiseUpTo ?? 8;
    const explain = options.structuralSelectors === true;
    this.sharedMirror = s.mirrored && !explain;
    this.baseT = this.sharedMirror ? s.R : s.T;

    if (explain) {
      const groups: StructuralGroup[] = ['onePerRound', 'playEveryRound', 'pairsMeet', 'oneHome'];
      if (s.mirrored) groups.push('mirror');
      for (const g of groups) this.structural.set(g, sink.newVar());
    }

    const pairs = (this.N * (this.N - 1)) / 2;
    this.mVars = new Int32Array(pairs * this.baseT);
    for (let i = 0; i < this.mVars.length; i++) this.mVars[i] = sink.newVar();
    this.hVars = new Int32Array(s.n * this.baseT);
    for (let i = 0; i < this.hVars.length; i++) this.hVars[i] = sink.newVar();

    const active = setup.constraints.filter((c) => c.enabled);
    this.minimiseBreaks = active.some((c) => c.kind === 'minBreaks');

    this.encodeStructure();
    if (this.minimiseBreaks || active.some((c) => c.kind === 'breakCap')) this.buildBreaks();
    for (const c of active) this.encodeConstraint(c);

    this.symmetry = this.analyseSymmetry(active);
    if (options.symmetryBreaking !== false && !explain) this.breakSymmetry();
  }

  // ---------------------------------------------------------------------------------------
  // Literal lookups
  // ---------------------------------------------------------------------------------------

  pair(i: number, j: number): number {
    if (i === j) throw new RangeError('A team cannot meet itself');
    const a = Math.min(i, j);
    const b = Math.max(i, j);
    return a * this.N - (a * (a + 1)) / 2 + (b - a - 1);
  }

  /** Literal: pair p meets in round r. */
  m(p: number, r: number): number {
    if (r >= this.baseT) return this.mVars[p * this.baseT + r - this.season.R];
    return this.mVars[p * this.baseT + r];
  }

  /** Literal: team t (real) plays at home in round r. */
  h(t: number, r: number): number {
    if (r >= this.baseT) return -this.hVars[t * this.baseT + r - this.season.R];
    return this.hVars[t * this.baseT + r];
  }

  /** Literal: team t has the bye in round r, or 0 with an even number of teams. */
  bye(t: number, r: number): number {
    return this.season.dummy < 0 ? 0 : this.m(this.pair(t, this.season.dummy), r);
  }

  /** A disjunction that is true exactly when team t is NOT at home in round r. */
  notHome(t: number, r: number): number[] {
    const b = this.bye(t, r);
    return b === 0 ? [-this.h(t, r)] : [-this.h(t, r), b];
  }

  /** A disjunction that is true exactly when team t is NOT away in round r. */
  notAway(t: number, r: number): number[] {
    const b = this.bye(t, r);
    return b === 0 ? [this.h(t, r)] : [this.h(t, r), b];
  }

  // ---------------------------------------------------------------------------------------
  // Structure
  // ---------------------------------------------------------------------------------------

  private encodeStructure(): void {
    const s = this.season;
    const N = this.N;
    const sink = this.sink;
    const g = (name: StructuralGroup) => this.structural.get(name);

    // Each team (the dummy included) plays exactly once in every round with own variables.
    for (let r = 0; r < this.baseT; r++) {
      for (let t = 0; t < N; t++) {
        const lits: number[] = [];
        for (let j = 0; j < N; j++) if (j !== t) lits.push(this.m(this.pair(t, j), r));
        atMostOne(sink, lits, g('onePerRound'), this.pairwiseUpTo);
        atLeastOne(sink, lits, g('playEveryRound'));
      }
    }

    // A real match has one home team and one away team.
    for (let r = 0; r < this.baseT; r++) {
      for (let i = 0; i < s.n; i++) {
        for (let j = i + 1; j < s.n; j++) {
          const m = this.m(this.pair(i, j), r);
          this.guarded([-m, this.h(i, r), this.h(j, r)], g('oneHome'));
          this.guarded([-m, -this.h(i, r), -this.h(j, r)], g('oneHome'));
        }
      }
    }

    // Byes carry no venue: fix h = false so models are canonical. (With a shared mirror the
    // second half's h is ¬h of the first, which is why this only covers rounds with own vars.)
    if (s.dummy >= 0) {
      const ownRounds = s.mirrored ? s.R : s.T;
      for (let r = 0; r < ownRounds; r++) {
        for (let t = 0; t < s.n; t++) sink.addClause([-this.bye(t, r), -this.h(t, r)]);
      }
    }

    // Pairs meet the right number of times.
    const pm = g('pairsMeet');
    if (s.legs === 1 || s.mirrored) {
      const legsWithVars = this.sharedMirror || s.legs === 1 ? 1 : 2;
      for (let leg = 0; leg < legsWithVars; leg++) {
        for (let i = 0; i < N; i++) {
          for (let j = i + 1; j < N; j++) {
            const lits: number[] = [];
            for (let r = 0; r < s.R; r++) lits.push(this.m(this.pair(i, j), leg * s.R + r));
            exactlyOne(sink, lits, pm, this.pairwiseUpTo);
          }
        }
      }
    } else {
      // Free double round-robin: every team hosts every other team exactly once.
      this.yVars = new Int32Array(s.n * s.n * s.T);
      for (let i = 0; i < s.n; i++) {
        for (let j = 0; j < s.n; j++) {
          if (i === j) continue;
          const ys: number[] = [];
          for (let r = 0; r < s.T; r++) {
            const y = sink.newVar();
            const m = this.m(this.pair(i, j), r);
            const hi = this.h(i, r);
            sink.addClause([-y, m]);
            sink.addClause([-y, hi]);
            sink.addClause([y, -m, -hi]);
            this.yVars[(i * s.n + j) * s.T + r] = y;
            ys.push(y);
          }
          exactlyOne(sink, ys, pm, this.pairwiseUpTo);
        }
      }
      // And every team has exactly one bye per leg's worth of rounds (two in total).
      if (s.dummy >= 0) {
        for (let t = 0; t < s.n; t++) {
          const lits: number[] = [];
          for (let r = 0; r < s.T; r++) lits.push(this.bye(t, r));
          exactlyK(sink, lits, 2, pm);
        }
      }
    }

    // Explaining a mirrored season: the second half has its own variables, tied by clauses.
    const mirror = g('mirror');
    if (s.mirrored && !this.sharedMirror) {
      for (let r = 0; r < s.R; r++) {
        for (let p = 0; p < (N * (N - 1)) / 2; p++) {
          const a = this.mVars[p * this.baseT + r];
          const b = this.mVars[p * this.baseT + r + s.R];
          this.guarded([-a, b], mirror);
          this.guarded([a, -b], mirror);
        }
        for (let t = 0; t < s.n; t++) {
          const a = this.hVars[t * this.baseT + r];
          const b = this.hVars[t * this.baseT + r + s.R];
          // Swapped venues, except in bye rounds where h is meaningless.
          const bye = this.bye(t, r);
          this.guarded(bye === 0 ? [a, b] : [a, b, bye], mirror);
          this.guarded(bye === 0 ? [-a, -b] : [-a, -b, bye], mirror);
        }
      }
    }
  }

  private guarded(lits: number[], guard: number | undefined): void {
    if (guard !== undefined) lits.push(-guard);
    this.sink.addClause(lits);
  }

  // ---------------------------------------------------------------------------------------
  // Breaks
  // ---------------------------------------------------------------------------------------

  private buildBreaks(): void {
    if (this.breaksBuilt) return;
    this.breaksBuilt = true;
    const s = this.season;
    for (let t = 0; t < s.n; t++) {
      const list: number[] = [];
      const own: number[] = [];
      for (let q = 1; q < this.T; q++) {
        if (this.sharedMirror && q > s.R) {
          list.push(own[q - s.R - 1]);
          continue;
        }
        const b = this.sink.newVar();
        // Same venue in rounds q−1 and q (and playing in both) forces a break.
        this.sink.addClause([...this.notHome(t, q - 1), ...this.notHome(t, q), b]);
        this.sink.addClause([...this.notAway(t, q - 1), ...this.notAway(t, q), b]);
        own.push(b);
        list.push(b);
      }
      this.teamBreakLits.push(list);
      this.breakLits.push(...list);
    }
  }

  /**
   * The literal to assume for "at most k breaks in total", or null when k is vacuous.
   * Builds (or enlarges) the totalizer on demand; new clauses go straight to the sink.
   */
  breaksAtMost(k: number): number | null {
    this.buildBreaks();
    if (k >= this.breakLits.length) return null;
    const need = Math.min(k + 1, this.breakLits.length);
    if (this.totalizer === null || this.totalizer.outputs.length < need) {
      // Leave headroom so a few looser bounds do not force a rebuild.
      const cap = Math.min(this.breakLits.length, Math.max(need, Math.ceil(need * 1.25) + 2));
      this.totalizer = new Totalizer(this.sink, this.breakLits, cap);
    }
    return this.totalizer.atMost(k);
  }

  // ---------------------------------------------------------------------------------------
  // User constraints
  // ---------------------------------------------------------------------------------------

  private team(id: string): number {
    const t = this.teamIndex.get(id);
    if (t === undefined) throw new Error(`Unknown team ${id}`);
    return t;
  }

  private encodeConstraint(c: Constraint): void {
    if (c.kind === 'minBreaks') return; // the objective, not a constraint
    const sel = this.sink.newVar();
    this.selectors.set(c.id, sel);
    const add = (lits: number[]) => this.sink.addClause([...lits, -sel]);
    const s = this.season;
    const all = Array.from({ length: s.n }, (_, i) => i);

    switch (c.kind) {
      case 'venue': {
        const t = this.team(c.team);
        const r = roundIndex(c.round, s);
        const b = this.bye(t, r);
        if (c.venue === 'home') {
          add([this.h(t, r)]);
          if (b !== 0) add([-b]);
        } else if (c.venue === 'away') {
          add([-this.h(t, r)]);
          if (b !== 0) add([-b]);
        } else {
          add(this.notHome(t, r));
        }
        return;
      }
      case 'unavailable': {
        const t = this.team(c.team);
        const r = roundIndex(c.round, s);
        for (let j = 0; j < s.n; j++) if (j !== t) add([-this.m(this.pair(t, j), r)]);
        return;
      }
      case 'fixed': {
        const a = this.team(c.a);
        const b = this.team(c.b);
        const r = roundIndex(c.round, s);
        add([this.m(this.pair(a, b), r)]);
        if (c.host === 'a') add([this.h(a, r)]);
        if (c.host === 'b') add([this.h(b, r)]);
        return;
      }
      case 'maxRun': {
        const teams = c.team === 'all' ? all : [this.team(c.team)];
        const k = c.max;
        for (const t of teams) {
          for (let r = 0; r + k < this.T; r++) {
            if (c.venue !== 'away') {
              const lits: number[] = [];
              for (let q = r; q <= r + k; q++) lits.push(...this.notHome(t, q));
              add(lits);
            }
            if (c.venue !== 'home') {
              const lits: number[] = [];
              for (let q = r; q <= r + k; q++) lits.push(...this.notAway(t, q));
              add(lits);
            }
          }
        }
        return;
      }
      case 'breakCap': {
        if (c.scope === 'total') {
          const lit = this.breaksAtMost(c.max);
          if (lit !== null) add([lit]);
        } else {
          for (const list of this.teamBreakLits) atMostKSequential(this.sink, list, c.max, sel);
        }
        return;
      }
      case 'sharedGround': {
        const a = this.team(c.a);
        const b = this.team(c.b);
        for (let r = 0; r < this.T; r++) add([...this.notHome(a, r), ...this.notHome(b, r)]);
        return;
      }
      case 'noEarlyMeeting': {
        const ts = c.teams.map((id) => this.team(id));
        for (let r = 0; r < Math.min(c.rounds, this.T); r++) {
          for (let x = 0; x < ts.length; x++) {
            for (let y = x + 1; y < ts.length; y++) add([-this.m(this.pair(ts[x], ts[y]), r)]);
          }
        }
        return;
      }
      case 'balancedEnds': {
        if (this.T < 2) return;
        const transitions: number[] = [];
        if (c.where !== 'end') transitions.push(1);
        if (c.where !== 'start') transitions.push(this.T - 1);
        for (const q of new Set(transitions)) {
          for (const t of all) {
            add([...this.notHome(t, q - 1), ...this.notHome(t, q)]);
            add([...this.notAway(t, q - 1), ...this.notAway(t, q)]);
          }
        }
        return;
      }
    }
  }

  // ---------------------------------------------------------------------------------------
  // Symmetry breaking
  // ---------------------------------------------------------------------------------------

  private analyseSymmetry(active: Constraint[]): SymmetryInfo {
    const referenced = new Set<number>();
    let swapInvariant = true;
    for (const c of active) {
      switch (c.kind) {
        case 'venue':
          referenced.add(this.team(c.team));
          swapInvariant = false;
          break;
        case 'unavailable':
          referenced.add(this.team(c.team));
          break;
        case 'fixed':
          referenced.add(this.team(c.a));
          referenced.add(this.team(c.b));
          if (c.host !== 'either') swapInvariant = false;
          break;
        case 'maxRun':
          if (c.team !== 'all') referenced.add(this.team(c.team));
          if (c.venue !== 'either') swapInvariant = false;
          break;
        case 'sharedGround':
          referenced.add(this.team(c.a));
          referenced.add(this.team(c.b));
          swapInvariant = false;
          break;
        case 'noEarlyMeeting':
          for (const id of c.teams) referenced.add(this.team(id));
          break;
        default:
          break; // minBreaks, breakCap and balancedEnds treat all teams and venues alike
      }
    }
    const interchangeable: number[] = [];
    for (let t = 0; t < this.season.n; t++) if (!referenced.has(t)) interchangeable.push(t);
    return {
      interchangeable,
      venueSwapInvariant: swapInvariant,
      applied: 'none',
      venueFixed: false,
    };
  }

  /**
   * Valid symmetry breaking (each scheme keeps at least one optimal schedule):
   * - all teams interchangeable, single or mirrored: relabel teams so team 0 meets team r+1
   *   in round r (with an odd count, team 0 is chosen as the team resting in the last round
   *   of the first leg);
   * - all interchangeable, free double: relabel so round 1 pairs (0,1), (2,3), …;
   * - only some interchangeable: their home/away rows are lexicographically ordered;
   * - venue swap invariant: team 0 is not at home in round 1.
   * The first three use team relabelings, the last one the global venue swap; they commute,
   * and the lexicographic rows and the venue fix are both lex-leader constraints for the same
   * variable order, so they can be combined.
   */
  private breakSymmetry(): void {
    const s = this.season;
    const sym = this.symmetry;
    const sink = this.sink;
    if (sym.interchangeable.length === s.n && s.n >= 2) {
      if (s.legs === 1 || s.mirrored) {
        for (let r = 0; r < s.R; r++) sink.addClause([this.m(this.pair(0, r + 1), r)]);
        sym.applied = 'opponent-order';
      } else {
        for (let k = 0; 2 * k + 1 < this.N; k++)
          sink.addClause([this.m(this.pair(2 * k, 2 * k + 1), 0)]);
        sym.applied = 'first-round';
      }
    } else if (sym.interchangeable.length >= 2) {
      const rows = sym.interchangeable;
      for (let k = 0; k + 1 < rows.length; k++) this.lexLeq(rows[k], rows[k + 1]);
      sym.applied = 'lex-rows';
    }
    if (sym.venueSwapInvariant) {
      sink.addClause([-this.h(0, 0)]);
      sym.venueFixed = true;
    }
  }

  /** h-row(a) ≤lex h-row(b) over the rounds that own variables (false < true). */
  private lexLeq(a: number, b: number): void {
    const sink = this.sink;
    let eq = 0; // 0 = "all previous positions equal" is trivially true at the start
    for (let r = 0; r < this.baseT; r++) {
      const x = this.h(a, r);
      const y = this.h(b, r);
      const pre = eq === 0 ? [] : [-eq];
      sink.addClause([...pre, -x, y]);
      if (r + 1 < this.baseT) {
        const next = sink.newVar();
        sink.addClause([...pre, x, y, next]);
        sink.addClause([...pre, -x, -y, next]);
        eq = next;
      }
    }
  }

  // ---------------------------------------------------------------------------------------
  // Warm start
  // ---------------------------------------------------------------------------------------

  /**
   * Points the solver's saved phases at a known schedule, so its first descent tries that
   * schedule. Purely a search hint: the clauses decide what is allowed.
   */
  /** Match and venue variables: the decisions that determine a schedule. */
  primaryVars(): number[] {
    return [...this.mVars, ...this.hVars];
  }

  warmStart(schedule: Schedule, setPhase: (lit: number) => void): void {
    const s = this.season;
    const status: number[][] = Array.from({ length: s.n }, () => new Array<number>(this.T).fill(0));
    for (let r = 0; r < this.T && r < schedule.rounds.length; r++) {
      const round = schedule.rounds[r];
      for (const m of round.matches) {
        status[m.home][r] = 1;
        status[m.away][r] = -1;
      }
      if (r >= this.baseT) continue;
      const met = new Set<number>();
      for (const m of round.matches) {
        const p = this.pair(m.home, m.away);
        met.add(p);
        setPhase(this.m(p, r));
        setPhase(this.h(m.home, r));
        setPhase(-this.h(m.away, r));
        if (this.yVars) {
          setPhase(this.yVars[(m.home * s.n + m.away) * s.T + r]);
          setPhase(-this.yVars[(m.away * s.n + m.home) * s.T + r]);
        }
      }
      if (s.dummy >= 0 && round.bye !== null) {
        const p = this.pair(round.bye, s.dummy);
        met.add(p);
        setPhase(this.m(p, r));
        setPhase(-this.h(round.bye, r));
      }
      for (let p = 0; p < (this.N * (this.N - 1)) / 2; p++)
        if (!met.has(p)) setPhase(-this.m(p, r));
    }
    for (let t = 0; t < this.teamBreakLits.length; t++) {
      const lits = this.teamBreakLits[t];
      for (let q = 1; q < this.T; q++) {
        const isBreak = status[t][q] !== 0 && status[t][q] === status[t][q - 1];
        setPhase(isBreak ? lits[q - 1] : -lits[q - 1]);
      }
    }
  }

  // ---------------------------------------------------------------------------------------
  // Decoding
  // ---------------------------------------------------------------------------------------

  /** Reads a schedule out of a model (`value(lit)` says whether a literal is true). */
  decode(value: (lit: number) => boolean): Schedule {
    const s = this.season;
    const rounds = [];
    for (let r = 0; r < this.T; r++) {
      const matches = [];
      let bye: number | null = null;
      for (let i = 0; i < s.n; i++) {
        for (let j = i + 1; j < s.n; j++) {
          if (!value(this.m(this.pair(i, j), r))) continue;
          if (value(this.h(i, r))) matches.push({ home: i, away: j });
          else matches.push({ home: j, away: i });
        }
        if (s.dummy >= 0 && value(this.bye(i, r))) bye = i;
      }
      matches.sort((x, y) => Math.min(x.home, x.away) - Math.min(y.home, y.away));
      rounds.push({ matches, bye });
    }
    return { rounds };
  }
}
