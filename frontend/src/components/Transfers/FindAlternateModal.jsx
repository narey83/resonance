import * as searchesLibrary from '../../lib/searches';
import { formatBytes, getFileName } from '../../lib/util';
import { Download, Search, User, X } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

const getParentFolder = (filepath) => {
  const parts = filepath.replaceAll('\\', '/').split('/').filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : '';
};

const baseName = (filepath) => {
  const parts = filepath.replaceAll('\\', '/').split('/').filter(Boolean);
  return parts.at(-1) ?? filepath;
};

const MAX_SEARCH_SECONDS = 30;

const FindAlternateModal = ({
  folderName,
  onClose,
  onDownload,
  originalFiles,
  originalUsername,
}) => {
  const [results, setResults] = useState([]);
  const [elapsed, setElapsed] = useState(0);
  const [done, setDone] = useState(false);
  const searchIdRef = useRef(null);
  const timerRef = useRef(null);
  const mountedRef = useRef(true);

  // Base filenames we need to find, keyed lowercase → original file (for size reference)
  const neededNames = new Map(
    originalFiles.map((f) => [baseName(f.filename).toLowerCase(), f]),
  );

  useEffect(() => {
    mountedRef.current = true;
    const searchId = uuidv4();
    searchIdRef.current = searchId;

    searchesLibrary
      .create({ id: searchId, searchText: folderName })
      .catch(() => {});

    let polls = 0;

    const poll = async () => {
      try {
        const responses = await searchesLibrary.getResponses({ id: searchId });
        if (!mountedRef.current || !responses) return;

        const lowerOriginal = originalUsername.toLowerCase();
        const byUser = new Map();
        for (const response of responses) {
          if (response.username.toLowerCase() === lowerOriginal) continue;

          // Collect files from the matching folder, keyed by lowercase base name
          const folderFiles = new Map();
          for (const f of response.files ?? []) {
            if (
              getParentFolder(f.filename).toLowerCase() !==
              folderName.toLowerCase()
            )
              continue;
            folderFiles.set(baseName(f.filename).toLowerCase(), f);
          }

          // Only accept if every needed file is present
          if (![...neededNames.keys()].every((name) => folderFiles.has(name)))
            continue;

          // Build matched file list in the same order as the originals
          const matchedFiles = [...neededNames.keys()].map((name) =>
            folderFiles.get(name),
          );

          const existing = byUser.get(response.username);
          if (!existing) {
            byUser.set(response.username, {
              files: matchedFiles,
              username: response.username,
            });
          }
        }

        setResults([...byUser.values()]);
      } catch {
        // silently ignore poll errors
      }

      polls++;
      const newElapsed = polls * 2;
      if (!mountedRef.current) return;
      setElapsed(newElapsed);

      if (newElapsed >= MAX_SEARCH_SECONDS) {
        setDone(true);
        searchesLibrary.stop({ id: searchId }).catch(() => {});
        return;
      }

      timerRef.current = setTimeout(poll, 2_000);
    };

    timerRef.current = setTimeout(poll, 2_000);

    return () => {
      mountedRef.current = false;
      clearTimeout(timerRef.current);
      searchesLibrary.stop({ id: searchId }).catch(() => {});
      searchesLibrary.remove({ id: searchId }).catch(() => {});
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      className="fam-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="fam-modal">
        <div className="fam-header">
          <Search
            size={13}
            style={{ flexShrink: 0, opacity: 0.6 }}
          />
          <span className="fam-title">
            Find alternate source — <em>{folderName}</em>
          </span>
          <button
            className="fam-close"
            onClick={onClose}
            type="button"
          >
            <X size={14} />
          </button>
        </div>

        <div className="fam-status">
          {!done ? (
            <>
              <span className="fam-status-dot fam-status-dot--pulse" />
              Searching… {elapsed}s / {MAX_SEARCH_SECONDS}s
            </>
          ) : (
            <>
              <span className="fam-status-dot" />
              Search complete
            </>
          )}
          <span className="fam-status-count">
            {results.length} source{results.length === 1 ? '' : 's'} found
          </span>
        </div>

        <div className="fam-results">
          {results.length === 0 && done && (
            <div className="fam-empty">
              No alternate sources found for this folder
            </div>
          )}
          {results.length === 0 && !done && (
            <div className="fam-empty fam-empty--waiting">
              Waiting for responses…
            </div>
          )}
          {results.map((result) => {
            const totalSize = result.files.reduce(
              (s, f) => s + (f.size ?? 0),
              0,
            );
            return (
              <div
                className="fam-result"
                key={result.username}
              >
                <div className="fam-result-header">
                  <User
                    size={12}
                    style={{ flexShrink: 0, opacity: 0.6 }}
                  />
                  <span className="fam-result-user">{result.username}</span>
                  <span className="fam-result-meta">
                    {result.files.length} file
                    {result.files.length === 1 ? '' : 's'}
                    <span className="fam-result-sep">·</span>
                    {formatBytes(totalSize)}
                  </span>
                  <button
                    className="fam-download-btn"
                    onClick={() =>
                      onDownload({
                        files: result.files,
                        username: result.username,
                      })
                    }
                    type="button"
                  >
                    <Download size={11} />
                    Download
                  </button>
                </div>
                <div className="fam-result-files">
                  {result.files.map((f) => (
                    <div
                      className="fam-result-file"
                      key={f.filename}
                    >
                      <span className="fam-result-filename">
                        {getFileName(f.filename)}
                      </span>
                      <span className="fam-result-filesize">
                        {formatBytes(f.size)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default FindAlternateModal;
