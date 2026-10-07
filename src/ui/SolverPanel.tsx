import { useId, type ReactNode } from 'react';
import { compact, nf, seconds } from '../app/hooks';
import type { AppState, Solved } from '../app/state';
import type { Season } from '../model/season';
import type { Setup } from '../model/types';
import type { Validation } from '../validate/validate';
import { ConflictChart } from './ConflictChart';
import { CheckIcon, CrossIcon, PlayIcon, StopIcon } from './icons';
import type { Status } from './status';
import { VerifyPanel } from './VerifyPanel';

interface Props {
  state: AppState;
  status: Status;
  validation: Validation | null;
  setup: Setup;
  season: Season;
  current: Solved | null;
  onSolve: () => void;
  onCancel: () => void;
  compactHeader: boolean;
  explain: ReactNode;
}

const SYMMETRY: Record<string, string> = {
  none: 'none (some rules name specific clubs)',
  'opponent-order': 'clubs relabelled by their meeting with club 1',
  'first-round': 'round 1 pairings fixed',
};

export function SolverPanel({
  state,
  status,
  validation,
  setup,
  season,
  current,
  onSolve,
  onCancel,
  compactHeader,
  explain,
}: Props) {
  const uid = useId();
  const trace = state.running ?? state.last;
  const outcome = state.outcome;
  const stats =
    state.running?.stats ??
    (outcome && 'stats' in outcome
      ? { ...outcome.stats, elapsedMs: outcome.elapsedMs }
      : trace?.stats);
  const running = state.running !== null;

  const tiles: Array<[string, string]> = stats
    ? [
        ['Conflicts', compact(stats.conflicts)],
        ['Decisions', compact(stats.decisions)],
        ['Propagations', compact(stats.propagations)],
        ['Learnt', compact(stats.learntTotal)],
        ['Restarts', compact(stats.restarts)],
        ['Elapsed', seconds('elapsedMs' in stats ? stats.elapsedMs : 0)],
      ]
    : [];

  return (
    <section
      className={`panel panel-solver${running ? ' is-running' : ''}`}
      aria-labelledby={`${uid}-h`}
    >
      <header className="panel-head">
        <span className="panel-num" aria-hidden="true">
          04
        </span>
        <h2 id={`${uid}-h`}>The solver</h2>
        <span className="panel-meta">{state.mainThread ? 'on the page' : 'Web Worker'}</span>
      </header>

      {!compactHeader && (
        <div className="solve-row">
          {running ? (
            <button key="cancel" type="button" className="btn btn--cancel" onClick={onCancel}>
              <StopIcon /> Cancel
            </button>
          ) : (
            <button
              key="solve"
              type="button"
              className="btn btn--solve"
              onClick={onSolve}
              aria-keyshortcuts="Control+Enter Meta+Enter"
            >
              <PlayIcon /> Solve
            </button>
          )}
          <p className="kbd-hint">
            <kbd>Ctrl</kbd> + <kbd>Enter</kbd>
          </p>
        </div>
      )}

      <RunStatus state={state} tone={status.tone} />

      {explain}

      {stats && (
        <dl className={`stat-grid${running ? ' is-live' : ''}`}>
          {tiles.map(([k, v]) => (
            <div key={k} className="stat">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}

      {trace && (running || trace.series.length > 1) && (
        <ConflictChart series={trace.series} marks={trace.marks} running={running} />
      )}

      {trace && trace.log.length > 0 && (
        <div className="log-block">
          <h3 className="block-title">Run log</h3>
          <ol className="solve-log" tabIndex={0} aria-label="Run log">
            {trace.log.map((l, i) => (
              <li key={i} className={`log-${l.kind}`}>
                <span className="log-time">
                  {l.t < 1 ? `${Math.round(l.t * 1000)} ms` : `${l.t.toFixed(2)} s`}
                </span>
                <span>{l.text}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {outcome && 'vars' in outcome && (
        <p className="problem-size">
          CNF: {nf.format(outcome.vars)} variables, {nf.format(outcome.clauses)} clauses. Symmetry
          breaking: {SYMMETRY[outcome.symmetry] ?? outcome.symmetry}.
        </p>
      )}

      {state.certificate && !running && (
        <CertificateLine certificate={state.certificate} kind={outcome?.status} />
      )}

      {validation && current && (
        <VerifyPanel validation={validation} setup={setup} season={season} />
      )}
    </section>
  );
}

function CertificateLine({
  certificate,
  kind,
}: {
  certificate: AppState['certificate'];
  kind: string | undefined;
}) {
  if (certificate === null) return null;
  const what = kind === 'unsat' ? 'Infeasibility proof' : 'Optimality proof';
  if (certificate === 'pending') {
    return (
      <p className="certificate is-pending" role="status">
        <span className="spinner" aria-hidden="true" /> {what}: re-checking every learnt clause…
      </p>
    );
  }
  if (certificate.verified === true) {
    return (
      <p className="certificate is-ok" role="status">
        <CheckIcon size={16} />
        <span>
          <strong>{what} checked</strong> by an independent RUP checker — {certificate.note} (
          {seconds(certificate.ms)})
        </span>
      </p>
    );
  }
  if (certificate.verified === false) {
    return (
      <p className="certificate is-bad" role="alert">
        <CrossIcon size={16} />
        <span>
          <strong>{what} failed the check.</strong> {certificate.note}
        </span>
      </p>
    );
  }
  return (
    <p className="certificate" role="status">
      <span>
        <strong>{what} not re-checked:</strong> {certificate.note}
      </span>
    </p>
  );
}

function RunStatus({ state, tone }: { state: AppState; tone: Status['tone'] }) {
  const run = state.running;
  const o = state.outcome;
  let title = 'Ready';
  let detail = 'Press Solve, or Ctrl + Enter (⌘ + Enter on a Mac).';
  let cls = 'idle';
  if (run) {
    cls = 'running';
    const st = run.stats;
    const phase = st?.phase ?? 'searching';
    const bound = st?.bound;
    title =
      phase === 'improving' && bound !== null && bound !== undefined
        ? `Tightening: ≤ ${bound} breaks?`
        : phase === 'proving' && bound !== null && bound !== undefined
          ? `Proving: ≤ ${bound} breaks is impossible?`
          : phase === 'explaining'
            ? 'Shrinking the conflict'
            : 'Searching';
    detail = st
      ? `${compact(st.conflicts)} conflicts · ${seconds(st.elapsedMs)}`
      : 'Starting the worker…';
  } else if (o) {
    const path = state.last?.marks.map((m) => m.breaks).join(' → ');
    switch (o.status) {
      case 'optimal':
        cls = 'ok';
        title =
          o.proof === 'solver'
            ? 'Proved optimal'
            : o.proof === 'theory'
              ? 'Optimal by theory'
              : 'Optimal';
        detail =
          o.proof === 'solver'
            ? `${path ? `Breaks ${path}; ` : ''}≤ ${o.breaks - 1} is UNSAT · ${seconds(o.elapsedMs)}`
            : o.proof === 'theory'
              ? `Matches the proven lower bound; the solver's own proof was cut short · ${seconds(o.elapsedMs)}`
              : `No breaks needed · ${seconds(o.elapsedMs)}`;
        break;
      case 'feasible':
        cls = 'ok';
        title = 'Schedule found';
        detail = `Breaks are not minimised — add “Fewest breaks” to optimise · ${seconds(o.elapsedMs)}`;
        break;
      case 'unsat':
        cls = 'bad';
        title = 'Proved infeasible';
        detail = `Shrunk to ${o.conflict.constraintIds.length} rule${o.conflict.constraintIds.length === 1 ? '' : 's'}${o.conflict.minimal ? ' (minimal)' : ''} · ${seconds(o.elapsedMs)}`;
        break;
      case 'timeout':
        cls = 'warn';
        title = 'Stopped at the 20 s limit';
        detail = o.schedule
          ? 'The best schedule is kept; optimality is not proven.'
          : 'No schedule found, and none ruled out.';
        break;
      case 'invalid':
        cls = 'bad';
        title = 'Not run';
        detail = 'The setup has problems to fix first.';
        break;
    }
  }
  return (
    <div className={`solver-status tone-${cls === 'idle' ? tone : cls}`}>
      <p className="solver-status-title">{title}</p>
      <p className="solver-status-detail">{detail}</p>
    </div>
  );
}
