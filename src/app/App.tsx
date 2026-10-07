import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import type { Constraint, ConstraintKind, Setup } from '../model/types';
import { exampleSetup } from '../model/presets';
import { seasonOf } from '../model/season';
import { inputIssues } from '../model/issues';
import { decodeSetup, encodeSetup, ShareError } from '../export/share';
import { validateSchedule } from '../validate/validate';
import { SolverClient } from '../worker/client';
import { addConstraint, removeConstraint, replaceConstraint, togglePin } from './edit';
import { useMedia, usePhone } from './hooks';
import { initialState, reducer, shapeOf, type Tab } from './state';
import { Masthead } from '../ui/Masthead';
import { LeaguePanel } from '../ui/LeaguePanel';
import { RulesPanel } from '../ui/RulesPanel';
import { FixturesPanel } from '../ui/FixturesPanel';
import { SolverPanel } from '../ui/SolverPanel';
import { ExplainPanel } from '../ui/ExplainPanel';
import { statusOf } from '../ui/status';
import { SolveBar } from '../ui/SolveBar';

const HowItWorks = lazy(() => import('../ui/HowItWorks'));

export const TIME_LIMIT_MS = 20_000;
const EXAMPLE_JSON = JSON.stringify(exampleSetup());

function loadInitial(): { setup: Setup; error: string | null } {
  const hash = window.location.hash;
  if (hash.length > 1) {
    try {
      return { setup: decodeSetup(hash), error: null };
    } catch (err) {
      const reason = err instanceof ShareError ? err.message : 'it could not be read';
      return {
        setup: exampleSetup(),
        error: `That shared league could not be opened: ${reason}. Showing the example league instead.`,
      };
    }
  }
  return { setup: exampleSetup(), error: null };
}

