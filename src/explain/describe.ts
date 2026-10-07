/**
 * Plain-language sentences for constraints, structural rules and relax actions.
 */
import type { StructuralGroup } from '../encode/encode';
import { breakBound, roundIndex, type Season } from '../model/season';
import type { Constraint, RoundRef, Team } from '../model/types';

export interface DescribeContext {
  teams: Team[];
  season: Season;
}

const listJoin = (items: string[]): string => {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
};

export function roundPhrase(ref: RoundRef, s: Season): string {
  if (ref === 'last') return `the final round (round ${s.T})`;
  return `round ${ref}`;
}

export function teamName(id: string, teams: Team[]): string {
  return teams.find((t) => t.id === id)?.name.trim() || 'a removed team';
}

/** One sentence that says what the constraint demands. */
export function describeConstraint(c: Constraint, ctx: DescribeContext): string {
  const name = (id: string) => teamName(id, ctx.teams);
  const s = ctx.season;
  switch (c.kind) {
    case 'venue': {
      const verb =
        c.venue === 'home'
          ? 'must play at home'
          : c.venue === 'away'
            ? 'must play away'
            : 'cannot play at home';
      return `${name(c.team)} ${verb} in ${roundPhrase(c.round, s)}.`;
    }
    case 'unavailable':
      return `${name(c.team)} cannot play in ${roundPhrase(c.round, s)} and must rest.`;
    case 'fixed': {
      const when = roundPhrase(c.round, s);
      if (c.host === 'either') return `${name(c.a)} and ${name(c.b)} must meet in ${when}.`;
      const [h, a] = c.host === 'a' ? [c.a, c.b] : [c.b, c.a];
      return `${name(h)} must host ${name(a)} in ${when}.`;
    }
    case 'maxRun': {
      const what =
        c.venue === 'either'
          ? `${c.max} home or ${c.max} away games`
          : `${c.max} ${c.venue} game${c.max === 1 ? '' : 's'}`;
      return c.team === 'all'
        ? `No team may play more than ${what} in a row.`
        : `${name(c.team)} may not play more than ${what} in a row.`;
    }
    case 'minBreaks':
      return 'Use as few breaks as possible.';
    case 'breakCap':
      return c.scope === 'total'
        ? `At most ${c.max} break${c.max === 1 ? '' : 's'} in the whole season.`
        : `No team may have more than ${c.max} break${c.max === 1 ? '' : 's'}.`;
    case 'sharedGround':
      return `${name(c.a)} and ${name(c.b)} share a ground, so they are never both at home in the same round.`;
    case 'noEarlyMeeting': {
      const teams = listJoin(c.teams.map(name));
      const rounds = c.rounds === 1 ? 'the first round' : `the first ${c.rounds} rounds`;
      return `${teams} must not meet each other in ${rounds}.`;
    }
    case 'balancedEnds': {
      const when = c.where === 'start' ? 'start' : c.where === 'end' ? 'end' : 'start or end';
      return `No team may ${when} the season with two home or two away games in a row.`;
    }
  }
}

/** Plain-language versions of the structural rules a conflict can rely on. */
export function describeStructural(g: StructuralGroup, s: Season): string {
  switch (g) {
    case 'onePerRound':
      return 'A team plays at most one match per round.';
    case 'playEveryRound':
      return s.dummy >= 0
        ? 'Every team plays in every round except its bye.'
        : 'Every team plays in every round — with an even number of teams nobody rests.';
    case 'pairsMeet':
      if (s.legs === 1) return 'Every pair of teams meets exactly once.';
      if (s.mirrored) return 'Every pair of teams meets exactly once in each half of the season.';
      return 'Every team hosts every other team exactly once.';
    case 'oneHome':
      return 'In every match one team is at home and the other away.';
    case 'mirror':
      return 'The second half repeats the first with home and away swapped.';
  }
}

/** Extra context when a conflict involves a break cap. */
export function theoryNote(conflict: Constraint[], s: Season): string | null {
  if (!conflict.some((c) => c.kind === 'breakCap' && c.scope === 'total')) return null;
  const bound = breakBound(s);
  if (bound === null || bound.value === 0) return null;
  const format =
    s.legs === 1
      ? 'single round-robin'
      : s.mirrored
        ? 'mirrored double round-robin'
        : 'double round-robin';
  const formula = s.legs === 1 || !s.mirrored ? 'n − 2' : '3n − 6';
  return bound.exact
    ? `Theory: any ${format} of ${s.n} teams has at least ${formula} = ${bound.value} breaks (de Werra, 1981).`
    : `Theory: at most two teams can avoid breaks, so ${s.n} teams need at least ${formula} = ${bound.value}.`;
}

export interface Relaxation {
  label: string;
  /** The loosened constraint (enabled), or null to switch the constraint off. */
  next: Constraint | null;
}

/** The gentlest way to loosen a constraint, plus switching it off. */
export function relaxations(c: Constraint, s: Season): Relaxation[] {
  const off: Relaxation = { label: 'Switch off', next: null };
  switch (c.kind) {
    case 'fixed':
      return c.host === 'either'
        ? [off]
        : [{ label: 'Allow either venue', next: { ...c, host: 'either' } }, off];
    case 'maxRun':
      return c.max + 1 < s.T
        ? [{ label: `Allow ${c.max + 1} in a row`, next: { ...c, max: c.max + 1 } }, off]
        : [off];
    case 'breakCap': {
      if (c.scope === 'perTeam') {
        return [{ label: `Allow ${c.max + 1} per team`, next: { ...c, max: c.max + 1 } }, off];
      }
      const bound = breakBound(s);
      const target = bound !== null && c.max < bound.value ? bound.value : c.max + 2;
      return [{ label: `Allow ${target} breaks`, next: { ...c, max: target } }, off];
    }
    case 'noEarlyMeeting':
      return c.rounds > 1
        ? [
            {
              label:
                c.rounds - 1 === 1
                  ? 'Only the first round'
                  : `Only the first ${c.rounds - 1} rounds`,
              next: { ...c, rounds: c.rounds - 1 },
            },
            off,
          ]
        : [off];
    case 'balancedEnds':
      return c.where === 'both'
        ? [{ label: 'Only at the start', next: { ...c, where: 'start' } }, off]
        : [off];
    default:
      return [off];
  }
}

/** Does round `ref` still exist? Used to keep "last" references meaningful. */
export function roundExists(ref: RoundRef, s: Season): boolean {
  const r = roundIndex(ref, s);
  return r >= 0 && r < s.T;
}
