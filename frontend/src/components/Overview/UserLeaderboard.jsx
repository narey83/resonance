import { formatBytes } from '../../lib/util';
import UsernameLink from '../Shared/UsernameLink';
import UserReportModal from './UserReportModal';
import React, { useState } from 'react';

const formatSpeed = (speed) => (speed > 0 ? `${formatBytes(speed)}/s` : '—');

const LeaderboardTable = ({ entries, onUserClick }) => {
  if (!entries || entries.length === 0) {
    return <div className="leaderboard-empty">No data for this period</div>;
  }

  return (
    <table className="leaderboard-table">
      <thead>
        <tr>
          <th className="leaderboard-rank">#</th>
          <th>User</th>
          <th className="leaderboard-num">Data</th>
          <th className="leaderboard-num">Files</th>
          <th className="leaderboard-num">Avg Speed</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry, index) => (
          <tr
            key={entry.username ?? index}
            onClick={() => onUserClick(entry.username)}
          >
            <td className="leaderboard-rank">{index + 1}</td>
            <td className="leaderboard-username">
              {entry.username ? (
                <UsernameLink username={entry.username} />
              ) : (
                '—'
              )}
            </td>
            <td className="leaderboard-num">
              {formatBytes(entry.totalBytes ?? 0)}
            </td>
            <td className="leaderboard-num">
              {(entry.count ?? 0).toLocaleString()}
            </td>
            <td className="leaderboard-num">
              {formatSpeed(entry.averageSpeed ?? 0)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

const UserLeaderboard = ({ leaderboard }) => {
  const [tab, setTab] = useState('upload');
  const [selectedUser, setSelectedUser] = useState(null);

  const entries =
    tab === 'download'
      ? leaderboard?.download ?? []
      : leaderboard?.upload ?? [];

  return (
    <>
      <div className="section-card">
        <div className="section-card-header">
          <span className="section-card-title">Top Users</span>
          <div className="section-card-tabs">
            <button
              className={`section-tab${tab === 'download' ? ' active' : ''}`}
              onClick={() => setTab('download')}
              type="button"
            >
              Downloads
            </button>
            <button
              className={`section-tab${tab === 'upload' ? ' active' : ''}`}
              onClick={() => setTab('upload')}
              type="button"
            >
              Uploads
            </button>
          </div>
        </div>
        <LeaderboardTable
          entries={entries}
          onUserClick={setSelectedUser}
        />
      </div>

      {selectedUser && (
        <UserReportModal
          onClose={() => setSelectedUser(null)}
          username={selectedUser}
        />
      )}
    </>
  );
};

export default UserLeaderboard;
