import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { download } from '../app/hooks';
import type { AppState, Solved, View } from '../app/state';
import { scheduleCsv } from '../export/csv';
import { calendarFileName, teamCalendar } from '../export/ics';
import { zip } from '../export/zip';
import type { InputIssue } from '../model/issues';
import type { Season } from '../model/season';
import type { Setup } from '../model/types';
import type { Validation } from '../validate/validate';
import { CheckIcon, CrossIcon, DownloadIcon, LinkIcon, PlayIcon } from './icons';
import { RoundsView } from './RoundsView';
import { StatsView } from './StatsView';
import { TeamsView } from './TeamsView';
import type { Status } from './status';

interface Props {
  setup: Setup;
  season: Season;
  state: AppState;
  current: Solved | null;
  validation: Validation | null;
  status: Status;
  issues: InputIssue[];
  conflictIds: string[];
  onTogglePin: (round: number, home: number, away: number) => void;
  onView: (view: View) => void;
  onSolve: () => void;
  onKeepSearching: () => void;
  onGoToRules: () => void;
  /** Narrow layouts show the explanation above the fixtures instead of on the right. */
  explainAbove: boolean;
  /** The explanation panel, when it belongs in this column. */
  explain: ReactNode;
}

const VIEWS: Array<[View, string]> = [
  ['rounds', 'Rounds'],
  ['teams', 'Teams'],
  ['stats', 'Statistics'],
];

