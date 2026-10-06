/**
 * Exhaustive enumeration of every valid schedule for tiny leagues (test-only).
 *
 * Rounds are perfect matchings of K_N (N = n, or n + 1 with a dummy team for byes). The
 * enumerator lists every sequence of matchings in which each pair meets the right number of
 * times, then every venue assignment. Combined with the independent validator it gives a
 * ground truth that shares nothing with the SAT encoding.
 */
import { season } from '../model/season';
import type { Constraint, Round, Schedule, Setup } from '../model/types';
import { validateSchedule } from './validate';

function perfectMatchings(N: number): Array<Array<[number, number]>> {
  const out: Array<Array<[number, number]>> = [];
  const used = new Array<boolean>(N).fill(false);
  const cur: Array<[number, number]> = [];
  const rec = () => {
    const a = used.indexOf(false);
    if (a < 0) {
      out.push(cur.slice());
      return;
    }
    used[a] = true;
    for (let b = a + 1; b < N; b++) {
      if (used[b]) continue;
      used[b] = true;
      cur.push([a, b]);
      rec();
      cur.pop();
      used[b] = false;
    }
    used[a] = false;
  };
  rec();
  return out;
}

export function* allSchedules(n: number, double: boolean, mirrored: boolean): Generator<Schedule> {
  const s = season(n, double, mirrored);
  const matchings = perfectMatchings(s.N);
  const key = (a: number, b: number) => a * s.N + b;
  const freeDouble = double && !mirrored;
  const seqLen = freeDouble ? s.T : s.R;
  const times = freeDouble ? 2 : 1;
  const count = new Map<number, number>();
  const seq: number[] = [];

  const sequences: number[][] = [];
  const rec = () => {
    if (seq.length === seqLen) {
      sequences.push(seq.slice());
      return;
    }
    for (let i = 0; i < matchings.length; i++) {
      const m = matchings[i];
      if (m.some(([a, b]) => (count.get(key(a, b)) ?? 0) >= times)) continue;
      for (const [a, b] of m) count.set(key(a, b), (count.get(key(a, b)) ?? 0) + 1);
      seq.push(i);
      rec();
      seq.pop();
      for (const [a, b] of m) count.set(key(a, b), (count.get(key(a, b)) ?? 0) - 1);
    }
  };
  rec();

  const realPairs: Array<[number, number]> = [];
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) realPairs.push([a, b]);
  const pairIndex = new Map(realPairs.map(([a, b], i) => [key(a, b), i]));

  for (const sq of sequences) {
    for (let mask = 0; mask < 1 << realPairs.length; mask++) {
      const seen = new Map<number, number>();
      const rounds: Round[] = sq.map((mi) => {
        const r: Round = { matches: [], bye: null };
        for (const [a, b] of matchings[mi]) {
          if (b === s.dummy) {
            r.bye = a;
            continue;
          }
          const k = key(a, b);
          const occurrence = seen.get(k) ?? 0;
          seen.set(k, occurrence + 1);
          // Bit set: a hosts b at the first (or only) meeting; the second meeting is reversed.
          const bit = ((mask >> (pairIndex.get(k) as number)) & 1) === 1;
          const aHosts = occurrence === 0 ? bit : !bit;
          r.matches.push(aHosts ? { home: a, away: b } : { home: b, away: a });
        }
        return r;
      });
      if (mirrored && double) {
        const second = rounds.map((r) => ({
          matches: r.matches.map((m) => ({ home: m.away, away: m.home })),
          bye: r.bye,
        }));
        yield { rounds: [...rounds, ...second] };
      } else {
        yield { rounds };
      }
    }
  }
}

export interface BruteResult {
  feasible: boolean;
  minBreaks: number | null;
  schedules: number;
}

/** Ground truth for a setup: is any schedule valid, and the fewest breaks among them. */
export function bruteForce(setup: Setup, only?: (c: Constraint) => boolean): BruteResult {
  const view: Setup = only
    ? {
        ...setup,
        constraints: setup.constraints.map((c) => ({ ...c, enabled: c.enabled && only(c) })),
      }
    : setup;
  let feasible = false;
  let minBreaks: number | null = null;
  let schedules = 0;
  for (const sc of allSchedules(setup.teams.length, setup.format === 'double', setup.mirrored)) {
    schedules++;
    const v = validateSchedule(view, sc);
    if (!v.ok) continue;
    feasible = true;
    if (minBreaks === null || v.totalBreaks < minBreaks) minBreaks = v.totalBreaks;
  }
  return { feasible, minBreaks, schedules };
}
