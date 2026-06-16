import React from 'react';
import { Icon } from 'semantic-ui-react';

const ShareTable = ({ onClick, shares }) => (
  <div className="info-section">
    <div className="info-section-title">Shared Directories</div>
    <div className="info-section-body">
      {shares.length === 0 ? (
        <div className="shares-empty">No shares configured</div>
      ) : (
        shares.map((share) => {
          const isManaged = share.isManaged;
          return (
            <div
              className={`shares-row${isManaged ? ' shares-row--managed' : ' shares-row--clickable'}`}
              key={`${share.host}+${share.localPath}`}
              onClick={isManaged ? undefined : () => onClick(share)}
              onKeyDown={
                isManaged
                  ? undefined
                  : ({ key }) => key === 'Enter' && onClick(share)
              }
              role={isManaged ? undefined : 'button'}
              tabIndex={isManaged ? undefined : 0}
            >
              <div className="shares-row-path">
                <Icon
                  name={isManaged ? 'lock' : share.isLocked ? 'lock' : 'folder'}
                />
                {share.localPath}
              </div>
              <div className="shares-row-meta">
                {share.host && <span>{share.host}</span>}
                {isManaged && <span>managed (mixtapes)</span>}
                {!isManaged && share.isLocked && (
                  <span>locked (privileged only)</span>
                )}
                {share.directories != null && (
                  <span>{share.directories} dirs</span>
                )}
                {share.files != null && <span>{share.files} files</span>}
                {share.alias && <span>alias: {share.alias}</span>}
                {share.remotePath && <span>remote: {share.remotePath}</span>}
              </div>
            </div>
          );
        })
      )}
    </div>
  </div>
);

export default ShareTable;