export function App() {
  const [boot] = useState(loadInitial);
  const [state, dispatch] = useReducer(reducer, boot.setup, (setup) => ({
    ...initialState(setup),
    notice: boot.error ? { kind: 'error' as const, text: boot.error } : null,
  }));
  const [howOpen, setHowOpen] = useState(false);
  const [announce, setAnnounce] = useState('');
  const phone = usePhone();
  const narrow = useMedia('(max-width: 1199.98px)');
  const clientRef = useRef<SolverClient | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const runIdRef = useRef(0);
  const setupRef = useRef(state.setup);
  useLayoutEffect(() => {
    setupRef.current = state.setup;
  }, [state.setup]);

  const setSetup = useCallback((setup: Setup) => dispatch({ type: 'setup', setup }), []);

  const solve = useCallback(
    (
      setup: Setup = setupRef.current,
      options: { incumbent?: { schedule: import('../model/types').Schedule; breaks: number } } = {},
    ) => {
      cancelRef.current?.();
      const client = (clientRef.current ??= new SolverClient());
      const id = ++runIdRef.current;
      const setupJson = JSON.stringify(setup);
      dispatch({ type: 'start', id });
      setAnnounce('Solving…');
      cancelRef.current = client.solve(
        { setup, timeLimitMs: TIME_LIMIT_MS, incumbent: options.incumbent },
        {
          onEvent: (event) => dispatch({ type: 'event', id, event }),
          onDone: (outcome) => {
            cancelRef.current = null;
            dispatch({ type: 'done', id, outcome, setupJson });
          },
          onCertificate: (certificate) => dispatch({ type: 'certificate', id, certificate }),
          onError: (message) => {
            cancelRef.current = null;
            dispatch({ type: 'error', id, message });
          },
          onFallback: () => {
            dispatch({ type: 'mainThread' });
            dispatch({
              type: 'notice',
              notice: {
                kind: 'info',
                text: 'Background solving is unavailable in this browser, so the solver runs on the page. It may feel less responsive while it works.',
              },
            });
          },
        },
      );
    },
    [],
  );

  const cancel = useCallback(() => {
    cancelRef.current?.();
    cancelRef.current = null;
    dispatch({ type: 'cancel' });
    setAnnounce('Solving cancelled.');
  }, []);

  // Solve the opening league straight after the first paint, then mark the page interactive.
  useEffect(() => {
    const t = window.setTimeout(() => solve(boot.setup), 0);
    document.documentElement.dataset.ready = 'true';
    return () => {
      window.clearTimeout(t);
      clientRef.current?.dispose();
      clientRef.current = null;
    };
  }, [solve, boot.setup]);

  // Ctrl/Cmd + Enter solves from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        solve();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [solve]);

  // Keep the URL hash in sync so the address bar is always a share link.
  useEffect(() => {
    const t = window.setTimeout(() => {
      const json = JSON.stringify(state.setup);
      const url = new URL(window.location.href);
      url.hash = json === EXAMPLE_JSON ? '' : encodeSetup(state.setup);
      window.history.replaceState(null, '', url.toString().replace(/#$/, ''));
    }, 250);
    return () => window.clearTimeout(t);
  }, [state.setup]);

  const season = useMemo(() => seasonOf(state.setup), [state.setup]);
  const issues = useMemo(() => inputIssues(state.setup), [state.setup]);
  const current = state.solved && state.solved.shape === shapeOf(state.setup) ? state.solved : null;
  const validation = useMemo(
    () => (current ? validateSchedule(state.setup, current.schedule) : null),
    [current, state.setup],
  );
  const stale = state.outcomeFor !== null && state.outcomeFor !== JSON.stringify(state.setup);
  const status = statusOf({ state, current, validation, issues, stale });

  // Announce finished runs for screen readers.
  const lastAnnounced = useRef<unknown>(null);
  useEffect(() => {
    if (state.outcome && state.outcome !== lastAnnounced.current && !state.running) {
      lastAnnounced.current = state.outcome;
      setAnnounce(status.announce);
    }
  }, [state.outcome, state.running, status.announce]);

  const conflictIds = useMemo(
    () => (state.outcome?.status === 'unsat' && !stale ? state.outcome.conflict.constraintIds : []),
    [state.outcome, stale],
  );

  const onTogglePin = useCallback(
    (round: number, home: number, away: number) => {
      const res = togglePin(setupRef.current, round, home, away);
      setSetup(res.setup);
      const s = res.setup;
      setAnnounce(
        `${res.pinned ? 'Pinned' : 'Unpinned'} ${s.teams[home].name} v ${s.teams[away].name} in round ${round + 1}.`,
      );
    },
    [setSetup],
  );

  const onAddConstraint = useCallback(
    (kind: ConstraintKind) => {
      const res = addConstraint(setupRef.current, kind);
      setSetup(res.setup);
      return res.id;
    },
    [setSetup],
  );

  const onRelax = useCallback(
    (original: Constraint, next: Constraint | null) => {
      const setup = next
        ? replaceConstraint(setupRef.current, next)
        : replaceConstraint(setupRef.current, { ...original, enabled: false });
      setSetup(setup);
      solve(setup);
    },
    [setSetup, solve],
  );

  const onRemoveConstraint = useCallback(
    (id: string) => setSetup(removeConstraint(setupRef.current, id)),
    [setSetup],
  );

  const keepSearching = useCallback(() => {
    if (!current) return;
    solve(setupRef.current, { incumbent: { schedule: current.schedule, breaks: current.breaks } });
  }, [current, solve]);

  const setTab = useCallback((tab: Tab) => dispatch({ type: 'tab', tab }), []);

  /** Shows the rules and moves focus to the first one that needs attention. */
  const goToRules = useCallback(() => {
    setTab('rules');
    window.setTimeout(() => {
      const card =
        document.querySelector<HTMLElement>('.rule--issue') ??
        document.querySelector<HTMLElement>('.rule--conflict') ??
        document.querySelector<HTMLElement>('.rule--broken') ??
        document.querySelector<HTMLElement>('.panel-rules');
      card?.scrollIntoView({ block: 'center' });
      card?.querySelector<HTMLElement>('select, input, button')?.focus({ preventScroll: true });
    }, 60);
  }, [setTab]);

  const explain =
    state.outcome?.status === 'unsat' ? (
      <ExplainPanel
        outcome={state.outcome}
        setup={state.setup}
        stale={stale}
        certificate={state.certificate}
        onRelax={onRelax}
        running={state.running !== null}
      />
    ) : null;

  return (
    <div className="app" data-tab={state.tab}>
      <a className="skip-link" href="#fixtures">
        Skip to the fixtures
      </a>
      <Masthead setup={state.setup} season={season} onHowItWorks={() => setHowOpen(true)} />

      {phone && (
        <nav className="tabs" aria-label="Sections">
          {(
            [
              ['league', 'League', `${state.setup.teams.length} clubs`],
              ['rules', 'Rules', `${state.setup.constraints.filter((c) => c.enabled).length} on`],
              ['schedule', 'Schedule', status.short],
            ] as const
          ).map(([tab, label, sub], i) => (
            <button
              key={tab}
              type="button"
              className="tab"
              aria-pressed={state.tab === tab}
              onClick={() => setTab(tab)}
            >
              <span className="tab-step">{i + 1}</span>
              <span className="tab-label">{label}</span>
              <span className="tab-sub">{sub}</span>
            </button>
          ))}
        </nav>
      )}

      {state.notice && (
        <div
          className={`notice notice--${state.notice.kind}`}
          role={state.notice.kind === 'error' ? 'alert' : 'status'}
        >
          <p>{state.notice.text}</p>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => dispatch({ type: 'notice', notice: null })}
          >
            Dismiss
          </button>
        </div>
      )}

      <main className="desk">
        {(!phone || state.tab !== 'schedule') && (
          <div className="col col-left">
            {(!phone || state.tab === 'league') && (
              <LeaguePanel
                setup={state.setup}
                season={season}
                issues={issues}
                onChange={setSetup}
                onNotice={(text) => dispatch({ type: 'notice', notice: { kind: 'info', text } })}
              />
            )}
            {(!phone || state.tab === 'rules') && (
              <RulesPanel
                setup={state.setup}
                season={season}
                issues={issues}
                validation={validation}
                conflictIds={conflictIds}
                onChange={setSetup}
                onAdd={onAddConstraint}
                onRemove={onRemoveConstraint}
              />
            )}
          </div>
        )}
        {(!phone || state.tab === 'schedule') && (
          <div className="col col-center">
            {narrow && explain}
            <FixturesPanel
              setup={state.setup}
              season={season}
              state={state}
              current={current}
              validation={validation}
              status={status}
              issues={issues}
              conflictIds={conflictIds}
              onTogglePin={onTogglePin}
              onView={(view) => dispatch({ type: 'view', view })}
              onSolve={() => solve()}
              onKeepSearching={keepSearching}
              onGoToRules={goToRules}
              explainAbove={narrow}
            />
          </div>
        )}
        {(!phone || state.tab === 'schedule') && (
          <aside className="col col-right" aria-label="Solver">
            <SolverPanel
              state={state}
              status={status}
              validation={validation}
              setup={state.setup}
              season={season}
              current={current}
              onSolve={() => solve()}
              onCancel={cancel}
              compactHeader={narrow}
              explain={narrow ? null : explain}
            />
          </aside>
        )}
      </main>

      <footer className="colophon">
        <p>
          Fixture is a working planner: a CDCL SAT solver written from scratch schedules the season
          in your browser, and separate code verifies every schedule it shows.
        </p>
        <p>
          <a href="https://mustafaobaidd1.github.io/">← Mustafa Obaid · Portfolio</a>
          <span aria-hidden="true"> · </span>
          <a href="https://github.com/mustafaobaidd1/fixture-league-scheduler">Source code</a>
          <span aria-hidden="true"> · </span>
          <button type="button" className="linklike" onClick={() => setHowOpen(true)}>
            How it works
          </button>
        </p>
      </footer>

      {narrow && (
        <SolveBar
          running={state.running}
          status={status}
          onSolve={() => {
            setTab('schedule');
            solve();
          }}
          onCancel={cancel}
        />
      )}

      {howOpen && (
        <Suspense
          fallback={
            <div className="dialog-loading" role="status">
              Loading…
            </div>
          }
        >
          <HowItWorks onClose={() => setHowOpen(false)} />
        </Suspense>
      )}

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announce}
      </div>
    </div>
  );
}
