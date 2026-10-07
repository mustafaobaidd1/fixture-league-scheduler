/**
 * Share links: the whole setup packed into the URL hash as compact JSON in base64url.
 * Teams are referenced by position, so links stay short; decoding validates every field and
 * re-creates ids. Schedules are not included — the solver is deterministic, so the same
 * setup reproduces the same schedule.
 */
import { MAX_TEAMS, MIN_TEAMS } from '../model/season';
import type { Constraint, RoundRef, Setup, Team } from '../model/types';

const VERSION = 1;
const PREFIX = 's=';

type Packed = (string | number | number[])[];

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const packRound = (r: RoundRef) => (r === 'last' ? -1 : r);
const unpackRound = (r: unknown): RoundRef => {
  if (r === -1) return 'last';
  if (typeof r === 'number' && Number.isInteger(r) && r >= 1 && r <= 99) return r;
  throw new ShareError('a round number is invalid');
};

export class ShareError extends Error {}

export function encodeSetup(setup: Setup): string {
  const index = new Map(setup.teams.map((t, i) => [t.id, i]));
  const ti = (id: string) => index.get(id) ?? -1;
  const constraints: Packed[] = [];
  for (const c of setup.constraints) {
    const e = c.enabled ? 1 : 0;
    switch (c.kind) {
      case 'venue':
        constraints.push([
          'v',
          e,
          ti(c.team),
          packRound(c.round),
          c.venue === 'home' ? 'h' : c.venue === 'away' ? 'a' : 'n',
        ]);
        break;
      case 'unavailable':
        constraints.push(['u', e, ti(c.team), packRound(c.round)]);
        break;
      case 'fixed':
        constraints.push([
          'f',
          e,
          ti(c.a),
          ti(c.b),
          packRound(c.round),
          c.host === 'either' ? 'e' : c.host,
        ]);
        break;
      case 'maxRun':
        constraints.push(['r', e, c.team === 'all' ? -1 : ti(c.team), c.venue[0], c.max]);
        break;
      case 'minBreaks':
        constraints.push(['m', e]);
        break;
      case 'breakCap':
        constraints.push(['b', e, c.scope === 'total' ? 't' : 'p', c.max]);
        break;
      case 'sharedGround':
        constraints.push(['g', e, ti(c.a), ti(c.b)]);
        break;
      case 'noEarlyMeeting':
        constraints.push(['x', e, c.teams.map(ti), c.rounds]);
        break;
      case 'balancedEnds':
        constraints.push(['e', e, c.where[0]]);
        break;
    }
  }
  const packed = {
    v: VERSION,
    n: setup.name,
    f: setup.format === 'double' ? (setup.mirrored ? 'm' : 'd') : 's',
    s: setup.startDate,
    i: setup.intervalDays,
    t: setup.teams.map((t) => [t.name, t.colors[0].slice(1), t.colors[1].slice(1)]),
    c: constraints,
  };
  return PREFIX + toBase64Url(new TextEncoder().encode(JSON.stringify(packed)));
}

