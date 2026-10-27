// <copyright file="SetPlansController.cs" company="John Narey">
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

namespace resonance.MusicLibrary.API;

using System;
using System.IO;
using System.Linq;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Asp.Versioning;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using resonance.Common;
using resonance.Mixtapes;
using resonance.MusicLibrary.Workspace;

[ApiController]
[ApiVersion("0")]
[Route("api/v{version:apiVersion}/musiclibrary/sets")]
[Authorize(Policy = AuthPolicy.FeatureLibrary)]
public class SetPlansController(WorkspaceStore store, MusicRepository library, IMixtapeService mixtapes) : ControllerBase
{
    private string Username => User.FindFirstValue(ClaimTypes.Name) ?? string.Empty;

    [HttpGet]
    public IActionResult List() => Ok(new
    {
        scope = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Username))).ToLowerInvariant(),
        sets = store.ListSets(Username).Select(Client),
    });

    [HttpPost]
    public IActionResult Create([FromBody] SetPlanRequest request) => Save(null, request);
    [HttpPut("{id}")]
    public IActionResult Update(string id, [FromBody] SetPlanRequest request) => Save(id, request);
    [HttpPost("{id}/archive")]
    public IActionResult Archive(string id, [FromBody] ArchiveRequest request)
    {
        try
        {
            return Ok(Client(store.ArchiveSet(Username, id, request.Revision, request.Archived)));
        }
        catch (InvalidOperationException error)
        {
            return Conflict(new { message = error.Message });
        }
    }

    [HttpPost("{id}/mixtape")]
    public IActionResult Snapshot(string id, [FromBody] SnapshotRequest request)
    {
        if (!Guid.TryParseExact(request.RequestId, "N", out _))
        {
            return BadRequest(new { message = "A valid snapshot request ID is required." });
        }

        var plan = store.FindSet(Username, id);
        if (plan == null)
        {
            return NotFound();
        }

        if (plan.Archived || plan.Revision != request.Revision)
        {
            return Conflict(new { message = "Save the current set before creating its playlist." });
        }

        if (plan.Items.Length == 0)
        {
            return BadRequest(new { message = "Add tracks before creating a playlist." });
        }

        var tracks = plan.Items.Select(item => library.GetByPath(MusicPath.ToAbsolute(item.Path))).ToArray();
        if (tracks.Any(track => track == null || !System.IO.File.Exists(track.Path)))
        {
            return Conflict(new { message = "Some set tracks are no longer available. Review them before creating a playlist." });
        }

        // Retrying an operation is idempotent; a later deliberate snapshot has
        // its own ID and cannot accidentally return a mixtape edited elsewhere.
        var snapshotId = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"set:{Username}:{plan.Id}:{plan.Revision}:{request.RequestId}"))).ToLowerInvariant()[..32];
        var mixtape = mixtapes.CreateSnapshot(snapshotId, plan.Name, "Set Planner snapshot. Track order is preserved; tempo checkpoints and transitions are rehearsal settings, not audio edits.", tracks);
        return Ok(new { mixtape.Id, mixtape.Name, count = mixtape.Tracks.Count, revision = plan.Revision });
    }

    private static SetPlan Client(SetPlan plan) => plan with { Items = plan.Items.Select(item => item with { Path = MusicPath.ToAbsolute(item.Path) }).ToArray() };
    private IActionResult Save(string id, SetPlanRequest request)
    {
        try
        {
            return Ok(Client(store.SaveSet(Username, id, request ?? throw new ArgumentException("Set details are required."))));
        }
        catch (ArgumentException error)
        {
            return BadRequest(new { message = error.Message });
        }
        catch (InvalidOperationException error)
        {
            return Conflict(new { message = error.Message });
        }
    }

    public record ArchiveRequest(long Revision, bool Archived);

    public record SnapshotRequest(long Revision, string RequestId);
}
