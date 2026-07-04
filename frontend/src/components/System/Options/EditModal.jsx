// <copyright file="EditModal.jsx" company="JP Dillingham">
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

import {
  getYaml,
  getYamlLocation,
  updateYaml,
  validateYaml,
} from '../../../lib/options';
import { Div, PlaceholderSegment, Switch } from '../../Shared';
import CodeEditor from '../../Shared/CodeEditor';
import React, { useEffect, useState } from 'react';
import { Button, Icon, Message, Modal } from 'semantic-ui-react';

const EditModal = ({ onClose, open, theme }) => {
  // eslint-disable-next-line react/hook-use-state
  const [{ error, loading }, setLoading] = useState({
    error: false,
    loading: true,
  });
  // eslint-disable-next-line react/hook-use-state
  const [{ isDirty, location, yaml }, setYaml] = useState({
    isDirty: false,
    location: undefined,
    yaml: undefined,
  });
  const [yamlError, setYamlError] = useState();
  const [updateError, setUpdateError] = useState();

  const get = async () => {
    setLoading({ error: false, loading: true });

    try {
      const [locationResult, yamlResult] = await Promise.all([
        getYamlLocation(),
        getYaml(),
      ]);

      setYaml({ isDirty: false, location: locationResult, yaml: yamlResult });
      setLoading({ error: false, loading: false });
    } catch (getError) {
      setLoading({ error: getError.message, loading: false });
    }
  };

  const validate = async (newYaml) => {
    const response = await validateYaml({ yaml: newYaml });
    setYamlError(response);
  };

  const update = async (newYaml) => {
    setYaml({ isDirty: true, location, yaml: newYaml });
    validate(newYaml);
  };

  const save = async (newYaml) => {
    await validate(newYaml);

    if (!yamlError) {
      try {
        await updateYaml({ yaml: newYaml });
        onClose();
      } catch (nextUpdateError) {
        setUpdateError(nextUpdateError.response.data);
      }
    }
  };

  useEffect(() => {
    if (open) {
      get();
    }
  }, [open]);

  return (
    <Modal
      onClose={onClose}
      open={open}
      size="large"
    >
      <Modal.Header>
        <Icon name="edit" />
        Edit Options
        <Div hidden={loading}>
          <Message
            className="no-grow edit-code-header"
            warning
          >
            <Icon name="warning sign" />
            Editing {location}
          </Message>
        </Div>
      </Modal.Header>
      <Modal.Content
        className="edit-code-content"
        scrolling
      >
        <Switch
          error={error && <PlaceholderSegment icon="close" />}
          loading={loading && <PlaceholderSegment loading />}
        >
          <div
            {...{
              className:
                yamlError || updateError
                  ? 'edit-code-container-error'
                  : 'edit-code-container',
            }}
          >
            <CodeEditor
              onChange={(value) => update(value)}
              style={{ minHeight: 500 }}
              theme={theme}
              value={yaml}
            />
          </div>
        </Switch>
      </Modal.Content>
      <Modal.Actions>
        {(yamlError || updateError) && (
          <Message
            className="no-grow left-align"
            negative
          >
            <Icon name="x" />
            {(yamlError ?? '') + (updateError ?? '')}
          </Message>
        )}
        <Button
          className="hover-fx"
          disabled={!isDirty}
          onClick={() => save(yaml)}
          primary
        >
          <Icon name="save" />
          Save
        </Button>
        <Button
          className="hover-fx"
          negative
          onClick={onClose}
        >
          <Icon name="close" />
          Cancel
        </Button>
      </Modal.Actions>
    </Modal>
  );
};

export default EditModal;
