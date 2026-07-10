// <copyright file="index.jsx" company="John Narey">
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

import {
  blockUser,
  fetchBlockedUsers,
  setBlockedUserOptions,
  unblockUser,
  useBlockedUsers,
} from '../../../lib/blockedUsers';
import { parseUtcDate } from '../../../lib/util';
import AppContext from '../../AppContext';
import React, { useContext, useEffect, useState } from 'react';
import {
  Button,
  Checkbox,
  Form,
  Header,
  Icon,
  Message,
  Segment,
  Table,
} from 'semantic-ui-react';

const OPTION_FIELDS = [
  {
    description: 'Reject file transfers to and from blocked users',
    key: 'blockTransfers',
    label: 'Block transfers',
  },
  {
    description:
      'Return an empty listing when blocked users browse your shares',
    key: 'blockBrowse',
    label: 'Block browsing',
  },
  {
    description: 'Ignore search requests from blocked users',
    key: 'blockSearchResponses',
    label: "Don't answer their searches",
  },
  {
    description: 'Drop private messages to and from blocked users',
    key: 'blockPrivateMessages',
    label: 'Block private messages',
  },
  {
    description: 'Hide chat room messages from blocked users',
    key: 'hideRoomMessages',
    label: 'Hide room messages',
  },
  {
    description: 'Drop results from blocked users out of your searches',
    key: 'hideSearchResults',
    label: 'Hide their search results',
  },
];

const BlockedUsers = () => {
  const { isAdmin } = useContext(AppContext);
  const { options, users } = useBlockedUsers();

  const [username, setUsername] = useState('');
  const [reason, setReason] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchBlockedUsers().catch(() => {});
  }, []);

  const handleBlock = async () => {
    if (!username.trim()) return;

    setWorking(true);
    setError(null);
    try {
      await blockUser(username.trim(), reason.trim() || undefined);
      setUsername('');
      setReason('');
    } catch (error_) {
      setError(error_.response?.data ?? 'Failed to block user');
    } finally {
      setWorking(false);
    }
  };

  const handleUnblock = async (name) => {
    setError(null);
    try {
      await unblockUser(name);
    } catch (error_) {
      setError(error_.response?.data ?? 'Failed to unblock user');
    }
  };

  const handleOptionToggle = async (key) => {
    setError(null);
    try {
      await setBlockedUserOptions({ ...options, [key]: !options[key] });
    } catch (error_) {
      setError(error_.response?.data ?? 'Failed to update options');
    }
  };

  return (
    <div>
      <Header size="small">
        <Icon name="ban" />
        Blocked Users
      </Header>
      <p>
        Blocked users can&apos;t interact with this server. Use the toggles to
        choose exactly which interactions are blocked; block or unblock users
        here or with the{' '}
        <Icon
          name="ban"
          size="small"
        />{' '}
        icon beside any username.
      </p>

      {error && <Message negative>{String(error)}</Message>}

      <Segment>
        <Form onSubmit={handleBlock}>
          <Form.Group>
            <Form.Input
              onChange={(_, { value }) => setUsername(value)}
              placeholder="Username"
              value={username}
              width={4}
            />
            <Form.Input
              onChange={(_, { value }) => setReason(value)}
              placeholder="Reason (optional)"
              value={reason}
              width={8}
            />
            <Form.Button
              disabled={!username.trim() || working}
              loading={working}
              negative
            >
              <Icon name="ban" />
              Block
            </Form.Button>
          </Form.Group>
        </Form>

        <Table
          basic="very"
          compact
        >
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Username</Table.HeaderCell>
              <Table.HeaderCell>Blocked</Table.HeaderCell>
              <Table.HeaderCell>Reason</Table.HeaderCell>
              <Table.HeaderCell textAlign="right" />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {users.length === 0 && (
              <Table.Row>
                <Table.Cell
                  colSpan={4}
                  textAlign="center"
                >
                  No blocked users
                </Table.Cell>
              </Table.Row>
            )}
            {users.map((user) => (
              <Table.Row key={user.username}>
                <Table.Cell>{user.username}</Table.Cell>
                <Table.Cell>
                  {parseUtcDate(user.blockedAt)?.toLocaleString()}
                </Table.Cell>
                <Table.Cell>{user.reason}</Table.Cell>
                <Table.Cell textAlign="right">
                  <Button
                    className="hover-fx"
                    onClick={() => handleUnblock(user.username)}
                    size="mini"
                  >
                    Unblock
                  </Button>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </Segment>

      <Header size="small">Blocking Options</Header>
      <Segment>
        {!isAdmin && (
          <Message info>
            Only administrators can change blocking options.
          </Message>
        )}
        {OPTION_FIELDS.map(({ description, key, label }) => (
          <div
            key={key}
            style={{ marginBottom: '0.75em' }}
          >
            <Checkbox
              checked={Boolean(options[key])}
              disabled={!isAdmin}
              label={label}
              onChange={() => handleOptionToggle(key)}
              toggle
            />
            <div style={{ marginLeft: '4.5em', opacity: 0.6 }}>
              {description}
            </div>
          </div>
        ))}
      </Segment>
    </div>
  );
};

export default BlockedUsers;
