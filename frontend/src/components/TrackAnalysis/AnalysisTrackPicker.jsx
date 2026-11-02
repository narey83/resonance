import useDebounce from '../../hooks/useDebounce';
import { getTracks } from '../../lib/musicLibrary';
import { Loader2, Music, Search, X } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

const trackLabel = (track) =>
  [
    track.title || track.filename?.split(/[/\\]/u).pop(),
    track.artist,
    track.album,
  ]
    .filter(Boolean)
    .join(' — ');

const AnalysisTrackPicker = ({ onSelect, selectedTrack }) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState({
    query: '',
    tracks: [],
    loading: false,
    failed: false,
  });
  const [active, setActive] = useState(-1);
  const [retry, setRetry] = useState(0);
  const input = useRef(null);
  const search = useDebounce(query.trim(), 250);
  useEffect(() => {
    if (!search || !open) return undefined;
    const controller = new AbortController();
    setResults({ query: search, tracks: [], loading: true, failed: false });
    getTracks(
      { search, limit: 8, sort: 'title' },
      { signal: controller.signal },
    )
      .then((data) => {
        if (!controller.signal.aborted)
          setResults({
            query: search,
            tracks: data?.tracks ?? [],
            loading: false,
            failed: false,
          });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setResults({
            query: search,
            tracks: [],
            loading: false,
            failed: true,
          });
      });
    return () => controller.abort();
  }, [open, retry, search]);
  const current = results.query === query.trim();
  const tracks = current ? results.tracks : [];
  const loading = !current || results.loading;
  const choose = (track) => {
    onSelect(track);
    setQuery('');
    setOpen(false);
    setActive(-1);
    input.current?.focus();
  };

  return (
    <div
      className="wa-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <div className="wa-picker-input-wrap">
        <Search size={13} />
        <input
          aria-activedescendant={
            active >= 0 && tracks[active]
              ? `waveform-track-${active}`
              : undefined
          }
          aria-autocomplete="list"
          aria-controls={
            open && query.trim() ? 'waveform-track-results' : undefined
          }
          aria-expanded={Boolean(open && query.trim())}
          aria-label="Search the music library for a waveform"
          className="wa-picker-input"
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            const key = event.key;
            if (key === 'Escape') {
              setOpen(false);
              setActive(-1);
            }

            if (key === 'ArrowDown' || key === 'ArrowUp') {
              event.preventDefault();
              setOpen(true);
              setActive((index) =>
                tracks.length
                  ? index < 0
                    ? key === 'ArrowDown'
                      ? 0
                      : tracks.length - 1
                    : (index + (key === 'ArrowDown' ? 1 : tracks.length - 1)) %
                      tracks.length
                  : -1,
              );
            }

            if (key === 'Enter' && tracks[active]) {
              event.preventDefault();
              choose(tracks[active]);
            }
          }}
          placeholder={
            selectedTrack
              ? trackLabel(selectedTrack)
              : 'Search the whole music library…'
          }
          ref={input}
          role="combobox"
          type="text"
          value={query}
        />
        {selectedTrack && !query && (
          <button
            aria-label="Clear selected waveform track"
            className="wa-picker-clear"
            onClick={() => onSelect(null)}
            title="Clear selection"
            type="button"
          >
            <X size={13} />
          </button>
        )}
      </div>
      {open && query.trim() && (
        <div className="wa-picker-dropdown">
          {loading ? (
            <p
              className="wa-picker-status"
              role="status"
            >
              <Loader2 size={13} /> Searching the music library…
            </p>
          ) : results.failed ? (
            <div
              className="wa-picker-status"
              role="alert"
            >
              Could not search the library.{' '}
              <button
                onClick={() => setRetry((value) => value + 1)}
                type="button"
              >
                Retry
              </button>
            </div>
          ) : tracks.length === 0 ? (
            <p
              className="wa-picker-status"
              role="status"
            >
              No tracks match “{query.trim()}”.
            </p>
          ) : null}
          <ul
            aria-label="Matching library tracks"
            id="waveform-track-results"
            role="listbox"
          >
            {tracks.map((track, index) => (
              <li
                aria-selected={index === active}
                id={`waveform-track-${index}`}
                key={track.path}
                role="option"
              >
                <button
                  className="wa-picker-option"
                  onClick={() => choose(track)}
                  tabIndex={-1}
                  type="button"
                >
                  <Music size={12} />
                  <span className="wa-picker-option-label">
                    {trackLabel(track)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default AnalysisTrackPicker;
