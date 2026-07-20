// <copyright file="MixtapesController.cs" company="John Narey">
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

namespace resonance.Mixtapes.API
{
    using System;
    using System.Collections.Generic;
    using System.Linq;
    using System.Text;
    using Asp.Versioning;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Http;
    using Microsoft.AspNetCore.Mvc;
    using resonance.MusicLibrary;

    public record CreateMixtapeRequest(string Name, string? Description);
    public record UpdateMixtapeRequest(string Name, string? Description);
    public record AddTrackRequest(string FilePath);
    public record ReorderTracksRequest(string[] TrackIds);

    [ApiController]
    [ApiVersion("0")]
    [Produces("application/json")]
    [Consumes("application/json")]
    [Route("api/v{version:apiVersion}/mixtapes")]
    [Authorize(Policy = AuthPolicy.Any)]
    public class MixtapesController : ControllerBase
    {
        public MixtapesController(IMixtapeService service, StreamUrlSigner urlSigner)
        {
            Service = service;
            UrlSigner = urlSigner;
        }

        private IMixtapeService Service { get; }

        private StreamUrlSigner UrlSigner { get; }

        [HttpGet]
        [ProducesResponseType(typeof(IReadOnlyList<Mixtape>), 200)]
        public IActionResult GetAll() => Ok(Service.GetAll().Select(SignMixtape).ToList());

        [HttpPost]
        [ProducesResponseType(typeof(Mixtape), 201)]
        public IActionResult Create([FromBody] CreateMixtapeRequest req)
        {
            var mixtape = Service.Create(req.Name, req.Description);
            return CreatedAtAction(nameof(GetById), new { id = mixtape.Id }, mixtape);
        }

        [HttpGet("{id}")]
        [ProducesResponseType(typeof(Mixtape), 200)]
        [ProducesResponseType(404)]
        public IActionResult GetById(string id)
        {
            var m = Service.GetById(id);
            return m == null ? NotFound() : Ok(SignMixtape(m));
        }

        [HttpPut("{id}")]
        [ProducesResponseType(typeof(Mixtape), 200)]
        [ProducesResponseType(404)]
        public IActionResult Update(string id, [FromBody] UpdateMixtapeRequest req)
        {
            try
            {
                return Ok(Service.Update(id, req.Name, req.Description));
            }
            catch (KeyNotFoundException)
            {
                return NotFound();
            }
        }

        [HttpDelete("{id}")]
        [ProducesResponseType(204)]
        [ProducesResponseType(404)]
        public IActionResult Delete(string id)
        {
            try
            {
                Service.Delete(id);
                return NoContent();
            }
            catch (KeyNotFoundException)
            {
                return NotFound();
            }
        }

        [HttpPost("{id}/tracks")]
        [ProducesResponseType(typeof(MixtapeTrack), 201)]
        [ProducesResponseType(404)]
        [ProducesResponseType(409)]
        public IActionResult AddTrack(string id, [FromBody] AddTrackRequest req)
        {
            try
            {
                var track = Service.AddTrack(id, req.FilePath);
                return Created(string.Empty, track);
            }
            catch (KeyNotFoundException)
            {
                return NotFound();
            }
            catch (InvalidOperationException ex)
            {
                return Conflict(new { error = ex.Message });
            }
        }

        [HttpDelete("{id}/tracks/{trackId}")]
        [ProducesResponseType(204)]
        [ProducesResponseType(404)]
        public IActionResult RemoveTrack(string id, string trackId)
        {
            try
            {
                Service.RemoveTrack(id, trackId);
                return NoContent();
            }
            catch (KeyNotFoundException)
            {
                return NotFound();
            }
        }

        [HttpDelete("{id}/tracks")]
        [ProducesResponseType(204)]
        [ProducesResponseType(404)]
        public IActionResult ClearTracks(string id)
        {
            try
            {
                Service.ClearTracks(id);
                return NoContent();
            }
            catch (KeyNotFoundException)
            {
                return NotFound();
            }
        }

        [HttpPut("{id}/tracks")]
        [ProducesResponseType(204)]
        public IActionResult ReorderTracks(string id, [FromBody] ReorderTracksRequest req)
        {
            Service.ReorderTracks(id, req.TrackIds);
            return NoContent();
        }

