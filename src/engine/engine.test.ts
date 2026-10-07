import { describe, expect, it } from 'vitest';
import { plainSetup } from '../model/presets';
import { seasonOf } from '../model/season';
import type { Constraint, Setup } from '../model/types';
import { rng } from '../solver/testing';
import { bruteForce } from '../validate/brute.testutil';
import { validateSchedule } from '../validate/validate';
import { Engine, runEngine, type Outcome } from './engine';

const minBreaks: Constraint = { id: 'mb', enabled: true, kind: 'minBreaks' };
/** Pure search: no warm start from the known construction, no stopping at the theory bound. */
const pure = { warmStart: false, theoryShortcut: false, timeLimitMs: 120_000 };

function expectValid(setup: Setup, out: Outcome) {
  if (!('schedule' in out) || !out.schedule) throw new Error(`no schedule (${out.status})`);
  const v = validateSchedule(setup, out.schedule);
  expect(v.ok).toBe(true);
  return v;
}

describe('engine — the breaks theorem (de Werra 1981)', () => {
  // A single round-robin with n even needs at least n − 2 breaks, and n − 2 is attainable.
  // The optimiser must find n − 2 and prove that n − 3 is infeasible (UNSAT).
  for (let n = 4; n <= 12; n += 2) {
    it(`single round-robin, n = ${n}: optimum n − 2 = ${n - 2}, proven`, async () => {
      const setup = plainSetup(n, { constraints: [minBreaks] });
      const engine = new Engine(setup, pure);
      const out = await engine.run();
      expect(out.status).toBe('optimal');
      if (out.status !== 'optimal') return;
      expect(out.breaks).toBe(n - 2);
      expect(out.proof).toBe('solver');
      expect(expectValid(setup, out).totalBreaks).toBe(n - 2);
      if (n <= 10) {
        // The UNSAT answer for "≤ n − 3 breaks" re-derived by the independent RUP checker.
        const cert = engine.certify(30_000);
        expect(cert.verified).toBe(true);
      }
    }, 120_000);
  }

  for (const n of [4, 6, 8]) {
    it(`mirrored double round-robin, n = ${n}: optimum 3n − 6 = ${3 * n - 6}, proven`, async () => {
      const setup = plainSetup(n, { format: 'double', mirrored: true, constraints: [minBreaks] });
      const out = await runEngine(setup, pure);
      expect(out.status).toBe('optimal');
      if (out.status !== 'optimal') return;
      expect(out.breaks).toBe(3 * n - 6);
      expect(out.proof).toBe('solver');
      expectValid(setup, out);
    }, 120_000);
  }

  it('odd team counts need no breaks at all (byes interrupt runs)', async () => {
    for (const n of [3, 5, 7, 9]) {
      const setup = plainSetup(n, { constraints: [minBreaks] });
      const out = await runEngine(setup, pure);
      expect(out.status).toBe('optimal');
      if (out.status === 'optimal') expect(out.breaks).toBe(0);
    }
  });

  it('symmetry breaking never removes the optimum', async () => {
    const symmetric: Constraint[] = [
      minBreaks,
      { id: 'run', enabled: true, kind: 'maxRun', team: 'all', venue: 'either', max: 2 },
      { id: 'ends', enabled: true, kind: 'balancedEnds', where: 'both' },
    ];
    const cases: Setup[] = [
      plainSetup(6, { constraints: [minBreaks] }),
      plainSetup(8, { constraints: symmetric }),
      plainSetup(6, { format: 'double', mirrored: true, constraints: symmetric }),
      plainSetup(6, { format: 'double', mirrored: false, constraints: [minBreaks] }),
      plainSetup(7, { format: 'double', mirrored: true, constraints: [minBreaks] }),
      // A club-specific rule: no symmetry breaking applies.
      plainSetup(6, {
        constraints: [
          minBreaks,
          { id: 'v', enabled: true, kind: 'venue', team: 't1', round: 2, venue: 'home' },
        ],
      }),
    ];
    for (const setup of cases) {
      const a = await runEngine(setup, { ...pure, symmetryBreaking: true });
      const b = await runEngine(setup, { ...pure, symmetryBreaking: false });
      expect(a.status).toBe('optimal');
      expect(b.status).toBe('optimal');
      if (a.status === 'optimal' && b.status === 'optimal') expect(a.breaks).toBe(b.breaks);
    }
  }, 120_000);
});

