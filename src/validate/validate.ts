/**
 * Independent schedule validator.
 *
 * Shares no code with the encoder: it never sees a variable or a clause. It reads a schedule
 * as a list of rounds of (home, away) matches and re-derives everything from the setup:
 * the structural rules of a round-robin, every active constraint, and the break count.
 * Every schedule the solver returns is shown with this validator's verdict.
 */
import { roundIndex, seasonOf, type Season } from '../model/season';
import type { Constraint, Schedule, Setup } from '../model/types';

export type Status = 'H' | 'A' | 'B';

export interface StructuralCheck {
  rule: 'rounds' | 'teams' | 'onePerRound' | 'playEveryRound' | 'pairsMeet' | 'mirror';
  label: string;
  ok: boolean;
  problems: string[];
}

export interface ConstraintCheck {
  id: string;
  ok: boolean;
  detail: string;
}

export interface Validation {
  ok: boolean;
  structureOk: boolean;
  structural: StructuralCheck[];
  constraints: ConstraintCheck[];
  /** status[t][r]: H home, A away, B bye. Only meaningful when structureOk. */
  status: Status[][];
  /** breakAt[t][r]: team t's game in round r repeats its previous venue. */
  breakAt: boolean[][];
  breaksPerTeam: number[];
  totalBreaks: number;
  homeGames: number[];
  awayGames: number[];
  matches: number;
}

const MAX_PROBLEMS = 6;