        [HttpGet("{id}/artwork")]
        [AllowAnonymous]
        [ProducesResponseType(200)]
        [ProducesResponseType(404)]
        public IActionResult GetArtwork(string id)
        {
            var info = Service.GetArtworkInfo(id);
            return info == null ? NotFound() : PhysicalFile(info.Value.Path, info.Value.ContentType);
        }

        [HttpPost("{id}/artwork")]
        [Consumes("multipart/form-data")]
        [ProducesResponseType(200)]
        [ProducesResponseType(400)]
        [ProducesResponseType(404)]
        public async System.Threading.Tasks.Task<IActionResult> UploadArtwork(string id, IFormFile file)
        {
            if (Service.GetById(id) == null)
            {
                return NotFound();
            }

            if (file == null || file.Length == 0)
            {
                return BadRequest("No file provided");
            }

            if (!file.ContentType.StartsWith("image/"))
            {
                return BadRequest("File must be an image");
            }

            await using var stream = file.OpenReadStream();
            await Service.SaveArtworkAsync(id, stream, file.ContentType);
            return Ok();
        }

        [HttpDelete("{id}/artwork")]
        [ProducesResponseType(204)]
        [ProducesResponseType(404)]
        public IActionResult DeleteArtwork(string id)
        {
            if (Service.GetById(id) == null)
            {
                return NotFound();
            }

            Service.DeleteArtwork(id);
            return NoContent();
        }

        [HttpPost("{id}/publish")]
        [ProducesResponseType(typeof(Mixtape), 200)]
        [ProducesResponseType(404)]
        public IActionResult Publish(string id)
        {
            try
            {
                return Ok(Service.Publish(id));
            }
            catch (KeyNotFoundException)
            {
                return NotFound();
            }
        }

        [HttpDelete("{id}/publish")]
        [ProducesResponseType(204)]
        [ProducesResponseType(404)]
        public IActionResult Unpublish(string id)
        {
            try
            {
                Service.Unpublish(id);
                return NoContent();
            }
            catch (KeyNotFoundException)
            {
                return NotFound();
            }
        }

        [HttpGet("{id}/export.m3u")]
        [Produces("audio/x-mpegurl")]
        [ProducesResponseType(200)]
        [ProducesResponseType(404)]
        public IActionResult ExportM3u(string id)
        {
            var m = Service.GetById(id);
            if (m == null)
            {
                return NotFound();
            }

            var content = Service.BuildM3uContent(m.Tracks ?? Array.Empty<MixtapeTrack>());
            var fileName = $"{SanitizeName(m.Name)}.m3u";
            return File(Encoding.UTF8.GetBytes(content), "audio/x-mpegurl", fileName);
        }

        [HttpPost("{id}/soulseek")]
        [ProducesResponseType(typeof(Mixtape), 200)]
        [ProducesResponseType(404)]
        public IActionResult SoulseekShare(string id)
        {
            try
            {
                return Ok(Service.SoulseekShare(id));
            }
            catch (KeyNotFoundException)
            {
                return NotFound();
            }
        }

        [HttpDelete("{id}/soulseek")]
        [ProducesResponseType(204)]
        [ProducesResponseType(404)]
        public IActionResult SoulseekUnshare(string id)
        {
            try
            {
                Service.SoulseekUnshare(id);
                return NoContent();
            }
            catch (KeyNotFoundException)
            {
                return NotFound();
            }
        }

        private static string SanitizeName(string name)
        {
            var invalid = System.IO.Path.GetInvalidFileNameChars();
            var safe = string.Concat(name.Select(c => invalid.Contains(c) ? '_' : c)).Trim();
            return string.IsNullOrEmpty(safe) ? "mixtape" : safe;
        }

        // Stamp each track's FilePath with a fresh artwork/stream signature so clients skip the
        // separate POST /sign round-trip (see StreamUrlSigner / MusicLibraryController).
        private MixtapeTrack SignTrack(MixtapeTrack t)
        {
            if (string.IsNullOrEmpty(t.FilePath))
            {
                return t;
            }

            var (exp, sig) = UrlSigner.Sign(t.FilePath);
            return t with { Exp = exp, Sig = sig };
        }

        private Mixtape SignMixtape(Mixtape m) =>
            m.Tracks == null ? m : m with { Tracks = m.Tracks.Select(SignTrack).ToList() };
    }
}
