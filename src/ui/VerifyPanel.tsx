import { describeConstraint } from '../explain/describe';
import type { Season } from '../model/season';
import type { Setup } from '../model/types';
import type { Validation } from '../validate/validate';
import { CheckIcon, CrossIcon } from './icons';

/** The independent validator's verdict, check by check. */
export function VerifyPanel({
  validation,
  setup,
  season,
}: {
  validation: Validation;
  setup: Setup;
  season: Season;
}) {
  const rules = validation.constraints;
  return (
    <details className="verify" open={!validation.ok}>
      <summary>
        <span className={`verify-badge${validation.ok ? ' is-ok' : ' is-bad'}`}>
          {validation.ok ? <CheckIcon size={14} /> : <CrossIcon size={14} />}
          {validation.ok ? 'Verified' : 'Check failed'}
        </span>
        <span className="verify-summary">
          Independent validator · {validation.structural.length + rules.length} checks
        </span>
      </summary>
      <p className="verify-intro">
        Separate code from the encoder re-reads the schedule as plain matches and checks every rule
        from scratch.
      </p>
      <ul className="verify-list">
        {validation.structural.map((c) => (
          <li key={c.rule} className={c.ok ? 'is-ok' : 'is-bad'}>
            {c.ok ? <CheckIcon size={14} /> : <CrossIcon size={14} />}
            <span>
              {c.label}
              {!c.ok && c.problems.length > 0 && <small>{c.problems[0]}</small>}
            </span>
          </li>
        ))}
        {rules.map((r) => {
          const c = setup.constraints.find((x) => x.id === r.id);
          if (!c) return null;
          return (
            <li key={r.id} className={r.ok ? 'is-ok' : 'is-bad'}>
              {r.ok ? <CheckIcon size={14} /> : <CrossIcon size={14} />}
              <span>
                {describeConstraint(c, { teams: setup.teams, season })}
                <small>{r.detail}</small>
              </span>
            </li>
          );
        })}
        <li className="is-ok">
          <CheckIcon size={14} />
          <span>Breaks recounted from the matches: {validation.totalBreaks}</span>
        </li>
      </ul>
    </details>
  );
}
