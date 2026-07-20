// <copyright file="TranslateResponse.cs" company="John Narey">
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

namespace resonance.Translation.API
{
    using System.Collections.Generic;

    /// <summary>
    ///     A single translated text.
    /// </summary>
    public class TranslationItem
    {
        /// <summary>
        ///     Gets or sets the translated text.
        /// </summary>
        public string Text { get; set; }

        /// <summary>
        ///     Gets or sets the language code DeepL detected the source text to be (e.g. DE).
        /// </summary>
        public string DetectedSourceLanguage { get; set; }
    }

    /// <summary>
    ///     The response to a <see cref="TranslateRequest"/>.
    /// </summary>
    public class TranslateResponse
    {
        /// <summary>
        ///     Gets or sets the target language the texts were translated into.
        /// </summary>
        public string TargetLanguage { get; set; }

        /// <summary>
        ///     Gets or sets the translations, one per input text, in the same order.
        /// </summary>
        public List<TranslationItem> Translations { get; set; } = new();
    }
}
