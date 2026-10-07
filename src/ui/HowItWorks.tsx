import { useEffect, useRef } from 'react';
import { CrossIcon } from './icons';

/** Long-form explanation: model, solver, encodings, proofs, validation and limits. */
export default function HowItWorks({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement as HTMLElement | null;
    if (!dialog.open) dialog.showModal();
    return () => opener?.focus();
  }, []);

  return (
    <dialog
      ref={ref}
      className="how"
      aria-labelledby="how-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
    >
      <div className="how-inner">
        <header className="how-head">
          <p className="kicker">How it works</p>
          <h2 id="how-title">A SAT solver that schedules a season — and says why when it can’t</h2>
          <button
            type="button"
            className="icon-btn how-close"
            aria-label="Close"
            onClick={() => ref.current?.close()}
          >
            <CrossIcon />
          </button>
        </header>

        <div className="how-body" tabIndex={0} role="region" aria-label="How it works, full text">
          <section>
            <h3>What kind of tool this is</h3>
            <p>
              A working planner, not a simulation. Every schedule it shows is checked by an{' '}
              <em>independent validator</em> — separate code that never sees the SAT encoding —
              against the round-robin structure and every active rule. Claims of optimality and
              impossibility rest on UNSAT answers from the solver; when the proof is small enough,
              an independent <em>RUP checker</em> re-derives every learnt clause before the claim is
              shown as checked. The encoding itself is tested against brute-force enumeration of
              every schedule for small leagues.
            </p>
          </section>

          <section>
            <h3>The model</h3>
            <p>
              With <i>n</i> clubs (a dummy club is added when <i>n</i> is odd — playing it means a
              bye), a leg has <i>N</i> − 1 rounds. The CNF formula uses three kinds of variables:
            </p>
            <ul>
              <li>
                <math>
                  <msub>
                    <mi>m</mi>
                    <mrow>
                      <mi>p</mi>
                      <mo>,</mo>
                      <mi>r</mi>
                    </mrow>
                  </msub>
                </math>{' '}
                — pair <i>p</i> = {'{'}
                <i>i</i>, <i>j</i>
                {'}'} meets in round <i>r</i>;
              </li>
              <li>
                <math>
                  <msub>
                    <mi>h</mi>
                    <mrow>
                      <mi>t</mi>
                      <mo>,</mo>
                      <mi>r</mi>
                    </mrow>
                  </msub>
                </math>{' '}
                — club <i>t</i> plays at home in round <i>r</i>;
              </li>
              <li>
                <math>
                  <msub>
                    <mi>b</mi>
                    <mrow>
                      <mi>t</mi>
                      <mo>,</mo>
                      <mi>r</mi>
                    </mrow>
                  </msub>
                </math>{' '}
                — club <i>t</i> has a <em>break</em> in round <i>r</i>: its second home (or away)
                game in a row. A bye interrupts a run.
              </li>
            </ul>
            <p>
              Structural rules: each club plays exactly once per round (an exactly-one constraint
              over its pairs), every pair meets once per leg, and a match has one home side:{' '}
              <math display="inline">
                <mrow>
                  <msub>
                    <mi>m</mi>
                    <mrow>
                      <mi>i</mi>
                      <mi>j</mi>
                      <mo>,</mo>
                      <mi>r</mi>
                    </mrow>
                  </msub>
                  <mo>→</mo>
                  <mo>(</mo>
                  <msub>
                    <mi>h</mi>
                    <mrow>
                      <mi>i</mi>
                      <mo>,</mo>
                      <mi>r</mi>
                    </mrow>
                  </msub>
                  <mo>⊕</mo>
                  <msub>
                    <mi>h</mi>
                    <mrow>
                      <mi>j</mi>
                      <mo>,</mo>
                      <mi>r</mi>
                    </mrow>
                  </msub>
                  <mo>)</mo>
                </mrow>
              </math>
              . A mirrored second half costs nothing: it reuses the first half’s variables, with{' '}
              <math>
                <mrow>
                  <msub>
                    <mi>h</mi>
                    <mrow>
                      <mi>t</mi>
                      <mo>,</mo>
                      <mi>r</mi>
                      <mo>+</mo>
                      <mi>R</mi>
                    </mrow>
                  </msub>
                  <mo>=</mo>
                  <mo>¬</mo>
                  <msub>
                    <mi>h</mi>
                    <mrow>
                      <mi>t</mi>
                      <mo>,</mo>
                      <mi>r</mi>
                    </mrow>
                  </msub>
                </mrow>
              </math>
              . A free double round-robin adds “<i>i</i> hosts <i>j</i>” variables so each club
              hosts every other club exactly once. Every user rule gets a <em>selector</em> literal{' '}
              <i>s</i>; its clauses become{' '}
              <math>
                <mrow>
                  <mo>(</mo>
                  <mo>¬</mo>
                  <mi>s</mi>
                  <mo>∨</mo>
                  <mo>…</mo>
                  <mo>)</mo>
                </mrow>
              </math>
              , so it is switched on by assuming <i>s</i>.
            </p>
          </section>

          <section>
            <h3>The solver: conflict-driven clause learning</h3>
            <p>The solver is written from scratch in TypeScript and runs in a Web Worker.</p>
            <ul>
              <li>
                <strong>Unit propagation with two watched literals.</strong> Each clause watches two
                of its literals and is only visited when one of them becomes false (Chaff, 2001); a
                cached “blocker” literal skips satisfied clauses, and two-literal clauses are stored
                as implication lists.
              </li>
              <li>
                <strong>Conflict analysis with first-UIP learning.</strong> When a clause is
                falsified, the solver walks the implication graph back to the first unique
                implication point of the current level and learns the clause that cuts there (GRASP,
                Chaff), then removes redundant literals by recursive minimisation.
              </li>
              <li>
                <strong>Non-chronological backjumping.</strong> It jumps back to the second-highest
                decision level in the learnt clause, where that clause immediately propagates.
              </li>
              <li>
                <strong>VSIDS.</strong> Variables in recent conflicts get their activity bumped by a
                growing increment (×1 / 0.95 per conflict), so old bumps decay; the next decision is
                the most active unassigned variable, kept in a binary heap.
              </li>
              <li>
                <strong>Phase saving.</strong> A variable is re-tried with the value it last had
                (Pipatsrisawat &amp; Darwiche, 2007). The first descent is seeded with a constructed
                schedule (below), so a league whose rules that schedule already meets is found
                without a single conflict.
              </li>
              <li>
                <strong>Luby restarts.</strong> The search restarts after 100 × luby(<i>i</i>)
                conflicts:{' '}
                <math>
                  <mrow>
                    <mn>1</mn>
                    <mo>,</mo>
                    <mn>1</mn>
                    <mo>,</mo>
                    <mn>2</mn>
                    <mo>,</mo>
                    <mn>1</mn>
                    <mo>,</mo>
                    <mn>1</mn>
                    <mo>,</mo>
                    <mn>2</mn>
                    <mo>,</mo>
                    <mn>4</mn>
                    <mo>,</mo>
                    <mn>1</mn>
                    <mo>,</mo>
                    <mo>…</mo>
                  </mrow>
                </math>{' '}
                (Luby, Sinclair &amp; Zuckerman, 1993).
              </li>
              <li>
                <strong>Clause deletion.</strong> Learnt clauses are ranked by literal block
                distance — the number of decision levels they touch — and the worse half is deleted
                periodically; clauses with LBD ≤ 2 are kept for good (Audemard &amp; Simon, 2009).
              </li>
            </ul>
          </section>

          <section>
            <h3>Cardinality encodings</h3>
            <p>
              <strong>Exactly-one</strong> is one “at least one” clause plus pairwise exclusions (≤
              8 literals) or a ladder of auxiliary variables (larger groups).{' '}
              <strong>
                At most <i>k</i>
              </strong>{' '}
              for per-club break caps uses Sinz’s sequential counter, with registers{' '}
              <math>
                <msub>
                  <mi>s</mi>
                  <mrow>
                    <mi>i</mi>
                    <mo>,</mo>
                    <mi>j</mi>
                  </mrow>
                </msub>
              </math>{' '}
              = “at least <i>j</i> of the first <i>i</i> inputs are true”:
            </p>
            <div
              className="how-math"
              tabIndex={0}
              role="region"
              aria-label="Sequential counter clauses"
            >
              <math display="block">
                <mrow>
                  <msub>
                    <mi>x</mi>
                    <mi>i</mi>
                  </msub>
                  <mo>∧</mo>
                  <msub>
                    <mi>s</mi>
                    <mrow>
                      <mi>i</mi>
                      <mo>−</mo>
                      <mn>1</mn>
                      <mo>,</mo>
                      <mi>j</mi>
                      <mo>−</mo>
                      <mn>1</mn>
                    </mrow>
                  </msub>
                  <mo>→</mo>
                  <msub>
                    <mi>s</mi>
                    <mrow>
                      <mi>i</mi>
                      <mo>,</mo>
                      <mi>j</mi>
                    </mrow>
                  </msub>
                  <mspace width="2em" />
                  <mo>¬</mo>
                  <msub>
                    <mi>x</mi>
                    <mi>i</mi>
                  </msub>
                  <mo>∨</mo>
                  <mo>¬</mo>
                  <msub>
                    <mi>s</mi>
                    <mrow>
                      <mi>i</mi>
                      <mo>−</mo>
                      <mn>1</mn>
                      <mo>,</mo>
                      <mi>k</mi>
                    </mrow>
                  </msub>
                </mrow>
              </math>
            </div>
            <p>
              The <strong>total</strong> number of breaks goes through a <em>totalizer</em>{' '}
              (Bailleux &amp; Boufkhad, 2003): a tree of unary adders whose outputs mean{' '}
              <math>
                <mrow>
                  <msub>
                    <mi>o</mi>
                    <mi>k</mi>
                  </msub>
                  <mo>⇐</mo>
                  <munderover>
                    <mo>∑</mo>
                    <mrow>
                      <mi>i</mi>
                    </mrow>
                    <mrow />
                  </munderover>
                  <msub>
                    <mi>b</mi>
                    <mi>i</mi>
                  </msub>
                  <mo>≥</mo>
                  <mi>k</mi>
                </mrow>
              </math>
              . Merging two children with outputs <i>a</i> and <i>b</i> adds{' '}
              <math>
                <mrow>
                  <mo>¬</mo>
                  <msub>
                    <mi>a</mi>
                    <mi>i</mi>
                  </msub>
                  <mo>∨</mo>
                  <mo>¬</mo>
                  <msub>
                    <mi>b</mi>
                    <mi>j</mi>
                  </msub>
                  <mo>∨</mo>
                  <msub>
                    <mi>r</mi>
                    <mrow>
                      <mi>i</mi>
                      <mo>+</mo>
                      <mi>j</mi>
                    </mrow>
                  </msub>
                </mrow>
              </math>
              . Assuming{' '}
              <math>
                <mrow>
                  <mo>¬</mo>
                  <msub>
                    <mi>o</mi>
                    <mrow>
                      <mi>k</mi>
                      <mo>+</mo>
                      <mn>1</mn>
                    </mrow>
                  </msub>
                </mrow>
              </math>{' '}
              then means “at most <i>k</i> breaks”.
            </p>
          </section>

          <section>
            <h3>A constructed starting point</h3>
            <p>
              De Werra’s canonical schedule has the fewest breaks possible for its format, and so
              does every copy of it with the clubs relabelled, all venues swapped or the rounds
              reversed. Before searching, a short local search over those transformations (plus
              rotations of the round order), scored by the independent validator — broken rules
              first, then breaks — picks the copy that fits the rules best. Its values become the
              solver’s saved phases: a hint, never a constraint. In the example league it already
              meets every rule with 18 breaks, so the solver’s real work is the proof that 17 is
              impossible.
            </p>
          </section>

          <section>
            <h3>Optimisation by bound tightening</h3>
            <p>
              After a schedule with <i>B</i> breaks is found, the solver is asked again under the
              extra assumption “at most <i>B</i> − 1”. Each SAT answer lowers <i>B</i>; learnt
              clauses carry over between calls. When the answer is UNSAT, no schedule with fewer
              breaks exists and the result is labelled <strong>Optimal (proven)</strong>. If the
              incumbent already equals a proven lower bound (below) the result is{' '}
              <strong>Optimal</strong> even when the solver’s own proof would take too long. On big
              leagues, when a full step stalls, a large-neighbourhood search pins the pairings
              outside a window of rounds (venues stay free) and asks for fewer breaks inside it;
              when windows stop helping, a full call gets the remaining time, since only a full call
              can prove optimality. After 20 s the best schedule so far is shown.
            </p>
          </section>

          <section>
            <h3>Explaining conflicts: cores and minimal unsatisfiable subsets</h3>
            <p>
              When the selectors cannot all be assumed, the solver reports the subset of assumptions
              involved in the final conflict — an unsatisfiable <em>core</em>. Deletion-based
              extraction then tries dropping each member: if the rest is still UNSAT, the member
              goes (and the smaller core of that call replaces the set); if the rest becomes
              satisfiable, the member is necessary. The result is a <em>minimal</em> unsatisfiable
              subset: every rule in it matters. A second pass guards the structural rules with
              selectors too and names the ones the conflict needs, such as “every club plays in
              every round”.
            </p>
          </section>

          <section>
            <h3>The breaks theorem</h3>
            <p>
              A club with no break alternates home and away, and there are only two such patterns.
              Two clubs with the same pattern are always at the same venue, so they could never play
              each other. Hence at most two clubs avoid breaks and a season needs at least <i>n</i>{' '}
              − 2. De Werra (1981) showed that for a single round-robin with <i>n</i> even this is
              exact, and that a mirrored double round-robin needs{' '}
              <math>
                <mrow>
                  <mn>3</mn>
                  <mi>n</mi>
                  <mo>−</mo>
                  <mn>6</mn>
                </mrow>
              </math>
              . With an odd number of clubs the byes let everyone alternate: zero breaks.
            </p>
            <p>
              The tests make the solver rediscover this: for <i>n</i> = 4, 6, …, 12 it finds{' '}
              <i>n</i> − 2 breaks by search alone and proves <i>n</i> − 3 infeasible (UNSAT); for
              mirrored seasons with <i>n</i> = 4, 6, 8 it proves 3<i>n</i> − 6. The <i>n</i> − 3
              proofs for <i>n</i> ≤ 10 are re-checked by the independent RUP checker. The validation
              script extends this to <i>n</i> = 16 (re-checked up to <i>n</i> = 14) and proves 3
              <i>n</i> − 6 for mirrored seasons up to <i>n</i> = 12.
            </p>
          </section>

          <section>
            <h3>Limitations</h3>
            <ul>
              <li>
                Large leagues with many rules can exhaust the 20-second budget; the best schedule
                found so far is then shown, without an optimality claim.
              </li>
              <li>
                Proof checking is forward RUP in the browser, so long proofs are skipped rather than
                checked. A checked proof certifies the CNF formula; that the formula matches the
                rules is covered by tests against exhaustive enumeration on small leagues, not by a
                formal proof.
              </li>
              <li>
                Breaks are the only objective. Travel distance, television slots and stadium
                capacities are out of scope.
              </li>
              <li>
                Rounds are dated by a fixed interval; individual match times and venues are not
                modelled.
              </li>
            </ul>
          </section>

          <section>
            <h3>Sources</h3>
            <ul className="how-sources">
              <li>
                D. de Werra, “Scheduling in sports”, Annals of Discrete Mathematics 11 (1981)
                381–395.
              </li>
              <li>
                R. V. Rasmussen, M. A. Trick, “Round robin scheduling — a survey”, EJOR 188 (2008)
                617–636.
              </li>
              <li>
                J. P. Marques-Silva, K. A. Sakallah, “GRASP: a search algorithm for propositional
                satisfiability”, IEEE TC (1999).
              </li>
              <li>M. Moskewicz et al., “Chaff: engineering an efficient SAT solver”, DAC 2001.</li>
              <li>
                N. Eén, N. Sörensson, “An extensible SAT-solver”, SAT 2003 (MiniSat; assumptions and
                final conflicts).
              </li>
              <li>
                G. Audemard, L. Simon, “Predicting learnt clauses quality in modern SAT solvers”,
                IJCAI 2009.
              </li>
              <li>
                K. Pipatsrisawat, A. Darwiche, “A lightweight component caching scheme for
                satisfiability solvers”, SAT 2007.
              </li>
              <li>
                M. Luby, A. Sinclair, D. Zuckerman, “Optimal speedup of Las Vegas algorithms”, IPL
                47 (1993).
              </li>
              <li>
                C. Sinz, “Towards an optimal CNF encoding of Boolean cardinality constraints”, CP
                2005.
              </li>
              <li>
                O. Bailleux, Y. Boufkhad, “Efficient CNF encoding of Boolean cardinality
                constraints”, CP 2003.
              </li>
            </ul>
            <p>
              Fonts: Big Shoulders Display and Barlow, both under the SIL Open Font License 1.1,
              self-hosted via Fontsource. Club names and crests are fictional.
            </p>
          </section>
        </div>
      </div>
    </dialog>
  );
}
