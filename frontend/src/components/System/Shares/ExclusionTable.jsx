import React from 'react';
import { Icon } from 'semantic-ui-react';

const ExclusionTable = ({ exclusions = [] } = {}) => {
  if (exclusions.length === 0) return null;

  return (
    <div className="info-section">
      <div className="info-section-title">Exclusions</div>
      <div className="info-section-body">
        {exclusions.map((share) => (
          <div
            className="shares-row"
            key={share.localPath}
          >
            <div
              className="shares-row-path shares-row-path--excluded"
              title={
                share.isManaged
                  ? 'System-managed exclusion — cannot be removed'
                  : undefined
              }
            >
              {share.isManaged ? (
                <Icon
                  color="grey"
                  name="lock"
                />
              ) : (
                <Icon
                  color="red"
                  name="x"
                />
              )}
              {share.localPath}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ExclusionTable;
