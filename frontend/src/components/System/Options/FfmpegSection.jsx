import * as ffmpegLibrary from '../../../lib/ffmpeg';
import { parseUtcDate } from '../../../lib/util';
import React, { useEffect, useState } from 'react';

const button = (extra = {}) => ({
  padding: '6px 14px',
  borderRadius: 5,
  border: '1px solid var(--border)',
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary)',
  cursor: 'pointer',
  fontSize: 13,
  ...extra,
});

const formatDate = (iso) => (iso ? parseUtcDate(iso).toLocaleString() : '');

// The yt-dlp/FFmpeg-Builds release identifier is an ISO date; show it as a date.
const displayVersion = (raw) => {
  if (!raw) return null;
  const full = raw.match(/version\s+(\S+)/)?.[1] ?? raw.split('\n')[0];
  const dateMatch = full.match(/(\d{4})(\d{2})(\d{2})$/);
  if (dateMatch) return `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
  return full.length > 24 ? full.slice(0, 24) + '…' : full;
};

const FfmpegSection = () => {
  const [version, setVersion] = useState(null);
  const [updateInfo, setUpdateInfo] = useState({
    current: null,
    latest: null,
    updateAvailable: false,
  });
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installResult, setInstallResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    ffmpegLibrary
      .getVersion()
      .then((r) => setVersion(r.data.version))
      .catch(() => {});
  }, []);

  const handleCheck = async () => {
    setChecking(true);
    setInstallResult(null);
    setError(null);
    try {
      const res = await ffmpegLibrary.checkForUpdate();
      setUpdateInfo(res.data);
    } catch (error_) {
      setError(`Update check failed: ${error_.message}`);
    } finally {
      setChecking(false);
    }
  };

  const handleInstall = async () => {
    setInstalling(true);
    setInstallResult(null);
    setError(null);
    try {
      const res = await ffmpegLibrary.installUpdate();
      setInstallResult(`Updated to ${formatDate(res.data.version)}`);
      setTimeout(() => setInstallResult(null), 5_000);
      const v = await ffmpegLibrary.getVersion();
      setVersion(v.data.version);
      setUpdateInfo((previous) => ({ ...previous, updateAvailable: false }));
    } catch (error_) {
      setError(`Update failed: ${error_.response?.data || error_.message}`);
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div
      style={{
        marginTop: 24,
        borderTop: '1px solid var(--border)',
        paddingTop: 20,
      }}
    >
      <div
        style={{
          fontWeight: 600,
          fontSize: 14,
          marginBottom: 8,
          padding: '0 14px',
        }}
      >
        ffmpeg (shared by yt-dlp, conversion, analysis &amp; streaming)
      </div>
      <div className="opt-field">
        <div className="opt-field-label">ffmpeg</div>
        <div className="opt-field-right">
          <div
            className="opt-field-control"
            style={{ gap: 10 }}
          >
            <strong style={{ fontSize: 13 }}>
              {displayVersion(version) || '—'}
            </strong>
            <button
              disabled={checking}
              onClick={handleCheck}
              style={button({ padding: '3px 10px', fontSize: 12 })}
              type="button"
            >
              {checking ? 'Checking…' : 'Check'}
            </button>
            {updateInfo.updateAvailable && (
              <button
                disabled={installing}
                onClick={handleInstall}
                style={button({
                  padding: '3px 10px',
                  fontSize: 12,
                  background: '#3182ce',
                  border: '1px solid #3182ce',
                  color: '#fff',
                })}
                type="button"
              >
                {installing ? 'Installing…' : 'Install Update'}
              </button>
            )}
            {updateInfo.latest &&
              (updateInfo.updateAvailable ? (
                <span
                  style={{ color: '#d69e2e', fontWeight: 600, fontSize: 12 }}
                >
                  → {formatDate(updateInfo.latest)}
                </span>
              ) : (
                <span style={{ color: '#38a169', fontSize: 12 }}>
                  ✓ up to date
                </span>
              ))}
            {installResult && (
              <span style={{ color: '#38a169', fontSize: 12 }}>
                {installResult}
              </span>
            )}
            {error && (
              <span style={{ fontSize: 12, color: 'var(--red, #e53e3e)' }}>
                {error}
              </span>
            )}
          </div>
          <div className="opt-field-desc">
            The app self-manages a single ffmpeg/ffprobe build (auto-downloaded
            and updated weekly in the background). Use Check/Install to update
            on demand.
          </div>
        </div>
      </div>
    </div>
  );
};

export default FfmpegSection;