export function FixturesPanel(props: Props) {
  const { setup, season, state, current, validation, status, issues, conflictIds } = props;
  const uid = useId();
  const [pinHintSeen, setPinHintSeen] = useState(false);
  const pins = setup.constraints.filter((c) => c.kind === 'fixed').length;
  const showPinHint = !pinHintSeen && pins <= 1;

  const calendar = (team: number) => {
    if (!current) return;
    const ics = teamCalendar(setup, current.schedule, team);
    download(calendarFileName(setup.teams[team].name), ics, 'text/calendar;charset=utf-8');
  };

  const timedOut =
    state.outcome?.status === 'timeout' && current && state.outcomeFor === JSON.stringify(setup);

  return (
    <section
      className="panel panel-fixtures"
      id="fixtures"
      aria-labelledby={`${uid}-h`}
      tabIndex={-1}
    >
      <header className="panel-head panel-head--fixtures">
        <span className="panel-num" aria-hidden="true">
          03
        </span>
        <h2 id={`${uid}-h`}>Fixtures</h2>
        <span className="panel-meta">
          {season.T} rounds · {season.legs * ((season.n * (season.n - 1)) / 2)} matches
        </span>
      </header>

      <div className={`status-banner tone-${status.tone}`} role="status">
        <div
          className={`stamp${status.verified ? ' is-verified' : ''}`}
          aria-hidden={!status.verified}
        >
          {status.verified ? (
            <>
              <span className="stamp-word">Verified</span>
              <CheckIcon size={22} />
            </>
          ) : status.tone === 'running' ? (
            <span className="stamp-word stamp-word--muted">Solving</span>
          ) : (
            <span className="stamp-word stamp-word--muted">Unverified</span>
          )}
        </div>
        <div className="status-text">
          <p className="status-title">{status.title}</p>
          <p className="status-detail">{status.detail}</p>
          {status.verified && validation && (
            <p className="status-sub">
              Independent check: {validation.matches} matches, {validation.constraints.length} rule
              {validation.constraints.length === 1 ? '' : 's'}, structure — all hold.
            </p>
          )}
        </div>
        {timedOut && !state.running && (
          <button
            type="button"
            className="btn btn--outline btn--small"
            onClick={props.onKeepSearching}
          >
            Keep searching (+20 s)
          </button>
        )}
      </div>

      {props.explain}

      {current && validation && (
        <div className="fixtures-tools">
          <div className="segmented segmented--views" role="group" aria-label="View">
            {VIEWS.map(([v, label]) => (
              <button
                key={v}
                type="button"
                className={`segment${state.view === v ? ' is-on' : ''}`}
                aria-pressed={state.view === v}
                onClick={() => props.onView(v)}
              >
                {label}
              </button>
            ))}
          </div>
          <ExportMenu setup={setup} current={current} onCalendar={calendar} />
        </div>
      )}

      {current &&
        validation &&
        (status.tone === 'bad' || status.tone === 'warn') &&
        !state.running && (
          <p className="stale-note">
            {state.outcome?.status === 'unsat'
              ? 'Showing the previous schedule: no schedule can satisfy the current rules.'
              : 'Showing the last schedule found. Rules marked “Broken” fail on it — solve again to replace it.'}{' '}
            <button type="button" className="linklike" onClick={props.onGoToRules}>
              Review the rules
            </button>
          </p>
        )}

      {current && validation ? (
        <>
          {state.view === 'rounds' && (
            <>
              {showPinHint && (
                <p className="pin-hint">
                  <span className="pin-hint-dot" aria-hidden="true" />
                  <span className="hint-mouse">
                    Click a match to pin it to its round — the solver will keep it there.
                  </span>
                  <span className="hint-touch">Tap a match to pin it to its round.</span>
                </p>
              )}
              <RoundsView
                setup={setup}
                season={season}
                schedule={current.schedule}
                validation={validation}
                conflictIds={conflictIds}
                reveal={state.reveal}
                onTogglePin={(r, h, a) => {
                  setPinHintSeen(true);
                  props.onTogglePin(r, h, a);
                }}
              />
              <p className="legend">
                <span className="legend-item">
                  <span className="venue-tag">H</span> home
                </span>
                <span className="legend-item">
                  <span className="venue-tag venue-tag--away">A</span> away
                </span>
                <span className="legend-item">
                  <span className="venue-tag venue-tag--break">HH</span>
                  <span className="venue-tag venue-tag--break venue-tag--away">AA</span> break:
                  second home or away game in a row
                </span>
                <span className="legend-item">
                  <span className="legend-pin" aria-hidden="true" /> pinned match
                </span>
              </p>
            </>
          )}
          {state.view === 'teams' && (
            <TeamsView
              setup={setup}
              schedule={current.schedule}
              validation={validation}
              onCalendar={calendar}
            />
          )}
          {state.view === 'stats' && (
            <StatsView setup={setup} season={season} validation={validation} />
          )}
        </>
      ) : props.explain && state.outcome?.status === 'unsat' ? null : (
        <EmptyFixtures
          explainAbove={props.explainAbove}
          state={state}
          season={season}
          issues={issues}
          status={status}
          onSolve={props.onSolve}
          onGoToRules={props.onGoToRules}
        />
      )}
    </section>
  );
}

