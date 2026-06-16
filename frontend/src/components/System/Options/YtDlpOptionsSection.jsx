import { parseUtcDate } from '../../../lib/util';
import * as ytdlpLibrary from '../../../lib/ytdlp';
import React, { useEffect, useRef, useState } from 'react';

const formatDate = (iso) => {
  if (!iso) return '';
  return parseUtcDate(iso).toLocaleString();
};

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

const ToolRow = ({
  checking,
  installLabel,
  installResult,
  installing,
  name,
  onCheck,
  onInstall,
  subtitle,
  updateInfo,
  updateLabel,
  version,
}) => (
  <div className="opt-field">
    <div className="opt-field-label">{name}</div>
    <div className="opt-field-right">
      <div
        className="opt-field-control"
        style={{ gap: 10 }}
      >
        <strong style={{ fontSize: 13 }}>{version || '—'}</strong>
        {subtitle && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {subtitle}
          </span>
        )}
        <button
          disabled={checking}
          onClick={onCheck}
          style={button({ padding: '3px 10px', fontSize: 12 })}
          type="button"
        >
          {checking ? 'Checking…' : 'Check'}
        </button>
        {updateInfo.updateAvailable && installLabel && (
          <button
            disabled={installing}
            onClick={onInstall}
            style={button({
              padding: '3px 10px',
              fontSize: 12,
              background: '#3182ce',
              border: '1px solid #3182ce',
              color: '#fff',
            })}
            type="button"
          >
            {installing ? 'Installing…' : installLabel}
          </button>
        )}
        {updateInfo.latest &&
          (updateInfo.updateAvailable ? (
            <span style={{ color: '#d69e2e', fontWeight: 600, fontSize: 12 }}>
              {updateLabel || `→ ${updateInfo.latest}`}
            </span>
          ) : (
            <span style={{ color: '#38a169', fontSize: 12 }}>✓ up to date</span>
          ))}
        {installResult && (
          <span style={{ color: '#38a169', fontSize: 12 }}>
            {installResult}
          </span>
        )}
      </div>
    </div>
  </div>
);

