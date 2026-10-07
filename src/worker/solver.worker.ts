/**
 * The solver runs here, off the main thread. Events stream back with postMessage while the
 * search is still running (posting does not need the worker to yield). Cancelling terminates
 * the worker, so the search loop needs no cancellation checks of its own.
 */
import { Engine } from '../engine/engine';
import type { SolveRequest, SolveResponse } from './protocol';

// The project compiles against the DOM library; describe just what this worker uses.
const scope = self as unknown as {
  postMessage(message: SolveResponse): void;
  onmessage: ((e: MessageEvent<SolveRequest>) => void) | null;
};

const post = (msg: SolveResponse) => scope.postMessage(msg);

scope.onmessage = async (e) => {
  const req = e.data;
  if (req.type !== 'solve') return;
  try {
    const engine = new Engine(req.setup, {
      timeLimitMs: req.timeLimitMs,
      incumbent: req.incumbent,
      onEvent: (event) => post({ id: req.id, type: 'event', event }),
    });
    const outcome = await engine.run();
    post({ id: req.id, type: 'done', outcome });
    if (outcome.status === 'optimal' || outcome.status === 'unsat') {
      post({ id: req.id, type: 'certificate', certificate: engine.certify(4_000) });
    }
  } catch (err) {
    post({ id: req.id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
