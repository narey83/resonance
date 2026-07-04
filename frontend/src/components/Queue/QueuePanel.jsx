import './QueuePanel.css';
import { usePlayer } from '../../context/PlayerContext';
import AlbumArt from '../Library/components/AlbumArt';
import { useVirtualizer } from '@tanstack/react-virtual';
import { GripVertical, ListMusic, Plus, Trash2, X } from 'lucide-react';
import React, { useRef, useState } from 'react';

const getTrackTitle = (track) =>
  track.title ||
  track.filename
    ?.split(/[/\\]/u)
    .pop()
    ?.replace(/\.[^.]+$/u, '') ||
  '(Unknown)';

const QueuePanel = ({ onClose }) => {
  const {
    clearQueue,
    enqueueTrack,
    insertIntoQueue,
    jumpTo,
    queue,
    queueIndex,
    removeFromQueue,
    reorderQueue,
    track: currentTrack,
  } = usePlayer();

  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [externalDragOver, setExternalDragOver] = useState(false);
  const dragIndexRef = useRef(null);
  const bodyRef = useRef(null);

  const upNext = queue.slice(queueIndex + 1);

  const virtualizer = useVirtualizer({
    count: upNext.length,
    getScrollElement: () => bodyRef.current,
    estimateSize: (index) => (upNext[index]?.artist ? 44 : 28),
    overscan: 5,
  });

  return (
    <div
      className={`queue-panel${externalDragOver ? ' queue-panel--drop' : ''}`}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget))
          setExternalDragOver(false);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/resonance-track')) {
          e.preventDefault();
          setExternalDragOver(true);
        }
      }}
      onDrop={(e) => {
        const trackData = e.dataTransfer.getData('application/resonance-track');
        if (trackData) {
          e.preventDefault();
          enqueueTrack(JSON.parse(trackData));
        }

        setExternalDragOver(false);
      }}
    >
      <div className="queue-panel-header">
        <ListMusic
          size={13}
          strokeWidth={1.75}
        />
        <span className="queue-panel-title">Queue</span>
        <span className="queue-panel-count">{queue.length}</span>
        {upNext.length > 0 && (
          <button
            className="queue-panel-close hover-fx"
            onClick={clearQueue}
            title="Clear queue"
            type="button"
          >
            <Trash2 size={14} />
          </button>
        )}
        <button
          className="queue-panel-close hover-fx"
          onClick={onClose}
          title="Close queue"
          type="button"
        >
          <X size={14} />
        </button>
      </div>

      <div
        className="queue-panel-body"
        ref={bodyRef}
      >
        {currentTrack && (
          <div className="queue-now">
            <div className="queue-now-label">Now Playing</div>
            <div className="queue-now-track">
              <AlbumArt
                hasArtwork={currentTrack.hasArtwork}
                name={
                  currentTrack.album ||
                  currentTrack.artist ||
                  getTrackTitle(currentTrack)
                }
                path={currentTrack.path}
                radius={3}
                size={32}
              />
              <div className="queue-track-info">
                <div className="queue-track-title">
                  {getTrackTitle(currentTrack)}
                </div>
                {currentTrack.artist && (
                  <div className="queue-track-meta">{currentTrack.artist}</div>
                )}
              </div>
            </div>
          </div>
        )}

        {upNext.length > 0 && (
          <>
            <div className="queue-up-label">Up Next · {upNext.length}</div>
            <div
              style={{
                height: virtualizer.getTotalSize(),
                position: 'relative',
              }}
            >
              {virtualizer.getVirtualItems().map((virtualItem) => {
                const actualIndex = queueIndex + 1 + virtualItem.index;
                const qTrack = upNext[virtualItem.index];
                const isDragTarget = dragOverIndex === actualIndex;
                return (
                  <div
                    key={virtualItem.key}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualItem.start}px)`,
                    }}
                  >
                    <div
                      className={`queue-track${isDragTarget ? ' queue-track--drag-over' : ''}`}
                      draggable
                      onClick={() => jumpTo(actualIndex)}
                      onDragEnd={() => {
                        setDragOverIndex(null);
                        dragIndexRef.current = null;
                      }}
                      onDragLeave={() => {
                        if (dragOverIndex === actualIndex)
                          setDragOverIndex(null);
                      }}
                      onDragOver={(e) => {
                        const isInternal = e.dataTransfer.types.includes(
                          'application/resonance-queue-index',
                        );
                        const isExternal = e.dataTransfer.types.includes(
                          'application/resonance-track',
                        );
                        if (isInternal || isExternal) {
                          e.preventDefault();
                          e.stopPropagation();
                          setDragOverIndex(actualIndex);
                          setExternalDragOver(false);
                        }
                      }}
                      onDragStart={(e) => {
                        dragIndexRef.current = actualIndex;
                        e.dataTransfer.setData(
                          'application/resonance-queue-index',
                          String(actualIndex),
                        );
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDrop={(e) => {
                        const fromIndexString = e.dataTransfer.getData(
                          'application/resonance-queue-index',
                        );
                        const trackData = e.dataTransfer.getData(
                          'application/resonance-track',
                        );
                        if (fromIndexString !== '') {
                          e.preventDefault();
                          e.stopPropagation();
                          const fromIndex = Number(fromIndexString);
                          if (
                            !Number.isNaN(fromIndex) &&
                            fromIndex !== actualIndex
                          )
                            reorderQueue(fromIndex, actualIndex);
                        } else if (trackData) {
                          e.preventDefault();
                          e.stopPropagation();
                          insertIntoQueue(JSON.parse(trackData), actualIndex);
                        }

                        setDragOverIndex(null);
                        dragIndexRef.current = null;
                      }}
                      onKeyDown={(e) =>
                        e.key === 'Enter' && jumpTo(actualIndex)
                      }
                      role="button"
                      tabIndex={0}
                    >
                      <div className="queue-drag-handle">
                        <GripVertical size={12} />
                      </div>
                      <div className="queue-track-info">
                        <div className="queue-track-title">
                          {getTrackTitle(qTrack)}
                        </div>
                        {qTrack.artist && (
                          <div className="queue-track-meta">
                            {qTrack.artist}
                          </div>
                        )}
                      </div>
                      <button
                        className="queue-remove-btn"
                        onClick={(event) => {
                          event.stopPropagation();
                          removeFromQueue(actualIndex);
                        }}
                        title="Remove from queue"
                        type="button"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {!currentTrack && upNext.length === 0 && (
          <div className="queue-empty">No tracks in queue</div>
        )}
        {externalDragOver && (
          <div className="queue-drop-hint">
            <Plus size={13} />
            Drop to add to queue
          </div>
        )}
      </div>
    </div>
  );
};

export default QueuePanel;
