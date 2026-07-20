// <copyright file="TranslationController.cs" company="John Narey">
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
    using System;
    using System.Linq;
    using System.Threading;
    using System.Threading.Tasks;
    using Asp.Versioning;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Mvc;

    /// <summary>
    ///     Message translation.
    /// </summary>
    [Route("api/v{version:apiVersion}/[controller]")]
    [ApiVersion("0")]
    [ApiController]
    [Produces("application/json")]
    [Consumes("application/json")]
    [Authorize(Policy = AuthPolicy.FeatureMessaging)]
    public class TranslationController : ControllerBase
    {
        /// <summary>
        ///     Initializes a new instance of the <see cref="TranslationController"/> class.
        /// </summary>
        /// <param name="translationService">The translation service.</param>
        public TranslationController(ITranslationService translationService)
        {
            Translation = translationService;
        }

        private ITranslationService Translation { get; }

        /// <summary>
        ///     Gets the translation feature status.
        /// </summary>
        /// <returns>Whether translation is enabled and the default target language.</returns>
        /// <response code="200">The request completed successfully.</response>
        [HttpGet("")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(200)]
        public IActionResult GetStatus()
        {
            return Ok(new
            {
                enabled = Translation.IsEnabled,
                defaultTargetLanguage = Translation.DefaultTargetLanguage,
            });
        }

        /// <summary>
        ///     Translates one or more texts into a target language.
        /// </summary>
        /// <param name="request">The translation request.</param>
        /// <param name="cancellationToken">The cancellation token.</param>
        /// <returns>The translated texts.</returns>
        /// <response code="200">The request completed successfully.</response>
        /// <response code="400">The request contained no texts to translate.</response>
        /// <response code="502">The translation provider returned an error.</response>
        /// <response code="503">Translation is not enabled or configured.</response>
        [HttpPost("")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(TranslateResponse), 200)]
        [ProducesResponseType(400)]
        [ProducesResponseType(502)]
        [ProducesResponseType(503)]
        public async Task<IActionResult> Translate([FromBody] TranslateRequest request, CancellationToken cancellationToken)
        {
            if (!Translation.IsEnabled)
            {
                return StatusCode(503, "Translation is not enabled. Configure a DeepL API key in Settings.");
            }

            if (request?.Texts is null || request.Texts.Count == 0)
            {
                return BadRequest("At least one text is required.");
            }

            try
            {
                var results = await Translation.TranslateAsync(request.Texts, request.TargetLanguage, cancellationToken);

                return Ok(new TranslateResponse
                {
                    TargetLanguage = string.IsNullOrWhiteSpace(request.TargetLanguage)
                        ? Translation.DefaultTargetLanguage
                        : request.TargetLanguage.Trim().ToUpperInvariant(),
                    Translations = results
                        .Select(r => new TranslationItem { Text = r.Text, DetectedSourceLanguage = r.DetectedSourceLanguage })
                        .ToList(),
                });
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception)
            {
                return StatusCode(502, "The translation provider returned an error.");
            }
        }
    }
}
