/**
 * The Luby sequence 1, 1, 2, 1, 1, 2, 4, 1, 1, 2, 1, 1, 2, 4, 8, … scaled by powers of `y`.
 *
 * Luby, Sinclair & Zuckerman (1993) showed that restarting a Las Vegas algorithm after
 * luby(i) units of work is within a logarithmic factor of the optimal fixed strategy.
 * CDCL solvers (MiniSat 2.2 onwards) use it with y = 2 and a unit of 100 conflicts.
 *
 * `x` is 0-based. The implementation follows MiniSat's: find the complete sub-sequence that
 * contains index x, then walk down into it.
 */
export function luby(y: number, x: number): number {
  let size = 1;
  let seq = 0;
  while (size < x + 1) {
    seq++;
    size = 2 * size + 1;
  }
  while (size - 1 !== x) {
    size = (size - 1) >> 1;
    seq--;
    x = x % size;
  }
  return Math.pow(y, seq);
}
