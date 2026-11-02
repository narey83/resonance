// <copyright file="Response.jsx" company="JP Dillingham">
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

import { toast } from '../../lib/activityNotices';
import { findDuplicates } from '../../lib/dedup';
import * as transfers from '../../lib/transfers';
import { getDirectoryContents, getStatus } from '../../lib/users';
import { formatBitrate, formatBytes, getDirectoryName } from '../../lib/util';
import FileList from '../Shared/FileList';
import UsernameLink from '../Shared/UsernameLink';
import { AlertTriangle, Download, Search, X } from 'lucide-react';
import React, { Component } from 'react';

const presenceCache = {};

const buildTree = (response) => {
  let { files = [] } = response;
  const { lockedFiles = [] } = response;
  files = files.concat(lockedFiles.map((file) => ({ ...file, locked: true })));

  return files.reduce((dict, file) => {
    const directory = getDirectoryName(file.filename);
    const displayDirectory = getDirectoryName(
      file.displayFilename ?? file.filename,
    );
    const selectable = { selected: false, displayDirectory, ...file };
    dict[directory] =
      dict[directory] === undefined
        ? [selectable]
        : dict[directory].concat(selectable);
    return dict;
  }, {});
};

class Response extends Component {
  constructor(props) {
    super(props);

    this.state = {
      downloadError: '',
      downloadRequest: undefined,
      fetchingDirectoryContents: false,
      presence: presenceCache[this.props.response.username] ?? null,
      tree: buildTree(this.props.response),
    };
  }

  componentDidMount() {
    const { username } = this.props.response;
    if (presenceCache[username]) return;
    let cancelled = false;
    getStatus({ username })
      .then(({ data }) => {
        const p = data?.presence ?? 'Offline';
        presenceCache[username] = p;
        if (!cancelled) this.setState({ presence: p });
      })
      .catch(() => {});
    this._cancelPresence = () => {
      cancelled = true;
    };
  }

  componentDidUpdate(previousProps) {
    if (
      JSON.stringify(this.props.response) !==
      JSON.stringify(previousProps.response)
    ) {
      this.setState({ tree: buildTree(this.props.response) });
    }
  }

  componentWillUnmount() {
    this._cancelPresence?.();
  }

  handleFileSelectionChange = (file, state) => {
    file.selected = state;
    this.setState((previousState) => ({
      downloadError: '',
      downloadRequest: undefined,
      tree: previousState.tree,
    }));
  };

  download = (username, files) => {
    this.setState({ downloadRequest: 'inProgress' }, async () => {
      try {
        const requests = (files || []).map(({ filename, size }) => ({
          filename,
          size,
        }));
        await transfers.download({ files: requests, username });

        this.setState({ downloadRequest: 'complete' });
      } catch (error) {
        this.setState({
          downloadError: error.response,
          downloadRequest: 'error',
        });
      }
    });
  };

  getFullDirectory = async (username, directory) => {
    this.setState({ fetchingDirectoryContents: true });

    try {
      const oldTree = { ...this.state.tree };
      const oldFiles = oldTree[directory];

      try {
        // some clients might send more than one directory in the response,
        // if the requested directory contains subdirectories. the root directory
        // is always first, and for now we'll only display the contents of that.
        const allDirectories = await getDirectoryContents({
          directory,
          username,
        });
        const theRootDirectory = allDirectories?.[0];

        // some clients might send an empty response for some reason
        if (!theRootDirectory) {
          throw new Error('No directories were included in the response');
        }

        const { files, name } = theRootDirectory;

        // the api returns file names only, so we need to prepend the directory
        // to make it look like a search result.  we also need to preserve
        // any file selections, so check the old files and assign accordingly
        const fixedFiles = files.map((file) => ({
          ...file,
          filename: `${directory}\\${file.filename}`,
          selected:
            oldFiles.find(
              (f) => f.filename === `${directory}\\${file.filename}`,
            )?.selected ?? false,
        }));

        oldTree[name] = fixedFiles;
        this.setState({ tree: { ...oldTree } });
      } catch (error) {
        throw new Error(`Failed to process directory response: ${error}`, {
          cause: error,
        });
      }
    } catch (error) {
      console.error(error);
      toast.error(error?.response?.data ?? error?.message ?? error);
    } finally {
      this.setState({ fetchingDirectoryContents: false });
    }
  };

