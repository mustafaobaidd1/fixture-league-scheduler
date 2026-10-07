import type { InputIssue } from '../model/issues';
import { breakBound, seasonOf } from '../model/season';
import type { Validation } from '../validate/validate';
import type { AppState, Solved } from '../app/state';

export type Tone = 'idle' | 'running' | 'ok' | 'warn' | 'bad';

export interface Status {
  tone: Tone;
  title: string;
  detail: string;
  short: string;
  announce: string;
  /** The schedule on screen passes the independent validator. */
  verified: boolean;
}

const plural = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`;

export function statusOf(args: {
  state: AppState;
  current: Solved | null;
  validation: Validation | null;
  issues: InputIssue[];
  stale: boolean;
}): Status {
  const { state, current, validation, issues, stale } = args;
  const verified = validation?.ok === true;
  const out = state.outcome;

  if (state.running) {
    const st = state.running.stats;
    const best = state.running.best;
    let detail = 'Looking for a schedule that satisfies every rule.';
    if (st?.phase === 'improving' && best)
      detail = `Best so far: ${plural(best.breaks, 'break')}. Trying for fewer.`;
    if (st?.phase === 'proving' && best)
      detail = `Best so far: ${plural(best.breaks, 'break')}. Proving nothing beats it.`;
    if (st?.phase === 'explaining')
      detail = 'No schedule exists. Finding the smallest set of rules to blame.';
    return {
      tone: 'running',
      title: 'Solving…',
      detail,
      short: 'Solving…',
      announce: 'Solving…',
      verified,
    };
  }

  if (issues.length > 0) {
    return {
      tone: 'bad',
      title: 'Check the setup',
      detail:
        issues.length === 1
          ? issues[0].message
          : `${issues.length} problems need fixing before the solver can run.`,
      short: 'Fix setup',
      announce: `The setup has ${plural(issues.length, 'problem')}.`,
      verified: false,
    };
  }

  if (out && !stale && out.status === 'unsat') {
    const k = out.conflict.constraintIds.length;
    return {
      tone: 'bad',
      title: 'No schedule exists',
      detail: `${k === 1 ? 'This rule cannot hold' : `These ${k} rules cannot all hold`} — see the explanation.`,
      short: 'Impossible',
      announce: `No schedule exists. ${plural(k, 'rule')} conflict.`,
      verified: false,
    };
  }

  if (out && !stale && out.status === 'timeout' && !current) {
    return {
      tone: 'warn',
      title: 'No answer within 20 s',
      detail: 'The solver neither found a schedule nor proved that none exists.',
      short: 'Timed out',
      announce: 'No answer within 20 seconds.',
      verified: false,
    };
  }

  if (current && validation) {
    if (!validation.ok) {
      const broken = validation.constraints.filter((c) => !c.ok).length;
      return {
        tone: 'warn',
        title: validation.structureOk ? 'Rules broken' : 'Invalid schedule',
        detail: validation.structureOk
          ? `${plural(broken, 'rule')} ${broken === 1 ? 'fails' : 'fail'} on this schedule. Solve again.`
          : 'This schedule breaks the round-robin structure.',
        short: 'Re-solve',
        announce: `${plural(broken, 'rule')} broken by the current schedule.`,
        verified: false,
      };
    }
    const b = validation.totalBreaks;
    if (!stale && out?.status === 'optimal') {
      const title = out.proof === 'theory' ? 'Optimal' : 'Optimal (proven)';
      const detail =
        out.proof === 'solver'
          ? b === 0
            ? 'No breaks at all.'
            : `${plural(b, 'break')} — the solver proved ${b - 1} is impossible.`
          : out.proof === 'theory'
            ? `${plural(b, 'break')} — equal to the theoretical minimum.`
            : 'No breaks at all.';
      return {
        tone: 'ok',
        title,
        detail,
        short: 'Optimal',
        announce: `${title}: ${plural(b, 'break')}. Verified.`,
        verified,
      };
    }
    if (!stale && out?.status === 'feasible') {
      return {
        tone: 'ok',
        title: 'Feasible',
        detail: `Every rule holds · ${plural(b, 'break')} (not minimised).`,
        short: 'Feasible',
        announce: `Schedule found with ${plural(b, 'break')}. Verified.`,
        verified,
      };
    }
    if (!stale && out?.status === 'timeout') {
      const bound = breakBound(seasonOf(state.setup));
      const floor = bound && bound.value < b ? `; at least ${bound.value} are needed` : '';
      return {
        tone: 'warn',
        title: 'Best found in 20 s',
        detail: `No answer within 20 s — here is the best schedule found so far (${plural(b, 'break')}${floor}).`,
        short: 'Best so far',
        announce: `Time limit reached. Best schedule so far has ${plural(b, 'break')}.`,
        verified,
      };
    }
    return {
      tone: 'ok',
      title: 'Still valid',
      detail: 'Every rule still holds after your edits. Solve again to re-optimise.',
      short: 'Valid',
      announce: 'The current schedule still satisfies every rule.',
      verified,
    };
  }

  const changed = state.solved !== null;
  return {
    tone: 'idle',
    title: changed ? 'League changed' : 'Not solved yet',
    detail: changed
      ? 'The teams or format changed. Solve to schedule the new league.'
      : 'Press Solve to build a schedule.',
    short: 'Unsolved',
    announce: changed ? 'The league changed. Solve again.' : 'Not solved yet.',
    verified: false,
  };
}
