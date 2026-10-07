/**
 * A constructive starting point for the solver.
 *
 * de Werra's canonical schedule has the fewest breaks possible for its format, and so does
 * every schedule obtained from it by relabelling the clubs, swapping all venues or reversing
 * the round order. Rotating the rounds keeps it a valid round-robin (breaks may change).
 * A short local search over these transformations, scored by the independent validator
 * (violated rules first, then breaks), often satisfies every club-specific rule outright —
 * and the solver, warm-started from it, then begins near the theoretical minimum.
 */
import type { Season } from '../model/season';
import type { Schedule, Setup } from '../model/types';
import { validateSchedule } from '../validate/validate';

interface Transform {
  /** label[c]: the club that plays canonical club c's fixtures. */
  label: number[];
  swap: boolean;
  reverse: boolean;
  /** Cyclic shift of the rounds within each leg. */
  rotate: number;
}

function apply(base: Schedule, season: Season, t: Transform): Schedule {
  const R = season.R;
  const legs = season.legs;
  const order: number[] = [];
  for (let leg = 0; leg < legs; leg++) {
    for (let r = 0; r < R; r++) order.push(leg * R + ((r + t.rotate) % R));
  }
  if (t.reverse) order.reverse();
  return {
    rounds: order.map((src) => {
      const round = base.rounds[src];
      return {
        matches: round.matches.map((m) => {
          const home = t.label[m.home];
          const away = t.label[m.away];
          return t.swap ? { home: away, away: home } : { home, away };
        }),
        bye: round.bye === null ? null : t.label[round.bye],
      };
    }),
  };
}

export interface Seed {
  schedule: Schedule;
  violated: number;
  breaks: number;
}

/** Deterministic: the same setup always gives the same seed. */
export function seedSchedule(
  setup: Setup,
  season: Season,
  base: Schedule,
  options: { budgetMs?: number; now?: () => number; random: () => number },
): Seed {
  const now = options.now ?? (() => performance.now());
  const deadline = now() + (options.budgetMs ?? 150);
  const n = season.n;
  const score = (t: Transform): Seed => {
    const schedule = apply(base, season, t);
    const v = validateSchedule(setup, schedule);
    return { schedule, violated: v.constraints.filter((c) => !c.ok).length, breaks: v.totalBreaks };
  };
  const better = (a: Seed, b: Seed) =>
    a.violated < b.violated || (a.violated === b.violated && a.breaks < b.breaks);
  const notWorse = (a: Seed, b: Seed) => !better(b, a);

  let cur: Transform = {
    label: Array.from({ length: n }, (_, i) => i),
    swap: false,
    reverse: false,
    rotate: 0,
  };
  let curScore = score(cur);
  let best = curScore;
  const rand = options.random;
  let iterations = 0;
  let sinceBest = 0;
  // Stop on success, after a stall, or at the time cap (a safety net; normally the
  // iteration limits end the search, which keeps it deterministic).
  while (best.violated > 0 && sinceBest < 400 && iterations < 6_000) {
    if ((iterations & 31) === 0 && now() > deadline) break;
    iterations++;
    sinceBest++;
    const next: Transform = { ...cur, label: cur.label.slice() };
    const move = rand();
    if (move < 0.82 && n >= 2) {
      const i = Math.floor(rand() * n);
      let j = Math.floor(rand() * n);
      if (j === i) j = (j + 1) % n;
      [next.label[i], next.label[j]] = [next.label[j], next.label[i]];
    } else if (move < 0.88) {
      next.swap = !next.swap;
    } else if (move < 0.94) {
      next.reverse = !next.reverse;
    } else {
      next.rotate = Math.floor(rand() * season.R);
    }
    const s = score(next);
    // Accept sideways moves too, so the search can cross plateaus of equal score.
    if (notWorse(s, curScore)) {
      cur = next;
      curScore = s;
      if (better(s, best)) {
        best = s;
        sinceBest = 0;
      }
    }
  }
  return best;
}
