import { describe, expect, it } from 'vitest';
import { CLUB_POOL } from '../model/presets';
import { contrast, luminance, textOn } from './color';
import { crestFor, initialsOf } from './crest';

describe('colour maths (WCAG 2.x)', () => {
  it('matches the reference luminance and contrast values', () => {
    expect(luminance('#ffffff')).toBeCloseTo(1, 6);
    expect(luminance('#000000')).toBe(0);
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 6);
    // #767676 on white is the classic 4.54:1 boundary colour.
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });

  it('always picks a text colour with at least 4.5:1 contrast', () => {
    for (let v = 0; v < 256; v += 5) {
      for (const hex of [
        `#${v.toString(16).padStart(2, '0').repeat(3)}`,
        `#ff${v.toString(16).padStart(2, '0')}00`,
      ]) {
        expect(contrast(hex, textOn(hex))).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('crests', () => {
  it('derives initials from the meaningful words of a name', () => {
    expect(initialsOf('Kestrel Vale')).toBe('KV');
    expect(initialsOf('FC Harbour Lights')).toBe('HL');
    expect(initialsOf('Westerley')).toBe('W');
    expect(initialsOf('  ')).toBe('?');
    expect(initialsOf('Saint-Étienne')).toBe('SÉ');
  });

  it('is deterministic and varies between clubs', () => {
    const a = crestFor('Kestrel Vale', ['#1f6b3a', '#f2c230']);
    expect(crestFor('Kestrel Vale', ['#1f6b3a', '#f2c230'])).toEqual(a);
    const designs = new Set(
      CLUB_POOL.map((c) => crestFor(c.name, c.colors)).map(
        (c) => c.shape + c.layers.length + c.layers.map((l) => l.d).join(),
      ),
    );
    expect(designs.size).toBeGreaterThan(8);
  });

  it('keeps the initials readable on their plate', () => {
    for (const club of CLUB_POOL) {
      const c = crestFor(club.name, club.colors);
      expect(contrast(c.plateFill, c.textFill)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
