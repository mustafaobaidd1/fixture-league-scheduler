import {
  describeConstraint,
  describeStructural,
  relaxations,
  theoryNote,
} from '../explain/describe';
import type { Outcome } from '../engine/engine';
import { seasonOf } from '../model/season';
import type { Constraint, Setup } from '../model/types';
import type { AppState } from '../app/state';
import { describeKind } from '../model/issues';

interface Props {
  outcome: Extract<Outcome, { status: 'unsat' }>;
  setup: Setup;
  stale: boolean;
  running: boolean;
  certificate: AppState['certificate'];
  onRelax: (original: Constraint, next: Constraint | null) => void;
}

/** "These N constraints cannot all hold", with one-click relaxations. */
export function ExplainPanel({ outcome, setup, stale, running, certificate, onRelax }: Props) {
  const season = seasonOf(setup);
  const conflict = outcome.conflict;
  const members = conflict.constraintIds
    .map((id) => setup.constraints.find((c) => c.id === id))
    .filter((c): c is Constraint => c !== undefined);
  const k = members.length;
  const note = theoryNote(members, season);

  return (
    <section
      className={`explain${stale ? ' is-stale' : ''}`}
      aria-labelledby="explain-title"
      role="region"
    >
      <p className="explain-kicker">Why no schedule exists</p>
      <h3 className="explain-title" id="explain-title">
        {k === 1 ? 'This constraint cannot hold' : `These ${k} constraints cannot all hold`}
      </h3>
      {stale && (
        <p className="explain-stale">
          The rules changed since this explanation. Solve again to refresh it.
        </p>
      )}
      <ol className="explain-list">
        {members.map((c, i) => {
          const options = relaxations(c, season);
          return (
            <li key={c.id} className="explain-item">
              <span className="explain-num" aria-hidden="true">
                {i + 1}
              </span>
              <div className="explain-body">
                <p className="explain-kind">{describeKind(c.kind)}</p>
                <p className="explain-text">
                  {describeConstraint(c, { teams: setup.teams, season })}
                </p>
                <div className="explain-actions">
                  {options.map((o) => (
                    <button
                      key={o.label}
                      type="button"
                      className={`btn btn--small ${o.next ? 'btn--relax' : 'btn--off'}`}
                      disabled={running || stale}
                      onClick={() => onRelax(c, o.next)}
                    >
                      {o.next ? `Relax: ${o.label.toLowerCase()}` : o.label}
                    </button>
                  ))}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {conflict.structuralKnown && conflict.structural.length > 0 && (
        <div className="explain-rules">
          <p className="explain-rules-title">Together with the structure of a round-robin:</p>
          <ul>
            {conflict.structural.map((g) => (
              <li key={g}>{describeStructural(g, season)}</li>
            ))}
          </ul>
        </div>
      )}
      {note && <p className="explain-theory">{note}</p>}
      <p className="explain-foot">
        {conflict.minimal
          ? k === 1
            ? 'Minimal: on its own this rule is impossible.'
            : `Minimal: drop any one of these ${k} and the rest can be satisfied — relaxing a single one re-solves.`
          : 'The solver ran out of time while shrinking this set, so it may not be minimal.'}
        {certificate !== null && certificate !== 'pending' && certificate.verified === true && (
          <> The impossibility proof was re-checked independently.</>
        )}
      </p>
    </section>
  );
}
