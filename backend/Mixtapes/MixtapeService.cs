// <copyright file="MixtapeService.cs" company="John Narey">
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

namespace resonance.Mixtapes
{
    using System;
    using System.Collections.Generic;
    using System.IO;
    using System.Linq;
    using System.Text;
    using System.Threading;
    using System.Threading.Tasks;
    using Microsoft.AspNetCore.SignalR;
    using Microsoft.Extensions.Hosting;
    using resonance.Mixtapes.API;
    using resonance.MusicLibrary;
    using resonance.Shares;
    using Serilog;

    public class MixtapeService : IMixtapeService, IHostedService
    {
        private const string MixtapesShareAlias = "Mixtapes";

        private static readonly ILogger Log = Serilog.Log.ForContext<MixtapeService>();

        /// <summary>
        /// Initializes a new instance of the <see cref="MixtapeService"/> class.
        /// Creates a new MixtapeService.
        /// </summary>
        /// <param name="repository">Repository for mixtape data.</param>
        /// <param name="musicRepository">Music library for track metadata enrichment.</param>
        /// <param name="downloadsDir">The configured downloads directory (from options).</param>
        /// <param name="artworkDir">Directory for storing mixtape artwork files.</param>
        /// <param name="shareService">Share service for Soulseek integration.</param>
        /// <param name="hub">The mixtapes SignalR hub context.</param>
        public MixtapeService(
            MixtapeRepository repository,
            MusicRepository musicRepository,
            string downloadsDir,
            string artworkDir,
            IShareService shareService,
            IHubContext<MixtapesHub> hub)
        {
            Repository = repository;
            MusicRepository = musicRepository;
            MixtapesBaseDir = Path.Combine(downloadsDir, "mixtapes");
            ArtworkDir = artworkDir;
            ShareService = shareService;
            Hub = hub;
            Repository.Initialize();

            // Ensure the mixtapes directory always exists and is registered as a managed share
            Directory.CreateDirectory(MixtapesBaseDir);
            ShareService.SetManagedShare(MixtapesBaseDir, MixtapesShareAlias);

            // Migrate legacy GUID-named folders to friendly names, then rebuild M3U/symlinks
            var migrated = false;
            foreach (var m in Repository.GetAll())
            {
                var legacyDir = LegacyMixtapeDir(m.Id);
                var friendlyDir = MixtapeDir(m);
                if (legacyDir != friendlyDir && Directory.Exists(legacyDir) && !Directory.Exists(friendlyDir))
                {
                    try
                    {
                        Directory.Move(legacyDir, friendlyDir);
                        migrated = true;
                    }
                    catch (Exception ex)
                    {
                        Log.Warning(ex, "Could not migrate mixtape folder {Old} → {New}", legacyDir, friendlyDir);
                    }
                }

                var tracks = Repository.GetTracks(m.Id);
                WriteMixtapeFolder(m, tracks);
            }

            // Flush stale UUID paths from the shares cache after any folder renames
            if (migrated)
            {
                ShareService.RequestScan();
            }
        }

        // All initialization (directory creation, managed share registration, migrations)
        // happens in the constructor; hosting this service just forces eager construction
        // at startup so the mixtapes managed share exists before anyone opens the UI
        public Task StartAsync(CancellationToken cancellationToken) => Task.CompletedTask;

        public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

        private MixtapeRepository Repository { get; }
        private MusicRepository MusicRepository { get; }
        private string MixtapesBaseDir { get; }
        private string ArtworkDir { get; }
        private IShareService ShareService { get; }
        private IHubContext<MixtapesHub> Hub { get; }

        private static string MixtapeFolderName(Mixtape m) => SafeFileName(m.Name);

        private string MixtapeDir(Mixtape m) => Path.Combine(MixtapesBaseDir, MixtapeFolderName(m));
        private string LegacyMixtapeDir(string id) => Path.Combine(MixtapesBaseDir, id);
        private string ArtworkFilePath(string id) => Path.Combine(ArtworkDir, id);
        private string ArtworkCtPath(string id) => Path.Combine(ArtworkDir, id + ".ct");

        private Mixtape WithArtwork(Mixtape m) =>
            File.Exists(ArtworkFilePath(m.Id)) ? m with { HasArtwork = true } : m;

        public bool HasArtwork(string id) => File.Exists(ArtworkFilePath(id));

        public (string Path, string ContentType)? GetArtworkInfo(string id)
        {
            var path = ArtworkFilePath(id);
            if (!File.Exists(path))
            {
                return null;
            }

            var ct = File.Exists(ArtworkCtPath(id)) ? File.ReadAllText(ArtworkCtPath(id)).Trim() : "image/jpeg";
            return (path, ct);
        }

