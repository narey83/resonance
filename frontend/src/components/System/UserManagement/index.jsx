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

import * as appUsers from '../../../lib/appUsers';
import { getUsername } from '../../../lib/token';
import { parseUtcDate } from '../../../lib/util';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Dropdown,
  Form,
  Header,
  Icon,
  Label,
  Modal,
  Table,
} from 'semantic-ui-react';

const ROLE_OPTIONS = [
  { key: 'Administrator', text: 'Admin', value: 'Administrator' },
  { key: 'ReadWrite', text: 'User', value: 'ReadWrite' },
];

const AddUserModal = ({ onAdd }) => {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    username: '',
    fullName: '',
    password: '',
    role: 'ReadWrite',
  });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setForm({ username: '', fullName: '', password: '', role: 'ReadWrite' });
    setError(null);
  };

  const handleSubmit = async () => {
    if (!form.username || !form.password) {
      setError('Username and password are required');
      return;
    }

    setLoading(true);
    try {
      const user = await appUsers.create(form);
      onAdd(user);
      setOpen(false);
      reset();
    } catch (error_) {
      setError(error_.response?.data ?? 'Failed to create user');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      closeIcon
      onClose={() => {
        setOpen(false);
        reset();
      }}
      onOpen={() => setOpen(true)}
      open={open}
      size="tiny"
      trigger={
        <Button
          className="hover-fx"
          primary
          size="small"
        >
          <Icon name="add user" />
          Add User
        </Button>
      }
    >
      <Modal.Header>Add User</Modal.Header>
      <Modal.Content>
        <Form>
          <Form.Input
            label="Username"
            onChange={(_, { value }) =>
              setForm((f) => ({ ...f, username: value }))
            }
            placeholder="Username"
            value={form.username}
          />
          <Form.Input
            label="Full Name"
            onChange={(_, { value }) =>
              setForm((f) => ({ ...f, fullName: value }))
            }
            placeholder="Optional"
            value={form.fullName}
          />
          <Form.Input
            label="Password"
            onChange={(_, { value }) =>
              setForm((f) => ({ ...f, password: value }))
            }
            placeholder="Password"
            type="password"
            value={form.password}
          />
          <Form.Field>
            <label>Role</label>
            <Dropdown
              fluid
              onChange={(_, { value }) =>
                setForm((f) => ({ ...f, role: value }))
              }
              options={ROLE_OPTIONS}
              selection
              value={form.role}
            />
          </Form.Field>
          {error && (
            <div style={{ color: 'var(--danger, #db2828)', marginTop: 8 }}>
              {error}
            </div>
          )}
        </Form>
      </Modal.Content>
      <Modal.Actions>
        <Button
          className="hover-fx"
          onClick={() => {
            setOpen(false);
            reset();
          }}
        >
          Cancel
        </Button>
        <Button
          className="hover-fx"
          loading={loading}
          onClick={handleSubmit}
          primary
        >
          Create
        </Button>
      </Modal.Actions>
    </Modal>
  );
};

