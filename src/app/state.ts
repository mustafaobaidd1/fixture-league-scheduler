import type { Certificate, EngineEvent, LiveStats, LogKind, Outcome } from '../engine/engine';
import type { Schedule, Setup } from '../model/types';

export type View = 'rounds' | 'teams' | 'stats';
export type Tab = 'league' | 'rules' | 'schedule';

export interface RunTrace {
  id: number;
  stats: LiveStats | null;
  /** (seconds, cumulative conflicts) samples for the chart. */
  series: Array<{ t: number; c: number }>;
  /** Improved schedules: (seconds, breaks). */
  marks: Array<{ t: number; breaks: number }>;
  log: Array<{ t: number; kind: LogKind; text: string }>;
  /** Best schedule seen during the run (shown live while optimising). */
  best: { schedule: Schedule; breaks: number } | null;
}

export interface Solved {
  /** Team ids + format: a schedule only applies to the league shape it was solved for. */
  shape: string;
  schedule: Schedule;
  breaks: number;
}

export interface AppState {
  setup: Setup;
  running: RunTrace | null;
  last: RunTrace | null;
  outcome: Outcome | null;
  /** JSON of the setup the outcome belongs to (to tell when it went stale). */
  outcomeFor: string | null;
  solved: Solved | null;
  certificate: Certificate | 'pending' | null;
  view: View;
  tab: Tab;
  notice: { kind: 'info' | 'error'; text: string } | null;
  /** Increments whenever a fresh schedule should animate in. */
  reveal: number;
  /** Set while the worker is unavailable and solving happens on the page. */
  mainThread: boolean;
}

export const shapeOf = (s: Setup) =>
  JSON.stringify([s.teams.map((t) => t.id), s.format, s.format === 'double' && s.mirrored]);

export type Action =
  | { type: 'setup'; setup: Setup }
  | { type: 'start'; id: number }
  | { type: 'event'; id: number; event: EngineEvent }
  | { type: 'done'; id: number; outcome: Outcome; setupJson: string }
  | { type: 'certificate'; id: number; certificate: Certificate }
  | { type: 'cancel' }
  | { type: 'error'; id: number; message: string }
  | { type: 'view'; view: View }
  | { type: 'tab'; tab: Tab }
  | { type: 'notice'; notice: AppState['notice'] }
  | { type: 'mainThread' };

const emptyTrace = (id: number): RunTrace => ({
  id,
  stats: null,
  series: [{ t: 0, c: 0 }],
  marks: [],
  log: [],
  best: null,
});

export function initialState(setup: Setup): AppState {
  return {
    setup,
    running: null,
    last: null,
    outcome: null,
    outcomeFor: null,
    solved: null,
    certificate: null,
    view: 'rounds',
    tab: 'schedule',
    notice: null,
    reveal: 0,
    mainThread: false,
  };
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'setup':
      return { ...state, setup: action.setup };
    case 'start':
      return { ...state, running: emptyTrace(action.id), certificate: null };
    case 'event': {
      const run = state.running;
      if (!run || run.id !== action.id) return state;
      const e = action.event;
      if (e.type === 'stats') {
        const t = e.stats.elapsedMs / 1000;
        const last = run.series[run.series.length - 1];
        const series =
          last && t - last.t < 0.04 ? run.series : [...run.series, { t, c: e.stats.conflicts }];
        return { ...state, running: { ...run, stats: e.stats, series } };
      }
      if (e.type === 'solution') {
        const t = e.elapsedMs / 1000;
        const first = run.best === null;
        return {
          ...state,
          running: {
            ...run,
            best: { schedule: e.schedule, breaks: e.breaks },
            marks: [...run.marks, { t, breaks: e.breaks }],
          },
          solved: { shape: shapeOf(state.setup), schedule: e.schedule, breaks: e.breaks },
          reveal: first ? state.reveal + 1 : state.reveal,
        };
      }
      return {
        ...state,
        running: {
          ...run,
          log: [...run.log, { t: e.elapsedMs / 1000, kind: e.kind, text: e.text }],
        },
      };
    }
    case 'done': {
      const run = state.running;
      if (!run || run.id !== action.id) return state;
      const o = action.outcome;
      let solved = state.solved;
      if ('schedule' in o && o.schedule) {
        solved = { shape: shapeOf(state.setup), schedule: o.schedule, breaks: o.breaks ?? 0 };
      }
      const final: RunTrace = {
        ...run,
        series:
          'stats' in o
            ? [...run.series, { t: o.elapsedMs / 1000, c: o.stats.conflicts }]
            : run.series,
      };
      return {
        ...state,
        running: null,
        last: final,
        outcome: o,
        outcomeFor: action.setupJson,
        solved,
        certificate: o.status === 'optimal' || o.status === 'unsat' ? 'pending' : null,
        tab: o.status === 'invalid' ? state.tab : state.tab,
      };
    }
    case 'certificate':
      if (state.last?.id !== action.id) return state;
      return { ...state, certificate: action.certificate };
    case 'cancel': {
      if (!state.running) return state;
      const run = state.running;
      return {
        ...state,
        running: null,
        last: run,
        notice: { kind: 'info', text: 'Solving cancelled.' },
      };
    }
    case 'error':
      if (state.running?.id !== action.id) return state;
      return {
        ...state,
        running: null,
        last: state.running,
        notice: { kind: 'error', text: `The solver failed: ${action.message}` },
      };
    case 'view':
      return { ...state, view: action.view };
    case 'tab':
      return { ...state, tab: action.tab };
    case 'notice':
      return { ...state, notice: action.notice };
    case 'mainThread':
      return { ...state, mainThread: true };
  }
}
