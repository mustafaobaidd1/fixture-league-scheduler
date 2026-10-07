import { describe, expect, it } from 'vitest';
import { canonicalSchedule } from '../model/construct';
import { exampleSetup, plainSetup } from '../model/presets';
import { seasonOf } from '../model/season';
import type { Setup } from '../model/types';
import { csvField, scheduleCsv } from './csv';
import { calendarFileName, escapeText, foldLine, teamCalendar } from './ics';
import { decodeSetup, encodeSetup, ShareError } from './share';
import { crc32, zip } from './zip';

const enc = new TextEncoder();
const dec = new TextDecoder();

describe('ICS export (RFC 5545)', () => {
  const setup = plainSetup(6, { format: 'double', mirrored: true });
  const schedule = canonicalSchedule(seasonOf(setup));
  const ics = teamCalendar(setup, schedule, 0, new Date(Date.UTC(2026, 9, 6, 12, 0, 0)));

  it('produces one VEVENT per match of the team, wrapped in a VCALENDAR', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)?.length).toBe(10); // 2 × (6 − 1) matches
    expect(ics.match(/END:VEVENT/g)?.length).toBe(10);
  });

  it('uses CRLF everywhere and never exceeds 75 octets per line', () => {
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    for (const line of ics.split('\r\n')) expect(enc.encode(line).length).toBeLessThanOrEqual(75);
  });

  it('writes all-day events with an exclusive end date and required properties', () => {
    // Round 1 is the start date; DTEND is the following day.
    expect(ics).toContain('DTSTART;VALUE=DATE:20260815\r\nDTEND;VALUE=DATE:20260816');
    expect(ics).toContain('DTSTAMP:20261006T120000Z');
    const uids = ics.match(/^UID:.*$/gm) ?? [];
    expect(uids.length).toBe(10);
    expect(new Set(uids).size).toBe(10);
  });

  it('escapes TEXT values and folds by octets, not characters', () => {
    expect(escapeText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
    const long = `SUMMARY:${'é'.repeat(60)}`;
    const folded = foldLine(long);
    for (const part of folded.split('\r\n'))
      expect(enc.encode(part).length).toBeLessThanOrEqual(75);
    // Unfolding (remove CRLF + one space) restores the original line.
    expect(folded.replace(/\r\n /g, '')).toBe(long);
  });

  it('makes safe file names', () => {
    expect(calendarFileName('Kestrel Vale')).toBe('kestrel-vale-fixtures.ics');
    expect(calendarFileName('Saint-Étienne / B')).toBe('saint-etienne-b-fixtures.ics');
    expect(calendarFileName('***')).toBe('team-fixtures.ics');
  });
});

describe('CSV export (RFC 4180)', () => {
  it('quotes fields that need it', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
  });

  it('lists every match and every bye with dates', () => {
    const setup: Setup = plainSetup(5);
    const schedule = canonicalSchedule(seasonOf(setup));
    const lines = scheduleCsv(setup, schedule).trimEnd().split('\r\n');
    expect(lines[0]).toBe('Round,Date,Home,Away,Home break,Away break,Notes');
    // 5 rounds × 2 matches + 5 byes.
    expect(lines.length - 1).toBe(15);
    expect(lines.filter((l) => l.endsWith(' rest')).length).toBe(5);
    expect(lines[1].startsWith('1,2026-08-15,')).toBe(true);
  });
});

describe('ZIP writer', () => {
  it('computes the standard CRC-32 check value', () => {
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
  });

  it('writes a readable stored archive', () => {
    const files = [
      { name: 'a.ics', data: enc.encode('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n') },
      { name: 'b.ics', data: enc.encode('hello') },
    ];
    const bytes = zip(files);
    const view = new DataView(bytes.buffer);
    // End of central directory record: entry count and directory offset.
    const end = bytes.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    let p = view.getUint32(end + 16, true);
    for (const f of files) {
      expect(view.getUint32(p, true)).toBe(0x02014b50);
      const size = view.getUint32(p + 24, true);
      const nameLen = view.getUint16(p + 28, true);
      const local = view.getUint32(p + 42, true);
      expect(dec.decode(bytes.subarray(p + 46, p + 46 + nameLen))).toBe(f.name);
      expect(view.getUint32(local, true)).toBe(0x04034b50);
      const localName = view.getUint16(local + 26, true);
      const data = bytes.subarray(local + 30 + localName, local + 30 + localName + size);
      expect(dec.decode(data)).toBe(dec.decode(f.data));
      expect(view.getUint32(p + 16, true)).toBe(crc32(f.data));
      p += 46 + nameLen;
    }
  });
});

describe('share links', () => {
  it('round-trips the example league', () => {
    const setup = exampleSetup();
    const back = decodeSetup('#' + encodeSetup(setup));
    expect(back.teams.map((t) => [t.name, t.colors])).toEqual(
      setup.teams.map((t) => [t.name, t.colors]),
    );
    expect(back.format).toBe(setup.format);
    expect(back.mirrored).toBe(setup.mirrored);
    expect(back.startDate).toBe(setup.startDate);
    // Constraints survive with team references remapped to the new ids.
    const strip = (s: Setup) =>
      JSON.stringify(s.constraints.map(({ id: _id, ...rest }) => rest)).replace(
        /"t\d+"/g,
        (m) => m,
      );
    expect(strip(back)).toBe(strip(setup));
  });

  it('round-trips every constraint kind, including disabled ones', () => {
    const setup = plainSetup(5, {
      format: 'double',
      mirrored: false,
      constraints: [
        { id: 'a', enabled: false, kind: 'venue', team: 't2', round: 'last', venue: 'not-home' },
        { id: 'b', enabled: true, kind: 'unavailable', team: 't3', round: 4 },
        { id: 'c', enabled: true, kind: 'fixed', a: 't1', b: 't5', round: 2, host: 'either' },
        { id: 'd', enabled: true, kind: 'maxRun', team: 'all', venue: 'away', max: 3 },
        { id: 'e', enabled: true, kind: 'minBreaks' },
        { id: 'f', enabled: true, kind: 'breakCap', scope: 'perTeam', max: 2 },
        { id: 'g', enabled: true, kind: 'sharedGround', a: 't4', b: 't2' },
        { id: 'h', enabled: true, kind: 'noEarlyMeeting', teams: ['t1', 't2', 't3'], rounds: 2 },
        { id: 'i', enabled: true, kind: 'balancedEnds', where: 'end' },
      ],
    });
    const back = decodeSetup(encodeSetup(setup));
    expect(back.constraints.map(({ id: _id, ...rest }) => rest)).toEqual(
      setup.constraints.map(({ id: _id, ...rest }) => rest),
    );
    expect(back.mirrored).toBe(false);
  });

  it('rejects damaged or hostile links with a readable error', () => {
    expect(() => decodeSetup('#nothing')).toThrow(ShareError);
    expect(() => decodeSetup('#s=%%%')).toThrow(ShareError);
    const evil = btoa(
      JSON.stringify({
        v: 1,
        n: 'x',
        f: 's',
        s: '2026-01-01',
        i: 7,
        t: [['a', 'zzzzzz', '000000']],
        c: [],
      }),
    );
    expect(() => decodeSetup('#s=' + evil)).toThrow(/team list|colour/);
    const badRef = encodeSetup(plainSetup(3)).replace(/^s=/, '');
    const data = JSON.parse(
      atob(
        badRef.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (badRef.length % 4)) % 4),
      ),
    );
    data.c = [['v', 1, 9, 1, 'h']];
    expect(() => decodeSetup('#s=' + btoa(JSON.stringify(data)))).toThrow(/team reference/);
  });
});
