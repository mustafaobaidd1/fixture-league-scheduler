import { memo, useCallback, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { pinFor } from '../app/edit';
import { roundDate, type Season } from '../model/season';
import type { Schedule, Setup } from '../model/types';
import type { Validation } from '../validate/validate';
import { Crest } from './Crest';
import { PinIcon } from './icons';

const dayFmt = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return dayFmt.format(new Date(Date.UTC(y, m - 1, d)));
}

interface Props {
  setup: Setup;
  season: Season;
  schedule: Schedule;
  validation: Validation;
  conflictIds: string[];
  reveal: number;
  onTogglePin: (round: number, home: number, away: number) => void;
}

export const RoundsView = memo(function RoundsView({
  setup,
  season,
  schedule,
  validation,
  conflictIds,
  reveal,
  onTogglePin,
}: Props) {
  const [focus, setFocus] = useState<[number, number]>([0, 0]);
  const gridRef = useRef<HTMLDivElement>(null);

  const move = useCallback(
    (r: number, m: number) => {
      const R = schedule.rounds.length;
      const rr = Math.max(0, Math.min(R - 1, r));
      const count = schedule.rounds[rr].matches.length;
      const mm = Math.max(0, Math.min(count - 1, m));
      setFocus([rr, mm]);
      gridRef.current?.querySelector<HTMLElement>(`[data-cell="${rr}-${mm}"]`)?.focus();
    },
    [schedule],
  );

  const onKey = (e: KeyboardEvent, r: number, m: number) => {
    const perRound = schedule.rounds[r].matches.length;
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        if (m + 1 < perRound) move(r, m + 1);
        else move(r + 1, 0);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (m > 0) move(r, m - 1);
        else move(r - 1, Number.MAX_SAFE_INTEGER);
        break;
      case 'ArrowDown':
        e.preventDefault();
        move(r + 1, m);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(r - 1, m);
        break;
      case 'Home':
        e.preventDefault();
        move(0, 0);
        break;
      case 'End':
        e.preventDefault();
        move(schedule.rounds.length - 1, Number.MAX_SAFE_INTEGER);
        break;
    }
  };

  const name = (t: number) => setup.teams[t]?.name || 'Unnamed';

  return (
    <div
      className="rounds"
      ref={gridRef}
      key={reveal}
      aria-describedby="rounds-help"
      style={
        {
          '--step': `${Math.min(12, 180 / Math.max(1, schedule.rounds.length)).toFixed(1)}ms`,
        } as CSSProperties
      }
    >
      <p className="sr-only" id="rounds-help">
        Arrow keys move between matches. Enter or Space pins a match to its round.
      </p>
      {schedule.rounds.map((round, r) => (
        <article
          key={r}
          className={`round${season.legs === 2 && r === season.R ? ' round--half' : ''}`}
          style={{ '--i': r } as CSSProperties}
          aria-labelledby={`round-${r}`}
        >
          {season.legs === 2 && r === season.R && (
            <p className="half-tag">
              Second half{season.mirrored ? ' · mirrors round 1 onwards' : ' · return fixtures'}
            </p>
          )}
          <header className="round-head">
            <h3 id={`round-${r}`} className="round-title">
              <span className="round-word">Round</span>
              <span className="round-num">{r + 1}</span>
            </h3>
            <time className="round-date" dateTime={roundDate(setup, r)}>
              {formatDate(roundDate(setup, r))}
            </time>
          </header>
          <ul className="tickets">
            {round.matches.map((m, k) => {
              const pin = pinFor(setup, r, m.home, m.away);
              const pinned = pin !== undefined;
              const clash = pinned && conflictIds.includes(pin.id);
              const homeBreak = validation.breakAt[m.home]?.[r];
              const awayBreak = validation.breakAt[m.away]?.[r];
              const isFocus = focus[0] === r && focus[1] === k;
              const label =
                `Round ${r + 1}: ${name(m.home)} at home against ${name(m.away)}.` +
                (homeBreak ? ` Break for ${name(m.home)}: second home game in a row.` : '') +
                (awayBreak ? ` Break for ${name(m.away)}: second away game in a row.` : '') +
                (pinned ? ' Pinned to this round.' : '');
              return (
                <li key={`${m.home}-${m.away}`}>
                  <button
                    type="button"
                    className={`ticket${pinned ? ' is-pinned' : ''}${clash ? ' is-clash' : ''}`}
                    data-cell={`${r}-${k}`}
                    tabIndex={isFocus ? 0 : -1}
                    aria-pressed={pinned}
                    aria-label={label}
                    onFocus={() => setFocus([r, k])}
                    onKeyDown={(e) => onKey(e, r, k)}
                    onClick={() => onTogglePin(r, m.home, m.away)}
                  >
                    <TeamLine team={m.home} setup={setup} venue="H" brk={homeBreak} />
                    <TeamLine team={m.away} setup={setup} venue="A" brk={awayBreak} />
                    <span className="ticket-pin" aria-hidden="true">
                      <PinIcon size={15} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {round.bye !== null && (
            <p className="round-bye">
              <span className="round-bye-tag">Rest</span> {name(round.bye)}
            </p>
          )}
        </article>
      ))}
    </div>
  );
});

function TeamLine({
  team,
  setup,
  venue,
  brk,
}: {
  team: number;
  setup: Setup;
  venue: 'H' | 'A';
  brk: boolean | undefined;
}) {
  const t = setup.teams[team];
  return (
    <span
      className={`ticket-team ticket-team--${venue === 'H' ? 'home' : 'away'}`}
      style={{ '--team': t.colors[0] } as CSSProperties}
    >
      <span className="ticket-block" aria-hidden="true" />
      <Crest name={t.name || '?'} colors={t.colors} size={20} />
      <span className="ticket-name">{t.name || 'Unnamed'}</span>
      <span
        className={`venue-tag${brk ? ' venue-tag--break' : ''}`}
        aria-hidden="true"
        title={
          brk
            ? venue === 'H'
              ? 'Break: second home game in a row'
              : 'Break: second away game in a row'
            : undefined
        }
      >
        {brk ? venue + venue : venue}
      </span>
    </span>
  );
}
