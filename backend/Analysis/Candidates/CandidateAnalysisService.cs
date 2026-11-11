// <copyright file="CandidateAnalysisService.cs" company="John Narey">
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

namespace resonance.Analysis.Candidates
{
    using System;
    using System.Collections.Generic;
    using System.ComponentModel;
    using System.Diagnostics;
    using System.Globalization;
    using System.IO;
    using System.IO.Compression;
    using System.Linq;
    using System.Security.Cryptography;
    using System.Text;
    using System.Text.Json;
    using System.Threading;
    using System.Threading.Tasks;
    using Microsoft.AspNetCore.SignalR;
    using resonance.Analysis.Imports;
    using resonance.Common;
    using resonance.MusicLibrary.API;
    using Serilog;

    public record CandidateJob(string JobId, string Status, string LibraryPath, string AudioSha256, long AudioBytes, DateTimeOffset CreatedAt, double? RequestedSeconds, string SourceKind = "independent-candidate");

    internal record CandidateInferenceDevice(string Device, bool GpuAttempted, string? Fallback, long PeakBytes);

    public class CandidateAnalysisService
    {
        public CandidateAnalysisService(CandidateAnalysisOptions options, IAnalysisService analysis, AnalysisStore store, IHubContext<LibraryActivityHub> hub = null)
        {
            Options = options;
            Hub = hub;
            Analysis = analysis;
            Store = store;
            Resources = options.ResolveResources(
                Environment.ProcessorCount,
                GC.GetGCMemoryInfo().TotalAvailableMemoryBytes);
            WorkerGate = new(Resources.ParallelJobs, Resources.ParallelJobs);
            Log.Information(
                "Enhanced analysis resources: {Jobs} parallel jobs, {Threads} threads per job, {Processors} available processors, {MemoryGiB:F1} GiB memory budget",
                Resources.ParallelJobs,
                Resources.ThreadsPerJob,
                Resources.ProcessorCount,
                Resources.AvailableMemoryBytes / (double)(1L << 30));
        }

        public bool Enabled => Options.Enabled;

        public bool StorageAvailable => !string.IsNullOrWhiteSpace(Options.OutputRoot)
            && Path.IsPathFullyQualified(Options.OutputRoot) && Directory.Exists(Options.OutputRoot);

        public CandidateResourcePlan Resources { get; }

        private IHubContext<LibraryActivityHub> Hub { get; }

        private AnalysisStore Store { get; }

        private CandidateAnalysisOptions Options { get; }

        private IAnalysisService Analysis { get; }

        // Candidate jobs use a separate bounded pool and store; they never join the native
        // auto-scan queue. The pool is sized from the container's effective CPU and memory.
        private SemaphoreSlim WorkerGate { get; }
        private object SummaryGate { get; } = new();

        private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", "Music / Enhanced Analysis");

        public async Task<CandidateJob> Analyze(CandidateAnalysisRequest request, CancellationToken ct)
        {
            RequireConfiguration();
            ArgumentNullException.ThrowIfNull(request);
            if (string.IsNullOrWhiteSpace(request.Path)
                || (request.Seconds.HasValue && (!double.IsFinite(request.Seconds.Value) || request.Seconds <= 0 || request.Seconds > 36000)))
            {
                throw new ArgumentException("An indexed library path and an optional positive analysis duration are required.");
            }

            CandidateFeatureSelection.Validate(request.Features);
            var source = ImportedAnalysisContract.RequireLibraryPath(MusicPath.Root, request.Path);
            if (Analysis.ResolveMaskedFilename(source) == null)
            {
                throw new ArgumentException("Track is not indexed in the local share.");
            }

            await WorkerGate.WaitAsync(ct);
            try
            {
                var job = await Run(source, request.Seconds, request.Features, ct);
                if (job.Status.StartsWith("completed", StringComparison.Ordinal) && job.RequestedSeconds == null)
                {
                    var saved = await Read(job.JobId, ct);
                    if (saved.ContentCurrent && saved.Analysis.HasValue)
                    {
                        CacheDjSummary(path: source, analysis: saved.Analysis.Value, analysisId: job.JobId);
                    }
                }

                return job;
            }
            finally
            {
                WorkerGate.Release();
            }
        }

