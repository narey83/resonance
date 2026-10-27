// <copyright file="UsbExportService.cs" company="John Narey">
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
    using System.Collections.Concurrent;
    using System.Collections.Generic;
    using System.Diagnostics;
    using System.IO;
    using System.IO.Compression;
    using System.Linq;
    using System.Security.Cryptography;
    using System.Text.Json;
    using System.Threading;
    using System.Threading.Tasks;
    using resonance.Analysis.Candidates;
    using resonance.Analysis.Imports;
    using resonance.Common;

    public record UsbExportRequest(string[] Paths, string PlaylistName = "Resonance", string Profile = "dual");
    public record UsbExportJob(string JobId, string Status, int Total, int Prepared, string Profile, string PlaylistName, string Error = null, bool DownloadAvailable = false);

    // Stages an export for download. This service deliberately has no device or destination API.
    public class UsbExportService
    {
        private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
        private readonly IAnalysisService analysis;
        private readonly CandidateAnalysisService candidates;
        private readonly ConcurrentDictionary<string, UsbExportJob> jobs = new();
        private readonly ConcurrentDictionary<string, CancellationTokenSource> cancellations = new();
        private readonly SemaphoreSlim gate = new(1, 1);
        private readonly string root = Environment.GetEnvironmentVariable("RESONANCE_USB_EXPORT_ROOT");
        private readonly string python = Environment.GetEnvironmentVariable("RESONANCE_USB_EXPORT_PYTHON");
        private readonly string worker = Environment.GetEnvironmentVariable("RESONANCE_USB_EXPORT_WORKER");
        private readonly string ffmpeg = Environment.GetEnvironmentVariable("RESONANCE_USB_EXPORT_FFMPEG");

        public UsbExportService(IAnalysisService analysis, CandidateAnalysisService candidates)
        {
            this.analysis = analysis;
            this.candidates = candidates;
        }

        public bool Enabled => !string.IsNullOrWhiteSpace(root) && Path.IsPathRooted(root)
            && File.Exists(python) && File.Exists(worker) && File.Exists(ffmpeg);

        public int NetworkLibraryTrackCount => analysis.GetAllTracks().Count();

        public static void Validate(UsbExportRequest request)
        {
            if (request?.Paths == null || request.Paths.Length == 0 || request.Paths.Length > 10000
                || request.Paths.Any(string.IsNullOrWhiteSpace) || request.Paths.Distinct(StringComparer.Ordinal).Count() != request.Paths.Length)
            {
                throw new ArgumentException("Select between 1 and 10000 distinct indexed library tracks.");
            }

            if (request.Profile != "dual" && request.Profile != "legacy")
            {
                throw new ArgumentException("Profile must be dual or legacy.");
            }

            if (string.IsNullOrWhiteSpace(request.PlaylistName) || request.PlaylistName.Length > 100 || request.PlaylistName.Any(char.IsControl))
            {
                throw new ArgumentException("Playlist name must contain 1–100 visible characters.");
            }
        }

        public object Library() => new { enabled = Enabled, experimental = true, helperPlatforms = new[] { "macos", "windows", "linux", "source" }.Where(platform => File.Exists(Environment.GetEnvironmentVariable($"RESONANCE_PIONEER_HELPER_{platform.ToUpperInvariant()}_{(platform == "source" ? "ARCHIVE" : "INSTALLER")}"))).ToArray(), tracks = analysis.GetAllTracks().Select(t => new { path = LibraryPath(t.OriginalFilename), title = t.Title ?? t.Filename, artist = t.Artist, album = t.Album, bpm = t.Bpm, key = t.Key }).ToArray() };

        public string NetworkLibraryRevision()
        {
            var rows = analysis.GetAllTracks().OrderBy(t => t.OriginalFilename, StringComparer.Ordinal).Select(t =>
            {
                var file = new FileInfo(LibraryPath(t.OriginalFilename));
                return new { path = file.FullName, bytes = file.Exists ? file.Length : -1, modified = file.Exists ? file.LastWriteTimeUtc.Ticks : 0, t.Title, t.Artist, t.Album, t.Bpm, t.Key };
            }).ToArray();
            var candidateRoot = Environment.GetEnvironmentVariable("RESONANCE_CANDIDATE_OUTPUT_ROOT");
            var candidates = Directory.Exists(candidateRoot) ? Directory.EnumerateFiles(candidateRoot, "*.json", SearchOption.AllDirectories).OrderBy(p => p, StringComparer.Ordinal).Select(p => new FileInfo(p)).Select(f => new { f.FullName, f.Length, modified = f.LastWriteTimeUtc.Ticks }).ToArray() : null;
            return Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { rows, candidates }, JsonOptions)))).ToLowerInvariant();
        }

        public UsbExportJob StartNetworkLibrary() => Start(new UsbExportRequest(
            analysis.GetAllTracks().Select(t => LibraryPath(t.OriginalFilename)).Distinct().ToArray(), "Resonance Library", "dual"));

        public string HelperDownload(string platform)
        {
            var path = HelperArchive(platform);
            try
            {
                using var archive = ZipFile.OpenRead(path);
                if (archive.Entries.Count == 0)
                {
                    throw new InvalidDataException("Empty helper archive.");
                }
            }
            catch (InvalidDataException)
            {
                throw new FileNotFoundException("Requested helper archive is invalid or unavailable.");
            }

            return path;
        }

        public UsbExportJob Start(UsbExportRequest request)
        {
            Validate(request);
            if (!Enabled)
            {
                throw new InvalidOperationException("USB export worker is not configured.");
            }

            var indexed = analysis.GetAllTracks().ToDictionary(t => LibraryPath(t.OriginalFilename), StringComparer.Ordinal);
            var tracks = request.Paths.Select(p =>
            {
                var path = ImportedAnalysisContract.RequireLibraryPath(MusicPath.Root, p);
                if (!indexed.TryGetValue(path, out var track) || analysis.ResolveMaskedFilename(path) == null)
                {
                    throw new ArgumentException("Every selected track must be indexed in the local share.");
                }

                return track;
            }).ToArray();
            if (tracks.Select(t => LibraryPath(t.OriginalFilename)).Distinct(StringComparer.Ordinal).Count() != tracks.Length)
            {
                throw new ArgumentException("Select each indexed track only once.");
            }

            var id = Guid.NewGuid().ToString("N");
            var job = new UsbExportJob(id, "queued", tracks.Length, 0, request.Profile, request.PlaylistName.Trim());
            jobs[id] = job;
            var cancellation = new CancellationTokenSource(TimeSpan.FromHours(6));
            cancellations[id] = cancellation;
            _ = Task.Run(() => Run(job, tracks, cancellation.Token));
            return job;
        }

        public UsbExportJob Read(string id)
        {
            if (jobs.TryGetValue(id, out var job))
            {
                return job;
            }

            if (id.Length != 32 || !id.All(Uri.IsHexDigit) || string.IsNullOrWhiteSpace(root))
            {
                throw new FileNotFoundException("Unknown export job.");
            }

            var directory = Path.Combine(root, id);
            if (!File.Exists(Path.Combine(directory, "resonance-usb.zip")))
            {
                throw new FileNotFoundException("Unknown export job.");
            }

            using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(directory, "export", "export-manifest.json")));
            var manifest = doc.RootElement;
            var total = manifest.GetProperty("trackCount").GetInt32();
            return new UsbExportJob(id, "completed", total, total, manifest.GetProperty("profile").GetString(), manifest.GetProperty("playlistName").GetString(), DownloadAvailable: true);
        }

        public bool Cancel(string id)
        {
            var job = Read(id);
            if (job.Status is "completed" or "failed" or "cancelled")
            {
                return false;
            }

            if (!cancellations.TryGetValue(id, out var cancellation))
            {
                return false;
            }

            cancellation.Cancel();
            return true;
        }

        public string Download(string id)
        {
            if (!Read(id).DownloadAvailable)
            {
                throw new InvalidOperationException("Export is not ready.");
            }

            return Path.Combine(root, id, "resonance-usb.zip");
        }

        public long StagedBytes(string id)
        {
            if (!Guid.TryParseExact(id, "N", out _) || string.IsNullOrWhiteSpace(root))
            {
                return 0;
            }

            var directory = Path.Combine(root, id);
            return Directory.Exists(directory) ? Directory.EnumerateFiles(directory, "*", SearchOption.AllDirectories).Sum(path => new FileInfo(path).Length) : 0;
        }

        public bool RemoveStagedJob(string id)
        {
            if (!Guid.TryParseExact(id, "N", out _) || string.IsNullOrWhiteSpace(root) || cancellations.ContainsKey(id))
            {
                return false;
            }

            var job = jobs.TryGetValue(id, out var cached) ? cached : null;
            if (job != null && job.Status is not ("completed" or "failed" or "cancelled"))
            {
                return false;
            }

            try
            {
                var directory = Path.Combine(root, id);
                if (Directory.Exists(directory))
                {
                    Directory.Delete(directory, true);
                }

                jobs.TryRemove(id, out _);
                return true;
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
            {
                return false;
            }
        }

        private static string LibraryPath(string path) => Path.GetFullPath(MusicPath.ToAbsolute(path));

        private static string HelperArchive(string platform)
        {
            var variable = platform switch
            {
                "macos" => "RESONANCE_USB_HELPER_MACOS_ARCHIVE",
                "source" => "RESONANCE_USB_HELPER_SOURCE_ARCHIVE",
                _ => throw new ArgumentException("Helper platform must be macos or source."),
            };
            var path = Environment.GetEnvironmentVariable(variable);
            if (string.IsNullOrWhiteSpace(path) || !Path.IsPathRooted(path)
                || !Path.GetExtension(path).Equals(".zip", StringComparison.OrdinalIgnoreCase) || !File.Exists(path))
            {
                throw new FileNotFoundException("Requested helper archive is not available on this instance.");
            }

            return Path.GetFullPath(path);
        }

        private bool HelperAvailable(string platform)
        {
            try
            {
                HelperDownload(platform);
                return true;
            }
            catch (IOException)
            {
                return false;
            }
            catch (UnauthorizedAccessException)
            {
                return false;
            }
        }

        private async Task Run(UsbExportJob job, TrackAnalysisInfo[] tracks, CancellationToken ct)
        {
            var entered = false;
            try
            {
                await gate.WaitAsync(ct);
                entered = true;
                jobs[job.JobId] = job = job with { Status = "preparing" };
                var directory = Path.Combine(Path.GetFullPath(root), job.JobId);
                Directory.CreateDirectory(directory);
                var manifestTracks = new List<object>();
                for (var i = 0; i < tracks.Length; i++)
                {
                    ct.ThrowIfCancellationRequested();
                    var track = tracks[i];
                    var path = ImportedAnalysisContract.RequireLibraryPath(MusicPath.Root, LibraryPath(track.OriginalFilename));
                    var enhanced = await candidates.LatestExportReady(path, ct);
                    if (enhanced == null || !ExportAnalysisContract.Ready(enhanced.Value.Analysis))
                    {
                        throw new InvalidOperationException($"Full enhanced analysis is required for {track.Title ?? track.Filename}. Run Track Analysis first.");
                    }

                    await using var source = File.OpenRead(path);
                    var hash = Convert.ToHexString(await SHA256.HashDataAsync(source, ct)).ToLowerInvariant();
                    if (!hash.Equals(enhanced.Value.Job.AudioSha256, StringComparison.OrdinalIgnoreCase))
                    {
                        throw new IOException("Source changed since enhanced analysis. Reanalyse before exporting.");
                    }

                    manifestTracks.Add(new { id = i + 1, sourceKey = Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(MusicPath.ToRelative(path)))).ToLowerInvariant(), sourcePath = path, sourceSha256 = hash, title = track.Title ?? Path.GetFileNameWithoutExtension(path), artist = track.Artist ?? string.Empty, album = track.Album ?? string.Empty, genre = string.Empty, bpm = track.Bpm, key = track.Key, analysis = enhanced.Value.Analysis });
                    jobs[job.JobId] = job = job with { Prepared = i + 1 };
                }

                var manifest = Path.Combine(directory, "manifest.json");
                await File.WriteAllTextAsync(manifest, JsonSerializer.Serialize(new { schemaVersion = 1, profile = job.Profile, playlistName = job.PlaylistName, tracks = manifestTracks }, JsonOptions), ct);
                var destination = Path.Combine(directory, "export");
                var start = new ProcessStartInfo(python) { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true };
                foreach (var argument in new[] { worker, "--manifest", manifest, "--destination", destination, "--profile", job.Profile, "--ffmpeg", ffmpeg })
                {
                    start.ArgumentList.Add(argument);
                }

                jobs[job.JobId] = job = job with { Status = "exporting" };
                using var process = Process.Start(start) ?? throw new IOException("Could not start export worker.");
                using var registration = ct.Register(() =>
                {
                    try
                    {
                        if (!process.HasExited)
                        {
                            process.Kill(true);
                        }
                    }
                    catch (InvalidOperationException)
                    {
                    }
                });
                var stdout = process.StandardOutput.ReadToEndAsync();
                var stderr = process.StandardError.ReadToEndAsync();
                await process.WaitForExitAsync(ct);
                var diagnostics = await stderr;
                await stdout;
                await File.WriteAllTextAsync(Path.Combine(directory, "worker.log"), diagnostics, ct);
                if (process.ExitCode != 0)
                {
                    throw new IOException("Export worker failed. " + diagnostics[..Math.Min(diagnostics.Length, 1500)]);
                }

                if (!Directory.Exists(Path.Combine(destination, "PIONEER")) || !Directory.Exists(Path.Combine(destination, "Contents")))
                {
                    throw new IOException("Worker did not produce PIONEER and Contents folders.");
                }

                ct.ThrowIfCancellationRequested();
                jobs[job.JobId] = job = job with { Status = "packaging" };
                ZipFile.CreateFromDirectory(destination, Path.Combine(directory, "resonance-usb.zip"), CompressionLevel.Fastest, false);
                ct.ThrowIfCancellationRequested();
                jobs[job.JobId] = job with { Status = "completed", DownloadAvailable = true };
            }
            catch (OperationCanceledException)
            {
                jobs[job.JobId] = job with { Status = "cancelled" };
            }
            catch (Exception exception)
            {
                jobs[job.JobId] = job with { Status = "failed", Error = exception.Message };
            }
            finally
            {
                if (entered)
                {
                    gate.Release();
                }

                if (cancellations.TryRemove(job.JobId, out var cancellation))
                {
                    cancellation.Dispose();
                }
            }
        }
    }
}
