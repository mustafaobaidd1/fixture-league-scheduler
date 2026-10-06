import { describe, expect, it } from 'vitest';
import { canonicalSchedule } from '../model/construct';
import { plainSetup } from '../model/presets';
import { season, seasonOf } from '../model/season';
import type { Constraint, ConstraintBody, Schedule, Setup } from '../model/types';
import { rng } from '../solver/testing';
import { allSchedules } from './brute.testutil';
import { validateSchedule } from './validate';

const clone = (s: Schedule): Schedule => JSON.parse(JSON.stringify(s));

/** Parses the survey's notation: per team, "+k" home vs k, "−k" away at k (1-based). */
function fromSigned(rows: string[]): Schedule {
  const n = rows.length;
  const T = rows[0].trim().split(/\s+/).length;
  const rounds: Schedule['rounds'] = Array.from({ length: T }, () => ({ matches: [], bye: null }));
  rows.forEach((row, t) => {
    row
      .trim()
      .split(/\s+/)
      .forEach((tok, r) => {
        const opp = Math.abs(Number(tok.replace('−', '-'))) - 1;
        if (tok.startsWith('+')) rounds[r].matches.push({ home: t, away: opp });
      });
  });
  expect(rounds.every((r) => r.matches.length === n / 2)).toBe(true);
  return { rounds };
}

describe('validator — reference schedules', () => {
  it('accepts the n = 6 schedule of Rasmussen & Trick (survey Fig. 6) and counts 4 breaks', () => {
    const schedule = fromSigned([
      '−6 +3 −5 +2 −4',
      '−5 +6 +4 −1 +3',
      '+4 −1 −6 +5 −2',
      '−3 +5 −2 +6 +1',
      '+2 −4 +1 −3 −6',
      '+1 −2 +3 −4 +5',
    ]);
    const v = validateSchedule(plainSetup(6), schedule);
    expect(v.structureOk).toBe(true);
    expect(v.totalBreaks).toBe(4);
    expect(v.breaksPerTeam).toEqual([0, 1, 1, 1, 1, 0]);
  });

  it("de Werra's canonical single round-robin has exactly n − 2 breaks (n = 2…20, even)", () => {
    for (let n = 2; n <= 20; n += 2) {
      const v = validateSchedule(plainSetup(n), canonicalSchedule(season(n, false, false)));
      expect(v.structureOk, `n=${n}`).toBe(true);
      expect(v.totalBreaks, `n=${n}`).toBe(n - 2);
    }
  });

  it('the mirrored canonical double round-robin has 3n − 6 breaks; the reversed one 2n − 4', () => {
    for (let n = 4; n <= 20; n += 2) {
      const mirrored = plainSetup(n, { format: 'double', mirrored: true });
      const vm = validateSchedule(mirrored, canonicalSchedule(seasonOf(mirrored)));
      expect(vm.structureOk).toBe(true);
      expect(vm.totalBreaks).toBe(3 * n - 6);
      const free = plainSetup(n, { format: 'double', mirrored: false });
      const vf = validateSchedule(free, canonicalSchedule(seasonOf(free)));
      expect(vf.structureOk).toBe(true);
      expect(vf.totalBreaks).toBe(2 * n - 4);
    }
  });

  it('canonical schedules with an odd number of teams give every team its byes', () => {
    for (const n of [3, 5, 7, 9, 19]) {
      for (const [double, mirrored] of [
        [false, true],
        [true, true],
        [true, false],
      ] as const) {
        const setup = plainSetup(n, { format: double ? 'double' : 'single', mirrored });
        const sc = canonicalSchedule(seasonOf(setup));
        const v = validateSchedule(setup, sc);
        expect(v.structureOk, `n=${n} ${double} ${mirrored}`).toBe(true);
        const byes = new Array<number>(n).fill(0);
        for (const r of sc.rounds) byes[r.bye as number]++;
        expect(byes.every((b) => b === (double ? 2 : 1))).toBe(true);
      }
    }
  });
});

/** A random valid schedule: canonical, relabelled, rounds shuffled, venues flipped. */
function randomValid(setup: Setup, rand: () => number): Schedule {
  const s = seasonOf(setup);
  const base = canonicalSchedule(s);
  const perm = Array.from({ length: s.n }, (_, i) => i).sort(() => rand() - 0.5);
  const order = Array.from({ length: s.R }, (_, i) => i).sort(() => rand() - 0.5);
  const flip = new Map<string, boolean>();
  const pairFlip = (a: number, b: number) => {
    const k = `${Math.min(a, b)}-${Math.max(a, b)}`;
    if (!flip.has(k)) flip.set(k, rand() < 0.5);
    return flip.get(k) as boolean;
  };
  const leg = (offset: number) =>
    order.map((r) => {
      const round = base.rounds[offset + r];
      return {
        matches: round.matches.map((m) => {
          const home = perm[m.home];
          const away = perm[m.away];
          return pairFlip(home, away) ? { home: away, away: home } : { home, away };
        }),
        bye: round.bye === null ? null : perm[round.bye],
      };
    });
  const rounds = leg(0);
  if (s.legs === 2) rounds.push(...leg(s.R));
  return { rounds };
}

