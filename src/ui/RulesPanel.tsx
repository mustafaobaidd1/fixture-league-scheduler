import { useEffect, useId, useRef, type ReactNode } from 'react';
import { replaceConstraint } from '../app/edit';
import { describeConstraint } from '../explain/describe';
import type { InputIssue } from '../model/issues';
import { describeKind } from '../model/issues';
import type { Season } from '../model/season';
import type { Constraint, ConstraintKind, RoundRef, Setup } from '../model/types';
import type { Validation } from '../validate/validate';
import { CheckIcon, CrossIcon, PlusIcon, TrashIcon } from './icons';

interface Props {
  setup: Setup;
  season: Season;
  issues: InputIssue[];
  validation: Validation | null;
  conflictIds: string[];
  onChange: (setup: Setup) => void;
  onAdd: (kind: ConstraintKind) => string;
  onRemove: (id: string) => void;
}

const CHIPS: Array<[ConstraintKind, string]> = [
  ['venue', 'Home or away'],
  ['unavailable', 'Rest day'],
  ['fixed', 'Fixed match'],
  ['maxRun', 'Max run'],
  ['minBreaks', 'Fewest breaks'],
  ['breakCap', 'Break cap'],
  ['sharedGround', 'Shared ground'],
  ['noEarlyMeeting', 'No early meeting'],
  ['balancedEnds', 'Balanced ends'],
];