describe('engine — explaining infeasibility', () => {
  const ids = (out: Outcome) => (out.status === 'unsat' ? out.conflict.constraintIds : []);

  it('names exactly the three constraints of a venue clash and the rule they break', async () => {
    const setup = plainSetup(6, {
      format: 'double',
      constraints: [
        minBreaks,
        { id: 'a', enabled: true, kind: 'venue', team: 't1', round: 3, venue: 'home' },
        { id: 'noise1', enabled: true, kind: 'maxRun', team: 'all', venue: 'either', max: 3 },
        { id: 'b', enabled: true, kind: 'venue', team: 't2', round: 3, venue: 'home' },
        { id: 'noise2', enabled: true, kind: 'venue', team: 't4', round: 1, venue: 'away' },
        { id: 'c', enabled: true, kind: 'fixed', a: 't1', b: 't2', round: 3, host: 'either' },
      ],
    });
    const out = await runEngine(setup);
    expect(out.status).toBe('unsat');
    if (out.status !== 'unsat') return;
    expect(out.conflict.constraintIds).toEqual(['a', 'b', 'c']);
    expect(out.conflict.minimal).toBe(true);
    expect(out.conflict.structural).toEqual(['oneHome']);
  });

  it('blames "every team plays every round" for a rest day with an even team count', async () => {
    const setup = plainSetup(6, {
      constraints: [{ id: 'u', enabled: true, kind: 'unavailable', team: 't3', round: 2 }],
    });
    const out = await runEngine(setup);
    expect(ids(out)).toEqual(['u']);
    if (out.status === 'unsat') expect(out.conflict.structural).toEqual(['playEveryRound']);
  });

  it('explains a break cap below the theoretical minimum', async () => {
    const setup = plainSetup(6, {
      constraints: [
        { id: 'cap', enabled: true, kind: 'breakCap', scope: 'total', max: 3 },
        { id: 'v', enabled: true, kind: 'venue', team: 't1', round: 1, venue: 'home' },
      ],
    });
    const out = await runEngine(setup);
    expect(ids(out)).toEqual(['cap']);
    if (out.status === 'unsat') {
      expect(out.conflict.structural.length).toBeGreaterThan(0);
      expect(out.conflict.structural).toContain('pairsMeet');
    }
  });

  it('certifies the conflict with the independent RUP checker', async () => {
    const setup = plainSetup(4, {
      constraints: [
        { id: 'a', enabled: true, kind: 'sharedGround', a: 't1', b: 't2' },
        { id: 'b', enabled: true, kind: 'venue', team: 't1', round: 2, venue: 'home' },
        { id: 'c', enabled: true, kind: 'venue', team: 't2', round: 2, venue: 'home' },
      ],
    });
    const engine = new Engine(setup);
    const out = await engine.run();
    expect(ids(out)).toEqual(['a', 'b', 'c']);
    expect(engine.certify().verified).toBe(true);
  });

  it('mirrored seasons can name the mirror rule', async () => {
    // A 4-team mirrored season has rounds 1–3 and their mirror images 4–6. Fixing a pair in
    // round 1 forces the return match into round 4, so a second fixture in round 5 clashes —
    // through the mirror rule (without it, rounds 1 and 5 would be fine).
    const setup = plainSetup(4, {
      format: 'double',
      mirrored: true,
      constraints: [
        { id: 'f1', enabled: true, kind: 'fixed', a: 't1', b: 't2', round: 1, host: 'either' },
        { id: 'f2', enabled: true, kind: 'fixed', a: 't1', b: 't2', round: 5, host: 'either' },
      ],
    });
    const out = await runEngine(setup);
    expect(ids(out)).toEqual(['f1', 'f2']);
    if (out.status === 'unsat') expect(out.conflict.structural).toContain('mirror');
  });
});

