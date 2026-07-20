// <copyright file="translation.ts" company="John Narey">
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

import { apiClient } from './client';

export interface TranslationStatus {
  enabled: boolean;
  defaultTargetLanguage: string;
}

export interface TranslationItem {
  text: string;
  detectedSourceLanguage: string;
}

interface TranslateResponse {
  targetLanguage: string;
  translations: TranslationItem[];
}

const LANGUAGE_NAMES: Record<string, string> = {
  AR: 'Arabic', BG: 'Bulgarian', CS: 'Czech', DA: 'Danish', DE: 'German',
  EL: 'Greek', EN: 'English', ES: 'Spanish', ET: 'Estonian', FI: 'Finnish',
  FR: 'French', HU: 'Hungarian', ID: 'Indonesian', IT: 'Italian', JA: 'Japanese',
  KO: 'Korean', LT: 'Lithuanian', LV: 'Latvian', NB: 'Norwegian', NL: 'Dutch',
  PL: 'Polish', PT: 'Portuguese', RO: 'Romanian', RU: 'Russian', SK: 'Slovak',
  SL: 'Slovenian', SV: 'Swedish', TR: 'Turkish', UK: 'Ukrainian', ZH: 'Chinese',
};

export const languageName = (code?: string): string => {
  if (!code) return '';
  const upper = code.toUpperCase();
  // DeepL returns e.g. EN-GB / PT-BR for some source detections; match the base.
  return LANGUAGE_NAMES[upper] ?? LANGUAGE_NAMES[upper.split('-')[0]] ?? upper;
};

// Translation is deterministic and messages are re-fetched on refresh/poll, so a
// process-lifetime cache keyed by target+text keeps us off the network and off the
// DeepL character quota for anything already translated.
const cache = new Map<string, TranslationItem>();
const cacheKey = (target: string, text: string) => `${target} ${text}`;

export const getStatus = () =>
  apiClient.get<TranslationStatus>('/translation').then((r) => r.data);

/**
 * Translate a batch of texts into the target language. Cached items are served
 * locally; only the remainder is sent to the server. Results are returned in the
 * same order as the input.
 */
export const translate = async (texts: string[], targetLanguage: string): Promise<TranslationItem[]> => {
  const target = (targetLanguage || '').toUpperCase();
  const results: TranslationItem[] = new Array(texts.length);
  const pending: string[] = [];
  const pendingIndexes: number[] = [];

  for (const [index, text] of texts.entries()) {
    if (!text || !text.trim()) {
      results[index] = { text, detectedSourceLanguage: target };
      continue;
    }
    const hit = cache.get(cacheKey(target, text));
    if (hit) {
      results[index] = hit;
    } else {
      pending.push(text);
      pendingIndexes.push(index);
    }
  }

  if (pending.length > 0) {
    const { data } = await apiClient.post<TranslateResponse>('/translation', {
      texts: pending,
      targetLanguage: target || undefined,
    });
    const translations = data?.translations ?? [];
    for (const [index, originalIndex] of pendingIndexes.entries()) {
      const item = translations[index] ?? { text: pending[index], detectedSourceLanguage: target };
      cache.set(cacheKey(target, pending[index]), item);
      results[originalIndex] = item;
    }
  }

  return results;
};
