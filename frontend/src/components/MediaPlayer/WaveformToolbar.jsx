import PlayerDropdown from './PlayerDropdown';
import { AudioWaveform, Minus, Plus } from 'lucide-react';
import React from 'react';

export const WAVEFORM_ZOOMS = [1, 16, 32, 64, 128, 256];
export const WAVEFORM_MARKER_INTERVALS = [0, 16, 32, 64];

export const normalizeWaveformMarkerInterval = (value) => {
  const interval = Number(value);
  return WAVEFORM_MARKER_INTERVALS.includes(interval) ? interval : 32;
};

// Keep preferences saved with the previous steps on a selectable zoom level.
export const normalizeWaveformZoom = (value) => {
  const zoom = Number(value);
  if (!Number.isFinite(zoom) || zoom <= 1) return 1;
  return (
    WAVEFORM_ZOOMS.find((level) => level >= zoom) ||
    WAVEFORM_ZOOMS[WAVEFORM_ZOOMS.length - 1]
  );
};

const WaveformToolbar = ({
  basicGridState,
  enabled,
  enhancedAvailable = false,
  grid,
  height,
  markerInterval = 32,
  onGrid,
  onHeight,
  onMarkerInterval,
  onPhrases,
  onToggle,
  onVocals,
  onZoom,
  phrases,
  vocals,
  zoom,
}) => {
  const index = WAVEFORM_ZOOMS.indexOf(zoom);
  const basicGridStatus =
    enabled && grid && !enhancedAvailable && basicGridState
      ? basicGridState.beatCount === 0
        ? 'No detected beat timing yet'
        : markerInterval > 0 &&
            basicGridState.estimatedMarkerCount >= markerInterval / 16
          ? `${markerInterval} beat count from first measured beat · estimated`
          : basicGridState.barPhaseStatus === 'unresolved' && zoom === 1
            ? 'Beat timing only · bar phase uncertain'
            : null
      : null;
  return (
    <div
      aria-label="Waveform controls"
      className="mp-waveform-toolbar"
      role="group"
    >
      <button
        aria-pressed={enabled}
        className="mp-waveform-toggle"
        onClick={onToggle}
        type="button"
      >
        <AudioWaveform size={15} /> Waveform
      </button>
      {enabled && (
        <>
          <span className="mp-waveform-group-label">VIEW</span>
          <div
            aria-label="Waveform zoom"
            className="mp-waveform-zoom"
            role="group"
          >
            <button
              aria-label="Zoom waveform out"
              disabled={index <= 0}
              onClick={() => onZoom(WAVEFORM_ZOOMS[index - 1])}
              type="button"
            >
              <Minus size={14} />
            </button>
            <PlayerDropdown
              label="Waveform zoom"
              onChange={onZoom}
              options={WAVEFORM_ZOOMS.map((value) => ({
                value,
                label: value === 1 ? 'Normal' : `${value}× detail`,
              }))}
              value={zoom}
            />
            <button
              aria-label="Zoom waveform in"
              disabled={index >= WAVEFORM_ZOOMS.length - 1}
              onClick={() => onZoom(WAVEFORM_ZOOMS[index + 1])}
              type="button"
            >
              <Plus size={14} />
            </button>
          </div>
          <PlayerDropdown
            label="Waveform height"
            onChange={onHeight}
            options={[
              ...(![70, 110, 150].includes(height)
                ? [{ value: height, label: `${height}px · Custom` }]
                : []),
              { value: 70, label: 'Standard' },
              { value: 110, label: 'Large' },
              { value: 150, label: 'Studio' },
            ]}
            value={height}
          />
          <span
            aria-hidden="true"
            className="mp-waveform-divider"
          />
          <span className="mp-waveform-group-label">OVERLAYS</span>
          <button
            aria-pressed={grid}
            onClick={() => onGrid(!grid)}
            title="Beat guides appear when zoomed in; count markers estimate intervals from the first measured beat"
            type="button"
          >
            Beat grid
          </button>
          <PlayerDropdown
            disabled={!grid}
            label="Beat marker interval"
            onChange={onMarkerInterval}
            options={WAVEFORM_MARKER_INTERVALS.map((value) => ({
              value,
              label: value === 0 ? 'Markers off' : `${value} beats`,
            }))}
            value={markerInterval}
          />
          {basicGridStatus && (
            <span
              className="mp-waveform-grid-status"
              role="status"
            >
              {basicGridStatus}
            </span>
          )}
          <button
            aria-pressed={enhancedAvailable && vocals}
            disabled={!enhancedAvailable}
            onClick={() => onVocals(!vocals)}
            title={
              enhancedAvailable
                ? 'Show vocal predictions'
                : 'Requires Enhanced analysis'
            }
            type="button"
          >
            Vocals
          </button>
          <span
            className="mp-waveform-phrase"
            title={enhancedAvailable ? undefined : 'Requires Enhanced analysis'}
          >
            <PlayerDropdown
              disabled={!enhancedAvailable}
              label="Waveform phrase labels"
              onChange={onPhrases}
              options={[
                { value: 'dj', label: 'DJ phrases' },
                { value: 'musical', label: 'Musical phrases' },
                { value: 'off', label: 'Hide phrases' },
              ]}
              value={enhancedAvailable ? phrases : 'off'}
            />
          </span>
          <span className="mp-waveform-hint">
            {zoom === 1 ? 'Full track' : 'Following playhead'} · click or drag
            to seek
          </span>
        </>
      )}
    </div>
  );
};

export default WaveformToolbar;
