// <copyright file="Searches.jsx" company="JP Dillingham">
//           ▄▄▄▄     ▄▄▄▄     ▄▄▄▄
//     ▄▄▄▄▄▄█  █▄▄▄▄▄█  █▄▄▄▄▄█  █
//     █__ --█  █__ --█    ◄█  -  █
//     █▄▄▄▄▄█▄▄█▄▄▄▄▄█▄▄█▄▄█▄▄▄▄▄█
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) JP Dillingham.
//   │ Copyright (c) 2026 John Narey.
//   │ Modified as part of Resonance, a modified version of slskd;
//   │ see the project repository for the nature of the changes.
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
//   │ https://slskd.org
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: JP Dillingham
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

import './Search.css';
import { createSearchHubConnection } from '../../lib/hubFactory';
import * as prefs from '../../lib/prefs';
import * as library from '../../lib/searches';
import SearchDetail from './Detail/SearchDetail';
import SearchList from './List/SearchList';
import { Search } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { v4 as uuidv4 } from 'uuid';

const SIDEBAR_WIDTH_KEY = 'resonance-search-sidebar-width';
const SIDEBAR_MIN = 150;
const SIDEBAR_MAX = 500;

const Searches = ({ server } = {}) => {
  const [connecting, setConnecting] = useState(true);
  const [error, setError] = useState(undefined);
  const [searches, setSearches] = useState({});
  const [selectedId, setSelectedId] = useState(null);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(prefs.get(SIDEBAR_WIDTH_KEY, 220));
    return Number.isFinite(saved) ? saved : 220;
  });

  const [removing, setRemoving] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [creating, setCreating] = useState(false);
  const [restarting, setRestarting] = useState(false);

  const inputRef = useRef();
  const rootRef = useRef(null);
  const dividerMoveRef = useRef(null);
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const onDividerMouseDown = (mouseDownEvent) => {
    mouseDownEvent.preventDefault();
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    dividerMoveRef.current = (moveEvent) => {
      const rootRect = rootRef.current?.getBoundingClientRect();
      if (!rootRect) return;
      setSidebarWidth(
        Math.min(
          SIDEBAR_MAX,
          Math.max(SIDEBAR_MIN, moveEvent.clientX - rootRect.left),
        ),
      );
    };

    const onMouseUp = () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      setSidebarWidth((width) => {
        prefs.set(SIDEBAR_WIDTH_KEY, width);
        return width;
      });
      document.removeEventListener('mousemove', dividerMoveRef.current);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', dividerMoveRef.current);
    document.addEventListener('mouseup', onMouseUp);
  };

  useEffect(() => {
    let mounted = true;
    setConnecting(true);

    const searchHub = createSearchHubConnection();

    searchHub.on('list', (searchesEvent) => {
      if (!mounted) return;
      setSearches(
        searchesEvent.reduce((accumulator, search) => {
          accumulator[search.id] = search;
          return accumulator;
        }, {}),
      );
      setConnecting(false);
      setError(undefined);
    });

    searchHub.on('update', (search) => {
      if (!mounted) return;
      setSearches((old) => ({ ...old, [search.id]: search }));
    });

    searchHub.on('delete', (search) => {
      if (!mounted) return;
      setSearches((old) => {
        const next = { ...old };
        delete next[search.id];
        return next;
      });
    });

    searchHub.on('create', (search) => {
      if (!mounted) return;
      setSearches((old) => ({ ...old, [search.id]: search }));
    });

    searchHub.onreconnecting((connectionError) => {
      if (!mounted) return;
      setConnecting(false);
      setError(connectionError?.message ?? 'Disconnected');
    });
    searchHub.onreconnected(() => {
      if (!mounted) return;
      setConnecting(false);
      setError(undefined);
    });
    searchHub.onclose((connectionError) => {
      if (!mounted) return;
      setConnecting(false);
      setError(connectionError?.message ?? 'Disconnected');
    });

    const connect = async () => {
      try {
        setConnecting(true);
        await searchHub.start();
      } catch (connectionError) {
        if (!mounted) return;
        toast.error(connectionError?.message ?? 'Failed to connect');
        setConnecting(false);
        setError(connectionError?.message ?? 'Failed to connect');
      }
    };

    connect();

    return () => {
      mounted = false;
      searchHub.off('list');
      searchHub.off('update');
      searchHub.off('delete');
      searchHub.off('create');
      searchHub.stop();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async ({ search } = {}) => {
    const searchText = search || inputRef.current?.value;
    if (!searchText?.trim()) return;
    const id = uuidv4();

    try {
      setCreating(true);
      await library.create({ id, searchText: searchText.trim() });
      if (!mountedRef.current) return;

      if (inputRef.current) {
        inputRef.current.value = '';
        inputRef.current.focus();
      }

      setCreating(false);
      setSelectedId(id);
    } catch (createError) {
      console.error(createError);
      if (!mountedRef.current) return;
      toast.error(
        createError?.response?.data ?? createError?.message ?? createError,
      );
      setCreating(false);
    }
  };

  const remove = async (search) => {
    try {
      setRemoving(true);
      await library.remove({ id: search.id });
      if (!mountedRef.current) return;
      setSearches((old) => {
        const next = { ...old };
        delete next[search.id];
        return next;
      });
      if (selectedId === search.id) setSelectedId(null);
      setRemoving(false);
    } catch (removeError) {
      console.error(removeError);
      if (!mountedRef.current) return;
      toast.error(
        removeError?.response?.data ?? removeError?.message ?? removeError,
      );
      setRemoving(false);
    }
  };

  const restart = async (search) => {
    try {
      setRestarting(true);
      await library.restart({ id: search.id });
      if (!mountedRef.current) return;
      setRestarting(false);
    } catch (restartError) {
      console.error(restartError);
      if (!mountedRef.current) return;
      toast.error(
        restartError?.response?.data ?? restartError?.message ?? restartError,
      );
      setRestarting(false);
    }
  };

  const stop = async (search) => {
    try {
      setStopping(true);
      await library.stop({ id: search.id });
      if (!mountedRef.current) return;
      setStopping(false);
    } catch (stoppingError) {
      console.error(stoppingError);
      if (!mountedRef.current) return;
      toast.error(
        stoppingError?.response?.data ??
          stoppingError?.message ??
          stoppingError,
      );
      setStopping(false);
    }
  };

  const selectedSearch = selectedId ? searches[selectedId] : null;
  const isSearching =
    creating || (selectedSearch != null && !selectedSearch.isComplete);

  return (
    <div
      className="sr-root"
      ref={rootRef}
    >
      {/* ── Sidebar ── */}
      <div
        className="sr-sidebar"
        style={{ minWidth: sidebarWidth, width: sidebarWidth }}
      >
        <div className="sr-sidebar-top">
          <div className="sr-input-wrap">
            <Search
              className="sr-input-icon"
              size={14}
            />
            <input
              className="sr-input"
              disabled={creating || !server?.isConnected}
              onKeyDown={(keyDownEvent) =>
                keyDownEvent.key === 'Enter' && create()
              }
              placeholder={
                server?.isConnected ? 'Search phrase' : 'Not connected'
              }
              ref={inputRef}
              type="search"
            />
          </div>
          <button
            className={`sr-create-btn hover-fx${isSearching ? ' sr-create-btn--searching' : ''}`}
            disabled={creating || !server?.isConnected}
            onClick={() => create()}
            title="New Search"
            type="button"
          >
            <Search size={16} />
          </button>
        </div>

        {connecting ? (
          <div className="sr-sidebar-status">Connecting…</div>
        ) : error ? (
          <div className="sr-sidebar-status sr-sidebar-status--error">
            {error?.message ?? error}
          </div>
        ) : (
          <SearchList
            onRemove={remove}
            onSelect={setSelectedId}
            onStop={stop}
            searches={searches}
            selectedId={selectedId}
          />
        )}
      </div>

      {/* ── Resize divider ── */}
      <button
        aria-label="Drag to resize sidebar"
        className="sr-divider"
        onMouseDown={onDividerMouseDown}
        title="Drag to resize"
        type="button"
      />

      {/* ── Main area ── */}
      <div className="sr-main">
        {selectedSearch ? (
          <SearchDetail
            creating={creating}
            disabled={!server?.isConnected}
            key={selectedSearch.id}
            onCreate={create}
            onRemove={remove}
            onRestart={restart}
            onStop={stop}
            removing={removing}
            restarting={restarting}
            search={selectedSearch}
            stopping={stopping}
          />
        ) : (
          <div className="sr-empty">
            <Search
              size={32}
              strokeWidth={1.25}
            />
            <p>
              Enter a search phrase and press Enter, or select a past search
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Searches;
