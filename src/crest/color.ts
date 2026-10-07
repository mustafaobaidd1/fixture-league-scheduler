/** WCAG 2.x colour maths: relative luminance and contrast ratio. */

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export const INK = '#141414';
export const WHITE = '#ffffff';

/**
 * Ink or white text, whichever reads better on the background. Mid-tone backgrounds where
 * neither reaches 4.5:1 fall back to pure black, which always does (worst case ≈ 4.58:1).
 */
export function textOn(background: string): string {
  const onInk = contrast(background, INK);
  const onWhite = contrast(background, WHITE);
  const best = onInk >= onWhite ? INK : WHITE;
  return Math.max(onInk, onWhite) >= 4.5 ? best : '#000000';
}
