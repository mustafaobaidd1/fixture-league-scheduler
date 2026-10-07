import type { Season } from '../model/season';
import type { Setup } from '../model/types';
import { ArrowLeftIcon } from './icons';

export function formatName(season: Season): string {
  if (season.legs === 1) return 'Single round-robin';
  return season.mirrored ? 'Double round-robin, mirrored' : 'Double round-robin';
}

export function Masthead({
  setup,
  season,
  onHowItWorks,
}: {
  setup: Setup;
  season: Season;
  onHowItWorks: () => void;
}) {
  return (
    <header className="masthead">
      <div className="masthead-bar">
        <a className="masthead-link" href="https://mustafaobaidd1.github.io/">
          <ArrowLeftIcon size={16} />
          <span>Mustafa Obaid · Portfolio</span>
        </a>
        <div className="masthead-actions">
          <button type="button" className="masthead-link" onClick={onHowItWorks}>
            How it works
          </button>
          <a
            className="masthead-link"
            href="https://github.com/mustafaobaidd1/fixture-league-scheduler"
          >
            Source code
          </a>
        </div>
      </div>
      <div className="masthead-main">
        <div className="masthead-title">
          <p className="kicker">Constraint solving · in your browser</p>
          <h1>Fixture</h1>
        </div>
        <div className="masthead-deck">
          <p className="deck">A league scheduler that explains its conflicts.</p>
          <p className="edition">
            <strong>{setup.name}</strong>
            <span>{setup.teams.length} clubs</span>
            <span>{season.T} rounds</span>
            <span>{formatName(season)}</span>
          </p>
        </div>
        <div className="halftone masthead-halftone" aria-hidden="true" />
      </div>
    </header>
  );
}
