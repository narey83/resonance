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
    using System.Linq;
    using System.Security.Cryptography;
    using System.Text;
    using System.Text.Json;
    using System.Threading;
    using System.Threading.Tasks;
    using resonance.Analysis.Imports;
    using resonance.Common;

    public record CandidateJob(string JobId, string Status, string LibraryPath, string AudioSha256, long AudioBytes, DateTimeOffset CreatedAt, double? RequestedSeconds, string SourceKind = "independent-candidate");

    public class CandidateAnalysisService
    {
        public CandidateAnalysisService(CandidateAnalysisOptions options, IAnalysisService analysis, AnalysisStore store)
        {
            Options = options;
            Analysis = analysis;
            Store = store;
        }

        private AnalysisStore Store { get; }

        public bool Enabled => Options.Enabled;

        private CandidateAnalysisOptions Options { get; }

        private IAnalysisService Analysis { get; }

        // Candidate jobs use a separate queue and store; they never join the native auto-scan queue.
        private SemaphoreSlim WorkerGate { get; } = new(1, 1);

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
                return await Run(source, request.Seconds, request.Features, ct);
            }
            finally
            {
                WorkerGate.Release();
            }
        }

        internal static bool HasEnhanced(JsonElement document)
        {
            if (!document.TryGetProperty("scope", out var scope)
                || !scope.TryGetProperty("fullTrack", out var full) || !full.GetBoolean()
                || !document.TryGetProperty("featureAvailability", out var availability))
            {
                return false;
            }

            return new[] { "beats", "semanticPhrases", "vocalPresence", "genre" }.All(name =>
                availability.TryGetProperty(name, out var value) && value.GetString() == "available");
        }

        public async Task<(CandidateJob Job, JsonElement Analysis)?> LatestEnhanced(string path, CancellationToken ct)
        {
            if (!Enabled)
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

        internal void CacheDjSummary(string path, JsonElement analysis, string analysisId)
        {
            var features = analysis.GetProperty("features");
            var scores = features.GetProperty("genre").GetProperty("result").GetProperty("scores").EnumerateArray();
            var genre = scores.OrderByDescending(score => score.GetProperty("cosine").GetDouble()).FirstOrDefault();
            double? energy = null;
            if (features.TryGetProperty("energy", out var feature) && feature.TryGetProperty("result", out var result)
                && result.TryGetProperty("rms", out var rms) && rms.GetArrayLength() > 0)
                energy = rms.EnumerateArray().Average(value => value.GetDouble());
            var voice = features.GetProperty("vocalPresence").GetProperty("result");
            var vocals = voice.GetProperty("segments").GetArrayLength() > 0;
            if (voice.TryGetProperty("processedVoice", out var speech) && speech.TryGetProperty("sustainedSegments", out var spans))
                vocals |= spans.GetArrayLength() > 0;
            var arrangement = features.GetProperty("semanticPhrases").GetProperty("result");
            var automatic = arrangement.TryGetProperty("djStructure", out var dj) && dj.TryGetProperty("automatic", out var auto) && auto.ValueKind == JsonValueKind.True;
            var neutralPhrases = automatic ? dj.GetProperty("segments").EnumerateArray().Count(segment => segment.GetProperty("label").GetString() == "Transition") : 0;
            Store.SaveDjSummary(path, JsonSerializer.Serialize(new {
                complete = true, experimental = true, analysisId,
                genre = genre.ValueKind == JsonValueKind.Object ? genre.GetProperty("label").GetString() : null,
                energy, energySemantics = "Mean PCM RMS; loudness-based energy proxy", vocals,
                automaticArrangement = automatic, neutralPhraseCount = neutralPhrases,
                reviewReason = automatic ? null : "Independent predictions; audition beatgrid and phrase labels"
            }));
        }

        public async Task EnsureEnhanced(string path, CancellationToken ct, bool force = false)
        {
            if (!Enabled) return;
            var existing = force ? null : await LatestEnhanced(path, ct);
            CandidateJob generated;
            if (existing.HasValue)
            {
                var dj = existing.Value.Analysis.GetProperty("features").GetProperty("semanticPhrases").GetProperty("result");
                if (dj.TryGetProperty("djStructure", out var structure) && structure.TryGetProperty("revision", out var revision) && revision.GetString() == "genre-arrangement-v1.1") return;
                using var config = JsonDocument.Parse(await File.ReadAllTextAsync(Options.ConfigFile, ct));
                if (config.RootElement.TryGetProperty("semanticPhrases", out var settings) && settings.TryGetProperty("genreAware", out var enabled) && enabled.ValueKind == JsonValueKind.False) return;
                var source = ImportedAnalysisContract.RequireLibraryPath(MusicPath.Root, path);
                await WorkerGate.WaitAsync(ct);
                try
                {
                    generated = await Run(source, null, null, ct, Path.Combine(JobDirectory(existing.Value.Job.JobId), "result", "analysis.json"), true);
                }
                finally { WorkerGate.Release(); }
            }
            else generated = await Analyze(new CandidateAnalysisRequest(path), ct);
            var result = await Read(generated.JobId, ct);
            if (!result.ContentCurrent || !result.Analysis.HasValue || !HasEnhanced(result.Analysis.Value))
            {
                throw new InvalidOperationException("Enhanced full-track analysis has missing features; inspect candidate results.");
            }
            CacheDjSummary(path, result.Analysis.Value, generated.JobId);
        }

        public async Task<IReadOnlyList<CandidateJob>> List(string path, CancellationToken ct)
        {
            RequireConfiguration();
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
            RequireConfiguration();
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
            if (job.Status is "completed" or "completed-with-gaps" or "no-features")
            {
                result = await ReadResult(Path.Combine(directory, "result", "analysis.json"), job, ct);
            }

            return (job, result, identity.Sha256 == job.AudioSha256 && identity.Bytes == job.AudioBytes);
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
                if (refreshDjOnly) start.ArgumentList.Add("--refresh-dj-only");
            }

            using var process = new Process { StartInfo = start };
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(Options.TimeoutSeconds));
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, timeout.Token);
            string stdout = string.Empty;
            string stderr = string.Empty;
            var terminationFailed = false;
            try
            {
                process.Start();
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
                }
                else
                {
                    var result = await ReadResult(Path.Combine(resultDirectory, "analysis.json"), job, ct);
                    var states = result.GetProperty("featureAvailability").EnumerateObject().Select(feature => feature.Value.GetString()).ToArray();
                    var status = !states.Contains("available") ? "no-features" : states.Any(state => state is not ("available" or "skipped")) ? "completed-with-gaps" : "completed";
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
            var file = new FileInfo(path);
            if (!file.Exists || file.Length > Options.MaxResultBytes)
            {
                throw new IOException("Candidate result is missing or exceeds the configured size limit.");
            }

            using var document = JsonDocument.Parse(await File.ReadAllTextAsync(path, ct), new JsonDocumentOptions { MaxDepth = 64 });
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