        public async Task<(CandidateJob Job, JsonElement Analysis)?> LatestEnhanced(string path, CancellationToken ct)
        {
            if (!StorageAvailable)
            {
                return null;
            }

            foreach (var job in await List(path, ct))
            {
                if (job.RequestedSeconds != null || !job.Status.StartsWith("completed", StringComparison.Ordinal))
                {
                    continue;
                }

                var result = await Read(job.JobId, ct);
                if (result.ContentCurrent && result.Analysis.HasValue && HasEnhanced(result.Analysis.Value))
                {
                    CacheDjSummary(path, result.Analysis.Value, job.JobId);
                    return (job, result.Analysis.Value);
                }
            }

            return null;
        }

        public async Task EnsureEnhanced(string path, CancellationToken ct, bool force = false)
        {
            if (!Enabled)
            {
                return;
            }

            var existing = force ? null : await LatestEnhanced(path, ct);
            CandidateJob generated;
            if (existing.HasValue)
            {
                var dj = existing.Value.Analysis.GetProperty("features").GetProperty("semanticPhrases").GetProperty("result");
                if (dj.TryGetProperty("djStructure", out var structure) && structure.TryGetProperty("revision", out var revision) && revision.GetString() == "genre-arrangement-v1.1")
                {
                    return;
                }

                using var config = JsonDocument.Parse(await File.ReadAllTextAsync(Options.ConfigFile, ct));
                if (config.RootElement.TryGetProperty("semanticPhrases", out var settings) && settings.TryGetProperty("genreAware", out var enabled) && enabled.ValueKind == JsonValueKind.False)
                {
                    return;
                }

                var source = ImportedAnalysisContract.RequireLibraryPath(MusicPath.Root, path);
                var baseResult = Path.Combine(JobDirectory(existing.Value.Job.JobId), "result", "analysis.json");
                var baseStems = Path.Combine(JobDirectory(existing.Value.Job.JobId), "result", "stems");
                if (Directory.Exists(baseStems))
                {
                    await WorkerGate.WaitAsync(ct);
                    try
                    {
                        generated = await Run(source, null, null, ct, baseResult, true);
                    }
                    finally
                    {
                        WorkerGate.Release();
                    }
                }
                else
                {
                    // Bulk preparation removes heavyweight intermediate stems after a complete
                    // result is committed. A future model revision can still refresh the track by
                    // running a new full candidate rather than failing on a missing cache.
                    generated = await Analyze(new CandidateAnalysisRequest(path), ct);
                }
            }
            else
            {
                generated = await Analyze(new CandidateAnalysisRequest(path), ct);
            }

            var result = await Read(generated.JobId, ct);
            if (!result.ContentCurrent || !result.Analysis.HasValue || !HasEnhanced(result.Analysis.Value))
            {
                throw new InvalidOperationException("Enhanced track failed; missing or failed measurements: "
                    + (result.Analysis.HasValue ? string.Join(", ", FailedMeasurements(result.Analysis.Value).DefaultIfEmpty("required enhanced measurements or full-track result")) : "analysis result")
                    + ". Inspect candidate results; successful measurements were preserved.");
            }

            CacheDjSummary(path, result.Analysis.Value, generated.JobId);
            PruneBulkArtifacts(JobDirectory(generated.JobId), generated.JobId, Log);
        }

        public async Task<JsonElement> EnsureSelectedFeatures(string path, string[] features, CancellationToken ct, bool force = false)
        {
            CandidateFeatureSelection.Validate(features);
            if (features == null)
            {
                throw new ArgumentException("Choose enhanced features for this scan.", nameof(features));
            }

            if (!force)
            {
                foreach (var job in await List(path, ct))
                {
                    if (job.RequestedSeconds != null || !job.Status.StartsWith("completed", StringComparison.Ordinal))
                    {
                        continue;
                    }

                    var existing = await Read(job.JobId, ct);
                    if (existing.ContentCurrent && existing.Analysis.HasValue && HasSelectedFeatures(existing.Analysis.Value, features))
                    {
                        return existing.Analysis.Value;
                    }
                }
            }

            var generated = await Analyze(new CandidateAnalysisRequest(path, Features: features), ct);
            var result = await Read(generated.JobId, ct);
            if (!result.ContentCurrent || !result.Analysis.HasValue || !HasSelectedFeatures(result.Analysis.Value, features))
            {
                throw new InvalidOperationException("Selected enhanced features were not completed for this track.");
            }

            PruneBulkArtifacts(JobDirectory(generated.JobId), generated.JobId, Log);
            return result.Analysis.Value;
        }

