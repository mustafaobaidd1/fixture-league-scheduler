import { useId } from 'react';
import { addTeam, removeTeam, updateTeam } from '../app/edit';
import type { InputIssue } from '../model/issues';
import { MAX_TEAMS, MIN_TEAMS, type Season } from '../model/season';
import type { Setup } from '../model/types';
import { Crest } from './Crest';
import { PlusIcon, TrashIcon } from './icons';

interface Props {
  setup: Setup;
  season: Season;
  issues: InputIssue[];
  onChange: (setup: Setup) => void;
  onNotice: (text: string) => void;
}

export function LeaguePanel({ setup, season, issues, onChange, onNotice }: Props) {
  const uid = useId();
  const teamIssue = (id: string) => issues.find((i) => i.teamId === id);
  const setupIssue = (code: InputIssue['code']) => issues.find((i) => i.code === code);

  return (
    <section className="panel panel-league" aria-labelledby={`${uid}-h`}>
      <header className="panel-head">
        <span className="panel-num" aria-hidden="true">
          01
        </span>
        <h2 id={`${uid}-h`}>The league</h2>
        <span className="panel-meta">
          {setup.teams.length} of {MAX_TEAMS} clubs
        </span>
      </header>

      <div className="field">
        <label htmlFor={`${uid}-name`} className="label">
          League name
        </label>
        <input
          id={`${uid}-name`}
          className="input"
          value={setup.name}
          maxLength={60}
          onChange={(e) => onChange({ ...setup, name: e.target.value })}
        />
      </div>

      <ol className="team-list">
        {setup.teams.map((team, i) => {
          const issue = teamIssue(team.id);
          return (
            <li key={team.id} className="team-row">
              <Crest name={team.name || '?'} colors={team.colors} size={34} />
              <div className="team-name">
                <label className="sr-only" htmlFor={`${uid}-t${team.id}`}>
                  Name of team {i + 1}
                </label>
                <input
                  id={`${uid}-t${team.id}`}
                  className="input input--team"
                  value={team.name}
                  maxLength={40}
                  aria-invalid={issue ? true : undefined}
                  aria-describedby={issue ? `${uid}-e${team.id}` : undefined}
                  onChange={(e) => onChange(updateTeam(setup, team.id, { name: e.target.value }))}
                />
                {issue && (
                  <p className="field-error" id={`${uid}-e${team.id}`}>
                    {issue.message}
                  </p>
                )}
              </div>
              <label className="swatch" title="Primary colour">
                <span className="sr-only">Primary colour of {team.name || `team ${i + 1}`}</span>
                <input
                  type="color"
                  value={team.colors[0]}
                  onChange={(e) =>
                    onChange(
                      updateTeam(setup, team.id, { colors: [e.target.value, team.colors[1]] }),
                    )
                  }
                />
              </label>
              <label className="swatch" title="Secondary colour">
                <span className="sr-only">Secondary colour of {team.name || `team ${i + 1}`}</span>
                <input
                  type="color"
                  value={team.colors[1]}
                  onChange={(e) =>
                    onChange(
                      updateTeam(setup, team.id, { colors: [team.colors[0], e.target.value] }),
                    )
                  }
                />
              </label>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Remove ${team.name || `team ${i + 1}`}`}
                disabled={setup.teams.length <= MIN_TEAMS}
                onClick={() => {
                  const res = removeTeam(setup, team.id);
                  onChange(res.setup);
                  if (res.dropped > 0) {
                    onNotice(
                      `Removed ${team.name} and ${res.dropped} rule${res.dropped === 1 ? '' : 's'} that mentioned it.`,
                    );
                  }
                }}
              >
                <TrashIcon />
              </button>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        className="btn btn--outline btn--block"
        disabled={setup.teams.length >= MAX_TEAMS}
        onClick={() => onChange(addTeam(setup))}
      >
        <PlusIcon /> Add a club
      </button>
      {season.dummy >= 0 && (
        <p className="hint">
          With an odd number of clubs, one club rests (has a bye) in every round.
        </p>
      )}

      <fieldset className="fieldset">
        <legend className="label">Format</legend>
        <div className="segmented" role="radiogroup" aria-label="Round-robin format">
          {(['single', 'double'] as const).map((f) => (
            <label key={f} className={`segment${setup.format === f ? ' is-on' : ''}`}>
              <input
                type="radio"
                name={`${uid}-format`}
                value={f}
                checked={setup.format === f}
                onChange={() => onChange({ ...setup, format: f })}
              />
              <span>{f === 'single' ? 'Single' : 'Double'}</span>
              <small>{f === 'single' ? 'meet once' : 'home & away'}</small>
            </label>
          ))}
        </div>
        <label className={`switch-row${setup.format === 'single' ? ' is-disabled' : ''}`}>
          <input
            type="checkbox"
            role="switch"
            className="switch"
            checked={setup.format === 'double' && setup.mirrored}
            disabled={setup.format === 'single'}
            onChange={(e) => onChange({ ...setup, mirrored: e.target.checked })}
          />
          <span>
            Mirrored second half
            <small>Round {season.R + 1} repeats round 1 with venues swapped</small>
          </span>
        </label>
      </fieldset>

      <fieldset className="fieldset fieldset--calendar">
        <legend className="label">Calendar</legend>
        <div className="calendar-fields">
          <div className="field">
            <label htmlFor={`${uid}-date`} className="label label--small">
              First round
            </label>
            <input
              id={`${uid}-date`}
              className="input"
              type="date"
              value={setup.startDate}
              aria-invalid={setupIssue('date') ? true : undefined}
              onChange={(e) => onChange({ ...setup, startDate: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor={`${uid}-gap`} className="label label--small">
              Days between rounds
            </label>
            <input
              id={`${uid}-gap`}
              className="input"
              type="number"
              min={1}
              max={60}
              value={setup.intervalDays}
              aria-invalid={setupIssue('interval') ? true : undefined}
              onChange={(e) =>
                onChange({ ...setup, intervalDays: Math.round(Number(e.target.value)) })
              }
            />
          </div>
        </div>
        {(setupIssue('date') || setupIssue('interval')) && (
          <p className="field-error">{(setupIssue('date') ?? setupIssue('interval'))?.message}</p>
        )}
      </fieldset>
    </section>
  );
}
