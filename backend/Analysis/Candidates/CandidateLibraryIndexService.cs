namespace resonance.Analysis.Candidates
{
    using System;
    using System.IO;
    using System.Linq;
    using System.Text.Json;
    using System.Threading;
    using System.Threading.Tasks;
    using Microsoft.AspNetCore.SignalR;
    using Microsoft.Extensions.Hosting;
    using resonance.MusicLibrary.API;
    using Serilog;

    // Backfill older saved analysis once in the background. Browsing stays paged and never
    // waits for candidate file parsing or audio identity validation.
    public class CandidateLibraryIndexService(CandidateAnalysisOptions options, CandidateAnalysisService candidates,
        IHubContext<LibraryActivityHub> hub) : BackgroundService
    {
        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            if (!options.Enabled || !Directory.Exists(options.OutputRoot)) return;
            await Task.Delay(TimeSpan.FromSeconds(3), stoppingToken);
            var jobs = new System.Collections.Generic.List<CandidateJob>();
            foreach (var directory in Directory.EnumerateDirectories(options.OutputRoot))
            {
                try
                {
                    var job = JsonSerializer.Deserialize<CandidateJob>(await File.ReadAllTextAsync(Path.Combine(directory, "job.json"), stoppingToken),
                        new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                    if (job != null && job.RequestedSeconds == null && job.Status.StartsWith("completed", StringComparison.Ordinal)) jobs.Add(job);
                }
                catch (IOException) { }
                catch (JsonException) { }
            }
            var indexed = new System.Collections.Generic.HashSet<string>();
            foreach (var job in jobs.OrderByDescending(job => job.CreatedAt))
            {
                if (indexed.Contains(job.LibraryPath)) continue;
                try
                {
                    var result = await candidates.Read(job.JobId, stoppingToken);
                    if (result.ContentCurrent && result.Analysis.HasValue && CandidateAnalysisService.HasEnhanced(result.Analysis.Value))
                    {
                        candidates.CacheDjSummary(job.LibraryPath, result.Analysis.Value, job.JobId);
                        indexed.Add(job.LibraryPath);
                    }
                }
                catch (Exception exception) when (exception is IOException or ArgumentException or InvalidOperationException or JsonException or System.Collections.Generic.KeyNotFoundException)
                {
                    Log.Debug("Skipped saved DJ summary for {Path}: {Error}", job.LibraryPath, exception.Message);
                }
            }
            if (indexed.Count > 0) await hub.BroadcastLibraryUpdatedAsync(0, indexed.Count, 0);
        }
    }
}