        public async Task<IReadOnlyList<CandidateJob>> List(string path, CancellationToken ct)
        {
            RequireStorageConfiguration();
            var source = ImportedAnalysisContract.RequireLibraryPath(MusicPath.Root, path);
            if (Analysis.ResolveMaskedFilename(source) == null)
            {
                throw new ArgumentException("Track is not indexed in the local share.");
            }

            var relative = MusicPath.ToRelative(source);
            var jobs = new List<CandidateJob>();
            foreach (var directory in Directory.EnumerateDirectories(Path.GetFullPath(Options.OutputRoot)))
            {
                ct.ThrowIfCancellationRequested();
                if (!Guid.TryParseExact(Path.GetFileName(directory), "N", out _))
                {
                    continue;
                }

                var jobPath = Path.Combine(directory, "job.json");
                if (File.Exists(jobPath))
                {
                    var job = JsonSerializer.Deserialize<CandidateJob>(await File.ReadAllTextAsync(jobPath, ct));
                    if (job != null && job.LibraryPath == relative)
                    {
                        jobs.Add(job);
                    }
                }
            }

            return jobs.OrderByDescending(job => job.CreatedAt).ToArray();
        }

        public async Task<(CandidateJob Job, JsonElement? Analysis, bool ContentCurrent)> Read(string jobId, CancellationToken ct)
        {
            RequireStorageConfiguration();
            var directory = JobDirectory(jobId);
            var jobPath = Path.Combine(directory, "job.json");
            if (!File.Exists(jobPath))
            {
                throw new FileNotFoundException("Candidate job was not found.");
            }

            var job = JsonSerializer.Deserialize<CandidateJob>(await File.ReadAllTextAsync(jobPath, ct));
            var source = ImportedAnalysisContract.RequireLibraryPath(MusicPath.Root, job.LibraryPath);
            if (Analysis.ResolveMaskedFilename(source) == null)
            {
                throw new ArgumentException("Candidate source is not indexed in the local share.");
            }

            var identity = await Hash(source, ct);
            JsonElement? result = null;
            if (job.Status is "completed" or "completed-with-gaps" or "no-features" or "measurement-failed")
            {
                result = await ReadResult(Path.Combine(directory, "result", "analysis.json"), job, ct);
            }

            return (job, result, identity.Sha256 == job.AudioSha256 && identity.Bytes == job.AudioBytes);
        }

        public async Task<string> StemAudio(string jobId, string stem, CancellationToken ct)
        {
            var fileName = StemFileName(stem);
            var result = await Read(jobId, ct);
            if (!result.Job.Status.StartsWith("completed", StringComparison.Ordinal)
                || !result.ContentCurrent || !result.Analysis.HasValue
                || !result.Analysis.Value.TryGetProperty("featureAvailability", out var availability)
                || !availability.TryGetProperty("stems", out var status)
                || status.ValueKind != JsonValueKind.String
                || status.GetString() != "available")
            {
                throw new FileNotFoundException("A current, completed stem preview was not found.");
            }

            var file = Path.Combine(JobDirectory(jobId), "result", "stems", fileName);
            if (!File.Exists(file) || new FileInfo(file).LinkTarget != null)
            {
                throw new FileNotFoundException("Stem audio was not retained for this result.");
            }

            Log.Information("Serving stem preview {Stem} for candidate job {JobId}", stem, jobId);
            return file;
        }

        public async Task<IReadOnlyList<CandidateJob>> ExportCandidates(CancellationToken ct)
        {
            var result = new List<CandidateJob>();
            if (!StorageAvailable)
            {
                return result;
            }

            RequireStorageConfiguration();
            foreach (var reference in Store.ExportReferences())
            {
                ct.ThrowIfCancellationRequested();
                try
                {
                    var job = JsonSerializer.Deserialize<CandidateJob>(await File.ReadAllTextAsync(Path.Combine(JobDirectory(reference.AnalysisId), "job.json"), ct));
                    if (job is { RequestedSeconds: null, Status: "completed" } && job.LibraryPath == reference.Path)
                    {
                        result.Add(job);
                    }
                }
                catch (Exception exception) when (exception is IOException or JsonException or UnauthorizedAccessException)
                {
                    // Invalid or missing evidence never enters a sharing batch.
                }
            }

            return result;
        }

