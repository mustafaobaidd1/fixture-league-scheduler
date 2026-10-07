/**
 * Slower validation runs (`npm run validate`). Prints the tables recorded in the README.
 * Every run uses pure search unless stated: no warm start from a known construction, no
 * stopping at a theoretical bound, no neighbourhood search — the solver must find the
 * optimum and prove the next bound infeasible on its own.
 */
import { describe, expect, it } from 'vitest';
import { Engine, type EngineOptions, type Outcome } from '../src/engine/engine';
import { exampleSetup, plainSetup } from '../src/model/presets';
import type { Constraint, Setup } from '../src/model/types';
import { checkRup } from '../src/proof/rup';
import { Solver } from '../src/solver/cdcl';
import { bruteForceCount, pigeonhole, random3Sat, rng, satisfies } from '../src/solver/testing';
import { validateSchedule } from '../src/validate/validate';

const minBreaks: Constraint = { id: 'mb', enabled: true, kind: 'minBreaks' };
const pure: EngineOptions = {
  warmStart: false,
  theoryShortcut: false,
  lns: false,
  timeLimitMs: 300_000,
};
const ms = (x: number) => (x < 1000 ? `${x.toFixed(0)} ms` : `${(x / 1000).toFixed(2)} s`);
const table = (title: string, head: string[], rows: (string | number)[][]) => {
  const lines = [
    `\n### ${title}`,
    `| ${head.join(' | ')} |`,
    `|${head.map(() => '---').join('|')}|`,
  ];
  for (const r of rows) lines.push(`| ${r.join(' | ')} |`);
  console.log(lines.join('\n'));
};

async function optimum(setup: Setup, options: EngineOptions, certifyMs = 0) {
  const t0 = performance.now();
  const engine = new Engine(setup, options);
  const out: Outcome = await engine.run();
  const time = performance.now() - t0;
  const cert = certifyMs > 0 ? engine.certify(certifyMs) : null;
  if ('schedule' in out && out.schedule)
    expect(validateSchedule(setup, out.schedule).ok).toBe(true);
  return { out, time, cert };
}

