// <copyright file="DistributedNetworkConfirmModal.jsx" company="John Narey">
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

// Asks for confirmation before saving a change to the distributed network
// options, spelling out what each change does to the instance. These settings
// are easy to flip and the damage is silent: with the network disabled, other
// users' searches stop reaching us, so upload traffic quietly drains away over
// the following hours with nothing in the UI to connect it back to the toggle.

import React from 'react';
import { Button, Icon, Modal } from 'semantic-ui-react';

const DEFAULTS = { child_limit: 25, disable_children: false, disabled: false };

// settings round-trip through string storage, so accept quoted scalars too
const valueOf = (network, key) => {
  const value = network?.[key] ?? DEFAULTS[key];
  if (typeof DEFAULTS[key] === 'boolean') return String(value) === 'true';
  return Number(value);
};

// Returns the distributed network options that differ between two parsed
// option documents, as [{ key, from, to }].
export const getDistributedNetworkChanges = (before, after) => {
  const from = before?.soulseek?.distributed_network;
  const to = after?.soulseek?.distributed_network;

  return Object.keys(DEFAULTS)
    .map((key) => ({ from: valueOf(from, key), key, to: valueOf(to, key) }))
    .filter((change) => change.from !== change.to);
};

const describe = ({ from, key, to }, after) => {
  const network = after?.soulseek?.distributed_network;

  if (key === 'disabled' && to) {
    return {
      detail: (
        <>
          <p>
            Most Soulseek searches travel through the distributed network: the
            server hands each search to a few clients, and they pass it down to
            everyone else. With the network off, other users&apos; searches
            mostly stop reaching this instance, so your shared files drop out of
            their search results.
          </p>
          <p>
            Expect upload traffic to fall sharply over the next few hours. Only
            people who already know your username, browse you directly, or
            search a room you&apos;re in will still find your files. You also
            stop relaying searches for other peers.
          </p>
        </>
      ),
      title: 'Turn off the distributed network',
      tone: 'warning',
    };
  }

  if (key === 'disabled') {
    return {
      detail: (
        <p>
          This instance will rejoin the search network and start receiving other
          users&apos; searches, so your shared files show up in their results
          again. Upload traffic usually climbs over the next few hours as peers
          find you. Answering and relaying searches uses a little bandwidth and
          CPU.
        </p>
      ),
      title: 'Turn on the distributed network',
      tone: 'positive',
    };
  }

  if (key === 'disable_children' && to) {
    return {
      detail: (
        <p>
          You&apos;ll still receive searches, so people can still find your
          files. You just stop passing searches on to peers below you. This
          saves a little bandwidth and CPU but gives less back to the network.
        </p>
      ),
      title: 'Stop relaying searches to other peers',
      tone: 'neutral',
    };
  }

  if (key === 'disable_children') {
    return {
      detail: (
        <p>
          You&apos;ll pass the searches you receive on to up to{' '}
          {valueOf(network, 'child_limit')} peers below you. This uses some
          upload bandwidth and CPU. It doesn&apos;t change how many people find
          your own files.
        </p>
      ),
      title: 'Relay searches to other peers',
      tone: 'neutral',
    };
  }

  return {
    detail: (
      <p>
        Every peer below you receives every search you do, so a higher limit
        uses more upload bandwidth and CPU and a lower one uses less. It
        doesn&apos;t change how many people find your own files.
        {valueOf(network, 'disable_children') &&
          ' Relaying is currently turned off, so this has no effect until you turn it back on.'}
      </p>
    ),
    title: `Change the child limit from ${from} to ${to}`,
    tone: 'neutral',
  };
};

const TONE_ICONS = {
  neutral: 'info circle',
  positive: 'check circle',
  warning: 'warning sign',
};

const DistributedNetworkConfirmModal = ({
  after,
  changes,
  onCancel,
  onConfirm,
  open,
}) => {
  const described = changes.map((change) => ({
    ...describe(change, after),
    key: change.key,
  }));
  const isRisky = described.some((item) => item.tone === 'warning');

  return (
    <Modal
      onClose={onCancel}
      open={open}
      size="small"
    >
      <Modal.Header>
        <Icon name="sitemap" />
        Distributed network changes
      </Modal.Header>
      <Modal.Content>
        <div className="dnet-confirm">
          {described.map((item) => (
            <div
              className={`dnet-confirm-item dnet-confirm-item--${item.tone}`}
              key={item.key}
            >
              <div className="dnet-confirm-title">
                <Icon name={TONE_ICONS[item.tone]} />
                {item.title}
              </div>
              <div className="dnet-confirm-detail">{item.detail}</div>
            </div>
          ))}
        </div>
      </Modal.Content>
      <Modal.Actions>
        <Button
          className="hover-fx"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          className="hover-fx"
          negative={isRisky}
          onClick={onConfirm}
          primary={!isRisky}
        >
          {isRisky ? 'Turn it off and save' : 'Save changes'}
        </Button>
      </Modal.Actions>
    </Modal>
  );
};

export default DistributedNetworkConfirmModal;
