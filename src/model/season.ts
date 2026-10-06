import type { RoundRef, Setup } from './types';

export const MIN_TEAMS = 2;
export const MAX_TEAMS = 20;

/**
 * The shape of a season. With an odd number of teams a dummy team is added; whoever "plays"
 * the dummy has a bye. N is therefore always even and every leg has N − 1 rounds.
 */
export interface Season {
  /** Real teams. */
  n: number;
  /** Teams including the dummy (always even). */
  N: number;
  /** Index of the dummy team (= n) when n is odd, otherwise -1. */
  dummy: number;
  /** Rounds per leg. */
  R: number;
  legs: 1 | 2;
  /** Total rounds. */
  T: number;
  mirrored: boolean;
}

export function seasonOf(setup: Pick<Setup, 'teams' | 'format' | 'mirrored'>): Season {
  return season(setup.teams.length, setup.format === 'double', setup.mirrored);
}

export function season(n: number, double: boolean, mirrored: boolean): Season {
  const N = n % 2 === 0 ? n : n + 1;
  const R = N - 1;
  const legs = double ? 2 : 1;
  return { n, N, dummy: n % 2 === 0 ? -1 : n, R, legs, T: legs * R, mirrored: double && mirrored };
}

/** Resolves a round reference to a 0-based round index (may be out of range). */
export function roundIndex(ref: RoundRef, s: Season): number {
  return ref === 'last' ? s.T - 1 : ref - 1;
}

/** Number of times each pair of teams meets. */
export function meetingsPerPair(s: Season): number {
  return s.legs;
}

/** Matches each team plays in a season (byes excluded). */
export function matchesPerTeam(s: Season): number {
  return s.legs * (s.n - 1);
}

/** ISO date of a round (0-based), from the setup's start date and interval. */
export function roundDate(setup: Pick<Setup, 'startDate' | 'intervalDays'>, r: number): string {
  const [y, m, d] = setup.startDate.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + r * setup.intervalDays * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export interface BreakBound {
  value: number;
  /** True when the bound is known to be attained (with no other constraints). */
  exact: boolean;
  source: string;
}

/**
 * Break bounds with no other constraints (de Werra 1981, via the Rasmussen & Trick survey):
 * n − 2 for a single round-robin with n even, 3n − 6 for a mirrored double round-robin,
 * 0 for a single round-robin with an odd number of teams. For any other even format,
 * n − 2 still bounds from below: at most two teams can avoid breaks, because two
 * break-free teams with the same alternating pattern could never meet.
 */
export function breakBound(s: Season): BreakBound | null {
  if (s.n < 2) return null;
  if (s.n % 2 !== 0) {
    return s.legs === 1 ? { value: 0, exact: true, source: 'odd team count' } : null;
  }
  if (s.legs === 1) return { value: s.n - 2, exact: true, source: 'de Werra 1981' };
  if (s.mirrored) return { value: 3 * s.n - 6, exact: true, source: 'de Werra 1981' };
  return { value: s.n - 2, exact: false, source: 'at most two break-free teams' };
}
