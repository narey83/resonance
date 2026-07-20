// <copyright file="searchRelevance.js" company="John Narey">
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

// Soulseek matches search terms against the *whole* path (every folder + the
// filename), as independent words in any order. So "John Narey" also returns
// any "John …" file that lives under a folder named "narey". These helpers let
// the client float true phrase/filename matches to the top (relevance ranking)
// and, optionally, hard-filter to results whose *filename* contains every term.

// Split a raw query into lowercase word tokens, stripping edge punctuation.
export const parseQueryTerms = (query) =>
  (query ?? '')
    .split(/\s+/u)
    .map((t) =>
      t.replaceAll(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase(),
    )
    .filter(Boolean);

// Last path segment (filename) of a Soulseek path, lowercased.
const basename = (path) =>
  path.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ?? path;

// Relevance score for a single result path against the query terms. Higher is
// more relevant. Rewards, in order: the full phrase in the filename, the phrase
// anywhere in the path, terms in the filename, terms anywhere in the path.
export const scoreFilename = (terms, path) => {
  if (terms.length === 0) return 0;
  const full = path.replaceAll('\\', '/').toLowerCase();
  const base = basename(full);
  const phrase = terms.join(' ');
  let score = 0;
  if (base.includes(phrase)) score += 1_000;
  else if (full.includes(phrase)) score += 400;
  for (const t of terms) {
    if (base.includes(t)) score += 100;
    else if (full.includes(t)) score += 10;
  }

  return score;
};

// True when every query term appears in the filename (not just a parent folder).
export const basenameHasAllTerms = (terms, path) => {
  if (terms.length === 0) return true;
  const base = basename(path.replaceAll('\\', '/').toLowerCase());
  return terms.every((t) => base.includes(t));
};