export function RulesPanel({
  setup,
  season,
  issues,
  validation,
  conflictIds,
  onChange,
  onAdd,
  onRemove,
}: Props) {
  const uid = useId();
  const pendingFocus = useRef<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // After a rule is added, move focus to its first control (runs after the re-render).
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-rule="${id}"]`);
    if (!el) return;
    pendingFocus.current = null;
    el.scrollIntoView({ block: 'nearest' });
    el.querySelector<HTMLElement>('select, input, button')?.focus({ preventScroll: true });
  });

  const hasMin = setup.constraints.some((c) => c.kind === 'minBreaks');
  const active = setup.constraints.filter((c) => c.enabled).length;

  return (
    <section className="panel panel-rules" aria-labelledby={`${uid}-h`}>
      <header className="panel-head">
        <span className="panel-num" aria-hidden="true">
          02
        </span>
        <h2 id={`${uid}-h`}>The rules</h2>
        <span className="panel-meta">
          {active} of {setup.constraints.length} on
        </span>
      </header>

      <div className="chips" role="group" aria-label="Add a constraint">
        <span className="chips-label" aria-hidden="true">
          Add a constraint
        </span>
        {CHIPS.map(([kind, label]) => (
          <button
            key={kind}
            type="button"
            className="chip"
            disabled={kind === 'minBreaks' && hasMin}
            onClick={() => {
              pendingFocus.current = onAdd(kind);
            }}
          >
            <PlusIcon size={14} />
            {label}
          </button>
        ))}
      </div>

      {setup.constraints.length === 0 ? (
        <div className="empty">
          <p className="empty-title">No rules yet</p>
          <p>
            Every schedule is already a valid round-robin. Add a rule above, or pin a match by
            clicking it in the fixture list.
          </p>
        </div>
      ) : (
        <ul className="rule-list" ref={listRef}>
          {setup.constraints.map((c) => (
            <RuleCard
              key={c.id}
              constraint={c}
              setup={setup}
              season={season}
              issue={issues.find((i) => i.constraintId === c.id)}
              check={validation?.constraints.find((k) => k.id === c.id)}
              inConflict={conflictIds.includes(c.id)}
              onChange={(next) => onChange(replaceConstraint(setup, next))}
              onRemove={() => onRemove(c.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function RuleCard({
  constraint: c,
  setup,
  season,
  issue,
  check,
  inConflict,
  onChange,
  onRemove,
}: {
  constraint: Constraint;
  setup: Setup;
  season: Season;
  issue: InputIssue | undefined;
  check: { ok: boolean; detail: string } | undefined;
  inConflict: boolean;
  onChange: (c: Constraint) => void;
  onRemove: () => void;
}) {
  const uid = useId();
  const sentence = describeConstraint(c, { teams: setup.teams, season });
  const state = !c.enabled
    ? 'off'
    : inConflict
      ? 'conflict'
      : check
        ? check.ok
          ? 'holds'
          : 'broken'
        : 'unknown';
  return (
    <li
      className={`rule rule--${state}${issue ? ' rule--issue' : ''}`}
      data-rule={c.id}
      aria-describedby={`${uid}-s`}
    >
      <div className="rule-top">
        <span className="rule-kind">{describeKind(c.kind)}</span>
        {c.enabled && inConflict && <span className="badge badge--bad">In conflict</span>}
        {c.enabled && !inConflict && check && (
          <span className={`badge ${check.ok ? 'badge--ok' : 'badge--bad'}`} title={check.detail}>
            {check.ok ? <CheckIcon size={13} /> : <CrossIcon size={13} />}
            {check.ok ? 'Holds' : 'Broken'}
          </span>
        )}
        <span className="rule-tools">
          <label className="switch-label">
            <input
              type="checkbox"
              role="switch"
              className="switch"
              checked={c.enabled}
              aria-label={`${describeKind(c.kind)} rule on`}
              aria-describedby={`${uid}-s`}
              onChange={(e) => onChange({ ...c, enabled: e.target.checked })}
            />
          </label>
          <button
            type="button"
            className="icon-btn icon-btn--small"
            aria-label={`Delete rule: ${sentence}`}
            onClick={onRemove}
          >
            <TrashIcon size={16} />
          </button>
        </span>
      </div>
      <div className="rule-body">
        <RuleForm constraint={c} setup={setup} season={season} onChange={onChange} />
      </div>
      <p className="sr-only" id={`${uid}-s`}>
        {sentence}
      </p>
      {check && !check.ok && c.enabled && !inConflict && (
        <p className="rule-note rule-note--bad">{check.detail}</p>
      )}
      {issue && (
        <p className="rule-note rule-note--bad" role="alert">
          {issue.message}{' '}
          {issue.code === 'round-range' && issue.lastRound !== undefined && 'round' in c && (
            <button
              type="button"
              className="linklike"
              onClick={() => onChange({ ...c, round: issue.lastRound as number } as Constraint)}
            >
              Move it to round {issue.lastRound}
            </button>
          )}
        </p>
      )}
      {c.kind === 'unavailable' && season.dummy < 0 && c.enabled && (
        <p className="rule-note">
          With an even number of clubs nobody rests, so this rule cannot hold.
        </p>
      )}
      {c.kind === 'minBreaks' && (
        <p className="rule-note">
          The objective: the solver keeps tightening the bound until it proves the minimum.
        </p>
      )}
    </li>
  );
}

function Select<T extends string | number>({
  label,
  value,
  options,
  onChange,
  wide,
}: {
  label: string;
  value: T;
  options: Array<[T, string]>;
  onChange: (v: T) => void;
  wide?: boolean;
}) {
  return (
    <select
      className={`inline-select${wide ? ' inline-select--wide' : ''}`}
      aria-label={label}
      value={String(value)}
      onChange={(e) => {
        const found = options.find(([v]) => String(v) === e.target.value);
        if (found) onChange(found[0]);
      }}
    >
      {options.map(([v, text]) => (
        <option key={String(v)} value={String(v)}>
          {text}
        </option>
      ))}
    </select>
  );
}

function RuleForm({
  constraint: c,
  setup,
  season,
  onChange,
}: {
  constraint: Constraint;
  setup: Setup;
  season: Season;
  onChange: (c: Constraint) => void;
}) {
  const teams: Array<[string, string]> = setup.teams.map((t) => [t.id, t.name || 'Unnamed']);
  const rounds: Array<[string, string]> = [
    ...Array.from(
      { length: season.T },
      (_, i) => [String(i + 1), `round ${i + 1}`] as [string, string],
    ),
    ['last', 'the final round'],
  ];
  const roundValue = (r: RoundRef) => (r === 'last' ? 'last' : String(r));
  const toRound = (v: string): RoundRef => (v === 'last' ? 'last' : Number(v));
  const roundSelect = (r: RoundRef, set: (r: RoundRef) => void) => {
    const value = roundValue(r);
    const opts = rounds.some(([v]) => v === value)
      ? rounds
      : [[value, `round ${value}`] as [string, string], ...rounds];
    return <Select label="Round" value={value} options={opts} onChange={(v) => set(toRound(v))} />;
  };
  const words = (...parts: ReactNode[]) => <p className="madlib">{parts}</p>;

  switch (c.kind) {
    case 'venue':
      return words(
        <Select
          key="t"
          label="Team"
          value={c.team}
          options={teams}
          onChange={(team) => onChange({ ...c, team })}
          wide
        />,
        ' ',
        <Select
          key="v"
          label="Venue rule"
          value={c.venue}
          options={[
            ['home', 'must play at home'],
            ['away', 'must play away'],
            ['not-home', 'cannot play at home'],
          ]}
          onChange={(venue) => onChange({ ...c, venue })}
        />,
        ' in ',
        <span key="r">{roundSelect(c.round, (round) => onChange({ ...c, round }))}</span>,
      );
    case 'unavailable':
      return words(
        <Select
          key="t"
          label="Team"
          value={c.team}
          options={teams}
          onChange={(team) => onChange({ ...c, team })}
          wide
        />,
        ' must rest in ',
        <span key="r">{roundSelect(c.round, (round) => onChange({ ...c, round }))}</span>,
      );
    case 'fixed':
      return words(
        <Select
          key="a"
          label="First team"
          value={c.a}
          options={teams}
          onChange={(a) => onChange({ ...c, a })}
          wide
        />,
        ' ',
        <Select
          key="h"
          label="Venue"
          value={c.host}
          options={[
            ['a', 'must host'],
            ['b', 'must visit'],
            ['either', 'must meet'],
          ]}
          onChange={(host) => onChange({ ...c, host })}
        />,
        ' ',
        <Select
          key="b"
          label="Second team"
          value={c.b}
          options={teams}
          onChange={(b) => onChange({ ...c, b })}
          wide
        />,
        ' in ',
        <span key="r">{roundSelect(c.round, (round) => onChange({ ...c, round }))}</span>,
      );
    case 'maxRun':
      return words(
        <Select
          key="t"
          label="Who"
          value={c.team}
          options={[['all', 'No team'] as [string, string], ...teams]}
          onChange={(team) => onChange({ ...c, team })}
          wide
        />,
        c.team === 'all' ? ' may play more than ' : ' may not play more than ',
        <Select
          key="k"
          label="Longest run"
          value={c.max}
          options={Array.from(
            { length: Math.max(1, Math.min(8, season.T - 1)) },
            (_, i) => [i + 1, String(i + 1)] as [number, string],
          )}
          onChange={(max) => onChange({ ...c, max })}
        />,
        ' ',
        <Select
          key="v"
          label="Venue"
          value={c.venue}
          options={[
            ['either', 'home or away'],
            ['home', 'home'],
            ['away', 'away'],
          ]}
          onChange={(venue) => onChange({ ...c, venue })}
        />,
        ' games in a row',
      );
    case 'minBreaks':
      return words('Use as few breaks as possible.');
    case 'breakCap':
      return words(
        'At most ',
        <input
          key="n"
          className="inline-number"
          type="number"
          min={0}
          max={999}
          aria-label="Maximum breaks"
          value={c.max}
          onChange={(e) => onChange({ ...c, max: Math.max(0, Math.round(Number(e.target.value))) })}
        />,
        ' breaks ',
        <Select
          key="s"
          label="Scope"
          value={c.scope}
          options={[
            ['total', 'in total'],
            ['perTeam', 'for any one team'],
          ]}
          onChange={(scope) => onChange({ ...c, scope })}
        />,
      );
    case 'sharedGround':
      return words(
        <Select
          key="a"
          label="First team"
          value={c.a}
          options={teams}
          onChange={(a) => onChange({ ...c, a })}
          wide
        />,
        ' and ',
        <Select
          key="b"
          label="Second team"
          value={c.b}
          options={teams}
          onChange={(b) => onChange({ ...c, b })}
          wide
        />,
        ' share a ground: never both at home',
      );
    case 'noEarlyMeeting':
      return (
        <div className="madlib">
          <div className="pill-row" role="group" aria-label="Teams that must not meet early">
            {c.teams.map((id) => (
              <span key={id} className="pill">
                {setup.teams.find((t) => t.id === id)?.name ?? 'Removed team'}
                <button
                  type="button"
                  className="pill-x"
                  aria-label={`Remove ${setup.teams.find((t) => t.id === id)?.name ?? 'team'} from the group`}
                  onClick={() => onChange({ ...c, teams: c.teams.filter((t) => t !== id) })}
                >
                  <CrossIcon size={12} />
                </button>
              </span>
            ))}
            {c.teams.length < setup.teams.length && (
              <select
                className="inline-select inline-select--add"
                aria-label="Add a team to the group"
                value=""
                onChange={(e) =>
                  e.target.value && onChange({ ...c, teams: [...c.teams, e.target.value] })
                }
              >
                <option value="">+ team</option>
                {teams
                  .filter(([id]) => !c.teams.includes(id))
                  .map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
              </select>
            )}
          </div>
          <p>
            must not meet each other in the first{' '}
            <Select
              label="Rounds"
              value={c.rounds}
              options={Array.from(
                { length: season.T },
                (_, i) => [i + 1, String(i + 1)] as [number, string],
              )}
              onChange={(rounds) => onChange({ ...c, rounds })}
            />{' '}
            {c.rounds === 1 ? 'round' : 'rounds'}
          </p>
        </div>
      );
    case 'balancedEnds':
      return words(
        'No team may ',
        <Select
          key="w"
          label="Where"
          value={c.where}
          options={[
            ['both', 'start or end'],
            ['start', 'start'],
            ['end', 'end'],
          ]}
          onChange={(where) => onChange({ ...c, where })}
        />,
        ' the season with two home or two away games in a row',
      );
  }
}
