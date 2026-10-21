import React, { useRef } from 'react';

const clamp = (value) => Math.max(40, Math.min(240, value));
const WaveformResizeHandle = ({ height, onHeight }) => {
  const start = useRef(null);
  return (
    <div
      aria-label="Resize waveform height"
      aria-orientation="horizontal"
      aria-valuemax={240}
      aria-valuemin={40}
      aria-valuenow={height}
      className="mp-waveform-resize"
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          onHeight(clamp(height + (e.key === 'ArrowUp' ? 10 : -10)));
        }
      }}
      onPointerCancel={() => {
        start.current = null;
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        start.current = {
          y: e.clientY,
          height,
          scale:
            e.currentTarget.getBoundingClientRect().height /
              e.currentTarget.offsetHeight || 1,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (start.current)
          onHeight(
            clamp(
              Math.round(
                start.current.height +
                  (start.current.y - e.clientY) / start.current.scale,
              ),
            ),
          );
      }}
      onPointerUp={(e) => {
        start.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      role="separator"
      // Focusable separators support keyboard resizing under the ARIA separator pattern.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      title="Drag up or down to resize waveform · arrow keys also work"
    >
      <span />
    </div>
  );
};

export default WaveformResizeHandle;