describe('engine — other outcomes', () => {
  it('reports invalid input without solving', async () => {
    const setup = plainSetup(4, {
      constraints: [
        { id: 'f1', enabled: true, kind: 'fixed', a: 't1', b: 't2', round: 1, host: 'a' },
        { id: 'f2', enabled: true, kind: 'fixed', a: 't1', b: 't3', round: 1, host: 'a' },
      ],
    });
    const out = await runEngine(setup);
    expect(out.status).toBe('invalid');
    if (out.status === 'invalid') expect(out.issues[0].code).toBe('double-booked');
  });

  it('times out with the best schedule found so far', async () => {
    const setup = plainSetup(20, { format: 'double', mirrored: true, constraints: [minBreaks] });
    const out = await runEngine(setup, {
      warmStart: false,
      theoryShortcut: false,
      timeLimitMs: 1500,
    });
    expect(out.status).toBe('timeout');
    if (out.status === 'timeout') {
      expect(out.optimising).toBe(true);
      expect(out.schedule).not.toBeNull();
      expect(validateSchedule(setup, out.schedule!).ok).toBe(true);
      expect(out.breaks).toBeGreaterThanOrEqual(3 * 20 - 6);
    }
  }, 30_000);

  it('stops at the theoretical minimum when the solver proof would be slow', async () => {
    const setup = plainSetup(20, { format: 'double', mirrored: true, constraints: [minBreaks] });
    const out = await runEngine(setup, { timeLimitMs: 20_000, theoryProofMs: 300 });
    expect(out.status).toBe('optimal');
    if (out.status === 'optimal') {
      expect(out.breaks).toBe(54);
      expect(['theory', 'solver']).toContain(out.proof);
    }
  }, 30_000);

  it('is deterministic', async () => {
    const setup = plainSetup(8, {
      format: 'double',
      constraints: [
        minBreaks,
        { id: 'v', enabled: true, kind: 'venue', team: 't3', round: 4, venue: 'away' },
      ],
    });
    const a = await runEngine(setup);
    const b = await runEngine(setup);
    expect(JSON.stringify('schedule' in a && a.schedule)).toBe(
      JSON.stringify('schedule' in b && b.schedule),
    );
  });

  it('streams statistics and solutions while it works', async () => {
    const events: string[] = [];
    const setup = plainSetup(8, { format: 'double', constraints: [minBreaks] });
    await runEngine(setup, { warmStart: false, onEvent: (e) => events.push(e.type) });
    expect(events).toContain('stats');
    expect(events).toContain('solution');
    expect(events).toContain('log');
  });

  it('can run in slices on the main thread', async () => {
    let yields = 0;
    const setup = plainSetup(10, { constraints: [minBreaks] });
    const out = await runEngine(setup, {
      warmStart: false,
      sliceMs: 5,
      yieldControl: async () => {
        yields++;
      },
    });
    expect(out.status).toBe('optimal');
    expect(yields).toBeGreaterThan(0);
  }, 60_000);
});

// ---------------------------------------------------------------------------------------------
// Exhaustive cross-check: SAT pipeline vs. brute-force enumeration + validator
// ---------------------------------------------------------------------------------------------

