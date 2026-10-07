import { memo } from 'react';
import { compact } from '../app/hooks';

interface Props {
  series: Array<{ t: number; c: number }>;
  marks: Array<{ t: number; breaks: number }>;
  running: boolean;
}

const W = 300;
const H = 120;
const PAD = { l: 6, r: 8, t: 14, b: 20 };

/** Cumulative conflicts against time, with a tick for every improved schedule. */
export const ConflictChart = memo(function ConflictChart({ series, marks, running }: Props) {
  const tMax = Math.max(0.002, ...series.map((p) => p.t), ...marks.map((m) => m.t));
  const cMax = Math.max(1, ...series.map((p) => p.c));
  const x = (t: number) => PAD.l + (t / tMax) * (W - PAD.l - PAD.r);
  const y = (c: number) => H - PAD.b - (c / cMax) * (H - PAD.t - PAD.b);
  const pts = series.map((p) => `${x(p.t).toFixed(1)},${y(p.c).toFixed(1)}`).join(' ');
  const area =
    series.length > 1
      ? `M${x(series[0].t)},${y(0)} L${pts.split(' ').join(' L')} L${x(series[series.length - 1].t)},${y(0)} Z`
      : '';
  const last = series[series.length - 1];
  // Label ticks only where they do not collide; the last (best) one is always labelled.
  const labelled = new Set<number>();
  let lastX = Infinity;
  for (let i = marks.length - 1; i >= 0; i--) {
    const px = x(marks[i].t);
    if (i === marks.length - 1 || lastX - px >= 16) {
      labelled.add(i);
      lastX = px;
    }
  }
  const summary =
    `Conflicts over time: ${compact(last?.c ?? 0)} conflicts in ${tMax.toFixed(2)} s.` +
    (marks.length
      ? ` Improved schedules: ${marks.map((m) => `${m.breaks} breaks at ${m.t.toFixed(2)} s`).join(', ')}.`
      : '');

  return (
    <figure className="chart">
      <figcaption className="chart-caption">
        <span>Conflicts over time</span>
        <span className="chart-max">{compact(cMax)}</span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={summary}
        preserveAspectRatio="none"
        className={running ? 'is-live' : undefined}
      >
        <defs>
          <pattern id="chart-dots" width="4" height="4" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="0.9" fill="var(--ink)" />
          </pattern>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={PAD.l}
            x2={W - PAD.r}
            y1={y(cMax * f)}
            y2={y(cMax * f)}
            className="chart-grid"
          />
        ))}
        <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} className="chart-axis" />
        {area && <path d={area} fill="url(#chart-dots)" opacity="0.35" />}
        {series.length > 1 && <polyline points={pts} className="chart-line" fill="none" />}
        {marks.map((m, i) => (
          <g key={i} className="chart-mark">
            <line x1={x(m.t)} x2={x(m.t)} y1={PAD.t - 4} y2={y(0)} />
            {labelled.has(i) && (
              <text x={Math.min(W - 14, Math.max(10, x(m.t)))} y={PAD.t - 5} textAnchor="middle">
                {m.breaks}
              </text>
            )}
          </g>
        ))}
        <text x={PAD.l} y={H - 5} className="chart-tick">
          0 s
        </text>
        <text x={W - PAD.r} y={H - 5} textAnchor="end" className="chart-tick">
          {tMax < 1 ? `${Math.round(tMax * 1000)} ms` : `${tMax.toFixed(1)} s`}
        </text>
      </svg>
      {marks.length > 0 && <p className="chart-legend">Ticks: breaks in each improved schedule</p>}
    </figure>
  );
});