export function validateSchedule(setup: Setup, schedule: Schedule): Validation {
  const s = seasonOf(setup);
  const n = s.n;
  const structural: StructuralCheck[] = [];
  const check = (rule: StructuralCheck['rule'], label: string) => {
    const c: StructuralCheck = { rule, label, ok: true, problems: [] };
    structural.push(c);
    return (problem: string) => {
      c.ok = false;
      if (c.problems.length < MAX_PROBLEMS) c.problems.push(problem);
    };
  };
  const name = (t: number) => setup.teams[t]?.name ?? `team #${t + 1}`;

  // 1. The right number of rounds.
  const roundsFail = check('rounds', `${s.T} rounds`);
  if (schedule.rounds.length !== s.T) {
    roundsFail(`The schedule has ${schedule.rounds.length} rounds, the season needs ${s.T}.`);
  }
  const T = Math.min(schedule.rounds.length, s.T);

  // 2. Team references are valid.
  const teamsFail = check('teams', 'Matches name real, distinct teams');
  const valid = (t: unknown): t is number =>
    Number.isInteger(t) && (t as number) >= 0 && (t as number) < n;
  for (let r = 0; r < T; r++) {
    const round = schedule.rounds[r];
    for (const m of round.matches) {
      if (!valid(m.home) || !valid(m.away))
        teamsFail(`Round ${r + 1} names a team that does not exist.`);
      else if (m.home === m.away)
        teamsFail(`Round ${r + 1}: ${name(m.home)} is drawn against itself.`);
    }
    if (round.bye !== null && !valid(round.bye))
      teamsFail(`Round ${r + 1} rests a team that does not exist.`);
  }

  // 3–4. Each team appears exactly once per round (playing, or resting with an odd count).
  const status: Status[][] = Array.from({ length: n }, () => new Array<Status>(T).fill('B'));
  const appearances: number[][] = Array.from({ length: n }, () => new Array<number>(T).fill(0));
  const onceFail = check('onePerRound', 'No team plays twice in a round');
  const everyFail = check(
    'playEveryRound',
    s.dummy >= 0
      ? 'Every team plays each round except its one bye'
      : 'Every team plays every round',
  );
  for (let r = 0; r < T; r++) {
    const round = schedule.rounds[r];
    for (const m of round.matches) {
      if (!valid(m.home) || !valid(m.away) || m.home === m.away) continue;
      appearances[m.home][r]++;
      appearances[m.away][r]++;
      status[m.home][r] = 'H';
      status[m.away][r] = 'A';
    }
    if (s.dummy >= 0) {
      if (round.bye === null || !valid(round.bye)) {
        everyFail(`Round ${r + 1} has no team resting.`);
      } else {
        appearances[round.bye][r]++;
      }
    } else if (round.bye !== null) {
      everyFail(
        `Round ${r + 1} rests ${valid(round.bye) ? name(round.bye) : 'a team'}, but nobody should rest with an even number of teams.`,
      );
    }
    for (let t = 0; t < n; t++) {
      if (appearances[t][r] > 1)
        onceFail(`${name(t)} appears ${appearances[t][r]} times in round ${r + 1}.`);
      if (appearances[t][r] === 0) everyFail(`${name(t)} does not play in round ${r + 1}.`);
    }
  }

  // 5. Pairs meet the right number of times (and in a double round-robin, once at each ground).
  const meetFail = check(
    'pairsMeet',
    s.legs === 1
      ? 'Every pair meets exactly once'
      : 'Every team hosts every other team exactly once',
  );
  const met = new Map<string, number>();
  for (let r = 0; r < T; r++) {
    for (const m of schedule.rounds[r].matches) {
      if (!valid(m.home) || !valid(m.away) || m.home === m.away) continue;
      const key =
        s.legs === 1
          ? `${Math.min(m.home, m.away)}-${Math.max(m.home, m.away)}`
          : `${m.home}>${m.away}`;
      met.set(key, (met.get(key) ?? 0) + 1);
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j || (s.legs === 1 && j < i)) continue;
      const key = s.legs === 1 ? `${i}-${j}` : `${i}>${j}`;
      const k = met.get(key) ?? 0;
      if (k !== 1) {
        meetFail(
          s.legs === 1
            ? `${name(i)} and ${name(j)} meet ${k} times.`
            : `${name(i)} hosts ${name(j)} ${k} times.`,
        );
      }
    }
  }

  // 6. A mirrored second half repeats the first with venues swapped.
  if (s.mirrored) {
    const mirrorFail = check('mirror', 'The second half mirrors the first');
    for (let r = 0; r < s.R && r + s.R < T; r++) {
      const first = new Set(schedule.rounds[r].matches.map((m) => `${m.away}>${m.home}`));
      const second = schedule.rounds[r + s.R];
      const same =
        second.matches.length === first.size &&
        second.matches.every((m) => first.has(`${m.home}>${m.away}`)) &&
        second.bye === schedule.rounds[r].bye;
      if (!same) mirrorFail(`Round ${r + s.R + 1} is not round ${r + 1} with venues swapped.`);
    }
  }

  const structureOk = structural.every((c) => c.ok);

  // Breaks: two consecutive rounds at the same venue (a bye interrupts a run).
  const breakAt: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(T).fill(false));
  const breaksPerTeam = new Array<number>(n).fill(0);
  const homeGames = new Array<number>(n).fill(0);
  const awayGames = new Array<number>(n).fill(0);
  for (let t = 0; t < n; t++) {
    for (let r = 0; r < T; r++) {
      if (status[t][r] === 'H') homeGames[t]++;
      if (status[t][r] === 'A') awayGames[t]++;
      if (r > 0 && status[t][r] !== 'B' && status[t][r] === status[t][r - 1]) {
        breakAt[t][r] = true;
        breaksPerTeam[t]++;
      }
    }
  }
  const totalBreaks = breaksPerTeam.reduce((a, b) => a + b, 0);

  const constraints = setup.constraints
    .filter((c) => c.enabled)
    .map((c) =>
      checkConstraint(c, setup, s, status, breakAt, breaksPerTeam, totalBreaks, schedule),
    );

  return {
    ok: structureOk && constraints.every((c) => c.ok),
    structureOk,
    structural,
    constraints,
    status,
    breakAt,
    breaksPerTeam,
    totalBreaks,
    homeGames,
    awayGames,
    matches: schedule.rounds.reduce((a, r) => a + r.matches.length, 0),
  };
}

