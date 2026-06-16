import { formatBytes, getFileName } from '../../lib/util';
import { UsernameLink } from '../Shared';
import { ArrowDown, ArrowUp } from 'lucide-react';
import React, { useMemo } from 'react';

const ActivityLog = ({ direction, transfers }) => {
  const activeFiles = useMemo(() => {
    return (transfers ?? [])
      .flatMap((user) =>
        (user.directories ?? []).flatMap((directory) =>
          (directory.files ?? [])
            .filter(
              (file) =>
                file.direction?.toLowerCase() === direction &&
                file.state === 'InProgress',
            )
            .map((file) => ({ ...file, username: user.username })),
        ),
      )
      .sort((a, b) => (b.averageSpeed ?? 0) - (a.averageSpeed ?? 0));
  }, [direction, transfers]);

  if (activeFiles.length === 0) return null;

  const Icon = direction === 'upload' ? ArrowUp : ArrowDown;

  return (
    <div className="activity-log">
      <div className="activity-log-header">
        <span className="activity-log-pulse" />
        {activeFiles.length} active {direction}
        {activeFiles.length === 1 ? '' : 's'}
      </div>
      <div className="activity-log-rows">
        {activeFiles.slice(0, 10).map((file) => (
          <div
            className="activity-log-row"
            key={file.id}
          >
            <Icon
              className="activity-log-icon"
              size={11}
              strokeWidth={2.5}
            />
            <UsernameLink
              className="activity-log-user"
              username={file.username}
            />
            <span
              className="activity-log-filename"
              title={getFileName(file.filename)}
            >
              {getFileName(file.filename)}
            </span>
            <div className="activity-log-bar">
              <div
                className="activity-log-bar-fill"
                style={{ width: `${Math.round(file.percentComplete ?? 0)}%` }}
              />
            </div>
            <span className="activity-log-pct">
              {Math.round(file.percentComplete ?? 0)}%
            </span>
            <span className="activity-log-size">
              {formatBytes(file.bytesTransferred ?? 0)} /{' '}
              {formatBytes(file.size ?? 0)}
            </span>
            <span className="activity-log-speed">
              {file.averageSpeed > 0
                ? `${formatBytes(file.averageSpeed)}/s`
                : '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ActivityLog;
