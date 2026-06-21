// <copyright file="LibraryActivityController.cs" company="JP Dillingham">
//           ▄▄▄▄     ▄▄▄▄     ▄▄▄▄
//     ▄▄▄▄▄▄█  █▄▄▄▄▄█  █▄▄▄▄▄█  █
//     █__ --█  █__ --█    ◄█  -  █
//     █▄▄▄▄▄█▄▄█▄▄▄▄▄█▄▄█▄▄█▄▄▄▄▄█
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) JP Dillingham.
//   │ Copyright (c) 2026 John Narey.
//   │ Modified as part of Resonance, a modified version of slskd;
//   │ see the project repository for the nature of the changes.
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
//   │ https://slskd.org
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: JP Dillingham
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

namespace resonance.MusicLibrary.API
{
    using System.Security.Claims;
    using System.Threading.Tasks;
    using Asp.Versioning;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Mvc;
    using resonance.MusicLibrary;
    using resonance.MusicLibrary.Activity;

    public record LoveTrackRequest(string Path);
    public record RecordPlayRequest(string Path, string Title = null, string Artist = null, string Folder = null, string Source = null);

    [ApiController]
    [ApiVersion("0")]
    [Produces("application/json")]
    [Consumes("application/json")]
    [Route("api/v{version:apiVersion}/musiclibrary")]
    [Authorize(Policy = AuthPolicy.Any)]
    public class LibraryActivityController : ControllerBase
    {
        public LibraryActivityController(ILibraryActivityService service)
        {
            Service = service;
        }

        private ILibraryActivityService Service { get; }

        private string Username => User.FindFirstValue(ClaimTypes.Name) ?? string.Empty;

        // ── Loved ──────────────────────────────────────────────────────────────
        [HttpGet("loved")]
        [ProducesResponseType(typeof(string[]), 200)]
        public IActionResult GetLoved()
            => Ok(Service.GetLovedPaths(Username));

        [HttpPut("loved")]
        [ProducesResponseType(204)]
        public async Task<IActionResult> LoveTrack([FromBody] LoveTrackRequest request)
        {
            await Service.LoveTrackAsync(Username, request.Path);
            return NoContent();
        }

        [HttpDelete("loved")]
        [ProducesResponseType(204)]
        public async Task<IActionResult> UnloveTrack([FromQuery] string path)
        {
            await Service.UnloveTrackAsync(Username, path);
            return NoContent();
        }

        [HttpDelete("loved/all")]
        [ProducesResponseType(204)]
        public async Task<IActionResult> ClearAllLoved()
        {
            await Service.ClearAllLovedAsync(Username);
            return NoContent();
        }

        // ── Play history ───────────────────────────────────────────────────────
        [HttpPost("plays")]
        [ProducesResponseType(typeof(PlayStat), 200)]
        public async Task<IActionResult> RecordPlay([FromBody] RecordPlayRequest request)
        {
            var stat = await Service.RecordPlayAsync(Username, request.Path, request.Title, request.Artist, request.Folder, request.Source);
            return Ok(stat);
        }

        [HttpGet("plays")]
        [ProducesResponseType(typeof(PlayRecord[]), 200)]
        public IActionResult GetPlayHistory(
            [FromQuery] int limit = 100,
            [FromQuery] int offset = 0)
            => Ok(Service.GetPlayHistory(Username, limit, offset));

        [HttpDelete("plays/{id}")]
        [ProducesResponseType(204)]
        public async Task<IActionResult> DeletePlay(string id)
        {
            await Service.DeletePlayAsync(Username, id);
            return NoContent();
        }

        [HttpDelete("plays")]
        [ProducesResponseType(204)]
        public async Task<IActionResult> ClearHistory()
        {
            await Service.ClearHistoryAsync(Username);
            return NoContent();
        }

        [HttpGet("plays/stats")]
        [ProducesResponseType(typeof(PlayStat[]), 200)]
        public IActionResult GetPlayStats([FromQuery] string[] paths = null)
            => Ok(Service.GetPlayStats(Username, paths));
    }
}
