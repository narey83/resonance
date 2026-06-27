import { getCurrent as getOptions } from '../../lib/options';
import * as ytdlp from '../../lib/ytdlp';
import { Bell, Download, Search, X } from 'lucide-react';
import React, { useEffect, useState } from 'react';

const HISTORY_KEY = 'ytdlp.searchHistory';
const HISTORY_MAX = 12;
const AUDIO_FORMATS = ['best', 'mp3', 'opus', 'flac', 'wav', 'm4a'];

const loadHistory = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
};

const saveHistory = (history) => {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    // localStorage unavailable; history just won't persist
  }
};

const formatDuration = (seconds) => {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const formatCount = (n) => {
  if (n == null) return '';
  if (n >= 1_000_000)
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/u, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/u, '')}K`;
  return `${n}`;
};

const TYPE_LABELS = { channel: 'Channel', playlist: 'Playlist' };

const resultSubtitle = (r) => {
  if (r.type === 'channel') {
    const subs =
      r.subscriberCount != null
        ? `${formatCount(r.subscriberCount)} subscribers`
        : '';

    return [r.uploader !== r.title ? r.uploader : '', subs]
      .filter(Boolean)
      .join(' · ');
  }

  if (r.type === 'playlist') {
    return r.uploader || 'Playlist';
  }

  return [r.uploader, r.duration ? formatDuration(r.duration) : '']
    .filter(Boolean)
    .join(' · ');
};

const SearchPane = ({ onDownload, onSubscribe }) => {
  const [query, setQuery] = useState('');
  const [type, setType] = useState('video');
  const [mixPreset, setMixPreset] = useState('');
  const [uploadDate, setUploadDate] = useState('');
  const [audioFormat, setAudioFormat] = useState('');
  const [sort, setSort] = useState('');
  const [limit, setLimit] = useState(25);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [downloading, setDownloading] = useState({});
  const [subscribing, setSubscribing] = useState({});
  const [history, setHistory] = useState(loadHistory);

  // Default the format selector to the configured global format so it reflects what would
  // be used otherwise; the user can override it per download/subscription.
  useEffect(() => {
    getOptions()
      .then((options) => {
        const fmt = options?.integrations?.yt_dlp?.audio_format;
        if (fmt) setAudioFormat(fmt);
      })
      .catch(() => {});
  }, []);

  const addToHistory = (q) => {
    const next = [q, ...history.filter((h) => h !== q)].slice(0, HISTORY_MAX);
    setHistory(next);
    saveHistory(next);
  };

  const removeFromHistory = (q) => {
    const next = history.filter((h) => h !== q);
    setHistory(next);
    saveHistory(next);
  };

  const clearHistory = () => {
    setHistory([]);
    saveHistory([]);
  };

  const runSearch = async (q, overrides = {}) => {
    const options = {
      limit,
      sort,
      type,
      uploadDate: type === 'video' ? uploadDate : '',
      ...overrides,
    };
    setLoading(true);
    setResults([]);
    try {
      const res = await ytdlp.search(q, options);
      setResults(res.data || []);
      setSearched(true);
      addToHistory(q);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    await runSearch(query.trim());
  };

  const handleFilterChange = (setter, key) => async (e) => {
    const { value } = e.target;
    setter(key === 'limit' ? Number(value) : value);
    // For channels/playlists, upload date is a download-time filter (not a search filter),
    // so changing it shouldn't re-run the search.
    const skipResearch = key === 'uploadDate' && type !== 'video';
    if (!skipResearch && searched && query.trim() && !loading) {
      await runSearch(query.trim(), {
        [key]: key === 'limit' ? Number(value) : value,
      });
    }
  };

  const handleHistoryClick = async (q) => {
    setQuery(q);
    if (!loading) await runSearch(q);
  };

  const preset = ytdlp.DURATION_PRESETS.find((p) => p.value === mixPreset);

  // Only hide rows by length for video results — channel/playlist rows have no duration.
  const visibleResults =
    preset && type === 'video'
      ? results.filter(
          (r) =>
            r.duration &&
            r.duration >= preset.minSeconds &&
            (preset.maxSeconds === 0 || r.duration <= preset.maxSeconds),
        )
      : results;

  // Settings forwarded to downloads/subscriptions: chosen length (maxSeconds 0 = no upper bound),
  // chosen audio format, and — for channels/playlists — an upload-date lower bound.
  const downloadOverrides = {
    ...(preset
      ? {
          minTrackDurationSeconds: preset.minSeconds,
          maxTrackDurationSeconds: preset.maxSeconds,
        }
      : {}),
    ...(audioFormat ? { audioFormat } : {}),
    ...(type !== 'video' && uploadDate ? { uploadedAfter: uploadDate } : {}),
  };

  const handleDownload = async (result) => {
    setDownloading((previous) => ({ ...previous, [result.videoId]: true }));
    try {
      await onDownload(result, downloadOverrides);
    } finally {
      setDownloading((previous) => ({ ...previous, [result.videoId]: false }));
    }
  };

  const handleSubscribe = async (result) => {
    setSubscribing((previous) => ({ ...previous, [result.videoId]: true }));
    try {
      await onSubscribe(result, downloadOverrides);
    } finally {
      setSubscribing((previous) => ({ ...previous, [result.videoId]: false }));
    }
  };

  return (
    <div>
      <form
        className="ytdlp-add-form"
        onSubmit={handleSearch}
      >
        <div className="ytdlp-search-row">
          <div style={{ flex: 1 }}>
            <label>Search YouTube</label>
            <input
              autoFocus
              disabled={loading}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Artist, track, or channel name…"
              type="text"
              value={query}
            />
          </div>
          <button
            className="ytdlp-btn ytdlp-btn--primary"
            disabled={loading || !query.trim()}
            type="submit"
          >
            <Search size={14} />
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>

        <div className="ytdlp-search-filters">
          <select
            onChange={handleFilterChange(setType, 'type')}
            title="Result type"
            value={type}
          >
            <option value="video">Videos</option>
            <option value="channel">Channels</option>
            <option value="playlist">Playlists</option>
          </select>
          <select
            onChange={(e) => setMixPreset(e.target.value)}
            title="Mix length"
            value={mixPreset}
          >
            <option value="">Any length</option>
            {ytdlp.DURATION_PRESETS.map((p) => (
              <option
                key={p.value}
                value={p.value}
              >
                {p.label}
              </option>
            ))}
          </select>
          <select
            onChange={handleFilterChange(setUploadDate, 'uploadDate')}
            title={
              type === 'video'
                ? 'Upload date'
                : 'Only download uploads within this window'
            }
            value={uploadDate}
          >
            <option value="">Any time</option>
            <option value="today">Today</option>
            <option value="week">This week</option>
            <option value="month">This month</option>
            <option value="year">This year</option>
          </select>
          <select
            onChange={(e) => setAudioFormat(e.target.value)}
            title="Audio format"
            value={audioFormat}
          >
            {AUDIO_FORMATS.map((f) => (
              <option
                key={f}
                value={f}
              >
                {f}
              </option>
            ))}
          </select>
          <select
            onChange={handleFilterChange(setSort, 'sort')}
            title="Sort by"
            value={sort}
          >
            <option value="">Relevance</option>
            <option value="date">Upload date</option>
            <option value="views">View count</option>
            <option value="rating">Rating</option>
          </select>
          <select
            onChange={handleFilterChange(setLimit, 'limit')}
            title="Max results"
            value={limit}
          >
            <option value={10}>10 results</option>
            <option value={25}>25 results</option>
            <option value={50}>50 results</option>
          </select>
        </div>
      </form>

      {history.length > 0 && (
        <div className="ytdlp-history">
          <span className="ytdlp-history-label">Recent:</span>
          {history.map((h) => (
            <span
              className="ytdlp-history-chip"
              key={h}
            >
              <button
                onClick={() => handleHistoryClick(h)}
                type="button"
              >
                {h}
              </button>
              <button
                aria-label={`Remove ${h} from history`}
                className="ytdlp-history-chip-remove"
                onClick={() => removeFromHistory(h)}
                type="button"
              >
                <X size={11} />
              </button>
            </span>
          ))}
          <button
            className="ytdlp-history-clear"
            onClick={clearHistory}
            type="button"
          >
            Clear
          </button>
        </div>
      )}

      {loading && <div className="ytdlp-empty">Searching YouTube…</div>}

      {visibleResults.length === 0 && !loading && searched && (
        <div className="ytdlp-empty">No results</div>
      )}

      <div className="ytdlp-search-results">
        {visibleResults.map((r) => (
          <div
            className="ytdlp-result"
            key={r.videoId}
          >
            {r.thumbnailUrl ? (
              <img
                alt=""
                className={`ytdlp-result-thumb${r.type === 'channel' ? ' ytdlp-result-thumb--round' : ''}`}
                src={r.thumbnailUrl}
              />
            ) : (
              <div className="ytdlp-result-thumb-placeholder" />
            )}
            <div className="ytdlp-result-info">
              <div className="ytdlp-result-title">
                {r.title}
                {TYPE_LABELS[r.type] && (
                  <span className="ytdlp-result-badge">
                    {TYPE_LABELS[r.type]}
                  </span>
                )}
              </div>
              <div className="ytdlp-result-sub">{resultSubtitle(r)}</div>
            </div>
            <div className="ytdlp-job-actions">
              {(r.type === 'channel' || r.type === 'playlist') &&
                onSubscribe && (
                  <button
                    className="ytdlp-btn"
                    disabled={subscribing[r.videoId]}
                    onClick={() => handleSubscribe(r)}
                    title="Auto-download new uploads from this channel"
                    type="button"
                  >
                    <Bell size={13} />
                    {subscribing[r.videoId] ? 'Subscribing…' : 'Subscribe'}
                  </button>
                )}
              <button
                className="ytdlp-btn ytdlp-btn--primary"
                disabled={downloading[r.videoId]}
                onClick={() => handleDownload(r)}
                type="button"
              >
                <Download size={13} />
                {downloading[r.videoId]
                  ? 'Adding…'
                  : r.type === 'video'
                    ? 'Download'
                    : 'Download all'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SearchPane;
