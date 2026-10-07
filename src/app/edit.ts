/** Pure edits of a setup, used by the UI. */
import { breakBound, MAX_TEAMS, MIN_TEAMS, roundIndex, seasonOf } from '../model/season';
import { CLUB_POOL, newId } from '../model/presets';
import type { Constraint, ConstraintKind, Setup, Team } from '../model/types';

export function addTeam(setup: Setup): Setup {
  if (setup.teams.length >= MAX_TEAMS) return setup;
  const used = new Set(setup.teams.map((t) => t.name.trim().toLowerCase()));
  const club =
    CLUB_POOL.find((c) => !used.has(c.name.toLowerCase())) ??
    ({ name: `Team ${setup.teams.length + 1}`, colors: ['#334155', '#f3eee4'] } as const);
  const team: Team = { id: newId('t'), name: club.name, colors: [club.colors[0], club.colors[1]] };
  return { ...setup, teams: [...setup.teams, team] };
}

/** Removes a team and every rule that mentions it (groups just lose the member). */
export function removeTeam(setup: Setup, id: string): { setup: Setup; dropped: number } {
  if (setup.teams.length <= MIN_TEAMS) return { setup, dropped: 0 };
  let dropped = 0;
  const constraints: Constraint[] = [];
  for (const c of setup.constraints) {
    if (c.kind === 'noEarlyMeeting') {
      const teams = c.teams.filter((t) => t !== id);
      if (teams.length < 2 && c.teams.includes(id)) {
        dropped++;
        continue;
      }
      constraints.push({ ...c, teams });
      continue;
    }
    const refs = mentions(c);
    if (refs.includes(id)) {
      dropped++;
      continue;
    }
    constraints.push(c);
  }
  return {
    setup: { ...setup, teams: setup.teams.filter((t) => t.id !== id), constraints },
    dropped,
  };
}

export function mentions(c: Constraint): string[] {
  switch (c.kind) {
    case 'venue':
    case 'unavailable':
      return [c.team];
    case 'fixed':
    case 'sharedGround':
      return [c.a, c.b];
    case 'maxRun':
      return c.team === 'all' ? [] : [c.team];
    case 'noEarlyMeeting':
      return c.teams;
    default:
      return [];
  }
}

export function updateTeam(setup: Setup, id: string, patch: Partial<Omit<Team, 'id'>>): Setup {
  return { ...setup, teams: setup.teams.map((t) => (t.id === id ? { ...t, ...patch } : t)) };
}

export function defaultConstraint(setup: Setup, kind: ConstraintKind): Constraint {
  const ids = setup.teams.map((t) => t.id);
  const s = seasonOf(setup);
  const base = { id: newId('c'), enabled: true };
  switch (kind) {
    case 'venue':
      return { ...base, kind, team: ids[0], round: Math.min(2, s.T), venue: 'home' };
    case 'unavailable':
      return { ...base, kind, team: ids[ids.length - 1], round: 1 };
    case 'fixed':
      return { ...base, kind, a: ids[0], b: ids[1], round: 'last', host: 'a' };
    case 'maxRun':
      return { ...base, kind, team: 'all', venue: 'either', max: 2 };
    case 'minBreaks':
      return { ...base, kind };
    case 'breakCap': {
      const bound = breakBound(s);
      return { ...base, kind, scope: 'total', max: Math.max(bound?.value ?? 0, s.n) };
    }
    case 'sharedGround':
      return { ...base, kind, a: ids[0], b: ids[Math.min(1, ids.length - 1)] };
    case 'noEarlyMeeting':
      return {
        ...base,
        kind,
        teams: ids.slice(0, Math.min(3, ids.length)),
        rounds: Math.min(2, s.T),
      };
    case 'balancedEnds':
      return { ...base, kind, where: 'both' };
  }
}

export function addConstraint(setup: Setup, kind: ConstraintKind): { setup: Setup; id: string } {
  const c = defaultConstraint(setup, kind);
  return { setup: { ...setup, constraints: [...setup.constraints, c] }, id: c.id };
}

export function replaceConstraint(setup: Setup, next: Constraint): Setup {
  return { ...setup, constraints: setup.constraints.map((c) => (c.id === next.id ? next : c)) };
}

export function removeConstraint(setup: Setup, id: string): Setup {
  return { ...setup, constraints: setup.constraints.filter((c) => c.id !== id) };
}

/** The enabled fixed-match rule that pins this exact meeting, if any. */
export function pinFor(setup: Setup, round: number, a: number, b: number): Constraint | undefined {
  const s = seasonOf(setup);
  const ia = setup.teams[a]?.id;
  const ib = setup.teams[b]?.id;
  return setup.constraints.find(
    (c) =>
      c.enabled &&
      c.kind === 'fixed' &&
      roundIndex(c.round, s) === round &&
      ((c.a === ia && c.b === ib) || (c.a === ib && c.b === ia)),
  );
}

/** Pins a match as it is scheduled (home team hosts), or unpins it. */
export function togglePin(
  setup: Setup,
  round: number,
  home: number,
  away: number,
): { setup: Setup; pinned: boolean } {
  const existing = pinFor(setup, round, home, away);
  if (existing) return { setup: removeConstraint(setup, existing.id), pinned: false };
  const c: Constraint = {
    id: newId('c'),
    enabled: true,
    kind: 'fixed',
    a: setup.teams[home].id,
    b: setup.teams[away].id,
    round: round + 1,
    host: 'a',
  };
  return { setup: { ...setup, constraints: [...setup.constraints, c] }, pinned: true };
}
