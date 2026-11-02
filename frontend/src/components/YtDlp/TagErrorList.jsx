// <copyright file="TagErrorList.jsx" company="John Narey">
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

import { toast } from '../../lib/activityNotices';
import * as ytdlp from '../../lib/ytdlp';
import { Pencil, RefreshCw } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

const TagErrorList = ({ jobs, onRetryTags }) => {
  const [retryingAll, setRetryingAll] = useState(false);
  const [errorTracks, setErrorTracks] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ album: '', artist: '', title: '' });
  const [saving, setSaving] = useState(false);

  const totalTagErrors = jobs.reduce(
    (n, job) => n + (job.tagFailedTracks || 0),
    0,
  );

  const jobTitleById = useMemo(() => {
    const map = {};
    for (const job of jobs) map[job.id] = job.title || job.url;
    return map;
  }, [jobs]);

  const refresh = useCallback(async () => {
    try {
      const res = await ytdlp.getTagErrors();
      setErrorTracks(res.data || []);
    } catch (error) {
      toast.error(`Failed to load tag errors: ${error.message}`);
      setErrorTracks([]);
    }
  }, []);

  useEffect(() => {
    refresh();
    // totalTagErrors is in the deps so the list refetches when the live
    // job stats (via SignalR) report a different error count
  }, [refresh, totalTagErrors]);

  const handleRetry = async (trackId) => {
    await onRetryTags(trackId);
    await refresh();
  };

  const startEdit = (t) => {
    // Prefill: pull a [LABEL] out of the raw title as the album guess
    const raw = t.title || '';
    const open = raw.indexOf('[');
    const close = raw.indexOf(']', open + 1);
    const hasLabel = open >= 0 && close > open;
    setForm({
      album: hasLabel ? raw.slice(open + 1, close) : '',
      artist: '',
      title: hasLabel
        ? `${raw.slice(0, open)} ${raw.slice(close + 1)}`.trim()
        : raw,
    });
    setEditingId(t.id);
  };

  const handleSave = async () => {
    if (!form.artist.trim() || !form.title.trim()) {
      toast.error('Artist and title are required');
      return;
    }

    setSaving(true);
    try {
      await ytdlp.setTags(editingId, form);
      toast.success('Tags saved');
      setEditingId(null);
      await refresh();
    } catch (error) {
      toast.error(`Save failed: ${error.response?.data || error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleRetryAll = async () => {
    setRetryingAll(true);
    try {
      await Promise.all(errorTracks.map((t) => ytdlp.retryTags(t.id)));
      toast.success('Retried all tag errors');
    } catch (error) {
      toast.error(`Retry all failed: ${error.message}`);
    } finally {
      setRetryingAll(false);
      await refresh();
    }
  };

  if (errorTracks === null) {
    return <div className="ytdlp-empty">Loading tag errors…</div>;
  }

  if (errorTracks.length === 0) {
    return <div className="ytdlp-empty">No tag errors — all good!</div>;
  }

  return (
    <div>
      <div
        style={{
          marginBottom: 12,
          display: 'flex',
          justifyContent: 'flex-end',
        }}
      >
        <button
          className="ytdlp-btn ytdlp-btn--primary"
          disabled={retryingAll}
          onClick={handleRetryAll}
          type="button"
        >
          <RefreshCw size={13} />
          {retryingAll ? 'Retrying…' : 'Retry All'}
        </button>
      </div>
      <div className="ytdlp-tag-error-list">
        {errorTracks.map((t) => (
          <div
            className="ytdlp-tag-error-item"
            key={t.id}
          >
            <div className="ytdlp-tag-error-info">
              <div className="ytdlp-tag-error-title">{t.title}</div>
              <div className="ytdlp-tag-error-msg">{t.tagWritingError}</div>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  marginTop: 2,
                }}
              >
                {jobTitleById[t.jobId] || ''}
              </div>
              {editingId === t.id && (
                <div className="ytdlp-tag-fix">
                  <input
                    onChange={(event) =>
                      setForm({ ...form, artist: event.target.value })
                    }
                    placeholder="Artist"
                    type="text"
                    value={form.artist}
                  />
                  <input
                    onChange={(event) =>
                      setForm({ ...form, title: event.target.value })
                    }
                    placeholder="Title"
                    type="text"
                    value={form.title}
                  />
                  <input
                    onChange={(event) =>
                      setForm({ ...form, album: event.target.value })
                    }
                    placeholder="Album (optional)"
                    type="text"
                    value={form.album}
                  />
                  <div className="ytdlp-tag-fix-actions">
                    <button
                      className="ytdlp-btn ytdlp-btn--primary"
                      disabled={saving}
                      onClick={handleSave}
                      type="button"
                    >
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      className="ytdlp-btn"
                      disabled={saving}
                      onClick={() => setEditingId(null)}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
            {editingId !== t.id && (
              <>
                <button
                  className="ytdlp-btn"
                  onClick={() => startEdit(t)}
                  type="button"
                >
                  <Pencil size={13} /> Fix
                </button>
                <button
                  className="ytdlp-btn"
                  onClick={() => handleRetry(t.id)}
                  type="button"
                >
                  <RefreshCw size={13} /> Retry
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default TagErrorList;
