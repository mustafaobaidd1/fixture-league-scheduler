import { describe, expect, it } from 'vitest';
import { inputIssues } from '../model/issues';
import { exampleSetup, plainSetup } from '../model/presets';
import { seasonOf } from '../model/season';
import type { Constraint } from '../model/types';
import { describeConstraint, describeStructural, relaxations, theoryNote } from './describe';

describe('plain-language descriptions', () => {
  const setup = exampleSetup();
  const ctx = { teams: setup.teams, season: seasonOf(setup) };
  const text = (c: Constraint) => describeConstraint(c, ctx);

  it('describes the example league in plain sentences', () => {
    const lines = setup.constraints.map(text);
    expect(lines).toEqual([
      'Use as few breaks as possible.',
      'Harbour Lights and Saltmarsh Rovers share a ground, so they are never both at home in the same round.',
      'Kestrel Vale cannot play at home in round 3.',
      'Millstone Athletic must host Ironside United in the final round (round 14).',
      'Lantern Hill must play at home in round 1.',
      'Kestrel Vale, Millstone Athletic and Lantern Hill must not meet each other in the first 3 rounds.',
      'No team may play more than 2 home or 2 away games in a row.',
      'No team may start or end the season with two home or two away games in a row.',
    ]);
  });

  it('names the structural rules for each format', () => {
    expect(describeStructural('playEveryRound', seasonOf(plainSetup(6)))).toMatch(/nobody rests/);
    expect(describeStructural('playEveryRound', seasonOf(plainSetup(7)))).toMatch(/except its bye/);
    expect(describeStructural('pairsMeet', seasonOf(plainSetup(6)))).toBe(
      'Every pair of teams meets exactly once.',
    );
    expect(
      describeStructural(
        'pairsMeet',
        seasonOf(plainSetup(6, { format: 'double', mirrored: false })),
      ),
    ).toMatch(/hosts every other team/);
  });

  it('adds the breaks theorem when a cap is involved', () => {
    const cap: Constraint = { id: 'x', enabled: true, kind: 'breakCap', scope: 'total', max: 3 };
    expect(theoryNote([cap], seasonOf(plainSetup(8)))).toBe(
      'Theory: any single round-robin of 8 teams has at least n − 2 = 6 breaks (de Werra, 1981).',
    );
    expect(theoryNote([cap], seasonOf(plainSetup(8, { format: 'double' })))).toMatch(/3n − 6 = 18/);
    expect(theoryNote([], seasonOf(plainSetup(8)))).toBeNull();
  });

  it('offers gentle relaxations before switching off', () => {
    const s = seasonOf(plainSetup(8));
    const run: Constraint = {
      id: 'r',
      enabled: true,
      kind: 'maxRun',
      team: 'all',
      venue: 'either',
      max: 2,
    };
    expect(relaxations(run, s).map((r) => r.label)).toEqual(['Allow 3 in a row', 'Switch off']);
    const cap: Constraint = { id: 'c', enabled: true, kind: 'breakCap', scope: 'total', max: 2 };
    expect(relaxations(cap, s)[0]).toMatchObject({ label: 'Allow 6 breaks', next: { max: 6 } });
    const pin: Constraint = {
      id: 'p',
      enabled: true,
      kind: 'fixed',
      a: 't1',
      b: 't2',
      round: 3,
      host: 'a',
    };
    expect(relaxations(pin, s)[0].next).toMatchObject({ host: 'either' });
    const venue: Constraint = {
      id: 'v',
      enabled: true,
      kind: 'venue',
      team: 't1',
      round: 3,
      venue: 'home',
    };
    expect(relaxations(venue, s)).toEqual([{ label: 'Switch off', next: null }]);
  });
});

describe('input checks', () => {
  it('accepts the example league', () => {
    expect(inputIssues(exampleSetup())).toEqual([]);
  });

  it('flags malformed and over-subscribed setups', () => {
    const codes = (constraints: Constraint[], n = 6) =>
      inputIssues(plainSetup(n, { constraints })).map((i) => i.code);
    expect(
      codes([{ id: 'a', enabled: true, kind: 'venue', team: 't1', round: 9, venue: 'home' }]),
    ).toEqual(['round-range']);
    expect(
      codes([{ id: 'a', enabled: true, kind: 'venue', team: 'gone', round: 2, venue: 'home' }]),
    ).toEqual(['unknown-team']);
    expect(
      codes([
        { id: 'a', enabled: true, kind: 'fixed', a: 't1', b: 't2', round: 1, host: 'a' },
        { id: 'b', enabled: true, kind: 'fixed', a: 't2', b: 't1', round: 4, host: 'a' },
      ]),
    ).toEqual(['pair-overbooked']);
    expect(
      codes([{ id: 'a', enabled: true, kind: 'noEarlyMeeting', teams: ['t1'], rounds: 2 }]),
    ).toEqual(['group-size']);
    expect(codes([{ id: 'a', enabled: true, kind: 'sharedGround', a: 't1', b: 't1' }])).toEqual([
      'same-team',
    ]);
    // Disabled constraints are not checked.
    expect(
      codes([{ id: 'a', enabled: false, kind: 'venue', team: 't1', round: 99, venue: 'home' }]),
    ).toEqual([]);
  });

  it('flags duplicate names and bad dates', () => {
    const setup = plainSetup(4);
    setup.teams[1].name = setup.teams[0].name.toUpperCase();
    setup.startDate = '2026-13-45';
    const codes = inputIssues(setup).map((i) => i.code);
    expect(codes).toContain('duplicate-name');
    expect(codes).toContain('date');
  });
});
