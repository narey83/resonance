import { AudioWaveform, ChevronDown, Minus, Plus } from 'lucide-react';
import React from 'react';

export const WAVEFORM_ZOOMS = [1, 16, 32, 64, 128, 256];

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
  enabled,
  enhancedAvailable = false,
  grid,
  height,
  onGrid,
  onHeight,
  onPhrases,
  onToggle,
  onVocals,
  onZoom,
  phrases,
  vocals,
  zoom,
}) => {
  const index = WAVEFORM_ZOOMS.indexOf(zoom);
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
            <span className="mp-waveform-select">
              <select
                aria-label="Waveform zoom"
                onChange={(event) => onZoom(Number(event.target.value))}
                value={zoom}
              >
                {WAVEFORM_ZOOMS.map((value) => (
                  <option
                    key={value}
                    value={value}
                  >
                    {value === 1 ? 'Normal' : `${value}× detail`}
                  </option>
                ))}
              </select>
              <ChevronDown
                aria-hidden="true"
                size={12}
              />
            </span>
            <button
              aria-label="Zoom waveform in"
              disabled={index >= WAVEFORM_ZOOMS.length - 1}
              onClick={() => onZoom(WAVEFORM_ZOOMS[index + 1])}
              type="button"
            >
              <Plus size={14} />
            </button>
          </div>
          <span className="mp-waveform-select">
            <select
              aria-label="Waveform height"
              onChange={(event) => onHeight(Number(event.target.value))}
              value={height}
            >
              {![40, 70, 110, 150].includes(height) && (
                <option value={height}>{height}px · Custom</option>
              )}
              <option value={40}>Compact</option>
              <option value={70}>Standard</option>
              <option value={110}>Large</option>
              <option value={150}>Studio</option>
            </select>
            <ChevronDown
              aria-hidden="true"
              size={12}
            />
          </span>
          <span
            aria-hidden="true"
            className="mp-waveform-divider"
          />
          <span className="mp-waveform-group-label">OVERLAYS</span>
          <button
            aria-pressed={grid}
            onClick={() => onGrid(!grid)}
            title={
              enhancedAvailable
                ? 'Beat grid: amber 16-bar lines, violet 32-bar lines; aligned to arrangement sections'
                : 'Beat grid: amber 16-bar lines, violet 32-bar lines; estimated anchors from backend analysis'
            }
            type="button"
          >
            Beat grid
          </button>
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
            className={`mp-waveform-select${enhancedAvailable ? '' : ' mp-waveform-select--disabled'}`}
            title={enhancedAvailable ? undefined : 'Requires Enhanced analysis'}
          >
            <select
              aria-label="Waveform phrase labels"
              disabled={!enhancedAvailable}
              onChange={(event) => onPhrases(event.target.value)}
              value={enhancedAvailable ? phrases : 'off'}
            >
              <option value="dj">DJ phrases</option>
              <option value="musical">Musical phrases</option>
              <option value="off">Hide phrases</option>
            </select>
            <ChevronDown
              aria-hidden="true"
              size={12}
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
