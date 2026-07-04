import * as ytdlp from '../../lib/ytdlp';
import { Bell, Pause, Play, RefreshCw, Trash2 } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';

const INTERVAL_PRESETS = [
  { value: 0, label: 'Default' },
  { value: 60, label: 'Hourly' },
  { value: 360, label: 'Every 6h' },
  { value: 720, label: 'Every 12h' },
  { value: 1_440, label: 'Daily' },
];

const formatInterval = (minutes) => {
  if (!minutes) return 'default';
  if (minutes % 1_440 === 0) return `every ${minutes / 1_440}d`;
  if (minutes % 60 === 0) return `every ${minutes / 60}h`;
  return `every ${minutes}m`;
};

const formatChecked = (iso) => {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

const SubscriptionsPane = ({ subscriptions }) => {
  const [busy, setBusy] = useState({});
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const setItemBusy = (id, value) =>
    setBusy((previous) => ({ ...previous, [id]: value }));

  const handleToggle = async (sub) => {
    setItemBusy(sub.id, true);
    try {
      await ytdlp.updateSubscription(sub.id, { enabled: !sub.enabled });
    } catch (error) {
      toast.error(`Update failed: ${error.message}`);
    } finally {
      if (mountedRef.current) setItemBusy(sub.id, false);
    }
  };

  const handleInterval = async (sub, value) => {
    setItemBusy(sub.id, true);
    try {
      await ytdlp.updateSubscription(sub.id, { pollIntervalMinutes: value });
    } catch (error) {
      toast.error(`Update failed: ${error.message}`);
    } finally {
      if (mountedRef.current) setItemBusy(sub.id, false);
    }
  };

  const handleCheck = async (sub) => {
    setItemBusy(sub.id, true);
    try {
      await ytdlp.checkSubscription(sub.id);
      toast.success(`Checking ${sub.channelTitle || 'channel'}…`);
    } catch (error) {
      toast.error(`Check failed: ${error.message}`);
    } finally {
      if (mountedRef.current) setItemBusy(sub.id, false);
    }
  };

  const handleRemove = async (sub) => {
    setItemBusy(sub.id, true);
    try {
      await ytdlp.removeSubscription(sub.id);
    } catch (error) {
      toast.error(`Remove failed: ${error.message}`);
      if (mountedRef.current) setItemBusy(sub.id, false);
    }
  };

  return (
    <div className="ytdlp-subs-root">
      {subscriptions.length === 0 ? (
        <div className="ytdlp-empty">
          <Bell size={28} />
          <p>No subscriptions yet.</p>
          <p>
            Search for a channel under <strong>Search</strong> and hit Subscribe
            — new uploads then download automatically.
          </p>
        </div>
      ) : (
        <div className="ytdlp-subs-list">
          {subscriptions.map((sub) => (
            <div
              className={`ytdlp-sub${sub.enabled ? '' : ' ytdlp-sub--paused'}`}
              key={sub.id}
            >
              {sub.thumbnailUrl ? (
                <img
                  alt=""
                  className="ytdlp-result-thumb ytdlp-result-thumb--round"
                  src={sub.thumbnailUrl}
                />
              ) : (
                <div className="ytdlp-result-thumb ytdlp-result-thumb-placeholder ytdlp-result-thumb--round" />
              )}

              <div className="ytdlp-sub-info">
                <a
                  className="ytdlp-sub-title"
                  href={sub.channelUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  {sub.channelTitle || sub.channelUrl}
                </a>
                <div className="ytdlp-sub-meta">
                  <span>{formatInterval(sub.pollIntervalMinutes)}</span>
                  <span>·</span>
                  <span>checked {formatChecked(sub.lastCheckedAt)}</span>
                  {sub.newVideosFound > 0 && (
                    <>
                      <span>·</span>
                      <span>{sub.newVideosFound} downloaded</span>
                    </>
                  )}
                  {!sub.enabled && (
                    <>
                      <span>·</span>
                      <span>paused</span>
                    </>
                  )}
                </div>
                {sub.lastError && (
                  <div className="ytdlp-sub-error">{sub.lastError}</div>
                )}
              </div>

              <div className="ytdlp-job-actions">
                <select
                  disabled={busy[sub.id]}
                  onChange={(e) => handleInterval(sub, Number(e.target.value))}
                  title="Check interval"
                  value={
                    INTERVAL_PRESETS.some(
                      (p) => p.value === sub.pollIntervalMinutes,
                    )
                      ? sub.pollIntervalMinutes
                      : 0
                  }
                >
                  {INTERVAL_PRESETS.map((p) => (
                    <option
                      key={p.value}
                      value={p.value}
                    >
                      {p.label}
                    </option>
                  ))}
                </select>
                <button
                  className="ytdlp-btn hover-fx ytdlp-btn--xs"
                  disabled={busy[sub.id]}
                  onClick={() => handleCheck(sub)}
                  title="Check now"
                  type="button"
                >
                  <RefreshCw size={13} />
                </button>
                <button
                  className="ytdlp-btn hover-fx ytdlp-btn--xs"
                  disabled={busy[sub.id]}
                  onClick={() => handleToggle(sub)}
                  title={sub.enabled ? 'Pause' : 'Resume'}
                  type="button"
                >
                  {sub.enabled ? <Pause size={13} /> : <Play size={13} />}
                </button>
                <button
                  className="ytdlp-btn hover-fx ytdlp-btn--xs ytdlp-btn--danger"
                  disabled={busy[sub.id]}
                  onClick={() => handleRemove(sub)}
                  title="Unsubscribe"
                  type="button"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SubscriptionsPane;
