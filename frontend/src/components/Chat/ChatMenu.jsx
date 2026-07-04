// <copyright file="ChatMenu.jsx" company="JP Dillingham">
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

import './Chat.css';
import SendMessageModal from './SendMessageModal';
import React from 'react';
import { Button, Icon, Label, Menu } from 'semantic-ui-react';

const ChatMenu = ({ active, conversations, onConversationChange, ...rest }) => {
  const names = Object.keys(conversations);
  const isActive = (name) => active === name;

  return (
    <Menu
      className="conversation-menu"
      size="large"
    >
      {names.map((name) => (
        <Menu.Item
          active={isActive(name)}
          className={`menu-item ${isActive(name) ? 'menu-active' : ''}`}
          key={name}
          name={name}
          onClick={() => onConversationChange(name)}
        >
          <Icon
            color="green"
            name="circle"
            size="tiny"
          />
          {name}
          {conversations[name].hasUnAcknowledgedMessages && (
            <Label
              color="red"
              size="tiny"
            >
              {conversations[name].unAcknowledgedMessageCount}
            </Label>
          )}
        </Menu.Item>
      ))}
      <Menu.Menu position="right">
        <SendMessageModal
          centered
          size="small"
          trigger={
            <Button
              className="add-button hover-fx"
              icon
            >
              <Icon name="plus" />
            </Button>
          }
          {...rest}
        />
      </Menu.Menu>
    </Menu>
  );
};

export default ChatMenu;
