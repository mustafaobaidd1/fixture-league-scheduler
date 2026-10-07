/**
 * Main-thread side of the solver. Prefers a module Web Worker; if workers are unavailable or
 * the worker script fails to load, it falls back to running the same engine on the page in
 * short slices, yielding to the browser between them.
 */
import type { Certificate, EngineEvent, Outcome } from '../engine/engine';
import type { Schedule, Setup } from '../model/types';
import type { SolveRequest, SolveResponse } from './protocol';

export interface SolveHandlers {
  onEvent: (event: EngineEvent) => void;
  onDone: (outcome: Outcome) => void;
  onCertificate: (certificate: Certificate) => void;
  onError: (message: string) => void;
  /** Called once if the client had to switch to main-thread solving. */
  onFallback?: (reason: string) => void;
}

export interface SolveJob {
  setup: Setup;
  timeLimitMs: number;
  incumbent?: { schedule: Schedule; breaks: number };
}

class Cancelled extends Error {}

const yieldToBrowser = () =>
  new Promise<void>((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(0);
  });

export class SolverClient {
  private worker: Worker | null = null;
  private mode: 'worker' | 'main' = typeof Worker === 'undefined' ? 'main' : 'worker';
  private nextId = 1;
  private cancelMain: (() => void) | null = null;

  get usesWorker(): boolean {
    return this.mode === 'worker';
  }

  private spawn(): Worker {
    return new Worker(new URL('./solver.worker.ts', import.meta.url), {
      type: 'module',
      name: 'fixture-solver',
    });
  }

  /** Starts a solve; returns a function that cancels it. */
  solve(job: SolveJob, handlers: SolveHandlers): () => void {
    if (this.mode === 'main') return this.solveOnMainThread(job, handlers);
    const id = this.nextId++;
    let worker: Worker;
    try {
      worker = this.worker ?? this.spawn();
    } catch (err) {
      this.mode = 'main';
      handlers.onFallback?.(err instanceof Error ? err.message : 'Workers are unavailable');
      return this.solveOnMainThread(job, handlers);
    }
    this.worker = worker;
    let heard = false;
    let finished = false;
    let cancelFallback: (() => void) | null = null;
    const watchdog = window.setTimeout(() => {
      if (finished) return;
      this.reset();
      handlers.onError('The solver stopped responding.');
    }, job.timeLimitMs + 15_000);

    const onMessage = (e: MessageEvent<SolveResponse>) => {
      const msg = e.data;
      if (msg.id !== id) return;
      heard = true;
      if (msg.type === 'event') handlers.onEvent(msg.event);
      else if (msg.type === 'done') {
        finished = true;
        window.clearTimeout(watchdog);
        handlers.onDone(msg.outcome);
        if (msg.outcome.status !== 'optimal' && msg.outcome.status !== 'unsat') cleanup();
      } else if (msg.type === 'certificate') {
        handlers.onCertificate(msg.certificate);
        cleanup();
      } else {
        finished = true;
        window.clearTimeout(watchdog);
        handlers.onError(msg.message);
        cleanup();
      }
    };
    const onError = (e: ErrorEvent) => {
      e.preventDefault();
      window.clearTimeout(watchdog);
      cleanup();
      this.reset();
      if (!heard) {
        // The worker script never ran (blocked or failed to load): solve on the page instead.
        this.mode = 'main';
        handlers.onFallback?.('The background solver could not start');
        cancelFallback = this.solveOnMainThread(job, handlers);
      } else {
        handlers.onError(e.message || 'The solver crashed.');
      }
    };
    const cleanup = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    const req: SolveRequest = { type: 'solve', id, ...job };
    worker.postMessage(req);

    return () => {
      window.clearTimeout(watchdog);
      cleanup();
      if (cancelFallback) cancelFallback();
      else if (!finished) this.reset();
    };
  }

  private reset(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private solveOnMainThread(job: SolveJob, handlers: SolveHandlers): () => void {
    let cancelled = false;
    this.cancelMain?.();
    const cancel = () => {
      cancelled = true;
    };
    this.cancelMain = cancel;
    // The engine is only needed here when workers are unavailable: load it on demand.
    import('../engine/engine')
      .then(async ({ Engine }) => {
        if (cancelled) return;
        const engine = new Engine(job.setup, {
          timeLimitMs: job.timeLimitMs,
          incumbent: job.incumbent,
          sliceMs: 30,
          yieldControl: async () => {
            await yieldToBrowser();
            if (cancelled) throw new Cancelled();
          },
          onEvent: (event) => {
            if (!cancelled) handlers.onEvent(event);
          },
        });
        const outcome = await engine.run();
        if (cancelled) return;
        handlers.onDone(outcome);
        if (outcome.status === 'optimal' || outcome.status === 'unsat') {
          await yieldToBrowser();
          if (!cancelled) handlers.onCertificate(engine.certify(1_000));
        }
      })
      .catch((err: unknown) => {
        if (err instanceof Cancelled || cancelled) return;
        handlers.onError(err instanceof Error ? err.message : String(err));
      });
    return cancel;
  }

  dispose(): void {
    this.reset();
    this.cancelMain?.();
  }
}
