/**
 * The league setup a user edits, and the schedules the solver produces.
 *
 * Teams are referenced by stable ids inside constraints, and by index (their position in
 * `Setup.teams`) inside schedules, which are tied to the setup they were solved for.
 */

export interface Team {
  id: string;
  name: string;
  /** Primary and secondary colours, as #rrggbb. */
  colors: [string, string];
}

export type Format = 'single' | 'double';

/** A round number (1-based) or the season's final round, whatever its number. */
export type RoundRef = number | 'last';

interface ConstraintBase {
  id: string;
  enabled: boolean;
}

/** Venue availability: a team must (not) play at home in a round. */
export interface VenueConstraint extends ConstraintBase {
  kind: 'venue';
  team: string;
  round: RoundRef;
  venue: 'home' | 'away' | 'not-home';
}

/** A team cannot play in a round (it must take the round's bye). */
export interface UnavailableConstraint extends ConstraintBase {
  kind: 'unavailable';
  team: string;
  round: RoundRef;
}

/** Match a–b in a round; `host` says who is at home ('either' leaves the venue open). */
export interface FixedConstraint extends ConstraintBase {
  kind: 'fixed';
  a: string;
  b: string;
  round: RoundRef;
  host: 'a' | 'b' | 'either';
}

/** No more than `max` home (or away) games in a row, for one team or all. */
export interface MaxRunConstraint extends ConstraintBase {
  kind: 'maxRun';
  team: string | 'all';
  venue: 'home' | 'away' | 'either';
  max: number;
}

/** Minimise the total number of breaks (the objective). */
export interface MinBreaksConstraint extends ConstraintBase {
  kind: 'minBreaks';
}

/** Cap breaks: in total, or for every team. */
export interface BreakCapConstraint extends ConstraintBase {
  kind: 'breakCap';
  scope: 'total' | 'perTeam';
  max: number;
}

/** Two teams share a ground: never both at home in the same round. */
export interface SharedGroundConstraint extends ConstraintBase {
  kind: 'sharedGround';
  a: string;
  b: string;
}

/** The selected teams do not meet each other in the first `rounds` rounds. */
export interface NoEarlyMeetingConstraint extends ConstraintBase {
  kind: 'noEarlyMeeting';
  teams: string[];
  rounds: number;
}

/** No team opens and/or closes the season with two home or two away games in a row. */
export interface BalancedEndsConstraint extends ConstraintBase {
  kind: 'balancedEnds';
  where: 'start' | 'end' | 'both';
}

export type Constraint =
  | VenueConstraint
  | UnavailableConstraint
  | FixedConstraint
  | MaxRunConstraint
  | MinBreaksConstraint
  | BreakCapConstraint
  | SharedGroundConstraint
  | NoEarlyMeetingConstraint
  | BalancedEndsConstraint;

export type ConstraintKind = Constraint['kind'];

/** A constraint without its identity fields (distributes over the union). */
export type ConstraintBody = Constraint extends infer C
  ? C extends Constraint
    ? Omit<C, 'id' | 'enabled'>
    : never
  : never;

export interface Setup {
  name: string;
  teams: Team[];
  format: Format;
  /** Double round-robin only: the second half repeats the first with venues swapped. */
  mirrored: boolean;
  /** First matchday, YYYY-MM-DD (used for calendar export). */
  startDate: string;
  /** Days between consecutive rounds. */
  intervalDays: number;
  constraints: Constraint[];
}

/** One match: team indices into Setup.teams. */
export interface Match {
  home: number;
  away: number;
}

export interface Round {
  matches: Match[];
  /** The team resting this round (odd team counts only). */
  bye: number | null;
}

export interface Schedule {
  rounds: Round[];
}