        public async System.Threading.Tasks.Task SaveArtworkAsync(string id, Stream data, string contentType)
        {
            Directory.CreateDirectory(ArtworkDir);
            await using var fs = File.Create(ArtworkFilePath(id));
            await data.CopyToAsync(fs);
            await File.WriteAllTextAsync(ArtworkCtPath(id), contentType);
            await Hub.BroadcastUpdatedAsync();
        }

        public void DeleteArtwork(string id)
        {
            if (File.Exists(ArtworkFilePath(id)))
            {
                File.Delete(ArtworkFilePath(id));
            }

            if (File.Exists(ArtworkCtPath(id)))
            {
                File.Delete(ArtworkCtPath(id));
            }

            _ = Hub.BroadcastUpdatedAsync();
        }

        public IReadOnlyList<Mixtape> GetAll()
        {
            var mixtapes = Repository.GetAll();
            return mixtapes.Select(m => WithArtwork(m with { Tracks = Repository.GetTracks(m.Id) })).ToList();
        }

        public Mixtape? GetById(string id)
        {
            var m = Repository.GetById(id);
            if (m == null)
            {
                return null;
            }

            return WithArtwork(m with { Tracks = Repository.GetTracks(id) });
        }

        public Mixtape Create(string name, string? description)
        {
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var m = new Mixtape(Guid.NewGuid().ToString("N"), name, description, false, null, now, now);
            Repository.InsertMixtape(m);
            WriteMixtapeFolder(m, Array.Empty<MixtapeTrack>());
            _ = Hub.BroadcastUpdatedAsync();
            return m with { Tracks = Array.Empty<MixtapeTrack>() };
        }

        public Mixtape Update(string id, string name, string? description)
        {
            var old = Repository.GetById(id) ?? throw new KeyNotFoundException($"Mixtape {id} not found");
            var updated = old with { Name = name, Description = description, UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() };
            Repository.UpdateMixtape(updated);

            var oldDir = MixtapeDir(old);
            var newDir = MixtapeDir(updated);
            if (oldDir != newDir && Directory.Exists(oldDir) && !Directory.Exists(newDir))
            {
                try
                {
                    Directory.Move(oldDir, newDir);
                }
                catch (Exception ex)
                {
                    Log.Warning(ex, "Could not rename mixtape folder {Old} → {New}", oldDir, newDir);
                }
            }

            var tracks = Repository.GetTracks(id);
            WriteMixtapeFolder(updated, tracks);
            _ = Hub.BroadcastUpdatedAsync();

            return WithArtwork(updated with { Tracks = tracks });
        }

        public void Delete(string id)
        {
            var m = Repository.GetById(id);
            var dir = m != null ? MixtapeDir(m) : LegacyMixtapeDir(id);
            DeleteArtwork(id);
            Repository.DeleteMixtape(id);
            RemoveMixtapeFolder(dir);
            _ = Hub.BroadcastUpdatedAsync();
        }

        public MixtapeTrack AddTrack(string mixtapeId, string filePath)
        {
            var m = Repository.GetById(mixtapeId) ?? throw new KeyNotFoundException($"Mixtape {mixtapeId} not found");

            var libraryTrack = MusicRepository.GetByPath(filePath);
            var existing = Repository.GetTracks(mixtapeId);

            if (existing.Any(t => t.FilePath == filePath))
            {
                throw new InvalidOperationException("Track is already in this mixtape");
            }

            var sortOrder = existing.Count > 0 ? existing.Max(t => t.SortOrder) + 1 : 0;

            var track = new MixtapeTrack(
                Guid.NewGuid().ToString("N"),
                mixtapeId,
                filePath,
                libraryTrack?.Title,
                libraryTrack?.Artist,
                libraryTrack?.Album,
                libraryTrack?.Duration,
                sortOrder);

            Repository.InsertTrack(track);
            TouchMixtape(mixtapeId);

            var tracks = Repository.GetTracks(mixtapeId);
            var updated = Repository.GetById(mixtapeId)!;
            WriteMixtapeFolder(updated, tracks);
            _ = Hub.BroadcastUpdatedAsync();

            return track;
        }

        public void RemoveTrack(string mixtapeId, string trackId)
        {
            if (Repository.GetById(mixtapeId) == null)
            {
                throw new KeyNotFoundException($"Mixtape {mixtapeId} not found");
            }

            Repository.DeleteTrack(trackId);
            TouchMixtape(mixtapeId);

            var tracks = Repository.GetTracks(mixtapeId);
            var updated = Repository.GetById(mixtapeId)!;
            WriteMixtapeFolder(updated, tracks);
            _ = Hub.BroadcastUpdatedAsync();
        }

