/**
 * Input checks that run before any solving. These catch setups that are malformed or
 * over-subscribed in an obvious, countable way (a team fixed twice in one round, a pair
 * fixed more often than it meets). Genuine conflicts between valid constraints are left to
 * the solver, which explains them with a minimal unsatisfiable subset.
 */
import { MAX_TEAMS, MIN_TEAMS, roundIndex, seasonOf } from './season';
import type { Constraint, RoundRef, Setup } from './types';

export interface InputIssue {
  code:
    | 'team-count'
    | 'team-name'
    | 'duplicate-name'
    | 'team-colour'
    | 'date'
    | 'interval'
    | 'unknown-team'
    | 'round-range'
    | 'same-team'
    | 'group-size'
    | 'bad-number'
    | 'season-too-short'
    | 'double-booked'
    | 'pair-overbooked'
    | 'host-overbooked';
  message: string;
  constraintId?: string;
  teamId?: string;
  /** For round-range issues: the last valid round, so the UI can offer to move it there. */
  lastRound?: number;
}

const HEX = /^#[0-9a-f]{6}$/i;

export function inputIssues(setup: Setup): InputIssue[] {
  const issues: InputIssue[] = [];
  const n = setup.teams.length;
  if (n < MIN_TEAMS || n > MAX_TEAMS) {
    issues.push({
      code: 'team-count',
      message: `A league needs between ${MIN_TEAMS} and ${MAX_TEAMS} teams (it has ${n}).`,
    });
    return issues;
  }
  const s = seasonOf(setup);

  const seen = new Map<string, string>();
  for (const team of setup.teams) {
    const name = team.name.trim();
    if (name === '') {
      issues.push({ code: 'team-name', message: 'Every team needs a name.', teamId: team.id });
      continue;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      issues.push({
        code: 'duplicate-name',
        message: `Two teams are called “${name}”.`,
        teamId: team.id,
      });
    }
    seen.set(key, team.id);
    if (!HEX.test(team.colors[0]) || !HEX.test(team.colors[1])) {
      issues.push({
        code: 'team-colour',
        message: `${name} has an invalid colour.`,
        teamId: team.id,
      });
    }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(setup.startDate) || Number.isNaN(Date.parse(setup.startDate))) {
    issues.push({ code: 'date', message: 'The start date is not a valid date.' });
  }
  if (!Number.isInteger(setup.intervalDays) || setup.intervalDays < 1 || setup.intervalDays > 60) {
    issues.push({ code: 'interval', message: 'Rounds must be 1 to 60 days apart.' });
  }

  const teamIds = new Set(setup.teams.map((t) => t.id));
  const nameOf = (id: string) => setup.teams.find((t) => t.id === id)?.name.trim() || 'a team';
  const label = (c: Constraint) => describeKind(c.kind);

  const checkTeam = (c: Constraint, id: string) => {
    if (!teamIds.has(id)) {
      issues.push({
        code: 'unknown-team',
        message: `A “${label(c)}” rule refers to a team that is no longer in the league.`,
        constraintId: c.id,
      });
      return false;
    }
    return true;
  };
  const checkRound = (c: Constraint, ref: RoundRef) => {
    if (ref === 'last') return true;
    if (!Number.isInteger(ref) || ref < 1 || ref > s.T) {
      issues.push({
        code: 'round-range',
        message: `A “${label(c)}” rule uses round ${ref}, but the season has ${s.T} round${s.T === 1 ? '' : 's'}.`,
        constraintId: c.id,
        lastRound: s.T,
      });
      return false;
    }
    return true;
  };
  const checkCount = (c: Constraint, value: number, min: number, what: string) => {
    if (!Number.isInteger(value) || value < min) {
      issues.push({
        code: 'bad-number',
        message: `A “${label(c)}” rule needs ${what} of at least ${min}.`,
        constraintId: c.id,
      });
    }
  };

  const fixedRounds = new Map<string, string>(); // `${team}@${round}` → constraint id
  const pairCount = new Map<string, number>();
  const hostCount = new Map<string, number>();

  for (const c of setup.constraints) {
    if (!c.enabled) continue;
    switch (c.kind) {
      case 'venue':
      case 'unavailable':
        checkTeam(c, c.team);
        checkRound(c, c.round);
        break;
      case 'fixed': {
        const okTeams = checkTeam(c, c.a) && checkTeam(c, c.b);
        const okRound = checkRound(c, c.round);
        if (okTeams && c.a === c.b) {
          issues.push({
            code: 'same-team',
            message: 'A fixed match needs two different teams.',
            constraintId: c.id,
          });
          break;
        }
        if (!okTeams || !okRound) break;
        const r = roundIndex(c.round, s);
        for (const t of [c.a, c.b]) {
          const key = `${t}@${r}`;
          if (fixedRounds.has(key)) {
            issues.push({
              code: 'double-booked',
              message: `${nameOf(t)} has two fixed matches in round ${r + 1}.`,
              constraintId: c.id,
            });
          }
          fixedRounds.set(key, c.id);
        }
        const pairKey = [c.a, c.b].sort().join('|');
        const count = (pairCount.get(pairKey) ?? 0) + 1;
        pairCount.set(pairKey, count);
        if (count > s.legs) {
          issues.push({
            code: 'pair-overbooked',
            message: `${nameOf(c.a)} and ${nameOf(c.b)} meet ${s.legs === 1 ? 'once' : 'twice'} but have ${count} fixed matches.`,
            constraintId: c.id,
          });
        }
        if (c.host !== 'either' && s.legs === 2) {
          const host = c.host === 'a' ? c.a : c.b;
          const guest = c.host === 'a' ? c.b : c.a;
          const hk = `${host}>${guest}`;
          const hc = (hostCount.get(hk) ?? 0) + 1;
          hostCount.set(hk, hc);
          if (hc > 1) {
            issues.push({
              code: 'host-overbooked',
              message: `${nameOf(host)} hosts ${nameOf(guest)} only once, but two fixed matches say so.`,
              constraintId: c.id,
            });
          }
        }
        break;
      }
      case 'maxRun':
        if (c.team !== 'all') checkTeam(c, c.team);
        checkCount(c, c.max, 1, 'a run length');
        break;
      case 'breakCap':
        checkCount(c, c.max, 0, 'a cap');
        break;
      case 'sharedGround':
        if (checkTeam(c, c.a) && checkTeam(c, c.b) && c.a === c.b) {
          issues.push({
            code: 'same-team',
            message: 'A shared ground needs two different teams.',
            constraintId: c.id,
          });
        }
        break;
      case 'noEarlyMeeting': {
        const distinct = new Set(c.teams);
        let allKnown = true;
        for (const id of distinct) allKnown = checkTeam(c, id) && allKnown;
        if (allKnown && distinct.size < 2) {
          issues.push({
            code: 'group-size',
            message: 'Pick at least two teams that should not meet early.',
            constraintId: c.id,
          });
        }
        checkCount(c, c.rounds, 1, 'a number of rounds');
        if (Number.isInteger(c.rounds) && c.rounds > s.T) {
          issues.push({
            code: 'round-range',
            message: `“Don’t meet early” covers ${c.rounds} rounds, but the season has ${s.T}.`,
            constraintId: c.id,
            lastRound: s.T,
          });
        }
        break;
      }
      case 'balancedEnds':
        if (s.T < 2) {
          issues.push({
            code: 'season-too-short',
            message: 'A one-round season has no start or finish to balance.',
            constraintId: c.id,
          });
        }
        break;
      case 'minBreaks':
        break;
    }
  }
  return issues;
}

export function describeKind(kind: Constraint['kind']): string {
  switch (kind) {
    case 'venue':
      return 'Home or away';
    case 'unavailable':
      return 'Unavailable';
    case 'fixed':
      return 'Fixed match';
    case 'maxRun':
      return 'Runs';
    case 'minBreaks':
      return 'Fewest breaks';
    case 'breakCap':
      return 'Break cap';
    case 'sharedGround':
      return 'Shared ground';
    case 'noEarlyMeeting':
      return 'Don’t meet early';
    case 'balancedEnds':
      return 'Balanced start & finish';
  }
}
