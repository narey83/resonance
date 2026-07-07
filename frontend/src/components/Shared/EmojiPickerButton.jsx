// <copyright file="EmojiPickerButton.jsx" company="John Narey">
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

import './EmojiPickerButton.css';
import * as prefs from '../../lib/prefs';
import EmojiPicker, { Theme } from 'emoji-picker-react';
import { Smile } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';

const resolveTheme = () => {
  const saved = prefs.get('resonance-theme', null);
  const isDark =
    saved === null
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : saved !== 'light';
  return isDark ? Theme.DARK : Theme.LIGHT;
};

// Button + popover emoji picker. Calling `onSelect` with the chosen emoji
// character is the caller's responsibility for inserting/appending it.
const EmojiPickerButton = ({ className, onSelect }) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const onDocumentClick = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onDocumentClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocumentClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const handleEmojiClick = useCallback(
    (emojiData) => {
      onSelect(emojiData.emoji);
      setOpen(false);
    },
    [onSelect],
  );

  return (
    <div
      className={`emoji-picker-anchor${className ? ` ${className}` : ''}`}
      ref={containerRef}
    >
      <button
        className="emoji-picker-toggle hover-fx"
        onClick={() => setOpen((previous) => !previous)}
        title="Emoji"
        type="button"
      >
        <Smile
          size={18}
          strokeWidth={2}
        />
      </button>
      {open && (
        <div className="emoji-picker-popover">
          <EmojiPicker
            autoFocusSearch={false}
            lazyLoadEmojis
            onEmojiClick={handleEmojiClick}
            skinTonesDisabled
            theme={resolveTheme()}
          />
        </div>
      )}
    </div>
  );
};

export default EmojiPickerButton;
