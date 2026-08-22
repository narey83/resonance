// <copyright file="Linkify.tsx" company="John Narey">
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

import React from 'react';
import { Linking, Text } from 'react-native';

const URL_PATTERN = /https?:\/\/[^\s"')<>\]]+/gi;

// Trailing punctuation (a period ending the sentence, a closing paren that
// wasn't part of the URL, …) reads as part of the match but isn't part of
// the link, so it's peeled off and put back as plain text.
const stripTrailingPunctuation = (url: string) => url.replace(/[!),.:;?\]]+$/, '');

export function findFirstUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(URL_PATTERN);
  return match ? stripTrailingPunctuation(match[0]) : null;
}

type Segment = string | { url: string };

function linkifyParts(text: string): Segment[] {
  const parts: Segment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const raw = match[0];
    const url = stripTrailingPunctuation(raw);
    const trailing = raw.slice(url.length);

    if (match.index! > lastIndex) parts.push(text.slice(lastIndex, match.index));
    parts.push({ url });
    if (trailing) parts.push(trailing);
    lastIndex = match.index! + raw.length;
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));

  return parts.length > 0 ? parts : [text];
}

// Renders message text with any http(s) URLs turned into tappable inline
// links, via React Native's nested-<Text> support — no separate view, no
// layout change, and it inherits the wrapping <Text>'s own style.
export default function Linkify({ text }: { text: string }) {
  return (
    <>
      {linkifyParts(text).map((part, index) =>
        typeof part === 'string' ? (
          <Text key={index}>{part}</Text>
        ) : (
          <Text
            key={index}
            onPress={() => Linking.openURL(part.url)}
            style={{ textDecorationLine: 'underline' }}
          >
            {part.url}
          </Text>
        ),
      )}
    </>
  );
}