const YtDlpOptionsSection = () => {
  const [versions, setVersions] = useState({ ytDlp: null, ffmpeg: null });
  const [updateInfo, setUpdateInfo] = useState({
    current: null,
    latest: null,
    updateAvailable: false,
  });
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installResult, setInstallResult] = useState(null);
  const [cookieStatus, setCookieStatus] = useState({
    present: false,
    uploadedAt: null,
  });
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState(null);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    ytdlpLibrary
      .getVersions()
      .then((r) => setVersions(r.data))
      .catch(() => {});
    ytdlpLibrary
      .getCookieStatus()
      .then((r) => setCookieStatus(r.data))
      .catch(() => {});
  }, []);

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    setInstallResult(null);
    setError(null);
    try {
      const res = await ytdlpLibrary.checkForUpdate();
      setUpdateInfo(res.data);
    } catch (error_) {
      setError(`Update check failed: ${error_.message}`);
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleInstall = async () => {
    setInstalling(true);
    setInstallResult(null);
    setError(null);
    try {
      const res = await ytdlpLibrary.installUpdate();
      setInstallResult(`Updated to ${res.data.version}`);
      setTimeout(() => setInstallResult(null), 5_000);
      const v = await ytdlpLibrary.getVersions();
      setVersions(v.data);
      setUpdateInfo((previous) => ({
        ...previous,
        updateAvailable: false,
        current: res.data.version,
      }));
    } catch (error_) {
      setError(`Update failed: ${error_.response?.data || error_.message}`);
    } finally {
      setInstalling(false);
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const res = await ytdlpLibrary.uploadCookies(file);
      setCookieStatus(res.data);
    } catch (error_) {
      setError(`Upload failed: ${error_.message}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleBackfillDurations = async () => {
    setBackfilling(true);
    setBackfillResult(null);
    setError(null);
    try {
      const res = await ytdlpLibrary.backfillDurations();
      const { failed, skipped, updated } = res.data;
      setBackfillResult(
        `Updated ${updated} tracks${failed ? `, ${failed} failed` : ''}${skipped ? `, ${skipped} skipped` : ''}`,
      );
      setTimeout(() => setBackfillResult(null), 8_000);
    } catch (error_) {
      setError(`Backfill failed: ${error_.message}`);
    } finally {
      setBackfilling(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await ytdlpLibrary.deleteCookies();
      setCookieStatus({ present: false, uploadedAt: null });
    } catch (error_) {
      setError(`Delete failed: ${error_.message}`);
    } finally {
      setDeleting(false);
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
      {/* Tool Versions */}
      <div
        style={{
          fontWeight: 600,
          fontSize: 14,
          marginBottom: 8,
          padding: '0 14px',
        }}
      >
        Tool Versions
      </div>
      <ToolRow
        checking={checkingUpdate}
        installLabel={
          updateInfo.updateAvailable ? `Install ${updateInfo.latest}` : null
        }
        installResult={installResult}
        installing={installing}
        name="yt-dlp"
        onCheck={handleCheckUpdate}
        onInstall={handleInstall}
        updateInfo={updateInfo}
        version={versions.ytDlp}
      />

      {/* Cookie file */}
      <div
        style={{
          fontWeight: 600,
          fontSize: 14,
          marginBottom: 8,
          padding: '0 14px',
        }}
      >
        YouTube Cookie File
      </div>
      <div className="opt-field">
        <div className="opt-field-label">Cookie file</div>
        <div className="opt-field-right">
          <div
            className="opt-field-control"
            style={{ gap: 8 }}
          >
            <button
              disabled={uploading}
              onClick={() =>
                fileInputRef.current && fileInputRef.current.click()
              }
              style={button({ padding: '3px 10px', fontSize: 12 })}
              type="button"
            >
              {uploading
                ? 'Uploading…'
                : cookieStatus.present
                  ? 'Replace'
                  : 'Upload'}
            </button>
            {cookieStatus.present && (
              <button
                disabled={deleting}
                onClick={handleDelete}
                style={button({
                  padding: '3px 10px',
                  fontSize: 12,
                  border: '1px solid var(--red, #e53e3e)',
                  background: 'transparent',
                  color: 'var(--red, #e53e3e)',
                })}
                type="button"
              >
                {deleting ? 'Removing…' : 'Remove'}
              </button>
            )}
            {cookieStatus.present ? (
              <span style={{ fontSize: 12, color: '#38a169' }}>
                Active — uploaded {formatDate(cookieStatus.uploadedAt)}
              </span>
            ) : (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Not set — age-restricted content will not be accessible
              </span>
            )}
            {error && (
              <span style={{ fontSize: 12, color: 'var(--red, #e53e3e)' }}>
                {error}
              </span>
            )}
          </div>
          <div className="opt-field-desc">
            Export from Brave using the <em>Get cookies.txt LOCALLY</em>{' '}
            extension while logged in to YouTube, then upload here. Or install
            the Resonance Cookie Sync browser extension for automatic sync.
          </div>
        </div>
        <input
          accept=".txt"
          onChange={handleFileChange}
          ref={fileInputRef}
          style={{ display: 'none' }}
          type="file"
        />
      </div>
      {/* Database */}
      <div
        style={{
          fontWeight: 600,
          fontSize: 14,
          marginBottom: 8,
          padding: '0 14px',
          marginTop: 20,
        }}
      >
        Database
      </div>
      <div className="opt-field">
        <div className="opt-field-label">Track durations</div>
        <div className="opt-field-right">
          <div
            className="opt-field-control"
            style={{ gap: 8 }}
          >
            <button
              disabled={backfilling}
              onClick={handleBackfillDurations}
              style={button({ padding: '3px 10px', fontSize: 12 })}
              type="button"
            >
              {backfilling ? 'Scanning…' : 'Backfill from files'}
            </button>
            {backfillResult && (
              <span style={{ fontSize: 12, color: '#38a169' }}>
                {backfillResult}
              </span>
            )}
          </div>
          <div className="opt-field-desc">
            Reads duration from existing downloaded files and fills in any
            missing values in the database.
          </div>
        </div>
      </div>
    </div>
  );
};

export default YtDlpOptionsSection;
