// <copyright file="BridgeLibraryBatchService.cs" company="John Narey">
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

namespace resonance.Analysis.UsbExport
{
    using System;
    using System.Collections.Generic;
    using System.IO;
    using System.Linq;
    using System.Security.Cryptography;
    using System.Text;
    using System.Text.Json;
    using System.Threading;
    using System.Threading.Tasks;
    using Microsoft.Extensions.Hosting;
    using resonance.Analysis.Candidates;
    using resonance.Common;
    using Serilog;

    public record BridgeBatch(string Id, int Tracks, long EstimatedBytes);
    public record BridgeLibraryView(int Protocol, string Revision, int IndexedTracks, int ReadyTracks,
        string Status, string Message, BridgeBatch[] Batches, UsbExportJob Job = null);

    /// <summary>Builds bounded, reusable batches from verified full-track analysis only.</summary>
    public sealed class BridgeLibraryBatchService : BackgroundService
    {
        internal const long BatchByteLimit = 2L << 30;
        internal const int BatchTrackLimit = 100;
        private const long CacheByteLimit = 20L << 30;
        private readonly object gate = new();
        private readonly IAnalysisService analysis;
        private readonly CandidateAnalysisService candidates;
        private readonly UsbExportService exports;
        private readonly string stateFile;
        private readonly Dictionary<string, BatchJob> jobs = new(StringComparer.Ordinal);
        private readonly Dictionary<string, int> leases = new(StringComparer.Ordinal);
        private readonly Dictionary<string, VerifiedTrack> verified = new(StringComparer.Ordinal);
        private readonly Dictionary<string, BatchInput> inputs = new(StringComparer.Ordinal);
        private BridgeLibraryView view = new(2, string.Empty, 0, 0, "checking-analysis", "Checking export-ready full-track analysis.", Array.Empty<BridgeBatch>());
        private DateTimeOffset refreshAt = DateTimeOffset.MinValue;

        public BridgeLibraryBatchService(IAnalysisService analysis, CandidateAnalysisService candidates, UsbExportService exports)
        {
            this.analysis = analysis;
            this.candidates = candidates;
            this.exports = exports;
            stateFile = Path.Combine(Program.DataDirectory ?? Path.Combine(Program.AppDirectory ?? AppContext.BaseDirectory, "data"), "bridge-network-batches.json");
            try
            {
                if (File.Exists(stateFile) && new FileInfo(stateFile).Length <= 32 << 20)
                {
                    foreach (var pair in JsonSerializer.Deserialize<Dictionary<string, BatchJob>>(File.ReadAllText(stateFile)) ?? new())
                    {
                        if (Digest(pair.Key) && Guid.TryParseExact(pair.Value.JobId, "N", out _))
                        {
                            jobs[pair.Key] = pair.Value;
                        }
                    }
                }
            }
            catch (Exception exception) when (exception is IOException or JsonException or UnauthorizedAccessException)
            {
                Log.Warning("Bridge batch checkpoint could not be read; completed batches will be rebuilt on demand");
            }
        }

        public BridgeLibraryView Status
        {
            get
            {
                lock (gate)
                {
                    return view;
                }
            }
        }

        private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", "Bridge");

