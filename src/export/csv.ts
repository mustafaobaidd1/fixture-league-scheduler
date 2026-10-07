/** CSV export (RFC 4180: CRLF line breaks, fields with commas/quotes/newlines quoted). */
import { roundDate } from '../model/season';
import type { Schedule, Setup } from '../model/types';
import { validateSchedule } from '../validate/validate';

export function csvField(value: string | number): string {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function scheduleCsv(setup: Setup, schedule: Schedule): string {
  const v = validateSchedule(setup, schedule);
  const name = (t: number) => setup.teams[t]?.name.trim() ?? '';
  const pinned = (r: number, a: number, b: number) =>
    setup.constraints.some((c) => {
      if (!c.enabled || c.kind !== 'fixed') return false;
      const round = c.round === 'last' ? schedule.rounds.length : c.round;
      const ia = setup.teams.findIndex((t) => t.id === c.a);
      const ib = setup.teams.findIndex((t) => t.id === c.b);
      return round === r + 1 && ((ia === a && ib === b) || (ia === b && ib === a));
    });
  const rows: Array<Array<string | number>> = [
    ['Round', 'Date', 'Home', 'Away', 'Home break', 'Away break', 'Notes'],
  ];
  schedule.rounds.forEach((round, r) => {
    const date = roundDate(setup, r);
    for (const m of round.matches) {
      rows.push([
        r + 1,
        date,
        name(m.home),
        name(m.away),
        v.breakAt[m.home]?.[r] ? 'yes' : '',
        v.breakAt[m.away]?.[r] ? 'yes' : '',
        pinned(r, m.home, m.away) ? 'Fixed' : '',
      ]);
    }
    if (round.bye !== null) rows.push([r + 1, date, '', '', '', '', `${name(round.bye)} rest`]);
  });
  return rows.map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n';
}