describe('validation', () => {
  it('breaks theorem, single round-robin (de Werra 1981): n − 2, and n − 3 is UNSAT', async () => {
    const rows: (string | number)[][] = [];
    for (let n = 4; n <= 16; n += 2) {
      const { out, time, cert } = await optimum(
        plainSetup(n, { constraints: [minBreaks] }),
        pure,
        120_000,
      );
      expect(out.status).toBe('optimal');
      if (out.status !== 'optimal') continue;
      expect(out.breaks).toBe(n - 2);
      expect(out.proof).toBe('solver');
      rows.push([
        n,
        n - 2,
        out.breaks,
        `UNSAT (${out.stats.conflicts.toLocaleString('en')} conflicts)`,
        ms(time),
        cert?.verified
          ? `✓ ${cert.lemmas.toLocaleString('en')} lemmas, ${ms(cert.ms)}`
          : (cert?.note ?? '—'),
      ]);
    }
    table(
      'Single round-robin: minimum breaks',
      ['n', 'theory n − 2', 'found', '≤ n − 3', 'time', 'RUP check'],
      rows,
    );
  });

  it('mirrored double round-robin: 3n − 6', async () => {
    const rows: (string | number)[][] = [];
    for (let n = 4; n <= 12; n += 2) {
      const setup = plainSetup(n, { format: 'double', mirrored: true, constraints: [minBreaks] });
      const { out, time, cert } = await optimum(setup, pure, 60_000);
      expect(out.status).toBe('optimal');
      if (out.status !== 'optimal') continue;
      expect(out.breaks).toBe(3 * n - 6);
      rows.push([n, 3 * n - 6, out.breaks, ms(time), cert?.verified ? '✓' : (cert?.note ?? '—')]);
    }
    table(
      'Mirrored double round-robin: minimum breaks',
      ['n', 'theory 3n − 6', 'proven optimum', 'time', 'RUP check'],
      rows,
    );
  });

  it('other formats: what the solver proves', async () => {
    const rows: (string | number)[][] = [];
    const cases: Array<[string, Setup]> = [];
    for (const n of [3, 5, 7, 9, 11])
      cases.push([`single, n = ${n}`, plainSetup(n, { constraints: [minBreaks] })]);
    for (const n of [3, 5, 7, 9])
      cases.push([
        `mirrored double, n = ${n}`,
        plainSetup(n, { format: 'double', mirrored: true, constraints: [minBreaks] }),
      ]);
    for (const n of [4, 6, 8, 10])
      cases.push([
        `free double, n = ${n}`,
        plainSetup(n, { format: 'double', mirrored: false, constraints: [minBreaks] }),
      ]);
    for (const [label, setup] of cases) {
      const { out, time } = await optimum(setup, { ...pure, timeLimitMs: 120_000 });
      rows.push([
        label,
        out.status === 'optimal' ? out.breaks : `${out.status}`,
        out.status === 'optimal' ? out.proof : '—',
        ms(time),
      ]);
    }
    table(
      'Other formats (proven by the solver, no theory used)',
      ['league', 'minimum breaks', 'proof', 'time'],
      rows,
    );
  });

  it('pigeonhole PHP(n + 1, n) is UNSAT, with RUP-checked proofs', () => {
    const rows: (string | number)[][] = [];
    for (let n = 3; n <= 8; n++) {
      const s = new Solver({ proof: true });
      pigeonhole(n + 1, n).loadInto(s);
      const t0 = performance.now();
      const r = s.solve();
      const time = performance.now() - t0;
      expect(r).toBe('unsat');
      const c0 = performance.now();
      const rup = checkRup(s.proof!, [], { deadline: c0 + 120_000 });
      rows.push([
        `PHP(${n + 1}, ${n})`,
        r,
        s.stats.conflicts.toLocaleString('en'),
        ms(time),
        rup.ok ? `✓ ${ms(performance.now() - c0)}` : rup.timedOut ? 'timed out' : '✗',
      ]);
    }
    table('Pigeonhole', ['instance', 'answer', 'conflicts', 'time', 'RUP check'], rows);
  });

  it('random 3-SAT at m/n = 4.26 agrees with exhaustive enumeration', () => {
    const rand = rng(424242);
    let sat = 0;
    let unsat = 0;
    let agree = 0;
    let time = 0;
    const N = 1000;
    for (let i = 0; i < N; i++) {
      const cnf = random3Sat(20, 85, rand);
      const truth = bruteForceCount(cnf) > 0;
      const s = new Solver();
      cnf.loadInto(s);
      const t0 = performance.now();
      const r = s.solve();
      time += performance.now() - t0;
      if ((r === 'sat') === truth) agree++;
      if (r === 'sat') {
        expect(satisfies(cnf, s.model())).toBe(true);
        sat++;
      } else unsat++;
    }
    expect(agree).toBe(N);
    table(
      'Random 3-SAT, n = 20, m = 85',
      ['instances', 'agree with brute force', 'SAT', 'UNSAT', 'mean solve time'],
      [[N, agree, sat, unsat, `${(time / N).toFixed(2)} ms`]],
    );
  });

  it('the example league and big leagues (as the app runs them)', async () => {
    const rows: (string | number)[][] = [];
    {
      const { out, time, cert } = await optimum(exampleSetup(), { timeLimitMs: 20_000 }, 10_000);
      rows.push([
        'Example: 8 clubs, mirrored double, 8 rules',
        out.status === 'optimal' ? `optimal (${out.proof}), ${out.breaks}` : out.status,
        ms(time),
        cert?.verified ? `✓ ${cert.lemmas.toLocaleString('en')} lemmas` : (cert?.note ?? '—'),
      ]);
    }
    const rules = (ids: string[]): Constraint[] => [
      minBreaks,
      { id: 'r', enabled: true, kind: 'maxRun', team: 'all', venue: 'either', max: 2 },
      { id: 'g', enabled: true, kind: 'sharedGround', a: ids[0], b: ids[1] },
      { id: 'v1', enabled: true, kind: 'venue', team: ids[2], round: 5, venue: 'home' },
      { id: 'v2', enabled: true, kind: 'venue', team: ids[3], round: 5, venue: 'home' },
      { id: 'e', enabled: true, kind: 'balancedEnds', where: 'both' },
    ];
    for (const [label, format, mirrored] of [
      ['20 clubs, single + 5 rules', 'single', true],
      ['20 clubs, mirrored double + 5 rules', 'double', true],
      ['20 clubs, free double + 5 rules', 'double', false],
    ] as const) {
      const base = plainSetup(20, { format, mirrored });
      const setup = { ...base, constraints: rules(base.teams.map((t) => t.id)) };
      let first = -1;
      const t0 = performance.now();
      const out = await new Engine(setup, {
        timeLimitMs: 20_000,
        proof: false,
        onEvent: (e) => {
          if (e.type === 'solution' && first < 0) first = performance.now() - t0;
        },
      }).run();
      if ('schedule' in out && out.schedule)
        expect(validateSchedule(setup, out.schedule).ok).toBe(true);
      rows.push([
        label,
        out.status === 'optimal'
          ? `optimal (${out.proof}), ${out.breaks}`
          : `${out.status}, best ${'breaks' in out ? out.breaks : '—'}`,
        `${ms(performance.now() - t0)} (first schedule ${ms(first)})`,
        '—',
      ]);
    }
    table(
      'As the app runs them (20 s limit, warm start, LNS, theory bound)',
      ['league', 'result', 'time', 'RUP check'],
      rows,
    );
  });
});
