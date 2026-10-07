/**
 * Original geometric crests: a shield outline, a heraldic-style division in the team's two
 * colours and a round plate carrying the initials. Every choice is derived from the team
 * name, so a club keeps its crest across sessions and share links.
 */
import { textOn } from './color';

export interface CrestLayer {
  d: string;
  fill: string;
}

export interface CrestSpec {
  /** Shield outline in a 100 × 120 box. */
  shape: string;
  layers: CrestLayer[];
  plateFill: string;
  plateRing: string;
  initials: string;
  textFill: string;
}

const SHAPES = [
  // heater
  'M6 6H94V54C94 86 74 104 50 116C26 104 6 86 6 54Z',
  // rounded base
  'M6 6H94V66A44 44 0 0 1 6 66Z',
  // pointed ogee
  'M6 6H94V62Q94 98 50 116Q6 98 6 62Z',
  // notched top
  'M6 14L28 6L50 14L72 6L94 14V58C94 88 74 104 50 116C26 104 6 88 6 58Z',
  // clipped corners
  'M18 6H82L94 18V62C94 90 74 106 50 116C26 106 6 90 6 62V18Z',
];

type Division = (a: string, b: string) => CrestLayer[];

const field = (fill: string): CrestLayer => ({ d: 'M0 0H100V120H0Z', fill });

const DIVISIONS: Division[] = [
  // per pale
  (a, b) => [field(a), { d: 'M50 0H100V120H50Z', fill: b }],
  // per fess
  (a, b) => [field(a), { d: 'M0 60H100V120H0Z', fill: b }],
  // per bend
  (a, b) => [field(b), { d: 'M0 0H100V120Z', fill: a }],
  // chevron
  (a, b) => [field(a), { d: 'M0 96L50 46L100 96V120L50 70L0 120Z', fill: b }],
  // quarterly
  (a, b) => [field(a), { d: 'M50 0H100V60H50Z', fill: b }, { d: 'M0 60H50V120H0Z', fill: b }],
  // pales
  (a, b) => [field(a), { d: 'M18 0H34V120H18ZM50 0H66V120H50ZM82 0H98V120H82Z', fill: b }],
  // hoops
  (a, b) => [field(a), { d: 'M0 22H100V40H0ZM0 58H100V76H0ZM0 94H100V112H0Z', fill: b }],
  // saltire
  (a, b) => [
    field(a),
    { d: 'M0 0H16L100 104V120H84L0 16Z', fill: b },
    { d: 'M100 0V16L16 120H0V104L84 0Z', fill: b },
  ],
  // chief
  (a, b) => [field(a), { d: 'M0 0H100V36H0Z', fill: b }],
];

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const SKIP = new Set(['fc', 'afc', 'cf', 'sc', 'the', 'of', 'and', '&']);

/** Up to two initials from the meaningful words of a name. */
export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/[\s\-–—.]+/)
    .filter((w) => w.length > 0 && !SKIP.has(w.toLowerCase()));
  if (words.length === 0) return name.trim().slice(0, 1).toUpperCase() || '?';
  const letters = words.slice(0, 2).map((w) => Array.from(w)[0].toUpperCase());
  return letters.join('');
}

export function crestFor(name: string, colors: [string, string]): CrestSpec {
  const h = hash(name.trim().toLowerCase());
  const shape = SHAPES[h % SHAPES.length];
  const division = DIVISIONS[Math.floor(h / SHAPES.length) % DIVISIONS.length];
  const [a, b] = colors;
  return {
    shape,
    layers: division(a, b),
    plateFill: a,
    plateRing: b,
    initials: initialsOf(name),
    textFill: textOn(a),
  };
}
