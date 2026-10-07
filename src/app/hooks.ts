import { useEffect, useState } from 'react';

/** Tracks a media query (false during the first render on servers / old browsers). */
export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && 'matchMedia' in window
      ? window.matchMedia(query).matches
      : false,
  );
  useEffect(() => {
    if (!('matchMedia' in window)) return;
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);
  return matches;
}

export const usePhone = () => useMedia('(max-width: 767.98px)');
export const useReducedMotion = () => useMedia('(prefers-reduced-motion: reduce)');

/** Triggers a file download for generated content. */
export function download(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const nf = new Intl.NumberFormat('en');

/** Compact counts for big solver numbers: 1,234 · 56.7k · 8.9M. */
export function compact(n: number): string {
  if (n < 10_000) return nf.format(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 100_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function seconds(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}