  handleDedup = (filesToRemove) => {
    for (const file of filesToRemove) {
      file.selected = false;
    }

    this.setState((previousState) => ({ tree: previousState.tree }));
  };

  render() {
    const { response } = this.props;
    const free = response.hasFreeUploadSlot;

    const {
      downloadError,
      downloadRequest,
      fetchingDirectoryContents,
      presence,
      tree,
    } = this.state;

    const allFiles = Object.keys(tree).reduce(
      (accumulator, directory) => accumulator.concat(tree[directory]),
      [],
    );
    const selectedFiles = allFiles.filter((file) => file.selected);
    const selectedSize = formatBytes(
      selectedFiles.reduce((total, file) => total + file.size, 0),
    );
    const { definite, probable } = findDuplicates(selectedFiles);
    const allDuplicates = [...definite, ...probable];

    return (
      <div className="result-card">
        <div className="result-card-header">
          <span
            className={`result-status-dot${free ? ' result-status-dot--free' : ''}`}
          />

          <UsernameLink
            className="result-card-username"
            username={response.username}
          />

          <div className="result-card-stats">
            <span className="result-stat">
              {formatBitrate(response.uploadSpeed)}
            </span>
            <span
              className={`result-stat${free ? ' result-stat--slot-free' : ' result-stat--slot-busy'}`}
            >
              {free ? 'Free slot' : 'No slot'}
            </span>
            <span className="result-stat">Queue {response.queueLength}</span>
          </div>

          <button
            aria-label="Hide result"
            className="result-card-close-btn"
            onClick={() => this.props.onHide()}
            title="Hide result"
            type="button"
          >
            <X
              size={14}
              strokeWidth={2}
            />
          </button>
        </div>

        <div className="result-card-body">
          {Object.keys(tree).map((directory) => (
            <FileList
              directoryName={
                tree[directory]?.[0]?.displayDirectory ?? directory
              }
              disabled={downloadRequest === 'inProgress'}
              files={tree[directory]}
              footer={
                <button
                  className="result-browse-more-btn"
                  disabled={fetchingDirectoryContents || presence === 'Offline'}
                  onClick={() =>
                    this.getFullDirectory(response.username, directory)
                  }
                  title={presence === 'Offline' ? 'User is offline' : undefined}
                  type="button"
                >
                  {fetchingDirectoryContents && (
                    <span className="result-browse-spinner" />
                  )}
                  <Search
                    size={11}
                    strokeWidth={2}
                  />
                  Browse for more files in this directory
                </button>
              }
              hasFreeUploadSlot={free}
              key={directory}
              locked={tree[directory].some((file) => file.locked)}
              onSelectionChange={this.handleFileSelectionChange}
              showUserLink
              userPresence={presence}
              username={response.username}
            />
          ))}
        </div>

        {allDuplicates.length > 0 && (
          <div className="result-dupe-warning">
            <AlertTriangle
              size={13}
              strokeWidth={2}
            />
            {definite.length > 0 && (
              <span className="result-dupe-label result-dupe-label--definite">
                {definite.length} definite
              </span>
            )}
            {probable.length > 0 && (
              <span className="result-dupe-label result-dupe-label--probable">
                {probable.length} probable
              </span>
            )}
            duplicate{allDuplicates.length > 1 ? 's' : ''} in selection
            <button
              className="result-dupe-remove-btn"
              onClick={() => this.handleDedup(allDuplicates)}
              type="button"
            >
              Remove
            </button>
          </div>
        )}

        {selectedFiles.length > 0 && (
          <div className="result-card-footer">
            <button
              className="result-download-btn"
              disabled={this.props.disabled || downloadRequest === 'inProgress'}
              onClick={() => this.download(response.username, selectedFiles)}
              type="button"
            >
              <Download
                size={13}
                strokeWidth={2}
              />
              Download {selectedFiles.length}{' '}
              {selectedFiles.length === 1 ? 'file' : 'files'} · {selectedSize}
            </button>

            {downloadRequest === 'inProgress' && (
              <span className="result-dl-spinner" />
            )}
            {downloadRequest === 'complete' && (
              <span className="result-dl-status result-dl-status--ok">
                Queued
              </span>
            )}
            {downloadRequest === 'error' && (
              <span className="result-dl-status result-dl-status--err">
                Failed
                {downloadError?.status ? ` · HTTP ${downloadError.status}` : ''}
              </span>
            )}
          </div>
        )}
      </div>
    );
  }
}

export default Response;