        public async Task<(CandidateJob Job, JsonElement Analysis)?> LatestExportReady(string path, CancellationToken ct)
        {
            if (!StorageAvailable)
            {
                return null;
            }

            var id = Store.ExportReferenceFor(path);
            if (id == null)
            {
                return null;
            }

            var result = await Read(id, ct);
            return result.Job.Status == "completed" && result.Job.RequestedSeconds == null && result.ContentCurrent
                && result.Analysis.HasValue && ExportAnalysisContract.Ready(result.Analysis.Value)
                ? (result.Job, result.Analysis.Value) : null;
        }

        internal static string StemFileName(string stem) => stem switch
        {
            "vocals" or "drums" or "bass" or "other" => stem + ".wav",
            _ => throw new ArgumentException("Choose a valid stem.", nameof(stem)),
        };

        internal static bool HasSelectedFeatures(JsonElement analysis, string[] features)
        {
            return analysis.TryGetProperty("scope", out var scope)
                && scope.TryGetProperty("fullTrack", out var fullTrack) && fullTrack.ValueKind == JsonValueKind.True
                && analysis.TryGetProperty("featureAvailability", out var availability)
                && availability.ValueKind == JsonValueKind.Object
                && features.All(feature => availability.TryGetProperty(feature, out var status)
                    && status.ValueKind == JsonValueKind.String && status.GetString() == "available");
        }

        internal static double[] CueSeconds(JsonElement analysis)
        {
            if (!analysis.TryGetProperty("featureAvailability", out var availability)
                || !availability.TryGetProperty("cues", out var status)
                || status.ValueKind != JsonValueKind.String || status.GetString() != "available"
                || !analysis.TryGetProperty("features", out var features)
                || !features.TryGetProperty("cues", out var cues)
                || !cues.TryGetProperty("result", out var result)
                || !result.TryGetProperty("cueProposals", out var proposals)
                || proposals.ValueKind != JsonValueKind.Array
                || !analysis.TryGetProperty("durationSeconds", out var durationValue)
                || !durationValue.TryGetDouble(out var duration) || !double.IsFinite(duration) || duration <= 0)
            {
                throw new InvalidOperationException("Current cue proposals are unavailable.");
            }

            return proposals.EnumerateArray()
                .Where(item => item.ValueKind == JsonValueKind.Object
                    && item.TryGetProperty("seconds", out var value)
                    && value.ValueKind == JsonValueKind.Number
                    && value.TryGetDouble(out var seconds)
                    && double.IsFinite(seconds) && seconds >= 0 && seconds <= duration)
                .Select(item => item.GetProperty("seconds").GetDouble())
                .OrderBy(seconds => seconds)
                .DistinctBy(seconds => Math.Round(seconds, 1))
                .Take(8)
                .ToArray();
        }

        internal static bool HasEnhanced(JsonElement document)
        {
            if (!document.TryGetProperty("scope", out var scope)
                || !scope.TryGetProperty("fullTrack", out var full) || !full.GetBoolean()
                || !document.TryGetProperty("featureAvailability", out var availability))
            {
                return false;
            }

            return FailedMeasurements(document).Length == 0
                && new[] { "beats", "semanticPhrases", "vocalPresence", "genre" }.All(name =>
                    availability.TryGetProperty(name, out var value) && value.GetString() == "available");
        }

        internal static string[] FailedMeasurements(JsonElement document)
        {
            if (!document.TryGetProperty("featureAvailability", out var availability)
                || availability.ValueKind != JsonValueKind.Object)
            {
                return ["featureAvailability"];
            }

            return availability.EnumerateObject().Where(feature =>
            {
                if (feature.Value.GetString() is "available" or "skipped")
                {
                    return false;
                }

                // A deliberately disabled measurement was not requested. Missing models,
                // execution errors and other unavailable measurements still fail the track.
                return !(feature.Value.GetString() == "unavailable"
                    && document.TryGetProperty("features", out var features)
                    && features.TryGetProperty(feature.Name, out var result)
                    && result.TryGetProperty("reason", out var reason)
                    && reason.GetString()?.Replace(" ", string.Empty, StringComparison.Ordinal)
                        .Equals("Disabledinexplicitconfiguration", StringComparison.OrdinalIgnoreCase) == true);
            }).Select(feature => feature.Name).ToArray();
        }

