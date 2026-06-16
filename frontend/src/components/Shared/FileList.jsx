import { usePlayer } from '../../context/PlayerContext';
import {
  formatAttributes,
  formatBytes,
  formatSeconds,
  getFileName,
} from '../../lib/util';
import UsernameLink from './UsernameLink';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronRight, Folder, Lock, Play, X } from 'lucide-react';
import React, { useRef, useState } from 'react';
import { Checkbox } from 'semantic-ui-react';

const AUDIO_EXTENSIONS = new Set([
  'aac',
  'aif',
  'aiff',
  'alac',
  'ape',
  'flac',
  'm4a',
  'mp3',
  'ogg',
  'opus',
  'wav',
  'wma',
]);

const isAudio = (filename) =>
  AUDIO_EXTENSIONS.has(filename.split('.').pop().toLowerCase());

const presenceColor = (presence) =>
  presence === 'Online' ? '#48bb78' : presence === 'Away' ? '#ecc94b' : null;

const FileList = ({
  directoryName,
  disabled,
  files,
  footer,
  hasFreeUploadSlot = true,
  locked,
  onClose,
  onSelectionChange,
  showUserLink,
  userPresence,
  username,
}) => {
  const [folded, setFolded] = useState(false);
  const { play } = usePlayer() || {};
  const scrollRef = useRef(null);

  const sortedFiles = files
    ? [...files].sort((a, b) => (a.filename > b.filename ? 1 : -1))
    : [];

  const colCount = username && play ? 6 : 5;

  const rowVirtualizer = useVirtualizer({
    count: sortedFiles.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 37,
    overscan: 10,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    virtualItems.length > 0
      ? totalSize - virtualItems[virtualItems.length - 1].end
      : 0;

  return (
    <div className={`filelist${locked ? ' filelist--locked' : ''}`}>
      <div className="filelist-dir-header">
        <button
          aria-label={locked ? directoryName : folded ? 'Expand' : 'Collapse'}
          className="filelist-dir-fold-btn"
          disabled={Boolean(locked)}
          onClick={() => !locked && setFolded(!folded)}
          title={locked ? 'Locked' : folded ? 'Expand' : 'Collapse'}
          type="button"
        >
          {locked ? (
            <Lock
              size={12}
              strokeWidth={2}
            />
          ) : folded ? (
            <ChevronRight
              size={13}
              strokeWidth={2}
            />
          ) : (
            <ChevronDown
              size={13}
              strokeWidth={2}
            />
          )}
          <Folder
            size={13}
            strokeWidth={1.75}
          />
          <span className="filelist-dir-name">{directoryName}</span>
        </button>

        {showUserLink && username && (
          <div className="filelist-dir-user">
            {userPresence && presenceColor(userPresence) && (
              <span
                className="filelist-dir-presence"
                style={{ background: presenceColor(userPresence) }}
                title={userPresence}
              />
            )}
            <UsernameLink username={username} />
          </div>
        )}

        {Boolean(onClose) && (
          <button
            aria-label="Close"
            className="filelist-dir-close-btn"
            onClick={() => onClose()}
            title="Close"
            type="button"
          >
            <X
              size={13}
              strokeWidth={2}
            />
          </button>
        )}
      </div>

      {!folded && sortedFiles.length > 0 && (
        <div
          className="filelist-scroll"
          ref={scrollRef}
        >
          <table className="ui table">
            <thead className="filelist-thead">
              <tr>
                <th className="filelist-selector">
                  <Checkbox
                    checked={
                      sortedFiles.filter((file) => !file.selected).length === 0
                    }
                    disabled={disabled}
                    fitted
                    onChange={(event, data) =>
                      sortedFiles.map((file) =>
                        onSelectionChange(file, data.checked),
                      )
                    }
                  />
                </th>
                {username && play && <th className="filelist-play" />}
                <th className="filelist-filename">File</th>
                <th className="filelist-size">Size</th>
                <th className="filelist-attributes">Attributes</th>
                <th className="filelist-length">Length</th>
              </tr>
            </thead>
            <tbody>
              {paddingTop > 0 && (
                <tr>
                  <td
                    colSpan={colCount}
                    style={{ height: paddingTop, padding: 0, border: 'none' }}
                  />
                </tr>
              )}
              {virtualItems.map((vRow) => {
                const file = sortedFiles[vRow.index];
                return (
                  <tr key={vRow.key}>
                    <td className="filelist-selector">
                      <Checkbox
                        checked={file.selected}
                        disabled={disabled}
                        fitted
                        onChange={(event, data) =>
                          onSelectionChange(file, data.checked)
                        }
                      />
                    </td>

                    {username && play && (
                      <td className="filelist-play">
                        {isAudio(file.filename) && !file.locked && (
                          <button
                            className={`filelist-play-btn${hasFreeUploadSlot ? '' : ' filelist-play-btn--no-slot'}`}
                            disabled={!hasFreeUploadSlot}
                            onClick={() => play({ ...file, username })}
                            title={
                              hasFreeUploadSlot
                                ? 'Preview track'
                                : 'No free upload slot'
                            }
                            type="button"
                          >
                            <Play size={13} />
                          </button>
                        )}
                      </td>
                    )}

                    <td className="filelist-filename">
                      {locked && (
                        <Lock
                          className="filelist-lock-icon"
                          size={11}
                          strokeWidth={2}
                        />
                      )}
                      {getFileName(file.filename)}
                    </td>
                    <td className="filelist-size">{formatBytes(file.size)}</td>
                    <td className="filelist-attributes">
                      {formatAttributes(file)}
                    </td>
                    <td className="filelist-length">
                      {formatSeconds(file.length)}
                    </td>
                  </tr>
                );
              })}
              {paddingBottom > 0 && (
                <tr>
                  <td
                    colSpan={colCount}
                    style={{
                      height: paddingBottom,
                      padding: 0,
                      border: 'none',
                    }}
                  />
                </tr>
              )}
            </tbody>

            {footer && (
              <tfoot>
                <tr>
                  <th colSpan={colCount}>{footer}</th>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
};

export default FileList;
