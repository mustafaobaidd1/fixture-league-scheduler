/**
 * iCalendar (RFC 5545) export: one calendar per team, one all-day VEVENT per match.
 *
 * Details that matter to calendar apps: CRLF line endings, lines folded at 75 octets (not
 * characters) with a leading space on continuation lines, TEXT values escaping backslash,
 * semicolon, comma and newline, a stable UID per event, and DTEND as the exclusive end of an
 * all-day event (the next day).
 */
import { roundDate, seasonOf } from '../model/season';
import type { Schedule, Setup } from '../model/types';

const encoder = new TextEncoder();

export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Folds a content line so no physical line exceeds 75 octets of UTF-8. */
export function foldLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
      limit = 74; // continuation lines start with one space
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

const compactDate = (iso: string) => iso.replace(/-/g, '');

function utcStamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/** FNV-1a over a string: a short, stable fingerprint for UIDs. */
export function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function teamCalendar(
  setup: Setup,
  schedule: Schedule,
  team: number,
  generatedAt: Date = new Date(),
): string {
  const s = seasonOf(setup);
  const names = setup.teams.map((t) => t.name.trim());
  const id = fingerprint(
    JSON.stringify([setup.name, names, setup.format, setup.mirrored, setup.startDate]),
  );
  const stamp = utcStamp(generatedAt);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Mustafa Obaid//Fixture league scheduler//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(`${names[team]} — ${setup.name}`)}`,
  ];
  schedule.rounds.forEach((round, r) => {
    const m = round.matches.find((x) => x.home === team || x.away === team);
    if (!m) return;
    const date = roundDate(setup, r);
    const next = roundDate({ startDate: date, intervalDays: 1 }, 1);
    const home = m.home === team;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${id}-r${r + 1}-${m.home}-${m.away}@fixture-league-scheduler`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compactDate(date)}`,
      `DTEND;VALUE=DATE:${compactDate(next)}`,
      `SUMMARY:${escapeText(`${names[m.home]} v ${names[m.away]}`)}`,
      `DESCRIPTION:${escapeText(
        `Round ${r + 1} of ${s.T}. ${names[team]} plays ${home ? 'at home' : `away at ${names[m.home]}`}.`,
      )}`,
      `CATEGORIES:${home ? 'Home' : 'Away'}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  });
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/** A safe file name for a team's calendar. */
export function calendarFileName(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'team'}-fixtures.ics`;
}