        internal static void LogMeasurementFailures(JsonElement result, string source, string jobId, ILogger log)
        {
            foreach (var measurement in FailedMeasurements(result))
            {
                var reason = result.TryGetProperty("features", out var features)
                    && features.TryGetProperty(measurement, out var feature)
                    && feature.TryGetProperty("reason", out var detail) ? detail.GetString() : "No usable result returned";
                log.Warning("Analysis measurement failed for {Path}: {Measurement}; {Reason}; job {JobId}", source, measurement, reason, jobId);
            }
        }

        internal static CandidateInferenceDevice ReadInferenceDevice(JsonElement result)
        {
            if (!result.TryGetProperty("features", out var features)
                || features.ValueKind != JsonValueKind.Object
                || !features.TryGetProperty("stems", out var stems)
                || stems.ValueKind != JsonValueKind.Object
                || !stems.TryGetProperty("result", out var details)
                || details.ValueKind != JsonValueKind.Object
                || !details.TryGetProperty("device", out var deviceValue)
                || deviceValue.ValueKind != JsonValueKind.String)
            {
                return null;
            }

            var device = deviceValue.GetString();
            if (device is not ("cpu" or "cuda"))
            {
                return null;
            }

            var attempted = details.TryGetProperty("gpuAttempted", out var attemptedValue)
                && attemptedValue.ValueKind == JsonValueKind.True;
            var fallback = details.TryGetProperty("gpuFallback", out var fallbackValue)
                && fallbackValue.ValueKind == JsonValueKind.String ? fallbackValue.GetString() : null;
            var peak = details.TryGetProperty("gpuPeakAllocatedBytes", out var peakValue)
                && peakValue.ValueKind == JsonValueKind.Number && peakValue.TryGetInt64(out var value) ? value : 0;
            return new CandidateInferenceDevice(device, attempted, fallback, peak);
        }

        internal void CacheDjSummary(string path, JsonElement analysis, string analysisId)
        {
            var summary = CrateAnalysisSummary.Create(analysis, analysisId);
            if (summary == null)
            {
                return;
            }

            lock (SummaryGate)
            {
                if (Store.SaveDjSummary(path, summary))
                {
                    _ = Hub?.BroadcastLibraryUpdatedAsync(0, 1, 0);
                }
            }
        }

