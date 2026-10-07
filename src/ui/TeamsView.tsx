import { memo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { textOn } from '../crest/color';
import type { Schedule, Setup } from '../model/types';
import type { Validation } from '../validate/validate';
import { Crest } from './Crest';
import { teamCodes } from './teamCodes';
import { CalendarIcon } from './icons';

interface Props {
  setup: Setup;
  schedule: Schedule;
  validation: Validation;
  onCalendar: (team: number) => void;
}

/** Per-team strips: one row per club, one cell per round, breaks joined in red. */
export const TeamsView = memo(function TeamsView({
  setup,
  schedule,
  validation,
  onCalendar,
}: Props) {
  const codes = teamCodes(setup.teams);
  const T = schedule.rounds.length;
  const [focus, setFocus] = useState<[number, number]>([0, 0]);
  const tableRef = useRef<HTMLTableElement>(null);

  const opponent: number[][] = setup.teams.map(() => new Array<number>(T).fill(-1));
  schedule.rounds.forEach((round, r) => {
    for (const m of round.matches) {
      opponent[m.home][r] = m.away;
      opponent[m.away][r] = m.home;
    }
  });

  const move = (t: number, r: number) => {
    const tt = Math.max(0, Math.min(setup.teams.length - 1, t));
    const rr = Math.max(0, Math.min(T - 1, r));
    setFocus([tt, rr]);
    tableRef.current?.querySelector<HTMLElement>(`[data-cell="${tt}-${rr}"]`)?.focus();
  };
  const onKey = (e: KeyboardEvent, t: number, r: number) => {
    const moves: Record<string, [number, number]> = {
      ArrowRight: [t, r + 1],
      ArrowLeft: [t, r - 1],
      ArrowDown: [t + 1, r],
      ArrowUp: [t - 1, r],
      Home: [t, 0],
      End: [t, T - 1],
    };
    const to = moves[e.key];
    if (to) {
      e.preventDefault();
      move(to[0], to[1]);
    }
  };

  return (
    <div
      className="strip-wrap"
      role="region"
      aria-label="Home and away pattern of every club"
      tabIndex={0}
    >
      <table className="strip" ref={tableRef}>
        <caption className="sr-only">
          Home (H), away (A) and rest days for every club in every round. Breaks — two home or two
          away games in a row — are marked.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="strip-team-h">
              Club
            </th>
            {schedule.rounds.map((_, r) => (
              <th key={r} scope="col" className="strip-round">
                {r + 1}
              </th>
            ))}
            <th scope="col" className="strip-breaks-h">
              Breaks
            </th>
          </tr>
        </thead>
        <tbody>
          {setup.teams.map((team, t) => (
            <tr key={team.id}>
              <th scope="row" className="strip-team">
                <span className="strip-team-inner">
                  <Crest name={team.name || '?'} colors={team.colors} size={20} />
                  <span className="strip-name">{team.name || 'Unnamed'}</span>
                  <button
                    type="button"
                    className="icon-btn icon-btn--small strip-cal"
                    aria-label={`Download ${team.name} calendar (.ics)`}
                    title="Download calendar (.ics)"
                    onClick={() => onCalendar(t)}
                  >
                    <CalendarIcon size={15} />
                  </button>
                </span>
              </th>
              {schedule.rounds.map((_, r) => {
                const st = validation.status[t]?.[r] ?? 'B';
                const brk = validation.breakAt[t]?.[r] ?? false;
                const opp = opponent[t][r];
                const venueWord = st === 'H' ? 'home' : st === 'A' ? 'away' : 'rest';
                const label =
                  st === 'B'
                    ? `${team.name}, round ${r + 1}: rest`
                    : `${team.name}, round ${r + 1}: ${venueWord} ${st === 'H' ? 'against' : 'at'} ${setup.teams[opp]?.name}${brk ? ', break' : ''}`;
                const isFocus = focus[0] === t && focus[1] === r;
                return (
                  <td
                    key={r}
                    className={`strip-cell strip-cell--${st}${brk ? ' is-break' : ''}`}
                    style={
                      {
                        '--team': team.colors[0],
                        '--team-text': textOn(team.colors[0]),
                      } as CSSProperties
                    }
                    data-cell={`${t}-${r}`}
                    tabIndex={isFocus ? 0 : -1}
                    aria-label={label}
                    title={label}
                    onFocus={() => setFocus([t, r])}
                    onKeyDown={(e) => onKey(e, t, r)}
                  >
                    <span className="strip-venue" aria-hidden="true">
                      {st === 'B' ? '–' : st}
                    </span>
                    <span className="strip-opp" aria-hidden="true">
                      {opp >= 0 ? codes[opp] : 'rest'}
                    </span>
                  </td>
                );
              })}
              <td className={`strip-breaks${validation.breaksPerTeam[t] === 0 ? ' is-zero' : ''}`}>
                {validation.breaksPerTeam[t]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});
