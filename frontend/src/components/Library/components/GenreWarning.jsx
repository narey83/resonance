import './GenreWarning.css';
import { genreWarning } from '../../../lib/genreCompatibility';
import { Info, TriangleAlert } from 'lucide-react';
import React from 'react';

const Evidence = ({ evidence, label }) => (
  <div className="genre-warning-evidence">
    <span>{label}</span>
    <strong>{evidence.family?.label || evidence.tag || 'Unknown genre'}</strong>
    <span>
      {evidence.tag ? `Tagged: ${evidence.tag}` : 'No genre tag'}
      {evidence.prediction ? ` · Predicted: ${evidence.prediction}` : ''}
    </span>
  </div>
);

const GenreWarning = ({ comparison }) => {
  const warning = genreWarning(comparison);
  if (!warning) return null;
  const Icon = warning.kind === 'mismatch' ? TriangleAlert : Info;
  return (
    <div
      aria-label={warning.title}
      className={`genre-warning is-${warning.kind}`}
      role="note"
    >
      <div className="genre-warning-heading">
        <Icon
          aria-hidden="true"
          size={15}
        />
        <strong>{warning.title}</strong>
      </div>
      <div className="genre-warning-pair">
        <Evidence
          evidence={comparison.from}
          label="Outgoing"
        />
        <span aria-hidden="true">→</span>
        <Evidence
          evidence={comparison.to}
          label="Incoming"
        />
      </div>
      <p>{warning.detail}</p>
      <p className="genre-warning-advice">{warning.advice}</p>
    </div>
  );
};

export default GenreWarning;
