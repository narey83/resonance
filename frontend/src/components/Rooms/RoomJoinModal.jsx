// <copyright file="RoomJoinModal.jsx" company="JP Dillingham">
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

import './Rooms.css';
import * as rooms from '../../lib/rooms';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Dimmer,
  Header,
  Icon,
  Input,
  Loader,
  Modal,
  Table,
} from 'semantic-ui-react';

const RoomJoinModal = ({ joinRoom: parentJoinRoom, ...modalOptions }) => {
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState([]);
  const [selected, setSelected] = useState(undefined);
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState('desc');
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const getAvailableRooms = async () => {
      setLoading(true);
      try {
        setAvailable(await rooms.getAvailable());
      } catch (error) {
        // Without this the rejection went unhandled and the spinner span forever;
        // an empty list at least lets the modal render and be closed.
        console.debug('failed to fetch available rooms', error);
        setAvailable([]);
      } finally {
        setLoading(false);
      }
    };

    if (open) getAvailableRooms();
  }, [open]);

  const sortedAvailable = useMemo(() => {
    const sorted = [...available].filter((room) =>
      room.name.toLowerCase().includes(filter.toLowerCase()),
    );

    sorted.sort((a, b) => {
      if (sortOrder === 'asc') {
        if (typeof a[sortBy] === 'string') {
          return b[sortBy].localeCompare(a[sortBy]);
        }

        return a[sortBy] - b[sortBy];
      }

      if (typeof a[sortBy] === 'string') {
        return a[sortBy].localeCompare(b[sortBy]);
      }

      return b[sortBy] - a[sortBy];
    });

    return sorted;
  }, [available, filter, sortBy, sortOrder]);

  const close = () => {
    setAvailable([]);
    setSelected(undefined);
    setSortBy('name');
    setSortOrder('desc');
    setFilter('');
    setOpen(false);
  };

  const joinRoom = async () => {
    await parentJoinRoom(selected);
    close();
  };

  const isSelected = (room) => selected === room.name;

  return (
    <Modal
      className="join-room-modal"
      onClose={() => close()}
      onOpen={() => setOpen(true)}
      open={open}
      {...modalOptions}
    >
      <Header>
        <Icon name="comments" />
        <Modal.Content>Join Room</Modal.Content>
      </Header>
      <Modal.Content scrolling>
        {loading ? (
          <Dimmer
            active
            inverted
          >
            <Loader
              content="Loading Room List"
              inverted
            />
          </Dimmer>
        ) : (
          <>
            <Input
              fluid
              icon="filter"
              onChange={(_, event) => setFilter(event.value)}
              placeholder="Room Filter"
            />
            <Table
              celled
              selectable
            >
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell onClick={() => setSortBy('name')}>
                    Name
                    <Icon
                      link={sortBy === 'name'}
                      name={
                        sortBy === 'name' &&
                        (sortOrder === 'asc' ? 'chevron up' : 'chevron down')
                      }
                      onClick={() =>
                        setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
                      }
                    />
                  </Table.HeaderCell>
                  <Table.HeaderCell onClick={() => setSortBy('userCount')}>
                    Users
                    <Icon
                      link={sortBy === 'userCount'}
                      name={
                        sortBy === 'userCount' &&
                        (sortOrder === 'asc' ? 'chevron up' : 'chevron down')
                      }
                      onClick={() =>
                        setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
                      }
                    />
                  </Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {sortedAvailable.map((room) => (
                  <Table.Row
                    key={room.name}
                    onClick={() => setSelected(room.name)}
                    style={isSelected(room) ? { fontWeight: 'bold' } : {}}
                  >
                    <Table.Cell>
                      {isSelected(room) && (
                        <Icon
                          color="green"
                          name="check"
                        />
                      )}
                      {room.isPrivate && <Icon name="lock" />}
                      {room.isOwned && <Icon name="chess queen" />}
                      {room.isModerated && <Icon name="gavel" />}
                      {room.name}
                    </Table.Cell>
                    <Table.Cell>{room.userCount}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </>
        )}
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
          disabled={!selected}
          onClick={() => joinRoom()}
          positive
        >
          Join
        </Button>
      </Modal.Actions>
    </Modal>
  );
};

export default RoomJoinModal;
