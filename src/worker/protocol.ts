import type { Certificate, EngineEvent, Outcome } from '../engine/engine';
import type { Schedule, Setup } from '../model/types';

export interface SolveRequest {
  type: 'solve';
  id: number;
  setup: Setup;
  timeLimitMs: number;
  incumbent?: { schedule: Schedule; breaks: number };
}

export type SolveResponse =
  | { id: number; type: 'event'; event: EngineEvent }
  | { id: number; type: 'done'; outcome: Outcome }
  | { id: number; type: 'certificate'; certificate: Certificate }
  | { id: number; type: 'error'; message: string };
