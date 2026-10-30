// <copyright file="MetadataLookupActivity.jsx" company="John Narey">
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

import { getActivity } from '../../lib/metadataLookup';
import React, { useEffect, useState } from 'react';

const LABELS = {
  Failed: 'Failed',
  NoMatch: 'No match',
  NotChecked: 'No lookup recorded',
  Preview: 'Not saved',
  Unchanged: 'Unchanged',
  Unknown: 'Earlier attempt · unverified',
  Updated: 'Updated online',
};

const time = (value) => new Date(value).toLocaleString();

const MetadataLookupActivity = () => {
  const [data, setData] = useState(null);
  const [search, setSearch] = useState('');
  const [outcome, setOutcome] = useState('all');
  const [page, setPage] = useState(1);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let disposed = false;
    let timer;
    setLoading(true);
    const refresh = async () => {
      try {
        const result = await getActivity({ outcome, page, search });
        if (!disposed) {
          setData(result);
          setError(false);
        }
      } catch {
        if (!disposed) setError(true);
      } finally {
        if (!disposed) {
          setLoading(false);
          timer = setTimeout(refresh, 10_000);
        }
      }
    };

    const debounce = setTimeout(refresh, 250);

    return () => {
      disposed = true;
      clearTimeout(debounce);
      clearTimeout(timer);
    };
  }, [outcome, page, retry, search]);

  const filter = (value) => {
    setOutcome(value);
    setPage(1);
  };

  return (
    <section
      aria-label="Online lookup activity"
      className="ml-activity"
    >
      <div className="ml-section-heading">
        <div>
          <h2>Track activity</h2>
          <p>
            Updates are confirmed from saved tag changes. Previews and attempts
            never count as updates.
          </p>
        </div>
        <button
          className="ml-btn hover-fx"
          onClick={() => setRetry((value) => value + 1)}
          type="button"
        >
          Refresh activity
        </button>
      </div>
      {error && (
        <div
          className="ml-notice"
          role="alert"
        >
          Activity could not be refreshed.{' '}
          {data
            ? 'Showing the last available results.'
            : 'Try Refresh activity.'}
        </div>
      )}
      {data?.historyHealthy === false && (
        <div
          className="ml-notice"
          role="alert"
        >
          Some activity history could not be loaded or saved. The record may be
          incomplete.
        </div>
      )}
      <div
        aria-label="Filter track activity"
        className="ml-summary-grid"
      >
        {[
          ['all', 'Shared tracks', data?.total],
          ['updated', 'Confirmed updated', data?.updated],
          ['notupdated', 'No confirmed update', data?.notUpdated],
          ['unknown', 'No verified history', data?.unknown],
        ].map(([value, label, count]) => (
          <button
            aria-pressed={outcome === value}
            className="ml-summary-card hover-fx"
            key={value}
            onClick={() => filter(value)}
            type="button"
          >
            <strong>{count ?? '—'}</strong>
            <span>{label}</span>
          </button>
        ))}
      </div>
      <label className="ml-search">
        <span>Find a track</span>
        <input
          maxLength={250}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          placeholder="Search filename or folder…"
          type="search"
          value={search}
        />
      </label>
      <p className="ml-history-note">
        Confirmed updated means at least one recorded online change, even if a
        later attempt made no changes. Earlier attempts have no verified field
        history. Expand a track for its latest 20 events.
      </p>
      <div
        aria-busy={loading}
        className="ml-history-list"
      >
        {loading ? (
          <div
            className="ml-empty"
            role="status"
          >
            Loading activity…
          </div>
        ) : data?.items?.length === 0 ? (
          <div className="ml-empty">
            {search || outcome !== 'all'
              ? 'No tracks match these filters.'
              : 'No shared audio tracks yet.'}
          </div>
        ) : (
          data?.items?.map((track) => (
            <details
              className="ml-track"
              key={track.maskedFilename}
            >
              <summary>
                <span
                  className={`ml-outcome ml-outcome--${track.lastUpdate ? 'updated' : track.status.toLowerCase()}`}
                >
                  {track.lastUpdate
                    ? 'Updated online'
                    : LABELS[track.status] || track.status}
                </span>
                <span className="ml-track-name">
                  <strong>{track.filename}</strong>
                  <span>{track.directory}</span>
                </span>
                <span className="ml-track-last">
                  {track.history[0]
                    ? `${LABELS[track.status] || track.status} · ${time(track.history[0].at)}`
                    : 'No recorded event'}
                </span>
              </summary>
              {track.lastUpdate && (
                <p className="ml-history-note">
                  Last confirmed update: {time(track.lastUpdate.at)} ·{' '}
                  {Object.entries(track.lastUpdate.fields)
                    .map(([field, provider]) => `${field} (${provider})`)
                    .join(', ')}
                </p>
              )}
              {track.history.length === 0 ? (
                <p className="ml-history-note">
                  {track.status === 'Unknown'
                    ? 'This track was attempted before verified history was introduced. Whether online metadata changed the file is unknown.'
                    : 'No lookup is recorded for this track. Existing tags do not prove an online update.'}
                </p>
              ) : (
                <ol className="ml-events">
                  {track.history.map((event) => (
                    <li key={event.id}>
                      <div>
                        <strong>{LABELS[event.status] || event.status}</strong>
                        <span>
                          {event.origin} ·{' '}
                          <time dateTime={event.at}>{time(event.at)}</time>
                        </span>
                      </div>
                      <p>{event.summary}</p>
                      {Object.keys(event.fields).length > 0 && (
                        <p>
                          Changed:{' '}
                          {Object.entries(event.fields)
                            .map(
                              ([field, provider]) => `${field} (${provider})`,
                            )
                            .join(', ')}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </details>
          ))
        )}
      </div>
      {data && (
        <div className="ml-pagination">
          <span>
            {data.filtered === 0
              ? '0 tracks'
              : `${(page - 1) * data.pageSize + 1}–${Math.min(page * data.pageSize, data.filtered)} of ${data.filtered} tracks`}
          </span>
          <button
            className="ml-btn"
            disabled={loading || page <= 1}
            onClick={() => setPage((value) => value - 1)}
            type="button"
          >
            Previous
          </button>
          <button
            className="ml-btn"
            disabled={loading || page * data.pageSize >= data.filtered}
            onClick={() => setPage((value) => value + 1)}
            type="button"
          >
            Next
          </button>
        </div>
      )}
    </section>
  );
};

export default MetadataLookupActivity;
