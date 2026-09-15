// <copyright file="DistributedNetworkConfirmModal.test.js" company="John Narey">
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

import { getDistributedNetworkChanges } from './DistributedNetworkConfirmModal';

const withNetwork = (distributedNetwork) => ({
  soulseek: { distributed_network: distributedNetwork },
});

describe('getDistributedNetworkChanges', () => {
  it('reports nothing when the network options are untouched', () => {
    const before = withNetwork({ child_limit: 25, disabled: false });

    expect(getDistributedNetworkChanges(before, before)).toEqual([]);
  });

  it('treats a missing option as its default', () => {
    expect(
      getDistributedNetworkChanges({}, withNetwork({ disabled: false })),
    ).toEqual([]);
  });

  it('reports disabling the network', () => {
    expect(
      getDistributedNetworkChanges(
        withNetwork({ disabled: false }),
        withNetwork({ disabled: true }),
      ),
    ).toEqual([{ from: false, key: 'disabled', to: true }]);
  });

  it('reports every option that changed', () => {
    expect(
      getDistributedNetworkChanges(
        {},
        withNetwork({ child_limit: 10, disable_children: true }),
      ),
    ).toEqual([
      { from: 25, key: 'child_limit', to: 10 },
      { from: false, key: 'disable_children', to: true },
    ]);
  });

  it('ignores changes elsewhere in the document', () => {
    expect(
      getDistributedNetworkChanges(
        { soulseek: { listen_port: 50_300 } },
        { soulseek: { listen_port: 50_301 } },
      ),
    ).toEqual([]);
  });
});
