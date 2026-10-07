import { memo, useId } from 'react';
import { crestFor } from '../crest/crest';

interface CrestProps {
  name: string;
  colors: [string, string];
  size?: number;
  /** Initials are drawn from this size up (they would be illegible below it). */
  withInitials?: boolean;
}

export const Crest = memo(function Crest({ name, colors, size = 28, withInitials }: CrestProps) {
  const id = useId();
  const spec = crestFor(name, colors);
  const showText = withInitials ?? size >= 30;
  const fontSize = spec.initials.length > 1 ? 30 : 36;
  return (
    <svg
      className="crest"
      width={size}
      height={size * 1.2}
      viewBox="0 0 100 120"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id={`${id}-clip`}>
          <path d={spec.shape} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}-clip)`}>
        {spec.layers.map((l, i) => (
          <path key={i} d={l.d} fill={l.fill} />
        ))}
        {showText && (
          <>
            <circle
              cx="50"
              cy="60"
              r="25"
              fill={spec.plateFill}
              stroke={spec.plateRing}
              strokeWidth="5"
            />
            <text
              x="50"
              y="61"
              textAnchor="middle"
              dominantBaseline="central"
              fill={spec.textFill}
              fontSize={fontSize}
              className="crest-initials"
            >
              {spec.initials}
            </text>
          </>
        )}
      </g>
      <path d={spec.shape} fill="none" stroke="var(--ink)" strokeWidth="5" strokeLinejoin="round" />
    </svg>
  );
});
