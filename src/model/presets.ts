import type { Constraint, Setup, Team } from './types';

/** Fictional clubs for the example league and for new teams. */
export const CLUB_POOL: Array<Omit<Team, 'id'>> = [
  { name: 'Kestrel Vale', colors: ['#1f6b3a', '#f2c230'] },
  { name: 'Harbour Lights', colors: ['#1b2a4a', '#f3eee4'] },
  { name: 'Millstone Athletic', colors: ['#7a1f3d', '#8ec5e8'] },
  { name: 'Saltmarsh Rovers', colors: ['#e8701a', '#141414'] },
  { name: 'Ironside United', colors: ['#c8202f', '#ffffff'] },
  { name: 'Lantern Hill', colors: ['#5b2a86', '#f5d33f'] },
  { name: 'Copperfield Town', colors: ['#a8502a', '#f6e3c4'] },
  { name: 'Northgate Wanderers', colors: ['#1d4ed8', '#ffffff'] },
  { name: 'Brackwater Albion', colors: ['#0f766e', '#ffffff'] },
  { name: 'Foxholme Borough', colors: ['#141414', '#e8c547'] },
  { name: 'Quarry Lane', colors: ['#6b7280', '#c8202f'] },
  { name: 'Ashby Meadows', colors: ['#4d7c0f', '#f3eee4'] },
  { name: 'Westerley', colors: ['#0369a1', '#f2c230'] },
  { name: 'Ravenscar City', colors: ['#111827', '#d1d5db'] },
  { name: 'Tidewell Park', colors: ['#0e7490', '#f97316'] },
  { name: 'Hollin Bridge', colors: ['#9f1239', '#fde68a'] },
  { name: 'Marlow Common', colors: ['#3f6212', '#fef3c7'] },
  { name: 'Stonegate Celtic', colors: ['#166534', '#ffffff'] },
  { name: 'Calder Heath', colors: ['#7c2d12', '#93c5fd'] },
  { name: 'Peregrine Fields', colors: ['#334155', '#fb7185'] },
];

let counter = 0;
/** Short, collision-resistant ids (unique within a page session; shared links keep theirs). */
export function newId(prefix: string): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}${Date.now().toString(36).slice(-4)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/** The example league that opens on first load. */
export function exampleSetup(): Setup {
  const teams: Team[] = CLUB_POOL.slice(0, 8).map((t, i) => ({ ...t, id: `t${i + 1}` }));
  const [kestrel, harbour, millstone, saltmarsh, ironside, lantern] = teams.map((t) => t.id);
  const constraints: Constraint[] = [
    { id: 'c1', enabled: true, kind: 'minBreaks' },
    { id: 'c2', enabled: true, kind: 'sharedGround', a: harbour, b: saltmarsh },
    { id: 'c3', enabled: true, kind: 'venue', team: kestrel, round: 3, venue: 'not-home' },
    { id: 'c4', enabled: true, kind: 'fixed', a: millstone, b: ironside, round: 'last', host: 'a' },
    { id: 'c5', enabled: true, kind: 'venue', team: lantern, round: 1, venue: 'home' },
    {
      id: 'c6',
      enabled: true,
      kind: 'noEarlyMeeting',
      teams: [kestrel, millstone, lantern],
      rounds: 3,
    },
    { id: 'c7', enabled: true, kind: 'maxRun', team: 'all', venue: 'either', max: 2 },
    { id: 'c8', enabled: true, kind: 'balancedEnds', where: 'both' },
  ];
  return {
    name: 'The Fixture League',
    teams,
    format: 'double',
    mirrored: true,
    startDate: '2026-08-15',
    intervalDays: 7,
    constraints,
  };
}

/** A league of n teams with the given constraints (used by tests and validation runs). */
export function plainSetup(
  n: number,
  options: { format?: 'single' | 'double'; mirrored?: boolean; constraints?: Constraint[] } = {},
): Setup {
  const teams: Team[] = Array.from({ length: n }, (_, i) => ({
    id: `t${i + 1}`,
    name: CLUB_POOL[i % CLUB_POOL.length].name + (i >= CLUB_POOL.length ? ' II' : ''),
    colors: CLUB_POOL[i % CLUB_POOL.length].colors,
  }));
  return {
    name: `${n} teams`,
    teams,
    format: options.format ?? 'single',
    mirrored: options.mirrored ?? true,
    startDate: '2026-08-15',
    intervalDays: 7,
    constraints: options.constraints ?? [],
  };
}
