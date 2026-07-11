// <copyright file="MetadataLookupController.cs" company="John Narey">
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

namespace resonance.MetadataLookup.API
{
    using System.Collections.Generic;
    using System.Threading.Tasks;
    using Asp.Versioning;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Mvc;

    /// <summary>
    ///     Online metadata lookup — automatic enrichment status and per-track lookups (MusicBrainz).
    /// </summary>
    [ApiController]
    [ApiVersion("0")]
    [Produces("application/json")]
    [Consumes("application/json")]
    [Route("api/v{version:apiVersion}/[controller]")]
    public class MetadataLookupController : ControllerBase
    {
        public MetadataLookupController(IMetadataLookupService metadataLookupService)
        {
            Service = metadataLookupService;
        }

        private IMetadataLookupService Service { get; }

        /// <summary>Returns the current enrichment status (enabled flag, progress, ETA, recent items).</summary>
        /// <returns></returns>
        [HttpGet("status")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(MetadataScanState), 200)]
        public IActionResult GetStatus() => Ok(Service.State);

        /// <summary>Looks up candidate metadata for a single track without writing anything.</summary>
        /// <param name="request">The track to look up.</param>
        /// <returns></returns>
        [HttpPost("lookup")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(IEnumerable<MetadataMatch>), 200)]
        [ProducesResponseType(400)]
        public async Task<IActionResult> Lookup([FromBody] MetadataLookupRequest request)
        {
            if (request == null)
            {
                return BadRequest("A lookup request is required.");
            }

            return Ok(await Service.LookupAsync(request));
        }

        /// <summary>
        ///     Forces an immediate enrichment pass. Pass <paramref name="full"/> to bypass the
        ///     attempt cache and re-query tracks that previously had no match.
        /// </summary>
        /// <param name="full">Whether to re-query every candidate, including previous no-matches.</param>
        /// <returns></returns>
        [HttpPost("run")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(202)]
        public IActionResult Run([FromQuery] bool full = false)
        {
            Service.RequestRun(full);
            return Accepted();
        }

        /// <summary>Stops the in-flight enrichment pass, if any.</summary>
        /// <returns></returns>
        [HttpPost("stop")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(202)]
        public IActionResult Stop()
        {
            Service.RequestStop();
            return Accepted();
        }
    }
}
