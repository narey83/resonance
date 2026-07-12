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
  blockIp,
  blockPlace,
  blockUser,
  fetchBlockedUsers,
  fetchKnownLocations,
  setBlockedUserOptions,
  unblockIp,
  unblockPlace,
  unblockUser,
  useBlockedUsers,
} from '../../../lib/blockedUsers';
import { parseUtcDate } from '../../../lib/util';
import AppContext from '../../AppContext';
import React, { useContext, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  Dropdown,
  Form,
  Header,
  Icon,
  Label,
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
  {
    description:
      'Learn the IPs blocked users connect from, auto-block new usernames appearing from those IPs, and alert you when it happens',
    key: 'blockSameIp',
    label: 'Catch ban evasion (same IP)',
  },
];

const BlockedUsers = () => {
  const { isAdmin } = useContext(AppContext);
  const { geoAvailable, ips, options, places, users } = useBlockedUsers();

  const [username, setUsername] = useState('');
  const [reason, setReason] = useState('');
  const [cidr, setCidr] = useState('');
  const [cidrReason, setCidrReason] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [placeReason, setPlaceReason] = useState('');
  const [locations, setLocations] = useState({
    citiesByCountry: {},
    countries: [],
  });
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchBlockedUsers().catch(() => {});
    fetchKnownLocations()
      .then(setLocations)
      .catch(() => {});
  }, []);

  // Country/city options come from real observed peer locations (MaxMind); both allow
  // typing a value that hasn't been seen yet.
  const countryOptions = useMemo(
    () => locations.countries.map((c) => ({ key: c, text: c, value: c })),
    [locations.countries],
  );

  const cityOptions = useMemo(
    () =>
      (locations.citiesByCountry[country] ?? []).map((c) => ({
        key: c,
        text: c,
        value: c,
      })),
    [locations.citiesByCountry, country],
  );

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

  const handleBlockIp = async () => {
    if (!cidr.trim()) return;

    setWorking(true);
    setError(null);
    try {
      await blockIp(cidr.trim(), cidrReason.trim() || undefined);
      setCidr('');
      setCidrReason('');
    } catch (error_) {
      setError(error_.response?.data ?? 'Failed to block IP');
    } finally {
      setWorking(false);
    }
  };

  const handleUnblockIp = async (value) => {
    setError(null);
    try {
      await unblockIp(value);
    } catch (error_) {
      setError(error_.response?.data ?? 'Failed to unblock IP');
    }
  };

  const handleBlockPlace = async () => {
    if (!country.trim()) return;

    setWorking(true);
    setError(null);
    try {
      await blockPlace(
        country.trim(),
        city.trim() || undefined,
        placeReason.trim() || undefined,
      );
      setCountry('');
      setCity('');
      setPlaceReason('');
    } catch (error_) {
      setError(error_.response?.data ?? 'Failed to block location');
    } finally {
      setWorking(false);
    }
  };

  const handleUnblockPlace = async (id) => {
    setError(null);
    try {
      await unblockPlace(id);
    } catch (error_) {
      setError(error_.response?.data ?? 'Failed to unblock location');
    }
  };

  return (
    <div className="blocked-admin">
      <Header size="small">
        <Icon name="ban" />
        Blocked Users
        {users.length > 0 && (
          <Label circular>{users.length}</Label>
        )}
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

        <div className="blocked-scroll">
          <Table
            basic="very"
            compact
          >
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Username</Table.HeaderCell>
                <Table.HeaderCell>Known IPs</Table.HeaderCell>
                <Table.HeaderCell>Location</Table.HeaderCell>
                <Table.HeaderCell>Blocked</Table.HeaderCell>
                <Table.HeaderCell>Reason</Table.HeaderCell>
                <Table.HeaderCell textAlign="right" />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {users.length === 0 && (
                <Table.Row>
                  <Table.Cell
                    colSpan={6}
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
                    {user.ips?.length ? (
                      user.ips.map((ip) => (
                        <Label
                          key={ip}
                          onClick={() => blockIp(ip).catch(() => {})}
                          size="tiny"
                          style={{ cursor: 'pointer', marginBottom: 2 }}
                          title="Block this IP"
                        >
                          {ip}
                        </Label>
                      ))
                    ) : (
                      <span style={{ opacity: 0.4 }}>—</span>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    {user.city || user.country ? (
                      [user.city, user.country].filter(Boolean).join(', ')
                    ) : (
                      <span style={{ opacity: 0.4 }}>—</span>
                    )}
                  </Table.Cell>
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
        </div>
      </Segment>

      <Header size="small">
        <Icon name="shield" />
        Blocked IPs
        {ips.length > 0 && <Label circular>{ips.length}</Label>}
      </Header>
      <Segment>
        <Form onSubmit={handleBlockIp}>
          <Form.Group>
            <Form.Input
              onChange={(_, { value }) => setCidr(value)}
              placeholder="IP or CIDR (e.g. 1.2.3.4 or 1.2.3.0/24)"
              value={cidr}
              width={4}
            />
            <Form.Input
              onChange={(_, { value }) => setCidrReason(value)}
              placeholder="Reason (optional)"
              value={cidrReason}
              width={8}
            />
            <Form.Button
              disabled={!cidr.trim() || working}
              loading={working}
              negative
            >
              <Icon name="ban" />
              Block IP
            </Form.Button>
          </Form.Group>
        </Form>

        <Table
          basic="very"
          compact
        >
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>IP / Range</Table.HeaderCell>
              <Table.HeaderCell>Blocked</Table.HeaderCell>
              <Table.HeaderCell>Reason</Table.HeaderCell>
              <Table.HeaderCell textAlign="right" />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {ips.length === 0 && (
              <Table.Row>
                <Table.Cell
                  colSpan={4}
                  textAlign="center"
                >
                  No blocked IPs
                </Table.Cell>
              </Table.Row>
            )}
            {ips.map((ip) => (
              <Table.Row key={ip.cidr}>
                <Table.Cell>{ip.cidr}</Table.Cell>
                <Table.Cell>
                  {parseUtcDate(ip.blockedAt)?.toLocaleString()}
                </Table.Cell>
                <Table.Cell>{ip.reason}</Table.Cell>
                <Table.Cell textAlign="right">
                  <Button
                    className="hover-fx"
                    onClick={() => handleUnblockIp(ip.cidr)}
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

      <Header size="small">
        <Icon name="globe" />
        Blocked Locations
        {places.length > 0 && (
          <Label circular>{places.length}</Label>
        )}
      </Header>
      <Segment>
        {!geoAvailable && (
          <Message warning>
            The geo database (GeoLite2-City.mmdb) is not loaded, so location
            rules have no effect.
          </Message>
        )}
        <p style={{ opacity: 0.7 }}>
          Country accepts a name or two-letter code (e.g. &quot;Germany&quot; or
          &quot;DE&quot;); add a city to narrow the rule. IPs the geo database
          has no country or city for never match a location rule.
        </p>
        <Form onSubmit={handleBlockPlace}>
          <Form.Group>
            <Form.Field width={3}>
              <Dropdown
                allowAdditions
                clearable
                fluid
                onAddItem={(_, { value }) => setCountry(value)}
                onChange={(_, { value }) => {
                  setCountry(value);
                  setCity('');
                }}
                options={countryOptions}
                placeholder="Country"
                search
                selection
                value={country}
              />
            </Form.Field>
            <Form.Field width={3}>
              <Dropdown
                allowAdditions
                clearable
                disabled={!country}
                fluid
                onAddItem={(_, { value }) => setCity(value)}
                onChange={(_, { value }) => setCity(value)}
                options={cityOptions}
                placeholder="City (optional)"
                search
                selection
                value={city}
              />
            </Form.Field>
            <Form.Input
              onChange={(_, { value }) => setPlaceReason(value)}
              placeholder="Reason (optional)"
              value={placeReason}
              width={6}
            />
            <Form.Button
              disabled={!country || working}
              loading={working}
              negative
            >
              <Icon name="ban" />
              Block Location
            </Form.Button>
          </Form.Group>
        </Form>

        <Table
          basic="very"
          compact
        >
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Country</Table.HeaderCell>
              <Table.HeaderCell>City</Table.HeaderCell>
              <Table.HeaderCell>Blocked</Table.HeaderCell>
              <Table.HeaderCell>Reason</Table.HeaderCell>
              <Table.HeaderCell textAlign="right" />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {places.length === 0 && (
              <Table.Row>
                <Table.Cell
                  colSpan={5}
                  textAlign="center"
                >
                  No blocked locations
                </Table.Cell>
              </Table.Row>
            )}
            {places.map((place) => (
              <Table.Row key={place.id}>
                <Table.Cell>{place.country}</Table.Cell>
                <Table.Cell>{place.city ?? 'Any'}</Table.Cell>
                <Table.Cell>
                  {parseUtcDate(place.blockedAt)?.toLocaleString()}
                </Table.Cell>
                <Table.Cell>{place.reason}</Table.Cell>
                <Table.Cell textAlign="right">
                  <Button
                    className="hover-fx"
                    onClick={() => handleUnblockPlace(place.id)}
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
