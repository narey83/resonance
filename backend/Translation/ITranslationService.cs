// <copyright file="ITranslationService.cs" company="John Narey">
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

namespace resonance.Translation
{
    using System.Collections.Generic;
    using System.Threading;
    using System.Threading.Tasks;

    /// <summary>
    ///     Translates chat and chatroom messages via an external provider.
    /// </summary>
    public interface ITranslationService
    {
        /// <summary>
        ///     Gets a value indicating whether translation is enabled and configured.
        /// </summary>
        bool IsEnabled { get; }

        /// <summary>
        ///     Gets the default target language code used when a caller does not specify one.
        /// </summary>
        string DefaultTargetLanguage { get; }

        /// <summary>
        ///     Translates the given <paramref name="texts"/> into the <paramref name="targetLanguage"/>.
        /// </summary>
        /// <param name="texts">The texts to translate. Results are returned in the same order.</param>
        /// <param name="targetLanguage">The target language code (e.g. EN, DE, FR). Blank uses <see cref="DefaultTargetLanguage"/>.</param>
        /// <param name="cancellationToken">The cancellation token.</param>
        /// <returns>The translations, one per input text, in the same order.</returns>
        Task<IReadOnlyList<TranslationResult>> TranslateAsync(IReadOnlyList<string> texts, string targetLanguage, CancellationToken cancellationToken = default);
    }

    /// <summary>
    ///     The outcome of translating a single piece of text.
    /// </summary>
    /// <param name="Text">The translated text.</param>
    /// <param name="DetectedSourceLanguage">The language DeepL detected the source text to be, as an uppercase code (e.g. DE).</param>
    public record TranslationResult(string Text, string DetectedSourceLanguage);
}
