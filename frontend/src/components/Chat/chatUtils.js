// <copyright file="chatUtils.js" company="John Narey">
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

import { parseUtcDate } from '../../lib/util';

const AVATAR_COLORS = [
  '#5c6bc0',
  '#26a69a',
  '#ef5350',
  '#42a5f5',
  '#ab47bc',
  '#66bb6a',
  '#e67e22',
  '#29b6f6',
  '#ec407a',
  '#8d6e63',
];

export const avatarColor = (username = '') => {
  let hash = 0;
  for (const char of username) hash = (char.codePointAt(0) ?? 0) + hash * 31;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
};

export const avatarInitial = (username = '') =>
  (username[0] || '?').toUpperCase();

export const formatTime = (timestamp) =>
  parseUtcDate(timestamp).toLocaleTimeString('en', {
    hour: 'numeric',
    minute: '2-digit',
  });

export const formatDateLabel = (timestamp) => {
  const date = parseUtcDate(timestamp);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(Number(today) - 86_400_000);
  const messageDay = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  if (Number(messageDay) === Number(today)) return 'Today';
  if (Number(messageDay) === Number(yesterday)) return 'Yesterday';
  return date.toLocaleDateString('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const URL_PATTERN = /https?:\/\/[^\s"')<>\]]+/gi;

// Trailing punctuation (a period ending the sentence, a closing paren that
// wasn't part of the URL, …) reads as part of the match but isn't part of
// the link, so it's peeled off and put back as plain text.
const stripTrailingPunctuation = (url) => url.replace(/[!),.:;?\]]+$/, '');

export const findFirstUrl = (text) => {
  if (!text) return null;
  const match = text.match(URL_PATTERN);
  return match ? stripTrailingPunctuation(match[0]) : null;
};

// Splits message text into a mix of plain strings and `{ url }` segments, so
// the caller can render each URL as a link without touching the rest of the
// text (and without ever passing raw text through dangerouslySetInnerHTML).
export const linkifyText = (text) => {
  if (!text) return [text];

  const parts = [];
  let lastIndex = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const raw = match[0];
    const url = stripTrailingPunctuation(raw);
    const trailing = raw.slice(url.length);

    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    parts.push({ url });
    if (trailing) parts.push(trailing);
    lastIndex = match.index + raw.length;
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));

  return parts.length > 0 ? parts : [text];
};

export const groupByDate = (messages) => {
  const groups = [];
  let currentLabel = null;
  for (const message of messages) {
    const label = formatDateLabel(message.timestamp);
    if (label !== currentLabel) {
      currentLabel = label;
      groups.push({ label, messages: [] });
    }

    groups[groups.length - 1].messages.push(message);
  }

  return groups;
};
