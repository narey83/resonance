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
    using resonance.MusicLibrary;
    using Serilog;

    public record UsbExportRequest(string[] Paths, string PlaylistName = "Resonance", string Profile = "dual", string SelectionId = null, string PlayerModel = null);
    public record UsbExportJob(string JobId, string Status, int Total, int Prepared, string Profile, string PlaylistName, string Error = null, bool DownloadAvailable = false, string PlayerModel = null, bool Deferred = false);

    // Stages an export for download. This service deliberately has no device or destination API.

    /// <summary>Prepares server-side exports and retains their validation records.</summary>
    public sealed partial class UsbExportService : IDisposable
    {
        private static readonly object ArchiveGate = new();
        private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
        private readonly IAnalysisService analysis;
        private readonly CandidateAnalysisService candidates;
        private readonly IMusicLibraryService library;
        private readonly ConcurrentDictionary<string, UsbExportJob> jobs = new();
        private readonly ConcurrentDictionary<string, HashSet<string>> transferFiles = new();
        private readonly ConcurrentDictionary<string, CancellationTokenSource> cancellations = new();
        private readonly SemaphoreSlim gate = new(1, 1);
        private readonly string root = Environment.GetEnvironmentVariable("RESONANCE_USB_EXPORT_ROOT");
        private readonly string python = Environment.GetEnvironmentVariable("RESONANCE_USB_EXPORT_PYTHON");
        private readonly string worker = Environment.GetEnvironmentVariable("RESONANCE_USB_EXPORT_WORKER");
        private readonly string ffmpeg = Environment.GetEnvironmentVariable("RESONANCE_USB_EXPORT_FFMPEG");
        private readonly string ffprobe = Environment.GetEnvironmentVariable("RESONANCE_USB_EXPORT_FFPROBE");

        public UsbExportService(IAnalysisService analysis, CandidateAnalysisService candidates, IMusicLibraryService library = null, resonance.Mixtapes.IMixtapeService playlists = null, resonance.MusicLibrary.Workspace.WorkspaceStore workspace = null)
        {
            this.analysis = analysis;
            this.candidates = candidates;
            this.library = library;
            this.playlists = playlists;
            this.workspace = workspace;
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

            if (request.Profile != "dual" && request.Profile != "legacy" && request.Profile != "network")
            {
                throw new ArgumentException("Profile must be dual, legacy or network.");
            }

            if (request.PlayerModel != null && !((request.Profile == "dual" && request.PlayerModel is "opus-quad" or "cdj-3000x" or "xdj-az")
                || (request.Profile == "legacy" && request.PlayerModel is "cdj-3000" or "cdj-2000nxs2")))
            {
                throw new ArgumentException("Player model does not match the selected library format.");
            }

            if (string.IsNullOrWhiteSpace(request.PlaylistName) || request.PlaylistName.Length > 100 || request.PlaylistName.Any(char.IsControl))
            {
                throw new ArgumentException("Playlist name must contain 1–100 visible characters.");
            }
        }

        public void Dispose()
        {
            Dispose(true);
            GC.SuppressFinalize(this);
        }

        public object Library(string[] paths = null)
        {
            if (paths != null && (paths.Length == 0 || paths.Length > 10000 || paths.Any(string.IsNullOrWhiteSpace)))
            {
                throw new ArgumentException("Select between 1 and 10000 indexed library tracks.");
            }

            var scoped = paths?.Select(path => ImportedAnalysisContract.RequireLibraryPath(MusicPath.Root, LibraryPath(path))).Distinct(StringComparer.Ordinal).ToArray();
            var tracks = library != null
                ? library.GetExportTracks(scoped).Select(track => new { path = LibraryPath(track.Path), title = track.Title, artist = track.Artist, album = track.Album, bpm = track.Bpm, key = track.Key }).Cast<object>().ToArray()
                : analysis.GetAllTracks().Where(track => scoped == null || scoped.Contains(LibraryPath(track.OriginalFilename), StringComparer.Ordinal)).Select(track => new { path = LibraryPath(track.OriginalFilename), title = track.Title ?? track.Filename, artist = track.Artist, album = track.Album, bpm = track.Bpm, key = track.Key }).Cast<object>().ToArray();
            return new { enabled = Enabled, experimental = true, helperPlatforms = new[] { "macos", "windows", "linux", "source" }.Where(platform => File.Exists(Environment.GetEnvironmentVariable($"RESONANCE_PIONEER_HELPER_{platform.ToUpperInvariant()}_{(platform == "source" ? "ARCHIVE" : "INSTALLER")}"))).ToArray(), tracks };
        }

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

        public UsbExportJob Start(UsbExportRequest request, string username = "")
        {
            Validate(request);
            var source = ValidateSelection(request, username);
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
            var job = new UsbExportJob(id, "queued", tracks.Length, 0, request.Profile, request.PlaylistName.Trim(), PlayerModel: request.PlayerModel);
            jobs[id] = job;
            if (source != null)
            {
                jobSources[id] = source;
            }

            var cancellation = new CancellationTokenSource(TimeSpan.FromHours(6));
            cancellations[id] = cancellation;
            _ = Task.Run(() => Run(job, tracks, username, cancellation.Token));
            return job;
        }

        public UsbExportJob Read(string id)
        {
            if (jobs.TryGetValue(id, out var job))
            {
                return job.Status == "completed" ? job with { Deferred = File.Exists(Path.Combine(root, id, "export-deferred")) } : job;
            }

            if (id.Length != 32 || !id.All(Uri.IsHexDigit) || string.IsNullOrWhiteSpace(root))
            {
                throw new FileNotFoundException("Unknown export job.");
            }

            var directory = Path.Combine(root, id);
            if (!File.Exists(Path.Combine(directory, "export-complete")) && !File.Exists(Path.Combine(directory, "resonance-usb.zip")))
            {
                throw new FileNotFoundException("Unknown export job.");
            }

            using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(directory, "export", "export-manifest.json")));
            var manifest = doc.RootElement;
            var total = manifest.GetProperty("trackCount").GetInt32();
            return new UsbExportJob(id, "completed", total, total, manifest.GetProperty("profile").GetString(), manifest.GetProperty("playlistName").GetString(), DownloadAvailable: true, PlayerModel: manifest.TryGetProperty("playerModel", out var model) ? model.GetString() : null, Deferred: File.Exists(Path.Combine(directory, "export-deferred")));
        }

        public UsbExportJob[] History()
        {
            var saved = jobs.Values.ToDictionary(job => job.JobId, job => job.Status == "completed"
                ? job with { Deferred = File.Exists(Path.Combine(root, job.JobId, "export-deferred")) }
                : job, StringComparer.Ordinal);
            if (Directory.Exists(root))
            {
                foreach (var directory in new DirectoryInfo(root).EnumerateDirectories()
                    .Where(directory => Guid.TryParseExact(directory.Name, "N", out _) && !directory.Attributes.HasFlag(FileAttributes.ReparsePoint))
                    .OrderByDescending(directory => directory.LastWriteTimeUtc).Take(50))
                {
                    if (saved.ContainsKey(directory.Name))
                    {
                        continue;
                    }

                    try
                    {
                        saved[directory.Name] = Read(directory.Name);
                    }
                    catch (Exception exception) when (exception is IOException or JsonException or InvalidOperationException or KeyNotFoundException)
                    {
                        // An incomplete or damaged export must not hide other saved exports.
                    }
                }
            }

            return saved.Values.OrderBy(job => job.Status == "completed").Take(50).ToArray();
        }

        public JsonElement Inspect(string id)
        {
            if (!Guid.TryParseExact(id, "N", out _))
            {
                throw new FileNotFoundException("Unknown export job.");
            }

            if (!Read(id).DownloadAvailable)
            {
                throw new InvalidOperationException("Database inspection is available after the export completes.");
            }

            var path = Path.Combine(root, id, "inspection.json");
            if (!File.Exists(path))
            {
                throw new InvalidOperationException("This export has no saved database inspection report.");
            }

            if (new FileInfo(path).Length > 32 * 1024 * 1024)
            {
                throw new InvalidDataException("Export inspection report exceeds its size limit.");
            }

            using var document = JsonDocument.Parse(File.ReadAllText(path));
            return document.RootElement.Clone();
        }

        public bool Cancel(string id)
        {
            var job = Read(id);
            if (job.Status == "completed")
            {
                return RemoveStagedJob(id);
            }

            if (job.Status is "failed" or "cancelled")
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

        public UsbExportJob Defer(string id)
        {
            var job = Read(id);
            if (!job.DownloadAvailable)
            {
                throw new InvalidOperationException("Wait for the export to finish before deferring it.");
            }

            File.WriteAllText(Path.Combine(root, id, "export-deferred"), string.Empty);
            Log.Information("USB export {JobId} deferred for later transfer", id);
            return Read(id);
        }

        public UsbExportJob Resume(string id)
        {
            var job = Read(id);
            if (!job.DownloadAvailable)
            {
                throw new InvalidOperationException("Export is not ready.");
            }

            File.Delete(Path.Combine(root, id, "export-deferred"));
            return Read(id);
        }

        public string Download(string id)
        {
            if (!Read(id).DownloadAvailable)
            {
                throw new InvalidOperationException("Export is not ready.");
            }

            var archive = Path.Combine(root, id, "resonance-usb.zip");
            lock (ArchiveGate)
            {
                if (!File.Exists(archive))
                {
                    var temporary = archive + ".creating";
                    try
                    {
                        var manifest = TransferManifest(id);
                        using var document = JsonDocument.Parse(File.ReadAllText(manifest));
                        using (var zip = ZipFile.Open(temporary, ZipArchiveMode.Create))
                        {
                            zip.CreateEntryFromFile(manifest, "export-manifest.json", CompressionLevel.Fastest);
                            foreach (var file in document.RootElement.GetProperty("files").EnumerateArray())
                            {
                                var relativePath = file.GetProperty("path").GetString();
                                zip.CreateEntryFromFile(ResolveExportFile(Path.GetDirectoryName(manifest), relativePath), relativePath, CompressionLevel.Fastest);
                            }
                        }

                        File.Move(temporary, archive);
                    }
                    finally
                    {
                        if (File.Exists(temporary))
                        {
                            File.Delete(temporary);
                        }
                    }
                }
            }

            return archive;
        }

        public string TransferManifest(string id)
        {
            if (!Read(id).DownloadAvailable)
            {
                throw new InvalidOperationException("Export is not ready.");
            }

            return Path.Combine(root, id, "export", "export-manifest.json");
        }

        public string TransferFile(string id, string relativePath)
        {
            var manifest = TransferManifest(id);
            if (string.IsNullOrWhiteSpace(relativePath) || relativePath.Contains('\\') || relativePath.StartsWith('/') || relativePath.Split('/').Any(part => part is "" or "." or ".."))
            {
                throw new FileNotFoundException("Unknown export file.");
            }

            var allowed = transferFiles.GetOrAdd(id, _ =>
            {
                using var document = JsonDocument.Parse(File.ReadAllText(manifest));
                return document.RootElement.GetProperty("files").EnumerateArray()
                    .Select(file => file.GetProperty("path").GetString())
                    .ToHashSet(StringComparer.Ordinal);
            });
            if (!allowed.Contains(relativePath))
            {
                throw new FileNotFoundException("Unknown export file.");
            }

            return ResolveExportFile(Path.GetDirectoryName(manifest), relativePath);
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
                transferFiles.TryRemove(id, out _);
                return true;
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
            {
                return false;
            }
        }

        private static string ResolveExportFile(string exportDirectory, string relativePath)
        {
            if (string.IsNullOrWhiteSpace(relativePath) || relativePath.Contains('\\') || relativePath.StartsWith('/') || relativePath.Split('/').Any(part => part is "" or "." or ".."))
            {
                throw new FileNotFoundException("Unknown export file.");
            }

            var directory = Path.GetFullPath(exportDirectory);
            var path = Path.GetFullPath(Path.Combine(directory, relativePath.Replace('/', Path.DirectorySeparatorChar)));
            if (!path.StartsWith(directory + Path.DirectorySeparatorChar, StringComparison.Ordinal) || !File.Exists(path) || new FileInfo(path).LinkTarget != null)
            {
                throw new FileNotFoundException("Unknown export file.");
            }

            for (var parent = new DirectoryInfo(Path.GetDirectoryName(path)); parent.FullName != directory; parent = parent.Parent)
            {
                if (parent.LinkTarget != null)
                {
                    throw new FileNotFoundException("Unknown export file.");
                }
            }

            return path;
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

        private void Dispose(bool disposing)
        {
            if (disposing)
            {
                gate.Dispose();
            }
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

        private async Task Run(UsbExportJob job, TrackAnalysisInfo[] tracks, string username, CancellationToken ct)
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

                    var sourceInfo = new FileInfo(path);
                    var hash = enhanced.Value.Job.AudioSha256.ToLowerInvariant();
                    if (job.Profile != "network")
                    {
                        await using var source = File.OpenRead(path);
                        hash = Convert.ToHexString(await SHA256.HashDataAsync(source, ct)).ToLowerInvariant();
                        if (!hash.Equals(enhanced.Value.Job.AudioSha256, StringComparison.OrdinalIgnoreCase))
                        {
                            throw new IOException("Source changed since enhanced analysis. Reanalyse before exporting.");
                        }
                    }

                    var autoCues = workspace?.AutoCues(username, path)
                        .OrderBy(cue => cue.Seconds)
                        .Take(8)
                        .Select((cue, index) => new { timeMs = (int)Math.Round(cue.Seconds * 1000), hotCueNumber = index + 1, name = cue.Label })
                        .ToArray();
                    Log.Information("USB export track prepared. Track: {Track}, AutoCues: {AutoCues}", track.OriginalFilename, autoCues?.Length ?? 0);
                    manifestTracks.Add(new { id = i + 1, sourceKey = Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(MusicPath.ToRelative(path)))).ToLowerInvariant(), sourcePath = path, sourceSha256 = hash, sourceBytes = sourceInfo.Length, title = track.Title ?? Path.GetFileNameWithoutExtension(path), artist = track.Artist ?? string.Empty, album = track.Album ?? string.Empty, genre = string.Empty, bpm = track.Bpm, key = track.Key, cues = autoCues ?? [], analysis = enhanced.Value.Analysis });
                    jobs[job.JobId] = job = job with { Prepared = i + 1 };
                }

                var manifest = Path.Combine(directory, "manifest.json");
                await File.WriteAllTextAsync(manifest, JsonSerializer.Serialize(new { schemaVersion = 1, profile = job.Profile, playerModel = job.PlayerModel, playlistName = job.PlaylistName, source = jobSources.GetValueOrDefault(job.JobId), tracks = manifestTracks }, JsonOptions), ct);
                var destination = Path.Combine(directory, "export");
                var start = new ProcessStartInfo(python) { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true };
                foreach (var argument in new[] { worker, "--manifest", manifest, "--destination", destination, "--profile", job.Profile, "--ffmpeg", ffmpeg, "--ffprobe", ffprobe ?? Path.Combine(Path.GetDirectoryName(ffmpeg), OperatingSystem.IsWindows() ? "ffprobe.exe" : "ffprobe") })
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

                if (!Directory.Exists(Path.Combine(destination, "PIONEER")) || (job.Profile != "network" && !Directory.Exists(Path.Combine(destination, "Contents"))))
                {
                    throw new IOException("Worker did not produce PIONEER and Contents folders.");
                }

                ct.ThrowIfCancellationRequested();
                jobs[job.JobId] = job = job with { Status = "packaging" };
                if (job.Profile == "network")
                {
                    ZipFile.CreateFromDirectory(destination, Path.Combine(directory, "resonance-usb.zip"), CompressionLevel.Fastest, false);
                }

                ct.ThrowIfCancellationRequested();
                File.WriteAllText(Path.Combine(directory, "export-complete"), string.Empty);
                try
                {
                    if (job.Profile != "network")
                    {
                        SaveList(job.JobId);
                    }
                }
                catch (Exception exception) when (exception is IOException or JsonException or ArgumentException or UnauthorizedAccessException)
                {
                    Log.Warning(exception, "USB export completed, but its reusable list could not be saved. Job: {JobId}", job.JobId);
                }

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
