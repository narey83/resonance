import { djSummary } from '../../lib/libraryWorkbench';
import { AudioLines, CircleDashed, Loader2, Sparkles } from 'lucide-react';
import React from 'react';

export const playerAnalysisLevel = (metadata) => {
  const basicReady =
    metadata.hasWaveform === true &&
    Number(metadata.bpm) > 0 &&
    Boolean(metadata.key) &&
    metadata.lufs != null;
  if (!basicReady) return 'pending';
  return djSummary(metadata).complete === true ? 'enhanced' : 'basic';
};

const TrackAnalysisBadge = ({ active, metadata, track }) => {
  if (!track?.localRelativePath) return null;

  const kind = active ? 'working' : playerAnalysisLevel(metadata);
  const details = {
    working: ['Analysing', 'Track analysis is running', Loader2],
    enhanced: ['Enhanced', 'Basic and enhanced analysis complete', Sparkles],
    basic: [
      'Basic',
      'Basic analysis complete; enhanced analysis pending',
      AudioLines,
    ],
    pending: ['Pending', 'Basic analysis incomplete', CircleDashed],
  };
  const [label, title, Icon] = details[kind];

  return (
    <span
      aria-label={`Track analysis: ${label}`}
      className={`mp-analysis-badge mp-analysis-badge--${kind}`}
      role="status"
      title={title}
    >
      <Icon
        aria-hidden="true"
        className={kind === 'working' ? 'mp-analysis-badge-spinner' : undefined}
        size={12}
      />
      {label}
    </span>
  );
};

export default TrackAnalysisBadge;