function randomConstraint(setup: Setup, rand: () => number, id: string): Constraint {
  const s = seasonOf(setup);
  const team = () => setup.teams[Math.floor(rand() * setup.teams.length)].id;
  const two = () => {
    const a = team();
    let b = team();
    while (b === a) b = team();
    return [a, b];
  };
  const round = () => (rand() < 0.2 ? 'last' : 1 + Math.floor(rand() * s.T));
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const base = { id, enabled: true };
  switch (Math.floor(rand() * 9)) {
    case 0:
      return {
        ...base,
        kind: 'venue',
        team: team(),
        round: round(),
        venue: pick(['home', 'away', 'not-home'] as const),
      };
    case 1:
      return { ...base, kind: 'unavailable', team: team(), round: round() };
    case 2: {
      const [a, b] = two();
      return {
        ...base,
        kind: 'fixed',
        a,
        b,
        round: round(),
        host: pick(['a', 'b', 'either'] as const),
      };
    }
    case 3:
      return {
        ...base,
        kind: 'maxRun',
        team: rand() < 0.5 ? 'all' : team(),
        venue: pick(['home', 'away', 'either'] as const),
        max: 1 + Math.floor(rand() * 2),
      };
    case 4:
      return {
        ...base,
        kind: 'breakCap',
        scope: pick(['total', 'perTeam'] as const),
        max: Math.floor(rand() * 4),
      };
    case 5: {
      const [a, b] = two();
      return { ...base, kind: 'sharedGround', a, b };
    }
    case 6:
      return {
        ...base,
        kind: 'noEarlyMeeting',
        teams: two(),
        rounds: 1 + Math.floor(rand() * Math.min(3, s.T)),
      };
    case 7:
      return { ...base, kind: 'balancedEnds', where: pick(['start', 'end', 'both'] as const) };
    default:
      return { ...base, kind: 'minBreaks' };
  }
}

describe('engine — agrees with exhaustive enumeration on tiny leagues', () => {
  const formats: Array<[string, number, 'single' | 'double', boolean, number]> = [
    ['n=3 single', 3, 'single', true, 60],
    ['n=4 single', 4, 'single', true, 60],
    ['n=3 mirrored', 3, 'double', true, 40],
    ['n=4 mirrored', 4, 'double', true, 40],
    ['n=3 free', 3, 'double', false, 60],
    ['n=4 free', 4, 'double', false, 15],
  ];
  for (const [label, n, format, mirrored, trials] of formats) {
    it(`${label}: feasibility, optimum and minimal conflicts match brute force`, async () => {
      const rand = rng(n * 1000 + trials + (mirrored ? 7 : 0) + (format === 'double' ? 3 : 0));
      let sat = 0;
      let unsat = 0;
      for (let k = 0; k < trials; k++) {
        const count = 1 + Math.floor(rand() * 4);
        const base = plainSetup(n, { format, mirrored });
        const constraints = Array.from({ length: count }, (_, i) =>
          randomConstraint(base, rand, `c${i}`),
        );
        const setup = { ...base, constraints };
        const out = await runEngine(setup, { timeLimitMs: 30_000 });
        if (out.status === 'invalid') continue;
        const truth = bruteForce(setup);
        if (truth.feasible) {
          expect(['feasible', 'optimal'], label).toContain(out.status);
          const v = expectValid(setup, out);
          if (constraints.some((c) => c.kind === 'minBreaks')) {
            expect(out.status).toBe('optimal');
            expect(v.totalBreaks).toBe(truth.minBreaks);
          }
          sat++;
        } else {
          expect(out.status, label).toBe('unsat');
          if (out.status !== 'unsat') continue;
          const mus = new Set(out.conflict.constraintIds);
          expect(out.conflict.minimal).toBe(true);
          // The subset really is infeasible…
          expect(bruteForce(setup, (c) => mus.has(c.id)).feasible).toBe(false);
          // …and minimal: dropping any one member makes the rest feasible.
          for (const id of mus) {
            expect(bruteForce(setup, (c) => mus.has(c.id) && c.id !== id).feasible).toBe(true);
          }
          unsat++;
        }
      }
      expect(sat, `${label}: satisfiable cases`).toBeGreaterThan(0);
      expect(unsat, `${label}: unsatisfiable cases`).toBeGreaterThan(0);
    }, 120_000);
  }
});