        public BridgeLibraryView Request(string batch)
        {
            lock (gate)
            {
                if (string.IsNullOrEmpty(batch) || view.Status != "ready")
                {
                    return view;
                }

                if (!Digest(batch) || !inputs.TryGetValue(batch, out var input))
                {
                    return view with { Status = "refresh-required", Message = "Library changed. Refresh the batch manifest." };
                }

                if (jobs.TryGetValue(batch, out var cached))
                {
                    var job = ReadJob(cached.JobId);
                    if (job?.Status is "failed" or "cancelled")
                    {
                        if (cached.RetryAt == default)
                        {
                            cached = cached with { RetryAt = DateTimeOffset.UtcNow.AddMinutes(5) };
                            jobs[batch] = cached;
                            Log.Warning("Bridge batch {BatchId} failed; retry delayed for five minutes", batch[..12]);
                        }

                        if (DateTimeOffset.UtcNow >= cached.RetryAt && leases.GetValueOrDefault(cached.JobId) == 0 && exports.RemoveStagedJob(cached.JobId))
                        {
                            jobs.Remove(batch);
                            job = null;
                        }
                    }

                    if (job != null && (job.Status != "completed" || File.Exists(exports.Download(job.JobId))))
                    {
                        if (job.Status != cached.LastStatus)
                        {
                            Log.Information("Bridge batch {BatchId} is {BatchStatus}; {Prepared}/{Total} tracks", batch[..12], job.Status, job.Prepared, job.Total);
                            jobs[batch] = cached with { LastStatus = job.Status };
                        }

                        return view with { Job = job, Status = job.Status == "completed" ? "ready" : job.Status, Message = job.Status == "failed" ? "Batch preparation failed. Review Bridge server logs; the working local collection is preserved." : "Preparing a bounded batch of fully analysed tracks." };
                    }

                    exports.RemoveStagedJob(cached.JobId);
                    jobs.Remove(batch);
                }

                PruneExpired();
                if (jobs.Values.Select(item => ReadJob(item.JobId)).Any(job => job != null && job.Status is not ("completed" or "failed" or "cancelled")))
                {
                    return view with { Status = "waiting-turn", Message = "Another Bridge batch is being prepared. Waiting for the export worker." };
                }

                var bytes = jobs.Values.Sum(item => exports.StagedBytes(item.JobId));
                if (bytes + (input.Descriptor.EstimatedBytes * 2) > CacheByteLimit)
                {
                    return view with { Status = "waiting-storage", Message = "Server batch cache is full. Waiting for completed downloads to be acknowledged." };
                }

                try
                {
                    var job = exports.Start(new UsbExportRequest(input.Paths, "Resonance Library", "legacy"));
                    jobs[batch] = new(job.JobId, DateTimeOffset.UtcNow, job.Status);
                    Save();
                    Log.Information("Bridge batch {BatchId} queued with {Tracks} fully analysed tracks", batch[..12], input.Paths.Length);
                    return view with { Job = job, Status = "queued", Message = "Preparing a batch of fully analysed tracks." };
                }
                catch (Exception exception) when (exception is IOException or InvalidOperationException or ArgumentException or UnauthorizedAccessException)
                {
                    Log.Error(exception, "Bridge batch {BatchId} could not start", batch[..12]);
                    return view with { Status = "preparation-failed", Message = "The export worker could not start this batch. Review Bridge server logs." };
                }
            }
        }

        public bool TryAcquireDownload(string id, out string path, out Action release)
        {
            lock (gate)
            {
                path = null;
                release = null;
                if (!jobs.Values.Any(job => job.JobId == id))
                {
                    return false;
                }

                var job = ReadJob(id);
                if (job?.Status != "completed")
                {
                    return false;
                }

                path = exports.Download(id);
                if (!File.Exists(path))
                {
                    return false;
                }

                leases[id] = leases.GetValueOrDefault(id) + 1;
                var released = 0;
                release = () =>
                {
                    if (Interlocked.Exchange(ref released, 1) != 0)
                    {
                        return;
                    }

                    lock (gate)
                    {
                        leases[id] = Math.Max(0, leases.GetValueOrDefault(id) - 1);
                    }
                };
                return true;
            }
        }

        public bool Acknowledge(string batch, string id)
        {
            lock (gate)
            {
                if (!Digest(batch) || !Guid.TryParseExact(id, "N", out _))
                {
                    return false;
                }

                if (!jobs.TryGetValue(batch, out var job))
                {
                    return true;
                }

                if (job.JobId != id)
                {
                    return false;
                }

                if (leases.GetValueOrDefault(id) != 0)
                {
                    return false;
                }

                if (!exports.RemoveStagedJob(id))
                {
                    return false;
                }

                jobs.Remove(batch);
                leases.Remove(id);
                Save();
                Log.Information("Bridge batch {BatchId} acknowledged; server staging released", batch[..12]);
                return true;
            }
        }

