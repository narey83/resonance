// <copyright file="ContentsModal.jsx" company="JP Dillingham">
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

import { browse } from '../../../lib/shares';
import { CodeEditor, LoaderSegment, Switch } from '../../Shared';
import React, { useEffect, useState } from 'react';
import { Button, Icon, Modal } from 'semantic-ui-react';

const ContentsModal = ({ onClose, share, theme }) => {
  const [loading, setLoading] = useState(true);
  const [contents, setContents] = useState();

  const { id, localPath, remotePath } = share || {};

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);

      const result = await browse({ id });

      const directories = result.map((directory) => {
        const lines = [directory.name.replace(remotePath, localPath)];
        const directoryFilesOrderedByFilename = directory.files.sort(
          (file1, file2) => file1.filename.localeCompare(file2.filename),
        );

        for (const file of directoryFilesOrderedByFilename) {
          lines.push('\t' + file.filename.replace(remotePath, ''));
        }

        lines.push('');

        return lines.join('\n');
      });

      setContents(directories.join('\n'));
      setLoading(false);
    };

    if (id) {
      fetch();
    } else {
      setLoading(true);
      setContents();
    }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal
      onClose={onClose}
      open={share}
      size="large"
    >
      <Modal.Header>
        <Icon name="folder" />
        {localPath}
      </Modal.Header>
      <Modal.Content
        className="share-ls-content"
        scrolling
      >
        <Switch loading={loading && <LoaderSegment className="modal-loader" />}>
          <CodeEditor
            basicSetup={false}
            editable={false}
            style={{ minHeight: 500 }}
            theme={theme}
            value={contents || ''}
          />
        </Switch>
      </Modal.Content>
      <Modal.Actions>
        <Button
          className="hover-fx"
          onClick={onClose}
        >
          Close
        </Button>
      </Modal.Actions>
    </Modal>
  );
};

export default ContentsModal;
