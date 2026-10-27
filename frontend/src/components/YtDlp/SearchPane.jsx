// <copyright file="SearchPane.jsx" company="John Narey">
//    ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮
//   ─╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰  resonance
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) 2026 John Narey.
//   │ Part of Resonance, a Soulseek client based on slskd.
//   │
//   │ This program is free software: you can redistribute it and/or modify
//   │ it under the terms of the GNU Affero General Public License as published
//   │ by the Free Software Foundation, version 3.
//   │
//   │ This program is distributed in the hope that it will be useful,
//   │ but WITHOUT ANY WARRANTY; without even the implied warranty of
//   │ MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
//   │ GNU Affero General Public License for more details.
//   │
//   │ You should have received a copy of the GNU Affero General Public License
//   │ along with this program.  If not, see https://www.gnu.org/licenses/.
//   │
//   │ This program is distributed with Additional Terms pursuant to Section 7
//   │ of the AGPLv3.  See the LICENSE file in the root directory of this
//   │ project for the complete terms and conditions.
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: John Narey
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

import '../Search/Search.css';
import { getCurrent as getOptions } from '../../lib/options';
import * as ytdlp from '../../lib/ytdlp';
import { Bell, Download, Plus, Search, X } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

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

// A pasted URL skips the search and resolves to a single result card instead
const isUrl = (q) => /^https?:\/\//iu.test(q);

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
  const appliedSearch = useRef(null);
  const [wizardOpen, setWizardOpen] = useState(true);
  const [step, setStep] = useState(0);
  const [searchError, setSearchError] = useState('');
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
  const [urlMode, setUrlMode] = useState(false);

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
    appliedSearch.current = {
      query: q,
      type,
      mixPreset,
      uploadDate,
      audioFormat,
      sort,
      limit,
    };
    setWizardOpen(false);
    setSearchError('');
    setLoading(true);
    setResults([]);
    if (isUrl(q)) {
      setUrlMode(true);
      try {
        const res = await ytdlp.resolveUrl(q);
        setResults(res.data ? [res.data] : []);
      } catch (error) {
        setResults([]);
        setSearchError(
          `Could not resolve this URL: ${typeof error.response?.data === 'string' ? error.response.data : error.message}`,
        );
      } finally {
        setSearched(true);
        setLoading(false);
      }

      return;
    }

    setUrlMode(false);
    const options = {
      limit,
      sort,
      type,
      uploadDate: type === 'video' ? uploadDate : '',
      ...overrides,
    };
    try {
      const res = await ytdlp.search(q, options);
      setResults(res.data || []);
      setSearched(true);
      addToHistory(q);
    } catch (error) {
      setSearched(true);
      setSearchError(
        `Search failed: ${typeof error.response?.data === 'string' ? error.response.data : error.message}`,
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim() || loading) return;
    if (step < 2) {
      setStep(step + 1);
      return;
    }

    await runSearch(query.trim());
  };

  const backToResults = () => {
    const applied = appliedSearch.current;
    if (applied) {
      setQuery(applied.query);
      setType(applied.type);
      setMixPreset(applied.mixPreset);
      setUploadDate(applied.uploadDate);
      setAudioFormat(applied.audioFormat);
      setSort(applied.sort);
      setLimit(applied.limit);
    }

    setWizardOpen(false);
  };

  const handleHistoryClick = async (q) => {
    setQuery(q);
    if (!loading) await runSearch(q);
  };

  const preset = ytdlp.DURATION_PRESETS.find((p) => p.value === mixPreset);

  // Only hide rows by length for video results — channel/playlist rows have no duration,
  // and a URL-resolved video was asked for explicitly so it's never hidden.
  const visibleResults =
    preset && type === 'video' && !urlMode
      ? results.filter(
          (r) =>
            r.duration &&
            r.duration >= preset.minSeconds &&
            (preset.maxSeconds === 0 || r.duration <= preset.maxSeconds),
        )
      : results;

  // Settings forwarded to downloads/subscriptions: chosen length (maxSeconds 0 = no upper
  // bound), chosen audio format, and — for channels/playlists — an upload-date lower bound.
  // A URL-resolved single video skips the length filter: it was asked for explicitly, so a
  // hidden duration cutoff would silently produce an empty download.
  const overridesFor = (result) => ({
    ...(preset && !(urlMode && result.type === 'video')
      ? {
          minTrackDurationSeconds: preset.minSeconds,
          maxTrackDurationSeconds: preset.maxSeconds,
        }
      : {}),
    ...(audioFormat ? { audioFormat } : {}),
    ...(result.type !== 'video' && uploadDate
      ? { uploadedAfter: uploadDate }
      : {}),
  });

  const handleDownload = async (result) => {
    setDownloading((previous) => ({ ...previous, [result.videoId]: true }));
    try {
      await onDownload(result, overridesFor(result));
    } finally {
      setDownloading((previous) => ({ ...previous, [result.videoId]: false }));
    }
  };

  const handleSubscribe = async (result) => {
    setSubscribing((previous) => ({ ...previous, [result.videoId]: true }));
    try {
      await onSubscribe(result, overridesFor(result));
    } finally {
      setSubscribing((previous) => ({ ...previous, [result.videoId]: false }));
    }
  };

  return (
    <div className="ytdlp-search-workspace sr-workspace">
      <header className="sr-workspace-header">
        <div>
          <span className="sr-eyebrow">YT-DLP · YOUTUBE</span>
          <h1>YouTube search</h1>
        </div>
        {!wizardOpen && (
          <button
            className="sr-wizard-primary"
            disabled={loading}
            onClick={() => {
              setWizardOpen(true);
              setStep(0);
            }}
            type="button"
          >
            <Plus size={16} /> New search
          </button>
        )}
      </header>
      {wizardOpen && (
        <form
          className="sr-wizard"
          onSubmit={handleSearch}
        >
          <ol
            aria-label="YouTube search steps"
            className="sr-wizard-steps"
          >
            {['Find the music', 'Shape your search', 'Review & search'].map(
              (label, index) => (
                <li
                  aria-current={step === index ? 'step' : undefined}
                  key={label}
                >
                  <span>{index + 1}</span>
                  {label}
                </li>
              ),
            )}
          </ol>
          <div className="sr-wizard-body">
            <span className="sr-eyebrow">STEP {step + 1} OF 3</span>
            <h2>
              {
                [
                  'What would you like to find?',
                  'Choose what suits your library',
                  'Ready to discover?',
                ][step]
              }
            </h2>
            {step === 0 && (
              <>
                <p>
                  Search YouTube for music, sets and channels, or paste a direct
                  link.
                </p>
                <div className="sr-wizard-grid">
                  <label className="ytdlp-query-field">
                    Search words or URL
                    <input
                      autoFocus
                      disabled={loading}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Artist, track, channel or https://…"
                      type="text"
                      value={query}
                    />
                  </label>
                  {!isUrl(query.trim()) && (
                    <label>
                      Look for
                      <select
                        onChange={(event) => setType(event.target.value)}
                        value={type}
                      >
                        <option value="video">Videos / tracks</option>
                        <option value="channel">Channels</option>
                        <option value="playlist">Playlists</option>
                      </select>
                    </label>
                  )}
                </div>
                {isUrl(query.trim()) && (
                  <p className="sr-wizard-note">
                    Direct link detected. We’ll look up that item rather than
                    run a keyword search.
                  </p>
                )}
              </>
            )}
            {step === 1 && (
              <>
                <p>
                  Choose the results you want to see and the audio format to use
                  if you download.
                </p>
                <div className="sr-wizard-grid">
                  <label>
                    Length preference
                    <select
                      onChange={(event) => setMixPreset(event.target.value)}
                      value={mixPreset}
                    >
                      <option value="">Any length</option>
                      {ytdlp.DURATION_PRESETS.map((item) => (
                        <option
                          key={item.value}
                          value={item.value}
                        >
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Audio format for downloads
                    <select
                      onChange={(event) => setAudioFormat(event.target.value)}
                      value={audioFormat}
                    >
                      <option value="">Server default</option>
                      {AUDIO_FORMATS.map((format) => (
                        <option
                          key={format}
                          value={format}
                        >
                          {format === 'best'
                            ? 'Best available'
                            : format.toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {type === 'video' && !isUrl(query.trim())
                      ? 'Uploaded'
                      : 'Collection uploads to download'}
                    <select
                      onChange={(event) => setUploadDate(event.target.value)}
                      value={uploadDate}
                    >
                      <option value="">Any time</option>
                      <option value="today">Today</option>
                      <option value="week">This week</option>
                      <option value="month">This month</option>
                      <option value="year">This year</option>
                    </select>
                  </label>
                  {!isUrl(query.trim()) && (
                    <>
                      <label>
                        Sort results
                        <select
                          onChange={(event) => setSort(event.target.value)}
                          value={sort}
                        >
                          <option value="">Relevance</option>
                          <option value="date">Upload date</option>
                          <option value="views">View count</option>
                          <option value="rating">Rating</option>
                        </select>
                      </label>
                      <label>
                        Results to collect
                        <select
                          onChange={(event) =>
                            setLimit(Number(event.target.value))
                          }
                          value={limit}
                        >
                          <option value={10}>10 results</option>
                          <option value={25}>25 results</option>
                          <option value={50}>50 results</option>
                        </select>
                      </label>
                    </>
                  )}
                </div>
                <p className="sr-wizard-note">
                  Length presets filter returned videos and collection
                  downloads; they don’t identify a mix by its title. Direct
                  single-video links bypass length and date filters. Converting
                  to FLAC or WAV won’t restore quality missing from the source.
                </p>
                {(type !== 'video' || isUrl(query.trim())) && (
                  <p>
                    Date preferences apply when downloading a collection, rather
                    than filtering channel or playlist search results.
                  </p>
                )}
              </>
            )}
            {step === 2 && (
              <>
                <p>
                  {isUrl(query.trim())
                    ? 'Look up this link'
                    : `Search YouTube for ${type === 'video' ? 'videos' : `${type}s`}`}
                </p>
                <blockquote className="sr-query-preview">
                  {query.trim()}
                </blockquote>
                <p>
                  {preset?.label || 'Any length'} ·{' '}
                  {audioFormat
                    ? audioFormat === 'best'
                      ? 'Best available audio'
                      : audioFormat.toUpperCase()
                    : 'Server audio default'}
                  {!isUrl(query.trim()) ? ` · up to ${limit} results` : ''}
                </p>
                <p>
                  {!isUrl(query.trim()) && (
                    <>
                      Order:{' '}
                      {sort === 'date'
                        ? 'upload date'
                        : sort === 'views'
                          ? 'view count'
                          : sort === 'rating'
                            ? 'rating'
                            : 'relevance'}{' '}
                      ·{' '}
                    </>
                  )}
                  Uploads:{' '}
                  {uploadDate
                    ? {
                        today: 'today',
                        week: 'this week',
                        month: 'this month',
                        year: 'this year',
                      }[uploadDate]
                    : 'any time'}
                  {type !== 'video' || isUrl(query.trim())
                    ? ' (collection downloads)'
                    : ''}
                </p>
                <p>
                  Searching only retrieves information. Choose a result
                  afterwards to download it or subscribe to a collection.
                </p>
              </>
            )}
          </div>
          <footer className="sr-wizard-actions">
            {searched && (
              <button
                disabled={loading}
                onClick={backToResults}
                type="button"
              >
                Back to results
              </button>
            )}
            {step > 0 && (
              <button
                disabled={loading}
                onClick={() => setStep(step - 1)}
                type="button"
              >
                Back
              </button>
            )}
            <button
              className="sr-wizard-primary"
              disabled={loading || !query.trim()}
              type="submit"
            >
              {step < 2
                ? 'Continue'
                : isUrl(query.trim())
                  ? 'Look up link'
                  : 'Search YouTube'}
            </button>
          </footer>
        </form>
      )}
      {!wizardOpen && (
        <div className="sr-results-toolbar">
          <Search size={16} />
          <strong>{query}</strong>
          <span className="sr-result-summary">
            {loading
              ? 'Working…'
              : `${visibleResults.length} shown · ${results.length} found`}
          </span>
          <button
            className="sr-refine-toggle"
            disabled={loading}
            onClick={() => {
              setWizardOpen(true);
              setStep(1);
            }}
            type="button"
          >
            Edit search
          </button>
        </div>
      )}
      {history.length > 0 && (
        <div className="ytdlp-history">
          <span className="ytdlp-history-label">Recent:</span>
          {history.map((h) => (
            <span
              className="ytdlp-history-chip"
              key={h}
            >
              <button
                className="hover-fx"
                disabled={loading}
                onClick={() => handleHistoryClick(h)}
                type="button"
              >
                {h}
              </button>
              <button
                aria-label={`Remove ${h} from history`}
                className="ytdlp-history-chip-remove hover-fx"
                onClick={() => removeFromHistory(h)}
                type="button"
              >
                <X size={11} />
              </button>
            </span>
          ))}
          <button
            className="ytdlp-history-clear hover-fx"
            onClick={clearHistory}
            type="button"
          >
            Clear
          </button>
        </div>
      )}

      {!wizardOpen && loading && (
        <div className="ytdlp-empty">
          {urlMode ? 'Resolving URL…' : 'Searching YouTube…'}
        </div>
      )}

      {!wizardOpen &&
        !searchError &&
        visibleResults.length === 0 &&
        !loading &&
        searched && (
          <div className="ytdlp-empty">
            {urlMode
              ? 'No information found for that URL'
              : results.length > 0
                ? 'No videos match your length preference. Edit the search to broaden it.'
                : 'No results. Try different search words.'}
          </div>
        )}

      {!wizardOpen && searchError && (
        <div
          className="ytdlp-search-error"
          role="alert"
        >
          <h2>We couldn’t complete this search</h2>
          <p>{searchError}</p>
          <button
            className="ytdlp-btn"
            onClick={() => {
              setWizardOpen(true);
              setStep(2);
            }}
            type="button"
          >
            Review and retry
          </button>
        </div>
      )}
      {!wizardOpen && (
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
                  decoding="async"
                  loading="lazy"
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
                      title="Auto-download new items from this collection"
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
      )}
    </div>
  );
};

export default SearchPane;
