// <copyright file="translationStore.ts" company="John Narey">
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

import { onSessionReset, sessionGuard } from '../lib/sessionScope';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import * as translationAPI from '../api/translation';
import type { TranslationItem } from '../api/translation';

const AUTO_STORE_KEY = 'translation_auto_v1';
const REPLY_STORE_KEY = 'translation_reply_v1';

export interface PendingItem {
  key: string;
  text: string;
}

const baseLang = (code?: string) => (code || '').toUpperCase().split('-')[0];

interface TranslationStore {
  enabled: boolean;
  targetLang: string;
  loaded: boolean;
  /** Per-thread auto-translate (inbound read) flags, keyed by `chat:<user>` / `room:<name>`. */
  autoByThread: Record<string, boolean>;
  /** Per-thread translate-on-send (outbound reply) flags. */
  replyByThread: Record<string, boolean>;
  /** Most recently detected language of the other party, per thread (base code, e.g. ES). */
  detectedLangByThread: Record<string, string>;
  /** Translations keyed by an opaque, stable per-message key. */
  translations: Record<string, TranslationItem>;
  /** Message keys the user has flipped back to the original text. */
  originals: Record<string, boolean>;
  /** Original text behind an outgoing message we translated, keyed by the sent text. */
  sentOriginals: Record<string, { original: string; lang: string }>;

  loadStatus: () => Promise<void>;
  isAuto: (threadKey: string) => boolean;
  toggleAuto: (threadKey: string) => Promise<void>;
  toggleReply: (threadKey: string) => Promise<void>;
  ensureTranslated: (threadKey: string, items: PendingItem[]) => Promise<void>;
  toggleOriginal: (messageKey: string) => void;
  /**
   * Translate an outgoing reply into the other party's language. Detects that
   * language from `latestInboundText` if not already known. Returns the original
   * text unchanged when translation isn't possible or isn't needed.
   */
  translateOutgoing: (threadKey: string, text: string, latestInboundText?: string) => Promise<string>;
}

export const useTranslationStore = create<TranslationStore>((set, get) => ({
  enabled: false,
  targetLang: 'EN',
  loaded: false,
  autoByThread: {},
  replyByThread: {},
  detectedLangByThread: {},
  translations: {},
  originals: {},
  sentOriginals: {},

  loadStatus: async () => {
    const current = sessionGuard();
    // Persisted per-thread toggles (fire-and-forget on first load).
    if (!get().loaded) {
      try {
        const [autoRaw, replyRaw] = await Promise.all([
          SecureStore.getItemAsync(AUTO_STORE_KEY),
          SecureStore.getItemAsync(REPLY_STORE_KEY),
        ]);
        if (!current()) return;
        set({
          autoByThread: autoRaw ? (JSON.parse(autoRaw) as Record<string, boolean>) : {},
          replyByThread: replyRaw ? (JSON.parse(replyRaw) as Record<string, boolean>) : {},
        });
      } catch {
        if (!current()) return;
        // ignore malformed/absent persisted prefs
      }
    }

    try {
      const status = await translationAPI.getStatus();
      if (!current()) return;
      set({
        enabled: status.enabled,
        targetLang: status.defaultTargetLanguage || 'EN',
        loaded: true,
      });
    } catch {
      if (!current()) return;
      set({ loaded: true });
    }
  },

  isAuto: (threadKey) => Boolean(get().autoByThread[threadKey]),

  toggleAuto: async (threadKey) => {
    const current = sessionGuard();
    const turningOn = !get().autoByThread[threadKey];
    const next = { ...get().autoByThread, [threadKey]: turningOn };
    set({ autoByThread: next });
    try {
      await SecureStore.setItemAsync(AUTO_STORE_KEY, JSON.stringify(next));
      if (!current()) return;
    } catch {
      if (!current()) return;
      // best-effort persistence
    }
    if (turningOn && !get().replyByThread[threadKey]) {
      await get().toggleReply(threadKey);
      if (!current()) return;
    }
  },

  toggleReply: async (threadKey) => {
    const next = { ...get().replyByThread, [threadKey]: !get().replyByThread[threadKey] };
    set({ replyByThread: next });
    try {
      await SecureStore.setItemAsync(REPLY_STORE_KEY, JSON.stringify(next));
    } catch {
      // best-effort persistence
    }
  },

  ensureTranslated: async (threadKey, items) => {
    const current = sessionGuard();
    const { translations, targetLang } = get();
    const pending = items.filter((i) => i.text && i.text.trim() && !(i.key in translations));
    if (pending.length === 0) return;

    try {
      const results = await translationAPI.translate(pending.map((p) => p.text), targetLang);
      if (!current()) return;
      set((s) => {
        const next = { ...s.translations };
        pending.forEach((p, index) => {
          next[p.key] = results[index];
        });
        return { translations: next };
      });

      // Remember the other party's language (from the last detected result that
      // isn't already our own) so replies can be translated back into it.
      const detected = [...results].reverse().map((r) => baseLang(r?.detectedSourceLanguage)).find((c) => c && c !== targetLang.toUpperCase());
      if (detected) {
        set((s) => ({ detectedLangByThread: { ...s.detectedLangByThread, [threadKey]: detected } }));
      }
    } catch {
      if (!current()) return;
      // Translation is best-effort; leave originals in place on failure.
    }
  },

  toggleOriginal: (messageKey) => {
    set((s) => ({ originals: { ...s.originals, [messageKey]: !s.originals[messageKey] } }));
  },

  translateOutgoing: async (threadKey, text, latestInboundText) => {
    const current = sessionGuard();
    if (!text.trim()) return text;
    const targetUpper = get().targetLang.toUpperCase();

    let lang = get().detectedLangByThread[threadKey];

    // Detect the recipient's language from their latest message if unknown.
    if (!lang && latestInboundText?.trim()) {
      try {
        const [probe] = await translationAPI.translate([latestInboundText], get().targetLang);
        if (!current()) throw new Error('Session changed');
        const detected = baseLang(probe?.detectedSourceLanguage);
        if (detected && detected !== targetUpper) {
          lang = detected;
          set((s) => ({ detectedLangByThread: { ...s.detectedLangByThread, [threadKey]: detected } }));
        }
      } catch {
        if (!current()) throw new Error('Session changed');
        // fall through — send untranslated
      }
    }

    if (!lang || lang === targetUpper) return text;

    try {
      const [result] = await translationAPI.translate([text], lang);
      if (!current()) throw new Error('Session changed');
      const translated = result?.text || text;
      // Remember what was typed so the sent bubble can reveal the original.
      if (translated !== text) {
        set((s) => ({ sentOriginals: { ...s.sentOriginals, [translated]: { original: text, lang: lang! } } }));
      }
      return translated;
    } catch {
      if (!current()) throw new Error('Session changed');
      return text;
    }
  },
}));

onSessionReset(() => {
  useTranslationStore.setState(useTranslationStore.getInitialState(), true);
});
