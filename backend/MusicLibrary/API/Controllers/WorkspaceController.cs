namespace resonance.MusicLibrary.API;

using System;
using System.Linq;
using System.Security.Claims;
using Asp.Versioning;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using resonance.Analysis;
using resonance.Analysis.Candidates;
using resonance.Common;
using resonance.MetadataLookup;
using resonance.MusicLibrary.Workspace;

[ApiController, ApiVersion("0"), Route("api/v{version:apiVersion}/musiclibrary")]
[Authorize(Policy = AuthPolicy.FeatureLibrary)]
public class WorkspaceController(WorkspaceStore store, MusicRepository repository, PreparationService preparation,
    StreamUrlSigner signer, IMetadataLookupService enrichment, CandidateAnalysisOptions enhanced) : ControllerBase
{
    private string Username => User.FindFirstValue(ClaimTypes.Name) ?? "";
    private static SmartCrateRules ClientRules(SmartCrateRules rules) => rules with { Folder=rules.Folder==null ? null : MusicPath.ToAbsolute(rules.Folder) };
    private MusicTrack Sign(MusicTrack track)
    {
        var (exp, sig) = signer.Sign(track.Path);
        return track with { Exp = exp, Sig = sig };
    }
    private MusicLibraryQueryResult Query(SmartCrateRules rules, int limit = 1, int offset = 0, string search = null, string sort = "title", bool descending = false)
        => repository.Query(search, null, null, rules.Genre, null, rules.Folder, false, false, false, false, false,
            Math.Clamp(limit, 1, 500), Math.Max(0, offset), sort, descending, analysis: rules.Analysis, dj: rules.Filters(Username, DateTimeOffset.UtcNow));

    [HttpGet("crates")]
    public IActionResult Crates() => Ok(new
    {
        crates = store.ListCrates(Username).Select(crate => new
        {
            crate.Id,
            crate.Name,
            crate.Description,
            Rules=ClientRules(crate.Rules),
            crate.Revision,
            crate.Starter,
            trackCount = Query(crate.Rules).Total
        })
    });
    [HttpGet("crates/{id}/tracks")]
    public IActionResult CrateTracks(string id, [FromQuery] int limit = 100, [FromQuery] int offset = 0,
        [FromQuery] string search = null, [FromQuery] string sort = "title", [FromQuery] bool descending = false)
    {
        var crate = store.FindCrate(Username, id);
        if (crate == null) return NotFound();
        var page = Query(crate.Rules, limit, offset, search, sort, descending);
        return Ok(page with { Tracks = page.Tracks.Select(Sign).ToArray() });
    }
    [HttpPost("crates/preview")]
    public IActionResult Preview([FromBody] SmartCrateRules rules)
    {
        try { var page = Query((rules ?? new()).Validated(), 5); return Ok(page with { Tracks = page.Tracks.Select(Sign).ToArray() }); }
        catch (ArgumentException exception) { return BadRequest(new { message = exception.Message }); }
    }
    [HttpPost("crates")]
    public IActionResult Create([FromBody] SaveCrateRequest request) => Save(null, request);
    [HttpPut("crates/{id}")]
    public IActionResult Update(string id, [FromBody] SaveCrateRequest request) => Save(id, request);
    private IActionResult Save(string id, SaveCrateRequest request)
    {
        try
        {
            var crate=store.SaveCrate(Username, id, request ?? throw new ArgumentException("Crate details are required."));
            return Ok(crate with { Rules=ClientRules(crate.Rules) });
        }
        catch (ArgumentException exception) { return BadRequest(new { message = exception.Message }); }
        catch (InvalidOperationException exception) { return Conflict(new { message = exception.Message }); }
    }
    [HttpDelete("crates/{id}")]
    public IActionResult Delete(string id, [FromQuery] long revision) => store.DeleteCrate(Username, id, revision)
        ? NoContent() : Conflict(new { message = "This crate changed. Refresh before deleting it." });

    [HttpGet("preparation")]
    public IActionResult Preparation([FromQuery] string state = null, [FromQuery] string search = null, [FromQuery] int limit = 100, [FromQuery] int offset = 0)
    {
        var page = store.Page(state, search, Math.Clamp(limit, 1, 200), Math.Max(0, offset));
        var tracks = page.Items.Count == 0 ? [] : repository.Query(null, null, null, null, null, null, false, false, false, false, false,
            200, 0, dj: new(Paths: page.Items.Select(row => MusicPath.ToAbsolute(row.Path)).ToArray())).Tracks;
        var byPath = tracks.ToDictionary(track => MusicPath.ToRelative(track.Path));
        return Ok(new
        {
            total = page.Total,
            items = page.Items.Where(item => byPath.ContainsKey(item.Path)).Select(item => new
            {
                track = Sign(byPath[item.Path]),
                item.State,
                item.Attempts,
                item.NextAttemptAt,
                item.Detail
            })
        });
    }
    [HttpGet("preparation/status")]
    public IActionResult Status()
    {
        var counts = store.Counts(); var metadata = enrichment.State;
        return Ok(new
        {
            counts,
            total = counts.Values.Sum(),
            paused = store.Paused,
            automatic = true,
            enhancedEnabled = enhanced.Enabled,
            waitingReason = preparation.WaitingReason,
            preparation.LastCheckedAt,
            enrichment = new { metadata.Enabled, metadata.Scanning, metadata.Completed, metadata.Total, metadata.Written, metadata.Skipped, metadata.Failed, metadata.Progress }
        });
    }
    public record RetryRequest(string Path);
    [HttpPost("preparation/retry")]
    public IActionResult Retry([FromBody] RetryRequest request)
    {
        try { preparation.Retry(request?.Path ?? ""); return Accepted(); }
        catch (ArgumentException exception) { return BadRequest(new { message = exception.Message }); }
        catch (InvalidOperationException exception) { return Conflict(new { message = exception.Message }); }
    }
    public record PauseRequest(bool Paused);
    [HttpPost("preparation/pause")]
    public IActionResult Pause([FromBody] PauseRequest request) { store.Paused = request.Paused; return NoContent(); }
}