        public void ClearTracks(string mixtapeId)
        {
            if (Repository.GetById(mixtapeId) == null)
            {
                throw new KeyNotFoundException($"Mixtape {mixtapeId} not found");
            }

            Repository.ClearTracks(mixtapeId);
            TouchMixtape(mixtapeId);

            var updated = Repository.GetById(mixtapeId)!;
            WriteMixtapeFolder(updated, Array.Empty<MixtapeTrack>());
            _ = Hub.BroadcastUpdatedAsync();
        }

        public void ReorderTracks(string mixtapeId, string[] orderedTrackIds)
        {
            for (var i = 0; i < orderedTrackIds.Length; i++)
            {
                Repository.UpdateTrackOrder(orderedTrackIds[i], i);
            }

            TouchMixtape(mixtapeId);

            var updated = Repository.GetById(mixtapeId)!;
            var tracks = Repository.GetTracks(mixtapeId);
            WriteMixtapeFolder(updated, tracks);
            _ = Hub.BroadcastUpdatedAsync();
        }

        public Mixtape Publish(string id)
        {
            var m = Repository.GetById(id) ?? throw new KeyNotFoundException($"Mixtape {id} not found");
            var token = m.PublicToken ?? Guid.NewGuid().ToString("N")[..16];
            var updated = m with { IsPublished = true, PublicToken = token, UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() };
            Repository.UpdateMixtape(updated);
            _ = Hub.BroadcastUpdatedAsync();
            return WithArtwork(updated with { Tracks = Repository.GetTracks(id) });
        }

        public void Unpublish(string id)
        {
            var m = Repository.GetById(id) ?? throw new KeyNotFoundException($"Mixtape {id} not found");
            var updated = m with { IsPublished = false, UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() };
            Repository.UpdateMixtape(updated);
            _ = Hub.BroadcastUpdatedAsync();
        }

        public Mixtape SoulseekShare(string id)
        {
            var m = Repository.GetById(id) ?? throw new KeyNotFoundException($"Mixtape {id} not found");
            var updated = m with { IsSoulseekShared = true, UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() };
            Repository.UpdateMixtape(updated);

            var tracks = Repository.GetTracks(id);
            WriteMixtapeFolder(updated, tracks);
            ShareService.SetManagedShare(MixtapesBaseDir, MixtapesShareAlias);
            _ = Hub.BroadcastUpdatedAsync();

            return WithArtwork(updated with { Tracks = tracks });
        }

        public void SoulseekUnshare(string id)
        {
            var m = Repository.GetById(id) ?? throw new KeyNotFoundException($"Mixtape {id} not found");
            var updated = m with { IsSoulseekShared = false, UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() };
            Repository.UpdateMixtape(updated);

            var dir = MixtapeDir(updated);
            var tracks = Repository.GetTracks(id);
            RemoveSymlinks(dir);
            WriteM3U(dir, m.Name, tracks);
            _ = Hub.BroadcastUpdatedAsync();
        }

        public Mixtape? GetByToken(string token)
        {
            var m = Repository.GetByToken(token);
            if (m == null)
            {
                return null;
            }

            return WithArtwork(m with { Tracks = Repository.GetTracks(m.Id) });
        }

        public IReadOnlyList<MixtapeTrack> GetTracks(string mixtapeId) => Repository.GetTracks(mixtapeId);

        public void UpdateTrackPaths(string oldPrefix, string newPrefix)
        {
            var affectedIds = Repository.GetMixtapeIdsByTrackPrefix(oldPrefix);
            var updated = Repository.UpdateTrackPaths(oldPrefix, newPrefix);
            if (updated == 0)
            {
                return;
            }

            Log.Information("Updated {N} mixtape track path(s): '{Old}' → '{New}'", updated, oldPrefix, newPrefix);

            foreach (var id in affectedIds)
            {
                var m = Repository.GetById(id);
                if (m != null)
                {
                    WriteMixtapeFolder(m, Repository.GetTracks(id));
                }
            }

            _ = Hub.BroadcastUpdatedAsync();
        }

        /// <summary>
        /// Builds M3U playlist content for the given tracks.
        /// When baseDownloadUrl is provided each entry uses an HTTP URL instead of a local file path.
        /// </summary>
        /// <returns></returns>
        public string BuildM3uContent(IReadOnlyList<MixtapeTrack> tracks, string? baseDownloadUrl = null)
        {
            var sb = new StringBuilder();
            sb.AppendLine("#EXTM3U");
            foreach (var track in tracks)
            {
                var duration = (int)(track.Duration ?? 0);
                var artist = track.Artist ?? string.Empty;
                var title = track.Title ?? Path.GetFileNameWithoutExtension(track.FilePath);
                var display = string.IsNullOrEmpty(artist) ? title : $"{artist} - {title}";
                var uri = baseDownloadUrl != null
                    ? $"{baseDownloadUrl}/{Uri.EscapeDataString(track.Id)}/download"
                    : track.FilePath;
                sb.AppendLine($"#EXTINF:{duration},{display}");
                sb.AppendLine(uri);
            }

            return sb.ToString();
        }