describe('validator — property tests', () => {
  const formats: Array<[string, Setup]> = [];
  for (const n of [2, 3, 4, 5, 6, 7, 8, 11, 12]) {
    formats.push([`single n=${n}`, plainSetup(n)]);
    formats.push([`mirrored n=${n}`, plainSetup(n, { format: 'double', mirrored: true })]);
    formats.push([`free n=${n}`, plainSetup(n, { format: 'double', mirrored: false })]);
  }

  it('accepts random valid schedules and counts breaks consistently', () => {
    const rand = rng(1234);
    for (const [label, setup] of formats) {
      for (let k = 0; k < 20; k++) {
        const sc = randomValid(setup, rand);
        const v = validateSchedule(setup, sc);
        expect(v.structureOk, label).toBe(true);
        // The per-team pattern and the break total agree.
        const recount = v.breakAt.flat().filter(Boolean).length;
        expect(recount).toBe(v.totalBreaks);
        const s = seasonOf(setup);
        for (let t = 0; t < s.n; t++) {
          expect(v.homeGames[t] + v.awayGames[t]).toBe(s.legs * (s.n - 1));
        }
      }
    }
  });

  it('rejects corrupted schedules, naming the broken rule', () => {
    const rand = rng(99);
    type Corruption = (sc: Schedule, s: ReturnType<typeof seasonOf>) => string | null;
    const corruptions: Corruption[] = [
      // Swap two teams across different matches of one round: pairs then meet wrongly.
      (sc) => {
        const r = sc.rounds.find((x) => x.matches.length >= 2);
        if (!r) return null;
        const t = r.matches[0].away;
        r.matches[0].away = r.matches[1].away;
        r.matches[1].away = t;
        return 'pairsMeet';
      },
      // Drop a match: two teams sit out a round.
      (sc) => {
        const r = sc.rounds[Math.floor(rand() * sc.rounds.length)];
        if (r.matches.length === 0) return null;
        r.matches.pop();
        return 'playEveryRound';
      },
      // Copy a match into another round: someone plays twice there.
      (sc) => {
        if (sc.rounds.length < 2 || sc.rounds[0].matches.length === 0) return null;
        sc.rounds[1].matches.push({ ...sc.rounds[0].matches[0] });
        return 'onePerRound';
      },
      // Remove the last round.
      (sc) => {
        sc.rounds.pop();
        return 'rounds';
      },
      // A team plays itself.
      (sc) => {
        const m = sc.rounds[0].matches[0];
        if (!m) return null;
        m.away = m.home;
        return 'teams';
      },
      // Flip one venue: in a double round-robin a team then hosts the same opponent twice.
      (sc, s) => {
        if (s.legs !== 2) return null;
        const r = sc.rounds[Math.floor(rand() * sc.rounds.length)];
        const m = r.matches[0];
        if (!m) return null;
        [m.home, m.away] = [m.away, m.home];
        return 'pairsMeet';
      },
      // Mirrored: swap two rounds of the second half.
      (sc, s) => {
        if (!s.mirrored || s.R < 2) return null;
        const a = s.R;
        const b = s.R + 1;
        [sc.rounds[a], sc.rounds[b]] = [sc.rounds[b], sc.rounds[a]];
        return 'mirror';
      },
    ];
    let detected = 0;
    for (const [label, setup] of formats) {
      const s = seasonOf(setup);
      for (const corrupt of corruptions) {
        const sc = clone(randomValid(setup, rand));
        const rule = corrupt(sc, s);
        if (rule === null) continue;
        const v = validateSchedule(setup, sc);
        expect(v.structureOk, `${label}: ${rule}`).toBe(false);
        expect(v.ok).toBe(false);
        const failed = v.structural.filter((c) => !c.ok).map((c) => c.rule);
        expect(failed, `${label}: ${rule}`).toContain(rule);
        detected++;
      }
    }
    expect(detected).toBeGreaterThan(100);
  });

  it('agrees with an exhaustive count of schedules for tiny leagues', () => {
    // Every enumerated schedule is valid, and the count matches the combinatorics:
    // n = 4 single: 3! orders of the 3 perfect matchings × 2^6 venue choices = 384.
    let count = 0;
    for (const sc of allSchedules(4, false, false)) {
      expect(validateSchedule(plainSetup(4), sc).structureOk).toBe(true);
      count++;
    }
    expect(count).toBe(384);
    // n = 4 free double: 6!/(2!·2!·2!) = 90 orders × 2^6 = 5,760.
    let free = 0;
    const freeSetup = plainSetup(4, { format: 'double', mirrored: false });
    for (const sc of allSchedules(4, true, false)) {
      expect(validateSchedule(freeSetup, sc).structureOk).toBe(true);
      free++;
    }
    expect(free).toBe(5760);
  });
});