export function decodeSetup(hash: string): Setup {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw.startsWith(PREFIX)) throw new ShareError('the link does not contain a league');
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(fromBase64Url(raw.slice(PREFIX.length))));
  } catch {
    throw new ShareError('the link is damaged or incomplete');
  }
  if (typeof data !== 'object' || data === null) throw new ShareError('the link is damaged');
  const d = data as Record<string, unknown>;
  if (d.v !== VERSION) throw new ShareError('the link comes from a different version');

  const str = (x: unknown, what: string, max = 80) => {
    if (typeof x !== 'string' || x.length > max) throw new ShareError(`${what} is invalid`);
    return x;
  };
  const int = (x: unknown, what: string, min: number, max: number) => {
    if (typeof x !== 'number' || !Number.isInteger(x) || x < min || x > max) {
      throw new ShareError(`${what} is invalid`);
    }
    return x;
  };
  const hex = (x: unknown) => {
    if (typeof x !== 'string' || !/^[0-9a-f]{6}$/i.test(x))
      throw new ShareError('a colour is invalid');
    return `#${x.toLowerCase()}`;
  };

  if (!Array.isArray(d.t) || d.t.length < MIN_TEAMS || d.t.length > MAX_TEAMS) {
    throw new ShareError('the team list is invalid');
  }
  const teams: Team[] = d.t.map((row, i) => {
    if (!Array.isArray(row) || row.length !== 3) throw new ShareError('a team is invalid');
    return {
      id: `t${i + 1}`,
      name: str(row[0], 'a team name', 40),
      colors: [hex(row[1]), hex(row[2])],
    };
  });
  const team = (x: unknown) => teams[int(x, 'a team reference', 0, teams.length - 1)].id;

  if (!Array.isArray(d.c) || d.c.length > 60)
    throw new ShareError('the constraint list is invalid');
  const constraints: Constraint[] = d.c.map((row, k) => {
    if (!Array.isArray(row) || typeof row[0] !== 'string')
      throw new ShareError('a constraint is invalid');
    const base = { id: `c${k + 1}`, enabled: row[1] === 1 };
    const pick = <T extends string>(x: unknown, map: Record<string, T>): T => {
      if (typeof x !== 'string' || !(x in map))
        throw new ShareError('a constraint option is invalid');
      return map[x];
    };
    switch (row[0]) {
      case 'v':
        return {
          ...base,
          kind: 'venue',
          team: team(row[2]),
          round: unpackRound(row[3]),
          venue: pick(row[4], { h: 'home', a: 'away', n: 'not-home' } as const),
        };
      case 'u':
        return { ...base, kind: 'unavailable', team: team(row[2]), round: unpackRound(row[3]) };
      case 'f':
        return {
          ...base,
          kind: 'fixed',
          a: team(row[2]),
          b: team(row[3]),
          round: unpackRound(row[4]),
          host: pick(row[5], { a: 'a', b: 'b', e: 'either' } as const),
        };
      case 'r':
        return {
          ...base,
          kind: 'maxRun',
          team: row[2] === -1 ? 'all' : team(row[2]),
          venue: pick(row[3], { h: 'home', a: 'away', e: 'either' } as const),
          max: int(row[4], 'a run length', 1, 99),
        };
      case 'm':
        return { ...base, kind: 'minBreaks' };
      case 'b':
        return {
          ...base,
          kind: 'breakCap',
          scope: pick(row[2], { t: 'total', p: 'perTeam' } as const),
          max: int(row[3], 'a break cap', 0, 999),
        };
      case 'g':
        return { ...base, kind: 'sharedGround', a: team(row[2]), b: team(row[3]) };
      case 'x': {
        if (!Array.isArray(row[2]) || row[2].length > MAX_TEAMS)
          throw new ShareError('a team group is invalid');
        return {
          ...base,
          kind: 'noEarlyMeeting',
          teams: row[2].map(team),
          rounds: int(row[3], 'a round count', 1, 99),
        };
      }
      case 'e':
        return {
          ...base,
          kind: 'balancedEnds',
          where: pick(row[2], { s: 'start', e: 'end', b: 'both' } as const),
        };
      default:
        throw new ShareError('a constraint type is unknown');
    }
  });

  const format = pick3(d.f);
  return {
    name: str(d.n, 'the league name', 60),
    teams,
    format: format === 's' ? 'single' : 'double',
    mirrored: format !== 'd',
    startDate: (() => {
      const s = str(d.s, 'the start date', 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s)))
        throw new ShareError('the start date is invalid');
      return s;
    })(),
    intervalDays: int(d.i, 'the round interval', 1, 60),
    constraints,
  };
}

function pick3(x: unknown): 's' | 'm' | 'd' {
  if (x === 's' || x === 'm' || x === 'd') return x;
  throw new ShareError('the season format is invalid');
}
