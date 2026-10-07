import { compact } from '../app/hooks';
import type { RunTrace } from '../app/state';
import { PlayIcon, StopIcon } from './icons';
import type { Status } from './status';

/** Phone: the Solve button and live status, in reach of a thumb. */
export function SolveBar({
  running,
  status,
  onSolve,
  onCancel,
}: {
  running: RunTrace | null;
  status: Status;
  onSolve: () => void;
  onCancel: () => void;
}) {
  return (
    <div className={`solve-bar tone-${status.tone}`}>
      <div className="solve-bar-status">
        <span className="solve-bar-title">{status.title}</span>
        <span className="solve-bar-detail">
          {running?.stats
            ? `${compact(running.stats.conflicts)} conflicts · ${(running.stats.elapsedMs / 1000).toFixed(1)} s`
            : status.verified
              ? 'Verified ✓'
              : status.short}
        </span>
      </div>
      {running ? (
        <button type="button" className="btn btn--cancel" onClick={onCancel}>
          <StopIcon /> Cancel
        </button>
      ) : (
        <button type="button" className="btn btn--solve" onClick={onSolve}>
          <PlayIcon /> Solve
        </button>
      )}
    </div>
  );
}
