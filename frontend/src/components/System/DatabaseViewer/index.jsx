// <copyright file="index.jsx" company="JP Dillingham">
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

import './DatabaseViewer.css';
import { getSchema, listDatabases, runQuery } from '../../../lib/database';
import * as prefs from '../../../lib/prefs';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  Clock,
  Database,
  Download,
  Filter,
  Loader,
  Play,
  Table,
  X,
} from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';

const HISTORY_KEY = 'dbv-history';
const MAX_HISTORY = 20;
const SIDEBAR_KEY = 'dbv-sidebar-width';
const QHEIGHT_KEY = 'dbv-query-height';

const loadHistory = () => {
  const value = prefs.get(HISTORY_KEY, []);
  return Array.isArray(value) ? value : [];
};

const pushHistory = (entry, previous) => {
  const filtered = previous.filter(
    (h) => !(h.sql === entry.sql && h.db === entry.db),
  );
  const next = [entry, ...filtered].slice(0, MAX_HISTORY);
  prefs.set(HISTORY_KEY, next);
  return next;
};

const esc = (v) => {
  const s = v == null ? '' : String(v);
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replaceAll('"', '""')}"`
    : s;
};

const exportCsv = (columns, rows, databaseName) => {
  const csv = [
    columns.map(esc).join(','),
    ...rows.map((r) => r.map(esc).join(',')),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${databaseName}-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

const fmtCount = (n) => (n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n));

// eslint-disable-next-line complexity
const useDrag = (onMove, options = {}) => {
  const { max = Number.POSITIVE_INFINITY, min = 0, persist } = options;
  return useCallback(
    (mouseEvent) => {
      mouseEvent.preventDefault();
      const startPos =
        options.axis === 'y' ? mouseEvent.clientY : mouseEvent.clientX;
      const startValue = options.startValue();

      const move = (moveEvent) => {
        const delta =
          (options.axis === 'y' ? moveEvent.clientY : moveEvent.clientX) -
          startPos;
        const next = Math.max(min, Math.min(max, startValue + delta));
        onMove(next);
        if (persist) prefs.set(persist, next);
      };

      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.body.style.cursor =
        options.axis === 'y' ? 'row-resize' : 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    },
    [onMove, min, max, persist, options.axis], // eslint-disable-line react-hooks/exhaustive-deps
  );
};

// eslint-disable-next-line complexity
const DatabaseViewer = () => {
  const [databases, setDatabases] = useState([]);
  const [selectedDatabase, setSelectedDatabase] = useState(null);
  const [schema, setSchema] = useState({});
  const [expandedTables, setExpandedTables] = useState({});
  const [tableCounts, setTableCounts] = useState({});
  const [sql, setSql] = useState('');
  const [limit, setLimit] = useState(500);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [history, setHistory] = useState(loadHistory);
  const [showHistory, setShowHistory] = useState(false);
  const [sortCol, setSortCol] = useState(null);
  const [sortDirection, setSortDirection] = useState('asc');
  const [filter, setFilter] = useState('');
  const [expandedCell, setExpandedCell] = useState(null);

  const [sidebarWidth, setSidebarWidth] = useState(() =>
    Number(prefs.get(SIDEBAR_KEY, 220)),
  );
  const [queryHeight, setQueryHeight] = useState(() =>
    Number(prefs.get(QHEIGHT_KEY, 160)),
  );

  const sidebarWidthRef = useRef(sidebarWidth);
  const queryHeightRef = useRef(queryHeight);
  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);
  useEffect(() => {
    queryHeightRef.current = queryHeight;
  }, [queryHeight]);

  const textareaRef = useRef(null);
  const tableScrollRef = useRef(null);

  useEffect(() => {
    void (async () => {
      try {
        setDatabases(await listDatabases());
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const fetchTableCounts = useCallback(async (databaseName, tables) => {
    const counts = {};
    await Promise.all(
      tables.map(async (table) => {
        try {
          const data = await runQuery(
            databaseName,
            `SELECT COUNT(*) FROM "${table}"`,
            1,
          );
          counts[table] = data.rows[0]?.[0] ?? '?';
        } catch {
          counts[table] = '?';
        }
      }),
    );
    setTableCounts((previous) => ({ ...previous, [databaseName]: counts }));
  }, []);

  const selectDatabase = useCallback(
    async (name) => {
      setSelectedDatabase(name);
      setSchema({});
      setExpandedTables({});
      setResult(null);
      setError(null);
      setSql('');
      setFilter('');
      setSortCol(null);
      setLoadingSchema(true);
      try {
        const s = await getSchema(name);
        setSchema(s);
        fetchTableCounts(name, Object.keys(s));
      } catch {
        setError('Failed to load schema');
      } finally {
        setLoadingSchema(false);
      }
    },
    [fetchTableCounts],
  );

  const toggleTable = (table) =>
    setExpandedTables((p) => ({ ...p, [table]: !p[table] }));

  const selectTable = (table) => {
    const cols = schema[table];
    const colList = cols?.map((c) => `  "${c.name}"`).join(',\n') ?? '*';
    setSql(`SELECT\n${colList}\nFROM "${table}"\nLIMIT ${limit};`);
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const handleRun = async () => {
    if (!selectedDatabase || !sql.trim()) return;
    setRunning(true);
    setError(null);
    setResult(null);
    setFilter('');
    setSortCol(null);
    try {
      const data = await runQuery(selectedDatabase, sql, limit);
      setResult(data);
      setHistory((previous) =>
        pushHistory(
          { sql: sql.trim(), db: selectedDatabase, ts: Date.now() },
          previous,
        ),
      );
    } catch (caughtError) {
      setError(
        caughtError?.response?.data || caughtError?.message || 'Query failed',
      );
    } finally {
      setRunning(false);
    }
  };

  const handleKeyDown = ({ ctrlKey, key, metaKey, preventDefault }) => {
    if ((ctrlKey || metaKey) && key === 'Enter') {
      preventDefault();
      handleRun();
    }
  };

  const handleSort = (col) => {
    if (sortCol === col)
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortCol(col);
      setSortDirection('asc');
    }
  };

  // eslint-disable-next-line complexity
  const displayRows = (() => {
    if (!result) return [];
    let rows = result.rows;
    if (filter.trim()) {
      const q = filter.toLowerCase();
      rows = rows.filter((row) =>
        row.some(
          (cell) => cell != null && String(cell).toLowerCase().includes(q),
        ),
      );
    }

    if (sortCol !== null) {
      const index = result.columns.indexOf(sortCol);
      if (index >= 0) {
        rows = [...rows].sort((a, b) => {
          const av = a[index];
          const bv = b[index];
          if (av == null && bv == null) return 0;
          if (av == null) return sortDirection === 'asc' ? 1 : -1;
          if (bv == null) return sortDirection === 'asc' ? -1 : 1;
          const n = Number.parseFloat(String(av));
          const m = Number.parseFloat(String(bv));
          const cmp =
            !Number.isNaN(n) && !Number.isNaN(m)
              ? n - m
              : String(av).localeCompare(String(bv));
          return sortDirection === 'asc' ? cmp : -cmp;
        });
      }
    }

    return rows;
  })();

  const rowVirtualizer = useVirtualizer({
    count: displayRows.length,
    getScrollElement: () => tableScrollRef.current,
    estimateSize: () => 28,
    overscan: 15,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const rowsTotalSize = rowVirtualizer.getTotalSize();
  const rowsPaddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const rowsPaddingBottom =
    virtualRows.length > 0
      ? rowsTotalSize - virtualRows[virtualRows.length - 1].end
      : 0;

  useEffect(() => {
    if (tableScrollRef.current) tableScrollRef.current.scrollTop = 0;
  }, [result]);

  const startSidebarDrag = useDrag(setSidebarWidth, {
    axis: 'x',
    min: 140,
    max: 520,
    startValue: () => sidebarWidthRef.current,
    persist: SIDEBAR_KEY,
  });

  const startQueryDrag = useDrag(setQueryHeight, {
    axis: 'y',
    min: 80,
    max: 480,
    startValue: () => queryHeightRef.current,
    persist: QHEIGHT_KEY,
  });

  const databaseCounts = tableCounts[selectedDatabase] || {};

  // eslint-disable-next-line react/no-unstable-nested-components
  const SortIcon = ({ col }) => {
    if (sortCol !== col)
      return (
        <ArrowUpDown
          className="dbv-sort-icon"
          size={10}
        />
      );
    return sortDirection === 'asc' ? (
      <ArrowUp
        className="dbv-sort-icon dbv-sort-icon--active"
        size={10}
      />
    ) : (
      <ArrowDown
        className="dbv-sort-icon dbv-sort-icon--active"
        size={10}
      />
    );
  };

  return (
    <div className="dbv-root dbv-root--popout">
      {/* ── Sidebar ── */}
      <div
        className="dbv-sidebar"
        style={{ width: sidebarWidth }}
      >
        <div className="dbv-popout-bar">
          <Database size={13} />
          <span>Database Viewer</span>
          {selectedDatabase && (
            <span className="dbv-popout-db">— {selectedDatabase}</span>
          )}
        </div>
        <div className="dbv-sidebar-list">
          {databases.map((database) => (
            <div key={database}>
              <button
                className={`dbv-db-item hover-fx${selectedDatabase === database ? ' dbv-db-item--active' : ''}`}
                onClick={() => selectDatabase(database)}
                type="button"
              >
                <Database
                  size={12}
                  style={{ marginRight: 6, verticalAlign: 'middle' }}
                />
                {database}
              </button>

              {selectedDatabase === database && (
                <div className="dbv-table-group">
                  {loadingSchema && (
                    <div
                      style={{
                        padding: '8px 16px',
                        color: 'var(--text-muted)',
                      }}
                    >
                      <Loader
                        className="dbv-spin"
                        size={12}
                      />
                    </div>
                  )}
                  {Object.entries(schema).map(([table, cols]) => (
                    <div key={table}>
                      {/* The SELECT button sits beside the toggle, not inside it: a <button>
                          can't contain another <button>. */}
                      <div className="dbv-table-row">
                        <button
                          className="dbv-table-toggle"
                          onClick={() => toggleTable(table)}
                          type="button"
                        >
                          {expandedTables[table] ? (
                            <ChevronDown size={11} />
                          ) : (
                            <ChevronRight size={11} />
                          )}
                          <Table
                            size={11}
                            style={{ flexShrink: 0 }}
                          />
                          <span className="dbv-table-name">{table}</span>
                          {databaseCounts[table] !== undefined && (
                            <span className="dbv-table-count">
                              {fmtCount(databaseCounts[table])}
                            </span>
                          )}
                        </button>
                        <button
                          className="dbv-table-select-btn"
                          onClick={() => selectTable(table)}
                          title="Generate SELECT query"
                          type="button"
                        >
                          <Play size={10} />
                        </button>
                      </div>
                      {expandedTables[table] && (
                        <div className="dbv-col-list">
                          {cols.map((col) => (
                            <div
                              className="dbv-col-item"
                              key={col.name}
                            >
                              {col.primaryKey && (
                                <span className="dbv-col-pk">PK</span>
                              )}
                              <span className="dbv-col-name">{col.name}</span>
                              <span className="dbv-col-type">{col.type}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Vertical divider (sidebar ↔ main) ── */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        className="dbv-divider-v"
        onMouseDown={startSidebarDrag}
      />

      {/* ── Main ── */}
      <div className="dbv-main">
        {/* Query bar */}
        <div
          className="dbv-query-bar"
          style={{ height: queryHeight }}
        >
          {showHistory && (
            <div className="dbv-history-panel">
              <div className="dbv-history-header">
                <Clock size={12} />
                <span>Query History</span>
                <button
                  className="dbv-history-clear"
                  onClick={() => {
                    prefs.set(HISTORY_KEY, []);
                    setHistory([]);
                  }}
                  type="button"
                >
                  Clear all
                </button>
              </div>
              {history.length === 0 ? (
                <div className="dbv-history-empty">No history yet</div>
              ) : (
                <div className="dbv-history-list">
                  {history.map((h) => (
                    <button
                      className="dbv-history-item"
                      key={h.ts}
                      onClick={() => {
                        setSql(h.sql);
                        if (h.db !== selectedDatabase) selectDatabase(h.db);
                        setShowHistory(false);
                        setTimeout(() => textareaRef.current?.focus(), 50);
                      }}
                      type="button"
                    >
                      <span className="dbv-history-db">{h.db}</span>
                      <span className="dbv-history-sql">{h.sql}</span>
                      <span className="dbv-history-ts">
                        {new Date(h.ts).toLocaleTimeString()}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <textarea
            className="dbv-query-input"
            disabled={!selectedDatabase}
            onChange={({ target }) => setSql(target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              selectedDatabase
                ? 'SELECT * FROM … (Ctrl+Enter to run)'
                : 'Select a database'
            }
            ref={textareaRef}
            value={sql}
          />

          <div className="dbv-query-actions">
            <span className="dbv-limit-label">Limit</span>
            <input
              className="dbv-limit-input"
              max={5_000}
              min={1}
              onChange={({ target }) => setLimit(Number(target.value) || 500)}
              type="number"
              value={limit}
            />
            <button
              className={`dbv-icon-btn hover-fx${showHistory ? ' dbv-icon-btn--active' : ''}`}
              onClick={() => setShowHistory((v) => !v)}
              title="Query history"
              type="button"
            >
              <Clock size={14} />
            </button>
            <button
              className="dbv-run-btn hover-fx"
              disabled={!selectedDatabase || !sql.trim() || running}
              onClick={handleRun}
              type="button"
            >
              {running ? (
                <Loader
                  className="dbv-spin"
                  size={13}
                />
              ) : (
                <Play size={13} />
              )}
              Run
            </button>
          </div>
        </div>

        {/* ── Horizontal divider (query ↔ results) ── */}
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div
          className="dbv-divider-h"
          onMouseDown={startQueryDrag}
        />

        {/* Results */}
        <div className="dbv-results">
          {error && <div className="dbv-error">{error}</div>}

          {result && (
            <>
              <div className="dbv-result-meta">
                <span className="dbv-result-count">
                  {displayRows.length.toLocaleString()} row
                  {displayRows.length === 1 ? '' : 's'}
                  {filter && result.rows.length !== displayRows.length
                    ? ` (filtered from ${result.rows.length.toLocaleString()})`
                    : !filter && result.rows.length >= limit
                      ? ' (limit reached)'
                      : ''}
                </span>
                <div className="dbv-result-controls">
                  <div className="dbv-filter-wrap">
                    <Filter
                      className="dbv-filter-icon"
                      size={11}
                    />
                    <input
                      className="dbv-filter-input"
                      onChange={({ target }) => setFilter(target.value)}
                      placeholder="Filter rows…"
                      type="text"
                      value={filter}
                    />
                    {filter && (
                      <button
                        className="dbv-filter-clear"
                        onClick={() => setFilter('')}
                        type="button"
                      >
                        <X size={10} />
                      </button>
                    )}
                  </div>
                  <button
                    className="dbv-icon-btn"
                    onClick={() =>
                      exportCsv(result.columns, displayRows, selectedDatabase)
                    }
                    title="Export to CSV"
                    type="button"
                  >
                    <Download size={13} />
                    CSV
                  </button>
                </div>
              </div>
              <div
                className="dbv-table-wrap"
                ref={tableScrollRef}
              >
                <table className="dbv-result-table">
                  <thead>
                    <tr>
                      {result.columns.map((col) => (
                        <th
                          key={col}
                          onClick={() => handleSort(col)}
                        >
                          <span className="dbv-th-inner">
                            {col}
                            <SortIcon col={col} />
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rowsPaddingTop > 0 && (
                      <tr>
                        <td
                          colSpan={result.columns.length}
                          style={{
                            height: rowsPaddingTop,
                            padding: 0,
                            border: 'none',
                          }}
                        />
                      </tr>
                    )}
                    {virtualRows.map((vRow) => {
                      const row = displayRows[vRow.index];
                      return (
                        // eslint-disable-next-line react/no-array-index-key
                        <tr key={vRow.key}>
                          {row.map((cell, colIndex) => (
                            // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
                            <td
                              key={result.columns[colIndex]}
                              onClick={() =>
                                setExpandedCell({
                                  col: result.columns[colIndex],
                                  value: cell,
                                })
                              }
                            >
                              {cell == null ? (
                                <span className="dbv-null">null</span>
                              ) : (
                                String(cell)
                              )}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                    {rowsPaddingBottom > 0 && (
                      <tr>
                        <td
                          colSpan={result.columns.length}
                          style={{
                            height: rowsPaddingBottom,
                            padding: 0,
                            border: 'none',
                          }}
                        />
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {!result && !error && (
            <div className="dbv-empty">
              <Database
                size={32}
                strokeWidth={1}
              />
              <span>Run a query to see results</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Cell expand overlay ── */}
      {expandedCell && (
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
        <div
          className="dbv-overlay"
          onClick={() => setExpandedCell(null)}
          role="dialog"
        >
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <div
            className="dbv-cell-modal"
            onClick={(clickEvent) => clickEvent.stopPropagation()}
          >
            <div className="dbv-cell-modal-header">
              <span className="dbv-cell-modal-col">{expandedCell.col}</span>
              <button
                className="dbv-cell-modal-close hover-fx"
                onClick={() => setExpandedCell(null)}
                type="button"
              >
                <X size={14} />
              </button>
            </div>
            <div className="dbv-cell-modal-body">
              {expandedCell.value == null ? (
                <span className="dbv-null">null</span>
              ) : (
                String(expandedCell.value)
              )}
            </div>
            <div className="dbv-cell-modal-footer">
              <button
                className="dbv-cell-copy-btn hover-fx"
                onClick={() => {
                  if (expandedCell.value != null)
                    navigator.clipboard.writeText(String(expandedCell.value));
                }}
                type="button"
              >
                Copy value
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DatabaseViewer;