function EmptyFixtures({
  explainAbove,
  state,
  season,
  issues,
  status,
  onSolve,
  onGoToRules,
}: {
  explainAbove: boolean;
  state: AppState;
  season: Season;
  issues: InputIssue[];
  status: Status;
  onSolve: () => void;
  onGoToRules: () => void;
}) {
  if (state.running) {
    const perRound = Math.floor(season.N / 2);
    return (
      <div className="rounds rounds--skeleton" aria-hidden="true">
        {Array.from({ length: Math.min(season.T, 8) }, (_, r) => (
          <div key={r} className="round round--skeleton">
            <div className="round-head">
              <span className="round-title">
                <span className="round-word">Round</span>
                <span className="round-num">{r + 1}</span>
              </span>
            </div>
            {Array.from({ length: Math.min(perRound, 6) }, (_, k) => (
              <div key={k} className="ticket ticket--skeleton" />
            ))}
          </div>
        ))}
      </div>
    );
  }
  if (issues.length > 0) {
    return (
      <div className="empty empty--bad">
        <p className="empty-title">The solver can’t run yet</p>
        <ul className="issue-list">
          {issues.slice(0, 6).map((i, k) => (
            <li key={k}>
              <CrossIcon size={14} /> {i.message}
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn--outline" onClick={onGoToRules}>
          Review the rules
        </button>
      </div>
    );
  }
  if (state.outcome?.status === 'unsat') {
    const k = state.outcome.conflict.constraintIds.length;
    return (
      <div className="empty empty--bad empty--conflict">
        <p className="empty-figure" aria-hidden="true">
          {k}
        </p>
        <p className="empty-title">{k === 1 ? 'rule cannot hold' : 'rules clash'}</p>
        <p>
          No fixture list can satisfy every rule. The explanation{' '}
          {explainAbove ? 'above' : 'on the right'} names the smallest set to blame — relax one with
          a single click and the solver runs again.
        </p>
      </div>
    );
  }
  return (
    <div className="empty">
      <p className="empty-title">{status.title}</p>
      <p>{status.detail}</p>
      <button type="button" className="btn btn--solve" onClick={onSolve}>
        <PlayIcon /> Solve
      </button>
    </div>
  );
}

function ExportMenu({
  setup,
  current,
  onCalendar,
}: {
  setup: Setup;
  current: Solved;
  onCalendar: (t: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [team, setTeam] = useState(0);
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle');
  const ref = useRef<HTMLDivElement>(null);
  const uid = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        ref.current?.querySelector<HTMLElement>('.export-toggle')?.focus();
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const safeTeam = Math.min(team, setup.teams.length - 1);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
    window.setTimeout(() => setCopied('idle'), 2500);
  };

  return (
    <div className="export" ref={ref}>
      <button
        type="button"
        className="btn btn--outline btn--small export-toggle"
        aria-expanded={open}
        aria-controls={`${uid}-menu`}
        onClick={() => setOpen((o) => !o)}
      >
        <DownloadIcon size={16} />
        <span>
          Export<span className="wide-only"> &amp; share</span>
        </span>
      </button>
      {open && (
        <div className="export-menu" id={`${uid}-menu`}>
          <button
            type="button"
            className="export-item"
            onClick={() =>
              download(
                'fixtures.csv',
                scheduleCsv(setup, current.schedule),
                'text/csv;charset=utf-8',
              )
            }
          >
            <strong>Fixture list</strong>
            <span>CSV · every round, date and break</span>
          </button>
          <div className="export-item export-item--row">
            <label htmlFor={`${uid}-team`}>
              <strong>One club’s calendar</strong>
              <span>ICS · one event per match</span>
            </label>
            <div className="export-cal">
              <select
                id={`${uid}-team`}
                className="inline-select"
                value={safeTeam}
                onChange={(e) => setTeam(Number(e.target.value))}
              >
                {setup.teams.map((t, i) => (
                  <option key={t.id} value={i}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn--small" onClick={() => onCalendar(safeTeam)}>
                Download
              </button>
            </div>
          </div>
          <button
            type="button"
            className="export-item"
            onClick={() => {
              const enc = new TextEncoder();
              const used = new Map<string, number>();
              const files = setup.teams.map((t, i) => {
                let name = calendarFileName(t.name);
                const k = used.get(name) ?? 0;
                used.set(name, k + 1);
                if (k > 0) name = name.replace(/\.ics$/, `-${k + 1}.ics`);
                return { name, data: enc.encode(teamCalendar(setup, current.schedule, i)) };
              });
              download('fixture-calendars.zip', zip(files), 'application/zip');
            }}
          >
            <strong>Every club’s calendar</strong>
            <span>ZIP of {setup.teams.length} ICS files</span>
          </button>
          <button type="button" className="export-item" onClick={copy}>
            <strong>
              <LinkIcon size={15} />{' '}
              {copied === 'ok'
                ? 'Link copied'
                : copied === 'fail'
                  ? 'Copy failed — use the address bar'
                  : 'Copy share link'}
            </strong>
            <span>The whole setup lives in the link</span>
          </button>
          <p className="sr-only" aria-live="polite">
            {copied === 'ok'
              ? 'Share link copied to the clipboard.'
              : copied === 'fail'
                ? 'Could not copy the link.'
                : ''}
          </p>
        </div>
      )}
    </div>
  );
}
