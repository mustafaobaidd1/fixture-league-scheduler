import { memo, type CSSProperties } from 'react';
import { breakBound, type Season } from '../model/season';
import type { Setup } from '../model/types';
import type { Validation } from '../validate/validate';
import { Crest } from './Crest';

interface Props {
  setup: Setup;
  season: Season;
  validation: Validation;
}

export const StatsView = memo(function StatsView({ setup, season, validation }: Props) {
  const bound = breakBound(season);
  const maxBreaks = Math.max(1, ...validation.breaksPerTeam);
  const maxGames = Math.max(1, ...validation.homeGames.map((h, i) => h + validation.awayGames[i]));
  const T = validation.status[0]?.length ?? 0;
  const perRound = Array.from({ length: T }, (_, r) =>
    validation.breakAt.reduce((a, row) => a + (row[r] ? 1 : 0), 0),
  );
  const maxRound = Math.max(1, ...perRound);
  const breakFree = validation.breaksPerTeam.filter((b) => b === 0).length;
  const homeRange = [Math.min(...validation.homeGames), Math.max(...validation.homeGames)];

  return (
    <div className="stats">
      <dl className="stat-tiles">
        <div className="tile tile--big">
          <dt>Breaks in total</dt>
          <dd>{validation.totalBreaks}</dd>
        </div>
        <div className="tile">
          <dt>{bound?.exact ? 'Theoretical minimum' : 'Lower bound'}</dt>
          <dd>
            {bound ? bound.value : '—'}
            <span className="tile-note">
              {bound
                ? bound.source === 'de Werra 1981'
                  ? `de Werra (1981), ${season.legs === 1 ? 'n − 2' : '3n − 6'}, with no other rules`
                  : bound.source === 'odd team count'
                    ? 'Byes let every club alternate'
                    : 'At most two clubs can avoid breaks'
                : 'No simple bound for this format'}
            </span>
          </dd>
        </div>
        <div className="tile">
          <dt>Clubs without a break</dt>
          <dd>{breakFree}</dd>
        </div>
        <div className="tile">
          <dt>Home games per club</dt>
          <dd>
            {homeRange[0] === homeRange[1] ? homeRange[0] : `${homeRange[0]}–${homeRange[1]}`}
          </dd>
        </div>
      </dl>

      <section className="chart-block" aria-labelledby="stats-breaks">
        <h3 id="stats-breaks" className="block-title">
          Breaks per club
        </h3>
        <ul className="bars">
          {setup.teams.map((team, t) => (
            <li key={team.id} className="bar-row">
              <span className="bar-label">
                <Crest name={team.name || '?'} colors={team.colors} size={18} />
                <span>{team.name}</span>
              </span>
              <span
                className="bar-track"
                aria-hidden="true"
                style={{ '--units': maxBreaks } as CSSProperties}
              >
                <span
                  className="bar-fill bar-fill--break"
                  style={
                    {
                      width: `${(validation.breaksPerTeam[t] / maxBreaks) * 100}%`,
                    } as CSSProperties
                  }
                />
              </span>
              <span className="bar-value">{validation.breaksPerTeam[t]}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="chart-block" aria-labelledby="stats-venue">
        <h3 id="stats-venue" className="block-title">
          Home and away
        </h3>
        <ul className="bars">
          {setup.teams.map((team, t) => {
            const h = validation.homeGames[t];
            const a = validation.awayGames[t];
            return (
              <li key={team.id} className="bar-row">
                <span className="bar-label">
                  <Crest name={team.name || '?'} colors={team.colors} size={18} />
                  <span>{team.name}</span>
                </span>
                <span
                  className="bar-track bar-track--split"
                  aria-hidden="true"
                  style={{ '--units': maxGames } as CSSProperties}
                >
                  <span
                    className="bar-fill bar-fill--home"
                    style={
                      {
                        width: `${(h / maxGames) * 100}%`,
                        '--team': team.colors[0],
                      } as CSSProperties
                    }
                  />
                  <span
                    className="bar-fill bar-fill--away"
                    style={{ width: `${(a / maxGames) * 100}%` } as CSSProperties}
                  />
                </span>
                <span className="bar-value">
                  {h} H · {a} A
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="chart-block" aria-labelledby="stats-rounds">
        <h3 id="stats-rounds" className="block-title">
          Breaks by round
        </h3>
        <div
          className="columns"
          role="img"
          aria-label={`Breaks in each round: ${perRound.map((b, r) => `round ${r + 1}: ${b}`).join(', ')}`}
        >
          {perRound.map((b, r) => (
            <span key={r} className="column">
              <span
                className="column-bar"
                style={{ height: `${(b / maxRound) * 100}%` } as CSSProperties}
              >
                {b > 0 && <span className="column-value">{b}</span>}
              </span>
              <span className="column-label">{r + 1}</span>
            </span>
          ))}
        </div>
        <p className="hint">
          A break is counted in the round where a club plays its second home (or away) game in a
          row.
        </p>
      </section>
    </div>
  );
});