        private static void PruneBulkArtifacts(string jobDirectory, string jobId, ILogger log)
        {
            var resultDirectory = Path.Combine(jobDirectory, "result");
            try
            {
                foreach (var path in Directory.EnumerateFileSystemEntries(resultDirectory))
                {
                    if (Path.GetFileName(path) == "analysis.json")
                    {
                        continue;
                    }

                    if (Directory.Exists(path))
                    {
                        Directory.Delete(path, true);
                    }
                    else
                    {
                        File.Delete(path);
                    }
                }

                var analysis = Path.Combine(resultDirectory, "analysis.json");
                var compressed = analysis + ".gz";
                var temporary = compressed + ".tmp";
                using (var input = new FileStream(analysis, FileMode.Open, FileAccess.Read, FileShare.Read))
                using (var output = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                using (var gzip = new GZipStream(output, CompressionLevel.SmallestSize))
                {
                    input.CopyTo(gzip);
                }

                File.Move(temporary, compressed, true);
                File.Delete(analysis);
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
            {
                // Retention is safe but expensive. Never turn a valid completed analysis into a
                // failure solely because temporary evidence could not be reclaimed.
                log.Warning("Could not prune intermediate artifacts for enhanced job {JobId}: {Error}", jobId, exception.Message);
            }
        }

        private static async Task<(string Sha256, long Bytes)> Hash(string path, CancellationToken ct)
        {
            await using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 65536, true);
            var bytes = file.Length;
            return (Convert.ToHexString(await SHA256.HashDataAsync(file, ct)).ToLowerInvariant(), bytes);
        }

        private static async Task<string> Drain(StreamReader reader, CancellationToken ct)
        {
            const int limit = 65536;
            var result = new StringBuilder();
            var buffer = new char[4096];
            int count;
            try
            {
                while ((count = await reader.ReadAsync(buffer.AsMemory(), ct)) > 0)
                {
                    if (result.Length < limit)
                    {
                        result.Append(buffer, 0, Math.Min(count, limit - result.Length));
                    }
                }
            }
            catch (OperationCanceledException)
            {
                // A timeout/cancelled job may have truncated diagnostics.
            }
            catch (IOException) when (ct.IsCancellationRequested)
            {
                // Owned process termination can close a redirected pipe during a read.
            }

            return result.ToString();
        }

        private static async Task WriteJob(string directory, CandidateJob job, CancellationToken ct)
        {
            var temporary = Path.Combine(directory, "job-" + Guid.NewGuid().ToString("N") + ".tmp");
            await File.WriteAllTextAsync(temporary, JsonSerializer.Serialize(job), ct);
            File.Move(temporary, Path.Combine(directory, "job.json"), true);
        }

        private void RequireStorageConfiguration()
        {
            if (!StorageAvailable)
            {
                throw new InvalidOperationException("Saved full-track analysis is not available on this server.");
            }

            var music = Path.TrimEndingDirectorySeparator(Path.GetFullPath(MusicPath.Root));
            var output = Path.GetFullPath(Options.OutputRoot);
            if (output == music || output.StartsWith(music + Path.DirectorySeparatorChar, StringComparison.Ordinal))
            {
                throw new InvalidOperationException("Saved analysis must be outside the music library.");
            }
        }

        private void RequireConfiguration()
        {
            if (!Options.Enabled)
            {
                throw new InvalidOperationException("Independent candidate analysis is not configured on this server.");
            }

            foreach (var path in new[] { Options.PythonExecutable, Options.WorkerScript, Options.ConfigFile, Options.OutputRoot })
            {
                if (!Path.IsPathFullyQualified(path))
                {
                    throw new InvalidOperationException("Candidate worker paths must be absolute startup configuration.");
                }
            }

            if (!File.Exists(Options.PythonExecutable) || !File.Exists(Options.WorkerScript) || !File.Exists(Options.ConfigFile)
                || Options.TimeoutSeconds < 1 || Options.TimeoutSeconds > 3600 || Options.MaxResultBytes < 1024)
            {
                throw new InvalidOperationException("Candidate worker configuration is unavailable or invalid.");
            }

            var output = Path.GetFullPath(Options.OutputRoot);
            var music = Path.TrimEndingDirectorySeparator(Path.GetFullPath(MusicPath.Root));
            if (output == music || output.StartsWith(music + Path.DirectorySeparatorChar, StringComparison.Ordinal))
            {
                throw new InvalidOperationException("Candidate output must be outside the music library.");
            }

            Directory.CreateDirectory(output);
        }

        private string JobDirectory(string jobId)
        {
            if (!Guid.TryParseExact(jobId, "N", out _))
            {
                throw new ArgumentException("Invalid candidate job ID.");
            }

            return Path.Combine(Path.GetFullPath(Options.OutputRoot), jobId);
        }

        private async Task<CandidateJob> Run(string source, double? seconds, string[] features, CancellationToken ct, string reuseCandidate = null, bool refreshDjOnly = false)
        {
            var jobId = Guid.NewGuid().ToString("N");
            var directory = JobDirectory(jobId);
            Directory.CreateDirectory(directory);
            var input = Path.Combine(directory, "input" + Path.GetExtension(source));
            var resultDirectory = Path.Combine(directory, "result");
            (string Sha256, long Bytes) identity = default;
            CandidateJob job = null;
            var configSnapshot = Path.Combine(directory, "config.json");
            try
            {
                await using (var original = new FileStream(source, FileMode.Open, FileAccess.Read, FileShare.Read, 65536, true))
                await using (var copy = new FileStream(input, FileMode.CreateNew, FileAccess.Write, FileShare.None, 65536, true))
                {
                    await original.CopyToAsync(copy, ct);
                }

                File.SetAttributes(input, File.GetAttributes(input) | FileAttributes.ReadOnly);
                identity = await Hash(input, ct);
                job = new CandidateJob(jobId, "running", MusicPath.ToRelative(source), identity.Sha256, identity.Bytes, DateTimeOffset.UtcNow, seconds);
                await WriteJob(directory, job, ct);
                var selectedConfig = CandidateFeatureSelection.Apply(await File.ReadAllTextAsync(Options.ConfigFile, ct), features);
                await File.WriteAllTextAsync(configSnapshot, selectedConfig, ct);
                var configurationHash = await Hash(configSnapshot, ct);
                var workerHash = await Hash(Options.WorkerScript, ct);
                await File.WriteAllTextAsync(Path.Combine(directory, "provenance.json"), JsonSerializer.Serialize(new
                {
                    sourceKind = "independent-candidate",
                    workerSha256 = workerHash.Sha256,
                    configSha256 = configurationHash.Sha256,
                    pythonExecutable = Options.PythonExecutable,
                    workerScript = Options.WorkerScript,
                    configFile = Options.ConfigFile,
                    requestedSeconds = seconds,
                    requestedFeatures = features,
                    nativeAnalysisChanged = false,
                    importedAnalysisChanged = false,
                    tagsChanged = false,
                }), ct);
            }
            catch
            {
                if (File.Exists(input))
                {
                    File.SetAttributes(input, FileAttributes.Normal);
                    File.Delete(input);
                }

                Directory.Delete(directory, true);
                throw;
            }

            var start = new ProcessStartInfo(Options.PythonExecutable)
            {
                WorkingDirectory = Path.GetDirectoryName(Options.WorkerScript),
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            var threads = Resources.ThreadsPerJob.ToString(CultureInfo.InvariantCulture);
            start.Environment["RESONANCE_ANALYSIS_THREADS"] = threads;
            start.Environment["OMP_NUM_THREADS"] = threads;
            start.Environment["MKL_NUM_THREADS"] = threads;
            start.Environment["OPENBLAS_NUM_THREADS"] = threads;
            start.Environment["NUMEXPR_NUM_THREADS"] = threads;
            start.Environment["OMP_DYNAMIC"] = "FALSE";
            start.Environment["MKL_DYNAMIC"] = "FALSE";
            start.ArgumentList.Add(Options.WorkerScript);
            start.ArgumentList.Add(input);
            start.ArgumentList.Add("--config");
            start.ArgumentList.Add(configSnapshot);
            start.ArgumentList.Add("--output-dir");
            start.ArgumentList.Add(resultDirectory);
            if (seconds.HasValue)
            {
                start.ArgumentList.Add("--seconds");
                start.ArgumentList.Add(seconds.Value.ToString("R", CultureInfo.InvariantCulture));
            }

            if (reuseCandidate != null)
            {
                start.ArgumentList.Add("--reuse-candidate");
                start.ArgumentList.Add(reuseCandidate);
                if (refreshDjOnly)
                {
                    start.ArgumentList.Add("--refresh-dj-only");
                }
            }

            using var process = new Process { StartInfo = start };
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(Options.TimeoutSeconds));
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, timeout.Token);
            string stdout = string.Empty;
            string stderr = string.Empty;
            var terminationFailed = false;
            try
            {
                BackgroundAnalysisWork.Start(process);
                var outputTask = Drain(process.StandardOutput, linked.Token);
                var errorTask = Drain(process.StandardError, linked.Token);
                try
                {
                    await process.WaitForExitAsync(linked.Token);
                }
                catch (OperationCanceledException)
                {
                    if (!process.HasExited)
                    {
                        try
                        {
                            process.Kill(entireProcessTree: true);
                        }
                        catch (Win32Exception)
                        {
                            terminationFailed = true;
                        }
                    }

                    if (!terminationFailed)
                    {
                        using var cleanupTimeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
                        try
                        {
                            await process.WaitForExitAsync(cleanupTimeout.Token);
                        }
                        catch (OperationCanceledException)
                        {
                            terminationFailed = true;
                        }
                    }

                    throw;
                }
                finally
                {
                    stdout = await outputTask;
                    stderr = await errorTask;
                }

                if (process.ExitCode != 0)
                {
                    job = job with { Status = "worker-failed" };
                    Log.Warning("Enhanced analysis worker failed for {Path}: exit code {ExitCode}; job {JobId}", source, process.ExitCode, job.JobId);
                }
                else
                {
                    var result = await ReadResult(Path.Combine(resultDirectory, "analysis.json"), job, ct);
                    var failures = FailedMeasurements(result);
                    var status = failures.Length > 0 ? "measurement-failed"
                        : result.GetProperty("featureAvailability").EnumerateObject().Any(feature => feature.Value.GetString() == "available") ? "completed" : "no-features";
                    LogMeasurementFailures(result, source, job.JobId, Log);
                    var inference = ReadInferenceDevice(result);
                    if (inference != null)
                    {
                        Log.Information(
                            "Enhanced analysis stem device {Device} for {Path}; GPU attempted {GpuAttempted}, fallback {GpuFallback}, peak allocated {GpuPeakMiB} MiB; job {JobId}",
                            inference.Device, source, inference.GpuAttempted, inference.Fallback,
                            inference.PeakBytes / (1024 * 1024), job.JobId);
                    }

                    var after = await Hash(input, ct);
                    job = job with { Status = after == identity ? status : "input-changed" };
                }
            }
            catch (OperationCanceledException)
            {
                job = job with { Status = terminationFailed ? "termination-failed" : ct.IsCancellationRequested ? "cancelled" : "timed-out" };
            }
            catch (Exception exception) when (exception is IOException || exception is InvalidOperationException || exception is JsonException || exception is ArgumentException || exception is KeyNotFoundException || exception is Win32Exception)
            {
                job = job with { Status = "invalid-result" };
            }
            finally
            {
                await WriteJob(directory, job, CancellationToken.None);
                await File.WriteAllTextAsync(Path.Combine(directory, "process-output.json"), JsonSerializer.Serialize(new { stdout, stderr }), CancellationToken.None);

                if (terminationFailed)
                {
                    await File.WriteAllTextAsync(Path.Combine(directory, "lifecycle-warning.json"), JsonSerializer.Serialize(new
                    {
                        ownedProcessTerminationConfirmed = false,
                        inputCopyRetained = true,
                        processId = process.Id,
                        message = "Owned process termination could not be confirmed; retain its isolated input copy for lifecycle recovery.",
                    }), CancellationToken.None);
                }
                else
                {
                    // Retain result/provenance, not a second full music collection.
                    File.SetAttributes(input, FileAttributes.Normal);
                    File.Delete(input);
                }
            }

            return job;
        }

