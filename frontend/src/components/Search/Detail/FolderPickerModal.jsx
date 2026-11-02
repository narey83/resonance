// <copyright file="FolderPickerModal.jsx" company="John Narey">
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

import { toast } from '../../../lib/activityNotices';
import * as transfers from '../../../lib/transfers';
import { ChevronRight, Download, Folder, FolderPlus, X } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from 'semantic-ui-react';

const FolderPickerModal = ({
  onClose,
  onConfirm,
  open,
  suggestedPath = '',
}) => {
  const [pathSegments, setPathSegments] = useState([]);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [saving, setSaving] = useState(false);
  const [editablePath, setEditablePath] = useState('');
  const newFolderInputRef = useRef(null);

  const loadFolders = useCallback(async (segments) => {
    setLoading(true);
    try {
      const path = segments.join('/');
      const result = await transfers.listDownloadFolders(path);
      setPathSegments(segments);
      setFolders(result);
    } catch {
      if (segments.length > 0) {
        // path doesn't exist yet — walk up until we find a valid parent
        await loadFolders(segments.slice(0, -1));
      } else {
        setFolders([]);
        setPathSegments([]);
      }
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    setShowNewFolder(false);
    setNewFolderName('');
    setEditablePath(suggestedPath || '');
    const segments = suggestedPath
      ? suggestedPath.split('/').filter(Boolean)
      : [];
    loadFolders(segments);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (showNewFolder) {
      setTimeout(() => newFolderInputRef.current?.focus(), 50);
    }
  }, [showNewFolder]);

  const navigateInto = (folder) => {
    const segments = [...pathSegments, folder];
    setEditablePath(segments.join('/'));
    loadFolders(segments);
  };

  const navigateToBreadcrumb = (index) => {
    const segments = pathSegments.slice(0, index + 1);
    setEditablePath(segments.join('/'));
    loadFolders(segments);
  };

  const navigateToRoot = () => {
    setEditablePath('');
    loadFolders([]);
  };

  const createFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    setSaving(true);
    try {
      const path = [...pathSegments, name].join('/');
      await transfers.createDownloadFolder(path);
      setNewFolderName('');
      setShowNewFolder(false);
      await loadFolders([...pathSegments, name]);
    } catch {
      toast.error('Failed to create folder');
    } finally {
      setSaving(false);
    }
  };

  const handleNewFolderKey = (e) => {
    if (e.key === 'Enter') createFolder();
    if (e.key === 'Escape') {
      setShowNewFolder(false);
      setNewFolderName('');
    }
  };

  const confirm = () => {
    onConfirm(editablePath.trim());
    onClose();
  };

  return (
    <Modal
      onClose={onClose}
      open={open}
      size="small"
    >
      <div className="fpm-root">
        <div className="fpm-header">
          <span className="fpm-title">Choose Download Folder</span>
          <button
            className="fpm-close"
            onClick={onClose}
            title="Close"
            type="button"
          >
            <X size={12} />
          </button>
        </div>

        <div className="fpm-body">
          <div className="fpm-breadcrumb">
            <button
              className={`fpm-crumb hover-fx${pathSegments.length === 0 ? ' fpm-crumb--active' : ''}`}
              onClick={navigateToRoot}
              type="button"
            >
              Downloads
            </button>
            {pathSegments.map((seg, index) => (
              // eslint-disable-next-line react/no-array-index-key
              <React.Fragment key={index}>
                <ChevronRight
                  className="fpm-crumb-sep"
                  size={11}
                />
                <button
                  className={`fpm-crumb hover-fx${index === pathSegments.length - 1 ? ' fpm-crumb--active' : ''}`}
                  onClick={() => navigateToBreadcrumb(index)}
                  type="button"
                >
                  {seg}
                </button>
              </React.Fragment>
            ))}
          </div>

          <div className="fpm-folder-list">
            {loading && (
              <div className="fpm-list-state">
                <span className="fpm-spinner" />
              </div>
            )}
            {!loading && folders.length === 0 && (
              <div className="fpm-list-state fpm-list-empty">
                No subfolders here
              </div>
            )}
            {!loading &&
              folders.map((folder) => (
                <button
                  className="fpm-folder-item"
                  key={folder}
                  onClick={() => navigateInto(folder)}
                  type="button"
                >
                  <Folder
                    size={14}
                    strokeWidth={1.75}
                  />
                  <span className="fpm-folder-item-name">{folder}</span>
                  <ChevronRight
                    className="fpm-item-chevron"
                    size={12}
                  />
                </button>
              ))}
          </div>

          <div className="fpm-new-folder-area">
            {showNewFolder ? (
              <div className="fpm-new-folder-row">
                <Folder
                  size={13}
                  strokeWidth={1.75}
                />
                <input
                  className="fpm-new-folder-input"
                  disabled={saving}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={handleNewFolderKey}
                  placeholder="Folder name"
                  ref={newFolderInputRef}
                  type="text"
                  value={newFolderName}
                />
                <button
                  className="fpm-new-folder-create"
                  disabled={!newFolderName.trim() || saving}
                  onClick={createFolder}
                  type="button"
                >
                  Create
                </button>
                <button
                  className="fpm-new-folder-cancel"
                  onClick={() => {
                    setShowNewFolder(false);
                    setNewFolderName('');
                  }}
                  type="button"
                >
                  <X size={11} />
                </button>
              </div>
            ) : (
              <button
                className="fpm-new-folder-btn"
                onClick={() => setShowNewFolder(true)}
                type="button"
              >
                <FolderPlus size={13} />
                New Folder
              </button>
            )}
          </div>
        </div>

        <div className="fpm-footer">
          <div className="fpm-current-path">
            <Folder
              size={12}
              strokeWidth={1.75}
            />
            <input
              className="fpm-path-input"
              onChange={(e) => setEditablePath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirm();
              }}
              placeholder="Downloads root"
              type="text"
              value={editablePath}
            />
          </div>
          <div className="fpm-footer-actions">
            <button
              className="fpm-btn hover-fx fpm-btn--cancel"
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="fpm-btn hover-fx fpm-btn--confirm"
              onClick={confirm}
              type="button"
            >
              <Download size={13} />
              Download here
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default FolderPickerModal;