        internal static BatchInput[] Plan(IEnumerable<VerifiedTrack> tracks)
        {
            var batches = new List<BatchInput>();

            // Stable hash buckets keep a new track from reshuffling the whole collection.
            foreach (var bucket in tracks.GroupBy(track => track.SourceKey[..2]).OrderBy(group => group.Key, StringComparer.Ordinal))
            {
                var current = new List<VerifiedTrack>();
                long bytes = 0;
                void Flush()
                {
                    if (current.Count == 0)
                    {
                        return;
                    }

                    var id = Hash(string.Join("|", current.Select(track => track.SourceKey + ":" + track.SourceSha256 + ":" + track.AnalysisId)));
                    batches.Add(new(new(id, current.Count, bytes), current.Select(track => track.Path).ToArray()));
                    current.Clear();
                    bytes = 0;
                }

                foreach (var track in bucket.OrderBy(track => track.SourceKey, StringComparer.Ordinal))
                {
                    if (current.Count > 0 && (current.Count >= BatchTrackLimit || bytes + track.EstimatedBytes > BatchByteLimit))
                    {
                        Flush();
                    }

                    current.Add(track);
                    bytes += track.EstimatedBytes;
                }

                Flush();
            }

            return batches.ToArray();
        }

        internal async Task Refresh(CancellationToken ct)
        {
            var indexed = analysis.GetAllTracks().Select(track => MusicPath.ToRelative(track.OriginalFilename)).ToHashSet(StringComparer.Ordinal);
            var ready = new List<VerifiedTrack>();
            var observed = new HashSet<string>(StringComparer.Ordinal);
            foreach (var job in (await candidates.ExportCandidates(ct)).OrderByDescending(job => job.CreatedAt))
            {
                ct.ThrowIfCancellationRequested();
                if (!indexed.Contains(job.LibraryPath) || observed.Contains(job.LibraryPath))
                {
                    continue;
                }

                try
                {
                    var path = ImportedAnalysisContractPath(job.LibraryPath);
                    var file = new FileInfo(path);
                    if (!file.Exists)
                    {
                        continue;
                    }

                    if (verified.TryGetValue(job.JobId, out var cached) && cached.Bytes == file.Length && cached.Modified == file.LastWriteTimeUtc.Ticks)
                    {
                        ready.Add(cached);
                        observed.Add(job.LibraryPath);
                        continue;
                    }

                    var result = await candidates.Read(job.JobId, ct);
                    if (!result.ContentCurrent || !result.Analysis.HasValue || !ExportAnalysisContract.Ready(result.Analysis.Value))
                    {
                        continue;
                    }

                    var duration = result.Analysis.Value.GetProperty("durationSeconds").GetDouble();
                    var estimate = checked((long)Math.Ceiling(duration * 44100 * 4) + (1 << 20));
                    if (estimate > uint.MaxValue)
                    {
                        continue;
                    }

                    var key = Hash(job.LibraryPath);
                    var entry = new VerifiedTrack(path, key, job.JobId, job.AudioSha256, file.Length, file.LastWriteTimeUtc.Ticks, estimate);
                    ready.Add(entry);
                    verified[job.JobId] = entry;
                    observed.Add(job.LibraryPath);
                }
                catch (Exception exception) when (exception is IOException or JsonException or ArgumentException or InvalidOperationException or KeyNotFoundException or UnauthorizedAccessException or OverflowException)
                {
                    Log.Debug("Bridge analysis {AnalysisId} is not export-ready ({Reason})", job.JobId, exception.GetType().Name);
                }
            }

            var planned = Plan(ready);
            var revision = Hash(string.Join("|", planned.Select(batch => batch.Descriptor.Id)));
            var status = !exports.Enabled ? "waiting-worker" : ready.Count == 0 ? "waiting-analysis" : ready.Count > 65535 ? "player-limit" : "ready";
            var message = status switch
            {
                "waiting-worker" => "Connected. The server export worker is not configured.",
                "waiting-analysis" => "Connected. No tracks have current, complete full-track analysis ready for sharing.",
                "player-limit" => "This player protocol supports at most 65,535 tracks in one collection.",
                _ => $"{ready.Count} fully analysed tracks are ready in {planned.Length} resumable batches.",
            };
            lock (gate)
            {
                if (view.Revision != revision || view.Status != status || view.IndexedTracks != indexed.Count)
                {
                    Log.Information("Bridge readiness: {ReadyTracks}/{IndexedTracks} export-ready tracks; {Batches} batches; {Readiness}", ready.Count, indexed.Count, planned.Length, status);
                }

                inputs.Clear();
                foreach (var batch in planned)
                {
                    inputs[batch.Descriptor.Id] = batch;
                }

                view = new(2, revision, indexed.Count, ready.Count, status, message, planned.Select(batch => batch.Descriptor).ToArray());
                PruneExpired();
            }

            var retained = ready.Select(entry => entry.AnalysisId).ToHashSet(StringComparer.Ordinal);
            foreach (var id in verified.Keys.Where(id => !retained.Contains(id)).ToArray())
            {
                verified.Remove(id);
            }
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                if (DateTimeOffset.UtcNow >= refreshAt)
                {
                    try
                    {
                        await Refresh(stoppingToken);
                    }
                    catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                    {
                        return;
                    }
                    catch (Exception exception)
                    {
                        Log.Error(exception, "Bridge readiness check failed; no unverified tracks will be exported");
                        lock (gate)
                        {
                            view = view with { Status = "readiness-failed", Message = "Full-analysis verification failed. Review Bridge server logs." };
                        }
                    }

                    refreshAt = DateTimeOffset.UtcNow.AddMinutes(2);
                }

                await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken);
            }
        }

        private static string ImportedAnalysisContractPath(string path) => Imports.ImportedAnalysisContract.RequireLibraryPath(MusicPath.Root, path);
        private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
        private static bool Digest(string value) => value?.Length == 64 && value.All(character => character is (>= '0' and <= '9') or (>= 'a' and <= 'f'));
        private UsbExportJob ReadJob(string id)
        {
            try
            {
                return exports.Read(id);
            }
            catch (Exception exception) when (exception is IOException or JsonException or UnauthorizedAccessException or ArgumentException)
            {
                Log.Debug("Bridge staged job {JobId} needs rebuilding ({Reason})", id, exception.GetType().Name);
                return null;
            }
        }

        private void PruneExpired()
        {
            foreach (var pair in jobs.Where(pair => pair.Value.Requested < DateTimeOffset.UtcNow.AddHours(-2)).ToArray())
            {
                if (leases.GetValueOrDefault(pair.Value.JobId) == 0 && exports.RemoveStagedJob(pair.Value.JobId))
                {
                    jobs.Remove(pair.Key);
                }
            }
        }

        private void Save()
        {
            Directory.CreateDirectory(Path.GetDirectoryName(stateFile));
            var temporary = stateFile + ".tmp";
            using (var file = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None))
            {
                JsonSerializer.Serialize(file, jobs);
                file.Flush(true);
            }

            if (!OperatingSystem.IsWindows())
            {
                File.SetUnixFileMode(temporary, UnixFileMode.UserRead | UnixFileMode.UserWrite);
            }

            File.Move(temporary, stateFile, true);
        }

        internal record VerifiedTrack(string Path, string SourceKey, string AnalysisId, string SourceSha256, long Bytes, long Modified, long EstimatedBytes);
        internal record BatchInput(BridgeBatch Descriptor, string[] Paths);
        private record BatchJob(string JobId, DateTimeOffset Requested, string LastStatus, DateTimeOffset RetryAt = default);
    }
}
