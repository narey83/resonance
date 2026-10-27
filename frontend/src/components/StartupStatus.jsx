// <copyright file="StartupStatus.jsx" company="John Narey">
// Copyright (c) 2026 John Narey. SPDX-License-Identifier: AGPL-3.0-only
// </copyright>

import React, { useEffect, useRef, useState } from 'react';

const StartupStatus = ({ status }) => {
  const [dismissed, setDismissed] = useState(false);
  const [position, setPosition] = useState(null);
  const panelRef = useRef(null);
  const dragRef = useRef(null);
  const services = status?.services ?? [];
  const failed = services.filter((service) => service.state === 'failed');
  const pending = services.filter((service) => service.state !== 'ready');
  const completed = services.length - pending.length;

  const visible =
    services.length > 0 && !dismissed && (!status?.ready || failed.length > 0);

  const movePanel = (x, y) => {
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    // Rects/pointer coordinates include the interface zoom; inline CSS positions do not.
    const scale = panel.offsetWidth > 0 ? rect.width / panel.offsetWidth : 1;
    const safeScale = scale > 0 ? scale : 1;
    setPosition({
      x:
        Math.min(
          Math.max(8, x),
          Math.max(8, window.innerWidth - rect.width - 8),
        ) / safeScale,
      y:
        Math.min(
          Math.max(8, y),
          Math.max(8, window.innerHeight - rect.height - 8),
        ) / safeScale,
    });
  };

  useEffect(() => {
    if (!visible) return undefined;
    const keepOnScreen = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      // Preserve the centred default until the user moves the panel.
      setPosition((current) => {
        if (!current) return current;
        const scale =
          panel.offsetWidth > 0 ? rect.width / panel.offsetWidth : 1;
        const safeScale = scale > 0 ? scale : 1;
        const x =
          Math.min(
            Math.max(8, rect.left),
            Math.max(8, window.innerWidth - rect.width - 8),
          ) / safeScale;
        const y =
          Math.min(
            Math.max(8, rect.top),
            Math.max(8, window.innerHeight - rect.height - 8),
          ) / safeScale;
        return current.x === x && current.y === y ? current : { x, y };
      });
    };

    window.addEventListener('resize', keepOnScreen);
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(keepOnScreen);
    if (panelRef.current) observer?.observe(panelRef.current);
    const zoomObserver =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver(keepOnScreen);
    zoomObserver?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'class'],
    });
    return () => {
      window.removeEventListener('resize', keepOnScreen);
      observer?.disconnect();
      zoomObserver?.disconnect();
      dragRef.current = null;
    };
  }, [visible]);

  const startDrag = (event) => {
    if (event.button !== 0) return;
    const rect = panelRef.current.getBoundingClientRect();
    dragRef.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: rect.left,
      top: rect.top,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const drag = (event) => {
    const origin = dragRef.current;
    if (!origin || origin.id !== event.pointerId) return;
    movePanel(
      origin.left + event.clientX - origin.x,
      origin.top + event.clientY - origin.y,
    );
  };

  const stopDrag = () => {
    dragRef.current = null;
  };

  const moveWithKeyboard = (event) => {
    if (event.key === 'Home') {
      event.preventDefault();
      setPosition(null);
      return;
    }

    const offsets = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const offset = offsets[event.key];
    if (!offset) return;
    event.preventDefault();
    const rect = panelRef.current.getBoundingClientRect();
    const step = event.shiftKey ? 40 : 10;
    movePanel(rect.left + offset[0] * step, rect.top + offset[1] * step);
  };

  // Once everything has finished the banner only stays up to report failures, which would
  // otherwise leave a service silently dead until someone went looking in the logs.
  if (services.length === 0 || dismissed) return null;
  if (status?.ready && failed.length === 0) return null;

  return (
    <div
      className={`startup-status${failed.length ? ' startup-status--failed' : ''}`}
      ref={panelRef}
      role="status"
      style={
        position
          ? { left: position.x, top: position.y, transform: 'none' }
          : undefined
      }
    >
      <div className="startup-status-title">
        <button
          aria-label="Move startup panel"
          className="startup-status-move"
          onDoubleClick={() => setPosition(null)}
          onKeyDown={moveWithKeyboard}
          onPointerCancel={stopDrag}
          onPointerDown={startDrag}
          onPointerMove={drag}
          onPointerUp={stopDrag}
          title="Drag to move. Arrow keys move; Home or double-click resets position."
          type="button"
        >
          <span
            aria-hidden="true"
            className="startup-status-grip"
          >
            ⠿
          </span>
          <span>
            {status?.ready
              ? `${failed.length} service${failed.length === 1 ? '' : 's'} failed to start`
              : 'Starting background services'}
          </span>
        </button>
        {status?.ready && (
          <button
            aria-label="Dismiss"
            className="startup-status-dismiss"
            onClick={() => setDismissed(true)}
            type="button"
          >
            ×
          </button>
        )}
      </div>
      {!status?.ready && (
        <div className="startup-status-progress">
          {completed} of {services.length} services ready
        </div>
      )}
      <div className="startup-status-services">
        {(status?.ready ? failed : pending).map((service) => (
          <span
            className={`startup-status-service startup-status-service--${service.state}`}
            key={service.id}
            title={service.message}
          >
            <span className="startup-status-dot" />
            {service.name}:{' '}
            {service.state === 'failed' ? service.message : service.state}
          </span>
        ))}
      </div>
    </div>
  );
};

export default StartupStatus;