        private async Task<JsonElement> ReadResult(string path, CandidateJob job, CancellationToken ct)
        {
            string json;
            var file = new FileInfo(path);
            if (file.Exists)
            {
                if (file.Length > Options.MaxResultBytes)
                {
                    throw new IOException("Candidate result is missing or exceeds the configured size limit.");
                }

                json = await File.ReadAllTextAsync(path, ct);
            }
            else
            {
                file = new FileInfo(path + ".gz");
                if (!file.Exists || file.Length > Options.MaxResultBytes)
                {
                    throw new IOException("Candidate result is missing or exceeds the configured size limit.");
                }

                await using var input = file.OpenRead();
                await using var gzip = new GZipStream(input, CompressionMode.Decompress);
                using var reader = new StreamReader(gzip, Encoding.UTF8);
                json = await reader.ReadToEndAsync(ct);
                if (Encoding.UTF8.GetByteCount(json) > Options.MaxResultBytes)
                {
                    throw new IOException("Candidate result is missing or exceeds the configured size limit.");
                }
            }

            using var document = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = 64 });
            var root = document.RootElement;
            var audio = root.GetProperty("audioIdentity");
            if (root.GetProperty("schemaVersion").GetInt32() != 1
                || root.GetProperty("sourceKind").GetString() != "independent-candidate"
                || audio.GetProperty("sha256").GetString() != job.AudioSha256
                || audio.GetProperty("bytes").GetInt64() != job.AudioBytes
                || root.GetProperty("features").ValueKind != JsonValueKind.Object
                || root.GetProperty("featureAvailability").ValueKind != JsonValueKind.Object)
            {
                throw new JsonException("Candidate result identity/schema does not match the job.");
            }

            return root.Clone();
        }
    }
}
