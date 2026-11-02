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
import { toast } from '../../lib/activityNotices';
import { createSearchHubConnection } from '../../lib/hubFactory';
import { createHubRetryLoop } from '../../lib/hubRetryLoop';
import * as library from '../../lib/searches';
import SearchDetail from './Detail/SearchDetail';
import SearchList from './List/SearchList';
import SearchWizard from './SearchWizard';
import { Plus, Search } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

const Searches = ({ server } = {}) => {
  const [connecting, setConnecting] = useState(true);
  const [error, setError] = useState(undefined);
  const [searches, setSearches] = useState({});
  const [selectedId, setSelectedId] = useState(null);
  const [wizardOpen, setWizardOpen] = useState(true);
  const [searchFilters, setSearchFilters] = useState({});
  const [removing, setRemoving] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [creating, setCreating] = useState(false);
  const [restarting, setRestarting] = useState(false);

  const mountedRef = useRef(true);
  const pendingSearchRef = useRef(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const acceptSearch = useCallback((search) => {
    const pending = pendingSearchRef.current;
    if (
      !mountedRef.current ||
      !pending ||
      pending.id !== search.id ||
      pending.accepted
    )
      return;
    pending.accepted = true;
    setSelectedId(search.id);
    setWizardOpen(false);
    setCreating(false);
  }, []);

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
      for (const search of searchesEvent) acceptSearch(search);
      setConnecting(false);
      setError(undefined);
    });

    searchHub.on('update', (search) => {
      if (!mounted) return;
      setSearches((old) => ({ ...old, [search.id]: search }));
      acceptSearch(search);
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
      acceptSearch(search);
    });

    const retryLoop = createHubRetryLoop({
      start: () => searchHub.start(),
      onOnline: () => {
        if (mounted) {
          setConnecting(false);
          setError(undefined);
        }
      },
      onRetry: () => {
        if (mounted) {
          setConnecting(false);
          setError('Search updates disconnected. Reconnecting…');
        }
      },
    });
    searchHub.onreconnecting(retryLoop.reconnecting);
    searchHub.onreconnected(retryLoop.connected);
    searchHub.onclose(retryLoop.closed);
    retryLoop.start();

    return () => {
      mounted = false;
      retryLoop.dispose();
      searchHub.off('list');
      searchHub.off('update');
      searchHub.off('delete');
      searchHub.off('create');
      searchHub.stop();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async ({ filters = {}, options = {}, search } = {}) => {
    const searchText = search;
    if (!searchText?.trim()) return;
    const id = uuidv4();

    pendingSearchRef.current = { id, accepted: false };
    setSearchFilters((old) => ({ ...old, [id]: filters }));
    try {
      setCreating(true);
      const { data } = await library.create({
        id,
        searchText: searchText.trim(),
        ...options,
      });
      if (!mountedRef.current) return;
      setSearches((old) => ({ ...old, [id]: old[id] ?? data }));
      acceptSearch(data);
    } catch (createError) {
      console.error(createError);
      if (!mountedRef.current) return;
      toast.error(
        createError?.response?.data ?? createError?.message ?? createError,
      );
      if (pendingSearchRef.current?.id === id) setCreating(false);
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
  return (
    <div className="sr-root sr-workspace">
      <header className="sr-workspace-header">
        <div>
          <span className="sr-eyebrow">SOULSEEK</span>
          <h1>Soulseek search</h1>
        </div>
        {!wizardOpen && (
          <button
            className="sr-wizard-primary"
            onClick={() => setWizardOpen(true)}
            type="button"
          >
            <Plus size={16} /> New search
          </button>
        )}
      </header>
      <nav
        aria-label="Search history"
        className="sr-history"
      >
        {connecting ? (
          <span>Connecting…</span>
        ) : error ? (
          <span role="alert">{String(error)}</span>
        ) : (
          <SearchList
            onRemove={remove}
            onSelect={(id) => {
              setSelectedId(id);
              setWizardOpen(false);
            }}
            onStop={stop}
            searches={searches}
            selectedId={selectedId}
          />
        )}
      </nav>
      {wizardOpen && (
        <SearchWizard
          busy={creating}
          connected={server?.isConnected}
          onCancel={selectedSearch ? () => setWizardOpen(false) : undefined}
          onSearch={create}
        />
      )}
      <div className="sr-main">
        {!wizardOpen && selectedSearch ? (
          <SearchDetail
            creating={creating}
            disabled={!server?.isConnected}
            initialFilters={searchFilters[selectedSearch.id]}
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
        ) : !wizardOpen ? (
          <div className="sr-empty">
            <Search
              size={32}
              strokeWidth={1.25}
            />
            <p>
              Enter a search phrase and press Enter, or select a past search
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default Searches;