describe('validator — constraint checks', () => {
  // Team indices 0..3 → ids t1..t4. Rounds: R1 0v1 2v3 · R2 1v2 3v0 · R3 0v2 1v3 (n = 4 single).
  const sc: Schedule = {
    rounds: [
      {
        matches: [
          { home: 0, away: 1 },
          { home: 2, away: 3 },
        ],
        bye: null,
      },
      {
        matches: [
          { home: 1, away: 2 },
          { home: 3, away: 0 },
        ],
        bye: null,
      },
      {
        matches: [
          { home: 0, away: 2 },
          { home: 1, away: 3 },
        ],
        bye: null,
      },
    ],
  };
  const check = (c: ConstraintBody) => {
    const setup = plainSetup(4, { constraints: [{ ...c, id: 'x', enabled: true } as Constraint] });
    const v = validateSchedule(setup, sc);
    expect(v.structureOk).toBe(true);
    return v.constraints[0].ok;
  };

  it('venue, unavailability and fixed matches', () => {
    expect(check({ kind: 'venue', team: 't1', round: 1, venue: 'home' })).toBe(true);
    expect(check({ kind: 'venue', team: 't1', round: 2, venue: 'home' })).toBe(false);
    expect(check({ kind: 'venue', team: 't1', round: 2, venue: 'away' })).toBe(true);
    expect(check({ kind: 'venue', team: 't1', round: 'last', venue: 'not-home' })).toBe(false);
    expect(check({ kind: 'unavailable', team: 't1', round: 1 })).toBe(false);
    expect(check({ kind: 'fixed', a: 't1', b: 't3', round: 3, host: 'a' })).toBe(true);
    expect(check({ kind: 'fixed', a: 't1', b: 't3', round: 3, host: 'b' })).toBe(false);
    expect(check({ kind: 'fixed', a: 't3', b: 't1', round: 'last', host: 'either' })).toBe(true);
    expect(check({ kind: 'fixed', a: 't1', b: 't2', round: 2, host: 'either' })).toBe(false);
  });

  it('runs, breaks and caps', () => {
    // Patterns: t1 H A H · t2 A H H · t3 H A A · t4 A H A → breaks: t2 at R3, t3 at R3.
    expect(check({ kind: 'maxRun', team: 'all', venue: 'either', max: 2 })).toBe(true);
    expect(check({ kind: 'maxRun', team: 'all', venue: 'either', max: 1 })).toBe(false);
    expect(check({ kind: 'maxRun', team: 't1', venue: 'either', max: 1 })).toBe(true);
    expect(check({ kind: 'maxRun', team: 't2', venue: 'away', max: 1 })).toBe(true);
    expect(check({ kind: 'maxRun', team: 't2', venue: 'home', max: 1 })).toBe(false);
    expect(check({ kind: 'breakCap', scope: 'total', max: 2 })).toBe(true);
    expect(check({ kind: 'breakCap', scope: 'total', max: 1 })).toBe(false);
    expect(check({ kind: 'breakCap', scope: 'perTeam', max: 1 })).toBe(true);
    expect(check({ kind: 'breakCap', scope: 'perTeam', max: 0 })).toBe(false);
    expect(check({ kind: 'balancedEnds', where: 'start' })).toBe(true);
    expect(check({ kind: 'balancedEnds', where: 'end' })).toBe(false);
  });

  it('shared grounds and early meetings', () => {
    // t1 and t4 are never both at home; t1 and t3 both are in round 1.
    expect(check({ kind: 'sharedGround', a: 't1', b: 't4' })).toBe(true);
    expect(check({ kind: 'sharedGround', a: 't1', b: 't3' })).toBe(false);
    expect(check({ kind: 'noEarlyMeeting', teams: ['t1', 't3'], rounds: 2 })).toBe(true);
    expect(check({ kind: 'noEarlyMeeting', teams: ['t1', 't3'], rounds: 3 })).toBe(false);
    expect(check({ kind: 'noEarlyMeeting', teams: ['t1', 't2', 't3'], rounds: 1 })).toBe(false);
  });

  it('a bye interrupts a run and is never a break', () => {
    // n = 3: R1 0v1 (2 rests) · R2 2v0 (1 rests) · R3 1v2 (0 rests).
    const odd: Schedule = {
      rounds: [
        { matches: [{ home: 0, away: 1 }], bye: 2 },
        { matches: [{ home: 2, away: 0 }], bye: 1 },
        { matches: [{ home: 1, away: 2 }], bye: 0 },
      ],
    };
    const v = validateSchedule(plainSetup(3), odd);
    expect(v.structureOk).toBe(true);
    // t2: A, rest, H → no break; t3: rest, H, A → no break.
    expect(v.totalBreaks).toBe(0);
    expect(v.status[1]).toEqual(['A', 'B', 'H']);
  });
});
