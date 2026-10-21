// <copyright file="ZoomControl.jsx" company="John Narey">
//    ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮
//   ─╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰  resonance
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) 2026 John Narey.
//   │ Part of Resonance, a Soulseek client based on slskd.
//   │
//   │ This program is free software: you can redistribute it and/or modify
//   │ it under the terms of the GNU Affero General Public License as published
//   │ by the Free Software Foundation, version 3.
//   │
//   │ This program is distributed in the hope that it will be useful,
//   │ but WITHOUT ANY WARRANTY; without even the implied warranty of
//   │ MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
//   │ GNU Affero General Public License for more details.
//   │
//   │ You should have received a copy of the GNU Affero General Public License
//   │ along with this program.  If not, see https://www.gnu.org/licenses/.
//   │
//   │ This program is distributed with Additional Terms pursuant to Section 7
//   │ of the AGPLv3.  See the LICENSE file in the root directory of this
//   │ project for the complete terms and conditions.
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: John Narey
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

import React, { useEffect, useState } from 'react';

const STORAGE_KEY = 'resonance-ui-zoom';
const MODE_KEY = 'resonance-ui-zoom-mode';
const LEVELS = [50, 67, 75, 80, 90, 100];
// One desktop canvas across routes prevents the navigation/status strip from
// jumping in size as pages change. Longer tables retain their scroll areas.
export const fitWorkspaceZoom = (width, height) => {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    return 100;
  return Math.max(
    67,
    Math.min(100, Math.floor(Math.min(width / 1_440, height / 1_000) * 100)),
  );
};

const normalize = (value) =>
  Number.isInteger(Number(value)) && Number(value) >= 50 && Number(value) <= 100
    ? Number(value)
    : 100;

const readZoom = () => {
  try {
    return normalize(localStorage.getItem(STORAGE_KEY));
  } catch {
    return 100;
  }
};

const readMode = () => {
  try {
    return localStorage.getItem(MODE_KEY) !== 'manual';
  } catch {
    return true;
  }
};

const ZoomControl = () => {
  const [manualZoom, setManualZoom] = useState(readZoom);
  const [fit, setFit] = useState(readMode);
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const zoom = fit
    ? fitWorkspaceZoom(viewport.width, viewport.height)
    : manualZoom;

  useEffect(() => {
    const resize = () =>
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const previousZoom = root.style.zoom;
    const previousHeight = root.style.getPropertyValue('--app-viewport-height');
    const resize = () => {
      root.style.zoom = String(zoom / 100);
      root.style.setProperty(
        '--app-viewport-height',
        `${window.innerHeight / (zoom / 100)}px`,
      );
    };

    resize();
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      root.style.zoom = previousZoom;
      if (previousHeight) {
        root.style.setProperty('--app-viewport-height', previousHeight);
      } else {
        root.style.removeProperty('--app-viewport-height');
      }
    };
  }, [zoom]);

  useEffect(() => {
    const sync = (event) => {
      if (event.key === STORAGE_KEY || event.key === null) {
        setManualZoom(readZoom());
        setFit(readMode());
      }

      if (event.key === MODE_KEY) setFit(readMode());
    };

    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  const changeZoom = (value) => {
    setFit(false);
    setManualZoom(value);
    try {
      localStorage.setItem(STORAGE_KEY, String(value));
      localStorage.setItem(MODE_KEY, 'manual');
    } catch {
      // Zoom remains usable when browser storage is unavailable.
    }
  };

  const lower = [...LEVELS].reverse().find((value) => value < zoom);
  const higher = LEVELS.find((value) => value > zoom);

  return (
    <div
      aria-label="Interface scale"
      className="app-zoom-controls"
      role="group"
    >
      <button
        aria-label="Auto size"
        aria-pressed={fit}
        onClick={() => {
          const next = !fit;
          setFit(next);
          if (!next) setManualZoom(zoom);
          try {
            localStorage.setItem(MODE_KEY, next ? 'fit' : 'manual');
            if (!next) localStorage.setItem(STORAGE_KEY, String(zoom));
          } catch {
            /* The in-memory mode still works without storage. */
          }
        }}
        title="Automatically choose an interface scale for this window, up to 100%"
        type="button"
      >
        Auto size
      </button>
      <button
        aria-label="Reduce interface scale"
        disabled={!lower}
        onClick={() => changeZoom(lower)}
        title="Smaller interface"
        type="button"
      >
        −
      </button>
      <button
        aria-label={`Interface scale ${zoom}%. Use normal size (100%)`}
        aria-live="polite"
        className="app-zoom-reset"
        onClick={() => changeZoom(100)}
        title={
          zoom === 100 ? 'Normal size (100%)' : 'Return to normal size (100%)'
        }
        type="button"
      >
        {zoom}%
      </button>
      <button
        aria-label="Increase interface scale"
        disabled={!higher}
        onClick={() => changeZoom(higher)}
        title="Increase interface scale up to 100%"
        type="button"
      >
        +
      </button>
    </div>
  );
};

export default ZoomControl;