        // ── Folder + M3U management ───────────────────────────────────────────

        /// <summary>
        /// Writes the M3U and, if the mixtape is Soulseek-shared, also syncs symlinks.
        /// Called on every create/update/track change.
        /// </summary>
        private void WriteMixtapeFolder(Mixtape m, IReadOnlyList<MixtapeTrack> tracks)
        {
            try
            {
                var dir = MixtapeDir(m);
                Directory.CreateDirectory(dir);
                WriteM3U(dir, m.Name, tracks);
                if (m.IsSoulseekShared)
                {
                    SyncSymlinks(dir, tracks);
                }
            }
            catch (Exception ex)
            {
                Log.Warning(ex, "Could not write mixtape folder for {Id}", m.Id);
            }
        }

        private static void WriteM3U(string dir, string name, IReadOnlyList<MixtapeTrack> tracks)
        {
            Directory.CreateDirectory(dir);

            foreach (var old in Directory.GetFiles(dir, "*.m3u"))
            {
                try
                {
                    File.Delete(old);
                }
                catch
                { /* non-fatal */
                }
            }

            if (tracks.Count == 0)
            {
                return;
            }

            var m3uPath = Path.Combine(dir, $"{SafeFileName(name)}.m3u");
            var sb = new StringBuilder();
            sb.AppendLine("#EXTM3U");
            foreach (var track in tracks)
            {
                var duration = (int)(track.Duration ?? 0);
                var artist = track.Artist ?? string.Empty;
                var title = track.Title ?? Path.GetFileNameWithoutExtension(track.FilePath);
                var display = string.IsNullOrEmpty(artist) ? title : $"{artist} - {title}";
                sb.AppendLine($"#EXTINF:{duration},{display}");
                sb.AppendLine(track.FilePath);
            }

            File.WriteAllText(m3uPath, sb.ToString(), Encoding.UTF8);
        }

        private static void SyncSymlinks(string dir, IReadOnlyList<MixtapeTrack> tracks)
        {
            Directory.CreateDirectory(dir);

            foreach (var existing in Directory.GetFiles(dir).Where(f => !f.EndsWith(".m3u", StringComparison.OrdinalIgnoreCase)))
            {
                var target = tracks.FirstOrDefault(t => SymlinkName(t) == Path.GetFileName(existing));
                if (target == null)
                {
                    try
                    {
                        File.Delete(existing);
                    }
                    catch
                    { /* non-fatal */
                    }
                }
            }

            foreach (var track in tracks)
            {
                var linkPath = Path.Combine(dir, SymlinkName(track));
                if (!File.Exists(linkPath) && File.Exists(track.FilePath))
                {
                    try
                    {
                        File.CreateSymbolicLink(linkPath, track.FilePath);
                    }
                    catch (Exception ex)
                    {
                        Log.Warning(ex, "Could not create symlink {Link} → {Target}", linkPath, track.FilePath);
                    }
                }
            }
        }

        private static void RemoveSymlinks(string dir)
        {
            if (!Directory.Exists(dir))
            {
                return;
            }

            foreach (var f in Directory.GetFiles(dir).Where(f => !f.EndsWith(".m3u", StringComparison.OrdinalIgnoreCase)))
            {
                try
                {
                    File.Delete(f);
                }
                catch
                { /* non-fatal */
                }
            }
        }

        private static void RemoveMixtapeFolder(string dir)
        {
            if (!Directory.Exists(dir))
            {
                return;
            }

            try
            {
                Directory.Delete(dir, recursive: true);
            }
            catch (Exception ex)
            {
                Log.Warning(ex, "Could not remove mixtape folder {Dir}", dir);
            }
        }

        private static string SymlinkName(MixtapeTrack track)
        {
            var display = string.IsNullOrWhiteSpace(track.Title)
                ? Path.GetFileName(track.FilePath)
                : track.Title;
            var ext = Path.GetExtension(track.FilePath);
            var safe = SafeFileName(display ?? string.Empty);
            return $"{track.SortOrder:D2} - {safe}{ext}";
        }

        private static string SafeFileName(string name)
        {
            var invalid = Path.GetInvalidFileNameChars();
            var safe = string.Concat(name.Select(c => invalid.Contains(c) ? '_' : c)).Trim();
            return string.IsNullOrEmpty(safe) ? "mixtape" : safe;
        }

        private void TouchMixtape(string id)
        {
            var m = Repository.GetById(id);
            if (m == null)
            {
                return;
            }

            Repository.UpdateMixtape(m with { UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() });
        }
    }
}
