import { getTransferErrorNotifications } from '../../../lib/server';
import { parseUtcDate } from '../../../lib/util';
import React, { useCallback, useEffect, useState } from 'react';

const TYPE_LABELS = {
  UploadError: 'Upload Error',
  UploadRejected: 'Upload Rejected',
  DownloadError: 'Download Error',
};

const TYPE_CLASS = {
  UploadError: 'ten-type-badge--upload-error',
  UploadRejected: 'ten-type-badge--upload-rejected',
  DownloadError: 'ten-type-badge--download-error',
};

const formatTime = (iso) => {
  if (!iso) return '';
  const d = parseUtcDate(iso);
  const today = new Date();
  const isToday =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  return isToday
    ? d.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : d.toLocaleString();
};

const basename = (path) => {
  if (!path) return path;
  return path.split(/[/\\]/).pop() || path;
};

const TransferErrorNotificationSection = () => {
  const [notifications, setNotifications] = useState([]);
  const [error, setError] = useState(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const data = await getTransferErrorNotifications();
      setNotifications(data);
      setError(null);
    } catch {
      setError('Failed to load notification history');
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    const id = setInterval(fetchNotifications, 10_000);
    return () => clearInterval(id);
  }, [fetchNotifications]);

  return (
    <div className="brl-users">
      <div className="brl-users-header">
        Recent Notifications
        <span className="brl-users-count">{notifications.length}</span>
      </div>
      {error && <div className="brl-users-error">{error}</div>}
      {notifications.length === 0 && !error && (
        <div className="brl-users-empty">No notifications sent yet</div>
      )}
      {notifications.map((n) => (
        <div
          className="brl-user-row"
          key={`${n.sentAt}-${n.username}-${n.type}`}
        >
          <div className="brl-user-info">
            <div style={{ alignItems: 'center', display: 'flex', gap: 6 }}>
              <span className="brl-user-name">{n.username}</span>
              <span className={`ten-type-badge ${TYPE_CLASS[n.type] ?? ''}`}>
                {TYPE_LABELS[n.type] ?? n.type}
              </span>
            </div>
            <span className="brl-user-meta">{basename(n.filename)}</span>
            <span className="ten-message">{n.message}</span>
          </div>
          <span
            className="brl-user-meta"
            style={{ flexShrink: 0 }}
          >
            {formatTime(n.sentAt)}
          </span>
        </div>
      ))}
    </div>
  );
};

export default TransferErrorNotificationSection;
