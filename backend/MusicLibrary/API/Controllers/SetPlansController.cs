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

[ApiController, ApiVersion("0"), Route("api/v{version:apiVersion}/musiclibrary/sets")]
[Authorize(Policy = AuthPolicy.FeatureLibrary)]
public class SetPlansController(WorkspaceStore store, MusicRepository library, IMixtapeService mixtapes) : ControllerBase
{
    private string Username => User.FindFirstValue(ClaimTypes.Name) ?? "";
    private static SetPlan Client(SetPlan plan) => plan with { Items = plan.Items.Select(item => item with { Path = MusicPath.ToAbsolute(item.Path) }).ToArray() };

    [HttpGet]
    public IActionResult List() => Ok(new
    {
        scope = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Username))).ToLowerInvariant(),
        sets = store.ListSets(Username).Select(Client)
    });

    [HttpPost]
    public IActionResult Create([FromBody] SetPlanRequest request) => Save(null, request);
    [HttpPut("{id}")]
    public IActionResult Update(string id, [FromBody] SetPlanRequest request) => Save(id, request);
    private IActionResult Save(string id, SetPlanRequest request)
    {
        try { return Ok(Client(store.SaveSet(Username, id, request ?? throw new ArgumentException("Set details are required.")))); }
        catch (ArgumentException error) { return BadRequest(new { message = error.Message }); }
        catch (InvalidOperationException error) { return Conflict(new { message = error.Message }); }
    }

    public record ArchiveRequest(long Revision, bool Archived);
    [HttpPost("{id}/archive")]
    public IActionResult Archive(string id, [FromBody] ArchiveRequest request)
    {
        try { return Ok(Client(store.ArchiveSet(Username, id, request.Revision, request.Archived))); }
        catch (InvalidOperationException error) { return Conflict(new { message = error.Message }); }
    }

    public record SnapshotRequest(long Revision, string RequestId);
    [HttpPost("{id}/mixtape")]
    public IActionResult Snapshot(string id, [FromBody] SnapshotRequest request)
    {
        if (!Guid.TryParseExact(request.RequestId, "N", out _)) return BadRequest(new { message = "A valid snapshot request ID is required." });
        var plan = store.FindSet(Username, id);
        if (plan == null) return NotFound();
        if (plan.Archived || plan.Revision != request.Revision)
            return Conflict(new { message = "Save the current set before creating its mixtape." });
        if (plan.Items.Length == 0) return BadRequest(new { message = "Add tracks before creating a mixtape." });
        var tracks = plan.Items.Select(item => library.GetByPath(MusicPath.ToAbsolute(item.Path))).ToArray();
        if (tracks.Any(track => track == null || !System.IO.File.Exists(track.Path)))
            return Conflict(new { message = "Some set tracks are no longer available. Review them before creating a mixtape." });
        // Retrying an operation is idempotent; a later deliberate snapshot has
        // its own ID and cannot accidentally return a mixtape edited elsewhere.
        var snapshotId = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"set:{Username}:{plan.Id}:{plan.Revision}:{request.RequestId}"))).ToLowerInvariant()[..32];
        var mixtape = mixtapes.CreateSnapshot(snapshotId, plan.Name, "Set Planner snapshot. Track order is preserved; tempo checkpoints and transitions are rehearsal settings, not audio edits.", tracks);
        return Ok(new { mixtape.Id, mixtape.Name, count = mixtape.Tracks.Count, revision = plan.Revision });
    }
}