const EditUserModal = ({ isSelf, onUpdate, user }) => {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState(user.username);
  const [fullName, setFullName] = useState(user.fullName ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  // sync if parent user changes (e.g. after a previous edit)
  useEffect(() => {
    if (!open) {
      setUsername(user.username);
      setFullName(user.fullName ?? '');
      setPassword('');
      setError(null);
    }
  }, [open, user]);

  const handleSubmit = async () => {
    if (!username.trim()) {
      setError('Username cannot be empty');
      return;
    }

    setLoading(true);
    try {
      let updated = { ...user };

      if (username.trim() !== user.username) {
        // returns updated user with new username
        updated = await appUsers.changeUsername(user.username, username.trim());
      }

      if ((fullName.trim() || null) !== (user.fullName ?? null)) {
        await appUsers.changeFullName(
          updated.username,
          fullName.trim() || null,
        );
        updated = { ...updated, fullName: fullName.trim() || null };
      }

      if (password) {
        await appUsers.changePassword(updated.username, password);
      }

      onUpdate(user.username, updated);
      setOpen(false);
    } catch (error_) {
      setError(error_.response?.data ?? 'Failed to save changes');
    } finally {
      setLoading(false);
    }
  };

  const hasChanges =
    username.trim() !== user.username ||
    (fullName.trim() || null) !== (user.fullName ?? null) ||
    password.length > 0;

  return (
    <Modal
      closeIcon
      onClose={() => setOpen(false)}
      onOpen={() => setOpen(true)}
      open={open}
      size="tiny"
      trigger={
        <Button
          icon
          size="small"
          title="Edit user"
        >
          <Icon name="edit" />
        </Button>
      }
    >
      <Modal.Header>Edit User — {user.username}</Modal.Header>
      <Modal.Content>
        <Form>
          <Form.Input
            label="Username"
            onChange={(_, { value }) => setUsername(value)}
            value={username}
          />
          <Form.Input
            label="Full Name"
            onChange={(_, { value }) => setFullName(value)}
            placeholder="Optional"
            value={fullName}
          />
          <Form.Input
            label="New Password"
            onChange={(_, { value }) => setPassword(value)}
            placeholder="Leave blank to keep current"
            type="password"
            value={password}
          />
          {isSelf && username.trim() !== user.username && (
            <div
              style={{
                color: 'var(--warning, #f2a60d)',
                fontSize: '0.85em',
                marginTop: 4,
              }}
            >
              Changing your username will end all your active sessions.
            </div>
          )}
          {error && (
            <div style={{ color: 'var(--danger, #db2828)', marginTop: 8 }}>
              {error}
            </div>
          )}
        </Form>
      </Modal.Content>
      <Modal.Actions>
        <Button
          className="hover-fx"
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
        <Button
          className="hover-fx"
          disabled={!hasChanges}
          loading={loading}
          onClick={handleSubmit}
          primary
        >
          Save
        </Button>
      </Modal.Actions>
    </Modal>
  );
};

const UserManagement = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const currentUsername = getUsername();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await appUsers.list();
      setUsers(data);
    } catch (error_) {
      setError(error_.response?.data ?? 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleAdd = (user) => setUsers((previous) => [...previous, user]);

  // oldUsername tracks which entry to replace (username may have changed)
  const handleUpdate = (oldUsername, updated) => {
    setUsers((previous) =>
      previous.map((u) =>
        u.username === oldUsername ? { ...u, ...updated } : u,
      ),
    );
  };

  const handleRoleChange = async (username, role) => {
    try {
      await appUsers.changeRole(username, role);
      setUsers((previous) =>
        previous.map((u) => (u.username === username ? { ...u, role } : u)),
      );
    } catch (error_) {
      alert(error_.response?.data ?? 'Failed to change role');
    }
  };

  const handleDelete = async (username) => {
    if (!window.confirm(`Delete user '${username}'? This cannot be undone.`))
      return;
    try {
      await appUsers.remove(username);
      setUsers((previous) => previous.filter((u) => u.username !== username));
    } catch (error_) {
      alert(error_.response?.data ?? 'Failed to delete user');
    }
  };

  const adminCount = users.filter((u) => u.role === 'Administrator').length;

  if (loading) return <div style={{ padding: 16 }}>Loading…</div>;
  if (error)
    return (
      <div style={{ color: 'var(--danger, #db2828)', padding: 16 }}>
        {error}
      </div>
    );

  return (
    <div style={{ padding: '0 0 24px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <Header
          as="h4"
          style={{ margin: 0 }}
        >
          Users
        </Header>
        <AddUserModal onAdd={handleAdd} />
      </div>

      <Table
        basic="very"
        size="small"
      >
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>Username</Table.HeaderCell>
            <Table.HeaderCell>Role</Table.HeaderCell>
            <Table.HeaderCell>Created</Table.HeaderCell>
            <Table.HeaderCell />
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {users.map((u) => {
            const isSelf = u.username === currentUsername;
            const isLastAdmin = u.role === 'Administrator' && adminCount <= 1;
            const canDelete = !isSelf && !isLastAdmin;

            return (
              <Table.Row key={u.username}>
                <Table.Cell>
                  <div>
                    {u.username}
                    {isSelf && (
                      <Label
                        horizontal
                        size="mini"
                        style={{ marginLeft: 6 }}
                      >
                        you
                      </Label>
                    )}
                  </div>
                  {u.fullName && (
                    <div
                      style={{
                        color: 'var(--text-secondary)',
                        fontSize: '0.82em',
                        marginTop: 2,
                      }}
                    >
                      {u.fullName}
                    </div>
                  )}
                </Table.Cell>
                <Table.Cell>
                  <Dropdown
                    compact
                    disabled={isSelf || isLastAdmin}
                    onChange={(_, { value }) =>
                      handleRoleChange(u.username, value)
                    }
                    options={ROLE_OPTIONS}
                    selection
                    title={
                      isLastAdmin ? 'Cannot demote the last admin' : undefined
                    }
                    value={u.role}
                  />
                </Table.Cell>
                <Table.Cell
                  style={{ color: 'var(--text-secondary)', fontSize: '0.85em' }}
                >
                  {parseUtcDate(u.createdAt).toLocaleDateString()}
                </Table.Cell>
                <Table.Cell textAlign="right">
                  <EditUserModal
                    isSelf={isSelf}
                    onUpdate={handleUpdate}
                    user={u}
                  />{' '}
                  <Button
                    disabled={!canDelete}
                    icon
                    negative={canDelete}
                    onClick={() => handleDelete(u.username)}
                    size="small"
                    title={
                      isSelf
                        ? 'Cannot delete yourself'
                        : isLastAdmin
                          ? 'Cannot delete the last admin'
                          : 'Delete user'
                    }
                  >
                    <Icon name="trash" />
                  </Button>
                </Table.Cell>
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table>
    </div>
  );
};

export default UserManagement;
