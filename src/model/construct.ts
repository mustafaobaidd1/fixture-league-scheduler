/**
 * Classical constructions, used to warm-start the solver and as reference schedules.
 *
 * de Werra's canonical factorisation (via the Rasmussen & Trick survey): for N teams (N even)
 * with team N fixed and the others indexed mod N − 1, round i (1 ≤ i ≤ N − 1) is
 *   F_i = {(N, i)} ∪ {(i + k, i − k) : k = 1 … N/2 − 1}.
 * Orientation: (i, N) is played at i when i is odd, at N otherwise; (i + k, i − k) is played
 * at i + k when k is odd, at i − k otherwise. This single round-robin has exactly N − 2
 * breaks, de Werra's minimum.
 *
 * Labels are chosen so the result also satisfies the encoder's symmetry-breaking clauses:
 * the fixed team becomes team 0 and meets team r + 1 in round r, and it is away in round 1.
 */
import type { Season } from './season';
import type { Match, Round, Schedule } from './types';

export function canonicalSingle(N: number): Array<Array<[number, number]>> {
  if (N % 2 !== 0 || N < 2) throw new RangeError('The canonical factorisation needs an even N');
  const res = (x: number) => ((((x - 1) % (N - 1)) + (N - 1)) % (N - 1)) + 1;
  // Labels 1..N-1 keep their number as index; the fixed team N becomes index 0.
  const idx = (label: number) => (label === N ? 0 : label);
  const rounds: Array<Array<[number, number]>> = [];
  for (let i = 1; i <= N - 1; i++) {
    const round: Array<[number, number]> = [];
    round.push(i % 2 === 1 ? [idx(i), idx(N)] : [idx(N), idx(i)]);
    for (let k = 1; k <= N / 2 - 1; k++) {
      const a = res(i + k);
      const b = res(i - k);
      round.push(k % 2 === 1 ? [idx(a), idx(b)] : [idx(b), idx(a)]);
    }
    rounds.push(round);
  }
  return rounds;
}

/** A complete reference schedule for the season (byes for the dummy team when n is odd). */
export function canonicalSchedule(s: Season): Schedule {
  const leg = canonicalSingle(s.N).map((pairs) => toRound(pairs, s));
  if (s.legs === 1) return { rounds: leg };
  const swap = (r: Round): Round => ({
    matches: r.matches.map((m) => ({ home: m.away, away: m.home })),
    bye: r.bye,
  });
  // Mirrored: repeat with venues swapped. Free: the reversed, swapped first leg, which avoids
  // a break at the halfway point (2N − 4 breaks instead of 3N − 6).
  const second = s.mirrored ? leg.map(swap) : leg.slice().reverse().map(swap);
  const schedule = { rounds: [...leg, ...second] };
  return s.mirrored ? schedule : relabelFirstRound(schedule, s.n);
}

function toRound(pairs: Array<[number, number]>, s: Season): Round {
  const matches: Match[] = [];
  let bye: number | null = null;
  for (const [home, away] of pairs) {
    if (home === s.dummy) bye = away;
    else if (away === s.dummy) bye = home;
    else matches.push({ home, away });
  }
  return { matches, bye };
}

/**
 * Relabels teams so round 1 pairs (0,1), (2,3), … and the last team rests when n is odd —
 * the symmetry-breaking pattern used for free double round-robins.
 */
export function relabelFirstRound(schedule: Schedule, n: number): Schedule {
  const first = schedule.rounds[0];
  const map = new Array<number>(n).fill(-1);
  let next = 0;
  for (const m of first.matches) {
    map[m.home] = next++;
    map[m.away] = next++;
  }
  if (first.bye !== null) map[first.bye] = next;
  return {
    rounds: schedule.rounds.map((r) => ({
      matches: r.matches.map((m) => ({ home: map[m.home], away: map[m.away] })),
      bye: r.bye === null ? null : map[r.bye],
    })),
  };
}
