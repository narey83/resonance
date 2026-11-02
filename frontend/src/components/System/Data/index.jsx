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

import { toast } from '../../../lib/activityNotices';
import { clearCompleted } from '../../../lib/transfers';
import React, { useState } from 'react';
import { Button, Divider, Header, Icon } from 'semantic-ui-react';

const clear = async ({ direction, setState }) => {
  setState(true);
  await clearCompleted({ direction });
  setState(false);
  toast.success(`Completed ${direction}s cleared!`);
};

const Data = () => {
  const [up, setUp] = useState(false);
  const [down, setDown] = useState(false);

  return (
    <div>
      <Header
        as="h3"
        className="transfer-header"
      >
        Transfer Data
      </Header>
      <Divider />
      <p>
        <span>
          The Uploads and Downloads pages can become unresponsive if too many
          transfers are displayed. If you're having trouble with either page,
          try using the buttons below to remove completed transfers.
        </span>
      </p>
      <Button
        className="hover-fx"
        loading={up}
        onClick={() => clear({ direction: 'upload', setState: setUp })}
        primary
      >
        <Icon name="trash alternate" />
        Clear All Completed Uploads
      </Button>
      <Button
        className="hover-fx"
        loading={down}
        onClick={() => clear({ direction: 'download', setState: setDown })}
        primary
      >
        <Icon name="trash alternate" />
        Clear All Completed Downloads
      </Button>
    </div>
  );
};

export default Data;