function checkConstraint(
  c: Constraint,
  setup: Setup,
  s: Season,
  status: Status[][],
  breakAt: boolean[][],
  breaksPerTeam: number[],
  totalBreaks: number,
  schedule: Schedule,
): ConstraintCheck {
  const idx = (id: string) => setup.teams.findIndex((t) => t.id === id);
  const name = (t: number) => setup.teams[t]?.name ?? 'unknown team';
  const at = (t: number, r: number): Status | undefined => status[t]?.[r];
  const word = { H: 'at home', A: 'away', B: 'resting' } as const;
  const T = status[0]?.length ?? 0;
  const ok = (detail: string) => ({ id: c.id, ok: true, detail });
  const bad = (detail: string) => ({ id: c.id, ok: false, detail });

  switch (c.kind) {
    case 'venue': {
      const t = idx(c.team);
      const r = roundIndex(c.round, s);
      const st = at(t, r);
      if (st === undefined) return bad('That round is not in the schedule.');
      const holds = c.venue === 'home' ? st === 'H' : c.venue === 'away' ? st === 'A' : st !== 'H';
      return (holds ? ok : bad)(`${name(t)} is ${word[st]} in round ${r + 1}.`);
    }
    case 'unavailable': {
      const t = idx(c.team);
      const r = roundIndex(c.round, s);
      const st = at(t, r);
      if (st === undefined) return bad('That round is not in the schedule.');
      return (st === 'B' ? ok : bad)(`${name(t)} is ${word[st]} in round ${r + 1}.`);
    }
    case 'fixed': {
      const a = idx(c.a);
      const b = idx(c.b);
      const r = roundIndex(c.round, s);
      const round = schedule.rounds[r];
      if (round === undefined) return bad('That round is not in the schedule.');
      const m = round.matches.find(
        (x) => (x.home === a && x.away === b) || (x.home === b && x.away === a),
      );
      if (m === undefined) return bad(`${name(a)} and ${name(b)} do not meet in round ${r + 1}.`);
      const hostOk = c.host === 'either' || m.home === (c.host === 'a' ? a : b);
      return (hostOk ? ok : bad)(`${name(m.home)} hosts ${name(m.away)} in round ${r + 1}.`);
    }
    case 'maxRun': {
      const teams = c.team === 'all' ? setup.teams.map((_, i) => i) : [idx(c.team)];
      const venues: Status[] = c.venue === 'home' ? ['H'] : c.venue === 'away' ? ['A'] : ['H', 'A'];
      let worst = 0;
      let worstTeam = -1;
      for (const t of teams) {
        for (const v of venues) {
          let run = 0;
          for (let r = 0; r < T; r++) {
            run = at(t, r) === v ? run + 1 : 0;
            if (run > worst) {
              worst = run;
              worstTeam = t;
            }
          }
        }
      }
      const detail =
        worstTeam < 0 ? 'No runs at all.' : `Longest run: ${worst} (${name(worstTeam)}).`;
      return (worst <= c.max ? ok : bad)(detail);
    }
    case 'minBreaks':
      return ok(`${totalBreaks} breaks in total.`);
    case 'breakCap': {
      if (c.scope === 'total') {
        return (totalBreaks <= c.max ? ok : bad)(`${totalBreaks} breaks in total.`);
      }
      const most = Math.max(0, ...breaksPerTeam);
      return (most <= c.max ? ok : bad)(`At most ${most} breaks for any team.`);
    }
    case 'sharedGround': {
      const a = idx(c.a);
      const b = idx(c.b);
      for (let r = 0; r < T; r++) {
        if (at(a, r) === 'H' && at(b, r) === 'H') {
          return bad(`${name(a)} and ${name(b)} are both at home in round ${r + 1}.`);
        }
      }
      return ok('Never both at home.');
    }
    case 'noEarlyMeeting': {
      const set = new Set(c.teams.map(idx));
      for (let r = 0; r < Math.min(c.rounds, schedule.rounds.length); r++) {
        const m = schedule.rounds[r].matches.find((x) => set.has(x.home) && set.has(x.away));
        if (m !== undefined) {
          return bad(`${name(m.home)} meets ${name(m.away)} in round ${r + 1}.`);
        }
      }
      return ok(`No meetings in rounds 1–${Math.min(c.rounds, T)}.`);
    }
    case 'balancedEnds': {
      const qs: number[] = [];
      if (c.where !== 'end' && T >= 2) qs.push(1);
      if (c.where !== 'start' && T >= 2) qs.push(T - 1);
      for (const q of qs) {
        for (let t = 0; t < setup.teams.length; t++) {
          if (breakAt[t][q]) {
            const two = at(t, q) === 'H' ? 'two home' : 'two away';
            return bad(`${name(t)} ${q === 1 ? 'opens' : 'closes'} with ${two} games.`);
          }
        }
      }
      return ok('Nobody opens or closes with a break.');
    }
  }
}
