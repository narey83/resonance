import { usePlayer } from '../../../context/PlayerContext';
import { CAMELOT_KEYS } from '../../../lib/camelot';
import * as prefs from '../../../lib/prefs';
import LibraryMenu from './LibraryMenu';
import { SlidersHorizontal } from 'lucide-react';
import React, { useState } from 'react';

export const EMPTY_DJ_FILTERS = {
  bpmMin: '',
  bpmMax: '',
  key: '',
  genre: '',
  energy: '',
  vocals: '',
  analysis: '',
};
const LibraryDjFilters = ({ onChange, textFilter, value }) => {
  const { track } = usePlayer();
  const [saved, setSaved] = useState(() =>
    prefs.get('library.savedFilters', []),
  );
  const [name, setName] = useState('');
  const change = (key, next) => onChange({ ...value, [key]: next });
  const active =
    Object.values(value).filter(Boolean).length +
    Number(Boolean(textFilter?.value));
  return (
    <LibraryMenu
      label="Filters"
      summary={
        <>
          <SlidersHorizontal
            aria-hidden="true"
            size={14}
          />{' '}
          Filters
          {active > 0 && (
            <span className="library-toolbar-badge">{active}</span>
          )}
        </>
      }
      wide
    >
      <div className="library-filter-heading">
        <strong>Filter your tracks</strong>
        {active > 0 && (
          <button
            className="jb-btn"
            onClick={() => {
              onChange({ ...EMPTY_DJ_FILTERS });
              textFilter?.onChange('');
            }}
            type="button"
          >
            Clear filters
          </button>
        )}
      </div>
      <label className="library-filter-saved">
        Saved filters
        <select
          aria-label="Saved DJ filters"
          onChange={(e) => {
            const item = saved[Number(e.target.value)];
            if (item) onChange(item.filters);
          }}
          value=""
        >
          <option value="">Saved filters…</option>
          {saved.map((item, index) => (
            <option
              key={item.name}
              value={index}
            >
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <div className="library-filter-fields">
        {textFilter && (
          <label className="library-filter-text">
            Text contains
            <input
              onChange={(e) => textFilter.onChange(e.target.value)}
              placeholder="Title, artist or album"
              value={textFilter.value}
            />
          </label>
        )}
        <label>
          BPM from
          <input
            max="300"
            min="30"
            onChange={(e) => change('bpmMin', e.target.value)}
            type="number"
            value={value.bpmMin}
          />
        </label>
        <label>
          BPM to
          <input
            max="300"
            min="30"
            onChange={(e) => change('bpmMax', e.target.value)}
            type="number"
            value={value.bpmMax}
          />
        </label>
        <label>
          Compatible key
          <select
            onChange={(e) => change('key', e.target.value)}
            value={value.key}
          >
            <option value="">Any key</option>
            {CAMELOT_KEYS.map((k) => (
              <option
                key={k.camelot}
                value={k.standard}
              >
                {k.standard} · {k.camelot}
              </option>
            ))}
          </select>
        </label>
        <button
          className="jb-btn"
          disabled={!track?.key}
          onClick={() => change('key', track.key)}
          type="button"
        >
          Use playing key
        </button>
        <label>
          Genre
          <input
            onChange={(e) => change('genre', e.target.value)}
            placeholder="Genre tag or prediction"
            value={value.genre}
          />
        </label>
        <label title="Mean PCM RMS, a loudness-based energy proxy">
          Energy · RMS
          <select
            onChange={(e) => change('energy', e.target.value)}
            value={value.energy}
          >
            <option value="">Any energy</option>
            <option value="low">Low · below 0.15</option>
            <option value="medium">Medium · 0.15–0.30</option>
            <option value="high">High · above 0.30</option>
          </select>
        </label>
        <label>
          Vocal predictions
          <select
            onChange={(e) => change('vocals', e.target.value)}
            value={value.vocals}
          >
            <option value="">Any</option>
            <option value="yes">Voice detected</option>
            <option value="no">No voice detected</option>
          </select>
        </label>
        <label>
          Analysis
          <select
            onChange={(e) => change('analysis', e.target.value)}
            value={value.analysis}
          >
            <option value="">All tracks</option>
            <option value="enhanced">Enhanced available</option>
            <option value="pending">Enhanced pending</option>
            <option value="incomplete">Basic incomplete</option>
          </select>
        </label>
        <div className="library-save-filter">
          <input
            aria-label="Filter name"
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name this filter"
            value={name}
          />
          <button
            className="jb-btn"
            disabled={!name.trim()}
            onClick={() => {
              const next = [
                ...saved.filter((item) => item.name !== name.trim()),
                { name: name.trim(), filters: value },
              ].slice(-20);
              setSaved(next);
              prefs.set('library.savedFilters', next);
              setName('');
            }}
            type="button"
          >
            Save filter
          </button>
        </div>
        {Number(value.bpmMin) > Number(value.bpmMax) && value.bpmMax && (
          <span role="status">Minimum BPM is higher than maximum.</span>
        )}
      </div>
    </LibraryMenu>
  );
};

export default LibraryDjFilters;
