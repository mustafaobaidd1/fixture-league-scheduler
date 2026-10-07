import type { Team } from '../model/types';

/** Three-letter codes for compact tables, made unique within the league. */
export function teamCodes(teams: Team[]): string[] {
  const clean = (s: string) =>
    s
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9 ]/g, '')
      .toUpperCase();
  const words = teams.map((t) => clean(t.name).split(/\s+/).filter(Boolean));
  const candidates = (w: string[]): string[] => {
    const first = w[0] ?? 'TEAM';
    const out = [first.slice(0, 3)];
    if (w.length > 1)
      out.push((first.slice(0, 2) + w[1][0]).slice(0, 3), first[0] + w[1].slice(0, 2));
    for (let i = 3; i < first.length; i++) out.push(first.slice(0, 2) + first[i]);
    return out.filter((c) => c.length === 3);
  };
  const used = new Set<string>();
  return words.map((w, i) => {
    for (const c of candidates(w)) {
      if (!used.has(c)) {
        used.add(c);
        return c;
      }
    }
    const fallback = `${(w[0] ?? 'T').slice(0, 2)}${i + 1}`.slice(0, 4);
    used.add(fallback);
    return fallback;
  });
}
