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
    using resonance.Common;
    using resonance.Mixtapes.API;
    using resonance.MusicLibrary;
    using Serilog;

    public class MixtapeService : IMixtapeService, IHostedService
    {
        private static readonly ILogger Log = Serilog.Log.ForContext("SourceContext", resonance.Logs.Music.Mixtapes);

        /// <summary>
        /// Initializes a new instance of the <see cref="MixtapeService"/> class.
        /// Creates a new MixtapeService.
        /// </summary>
        /// <param name="repository">Repository for mixtape data.</param>
        /// <param name="musicRepository">Music library for track metadata enrichment.</param>
        /// <param name="downloadsDir">The configured downloads directory (from options).</param>
        /// <param name="artworkDir">Directory for storing mixtape artwork files.</param>
        /// <param name="hub">The mixtapes SignalR hub context.</param>
        public MixtapeService(
            MixtapeRepository repository,
            MusicRepository musicRepository,
            string downloadsDir,
            string artworkDir,
            IHubContext<MixtapesHub> hub)
        {
            Repository = repository;
            MusicRepository = musicRepository;
            MixtapesBaseDir = Path.Combine(downloadsDir, "mixtapes");
            ArtworkDir = artworkDir;
            Hub = hub;
            Repository.Initialize();
        }

        // All initialization (directory creation, migrations)
        private MixtapeRepository Repository { get; }
        private MusicRepository MusicRepository { get; }
        private string MixtapesBaseDir { get; }
        private string ArtworkDir { get; }
        private IHubContext<MixtapesHub> Hub { get; }

        // Serializes folder/playlist writes between the background startup rebuild and live edits.
        private object FolderSyncRoot { get; } = new();

        // Rebuilding each mixtape's folder and playlist runs in the background: it touches the downloads
        // disk, and doing it in the constructor held up host startup -- and with it the HTTP server -- by
        // around ten seconds, even for a single mixtape.
        public Task StartAsync(CancellationToken cancellationToken)
        {
            resonance.Core.StartupProgress.Starting("mixtapes", "Playlists", "Rebuilding playlist folders");

            // blocking file I/O that can wait on the disk spinning up, so keep it off the thread pool
            _ = Task.Factory.StartNew(
                () =>
                {
                    try
                    {
                        // Downloads can be a stalled network mount. Never touch it while
                        // constructing hosted services: that also blocks the HTTP listener.
                        Directory.CreateDirectory(MixtapesBaseDir);
                        RebuildFolders();
                        resonance.Core.StartupProgress.Ready("mixtapes", "Playlist folders are up to date");
                    }
                    catch (Exception ex)
                    {
                        resonance.Core.StartupProgress.Failed("mixtapes", ex.Message);
                        Log.Error(ex, "Failed to rebuild mixtape folders");
                    }
                },
                CancellationToken.None,
                TaskCreationOptions.LongRunning,
                TaskScheduler.Default);

            return Task.CompletedTask;
        }

        public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

        public bool HasArtwork(string id) => File.Exists(ArtworkFilePath(id));

        public (string Path, string ContentType)? GetArtworkInfo(string id, int? size = null)
        {
            var path = ArtworkFilePath(id);
            if (!File.Exists(path))
            {
                return null;
            }

            // Original artwork is often a multi-megabyte photo, while
            // every tile showing it is a few hundred pixels across. Serve a resized copy instead, kept on
            // disk beside the original so each size is only made once.
            var bucket = ThumbnailBucket(size ?? ArtworkResizer.DefaultSize);
            var thumbnail = ArtworkThumbnailPath(id, bucket);

            try
            {
                if (File.Exists(thumbnail) && File.GetLastWriteTimeUtc(thumbnail) >= File.GetLastWriteTimeUtc(path))
                {
                    return (thumbnail, "image/jpeg");
                }

                var source = File.ReadAllBytes(path);

                // write aside and move into place, so a concurrent request never reads a partial file
                var temporary = $"{thumbnail}.{Guid.NewGuid():N}.tmp";
                File.WriteAllBytes(temporary, ArtworkResizer.ResizeToJpeg(source, bucket));
                File.Move(temporary, thumbnail, overwrite: true);

                return (thumbnail, "image/jpeg");
            }
            catch (Exception ex)
            {
                Log.Warning("Failed to resize artwork for playlist {Id} to {Size}px: {Message}", id, bucket, ex.Message);
                return null;
            }
        }

        public async System.Threading.Tasks.Task SaveArtworkAsync(string id, Stream data, string contentType)
        {
            Directory.CreateDirectory(ArtworkDir);
            DeleteArtworkThumbnails(id);
            await using (var fs = File.Create(ArtworkFilePath(id)))
            {
                await data.CopyToAsync(fs);
            }

            await File.WriteAllTextAsync(ArtworkCtPath(id), contentType);
            TouchMixtape(id);
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

            DeleteArtworkThumbnails(id);
            TouchMixtape(id);

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

        public Mixtape CreateSnapshot(string id, string name, string? description, IReadOnlyList<MusicTrack> tracks)
        {
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var mixtape = new Mixtape(id, name, description, false, null, now, now);
            var rows = tracks.Select((track, index) => new MixtapeTrack(Guid.NewGuid().ToString("N"), id,
                track.Path, track.Title, track.Artist, track.Album, track.Duration, index)).ToArray();
            Repository.InsertSnapshot(mixtape, rows);
            var saved = GetById(id)!;
            WriteMixtapeFolder(saved, saved.Tracks!);
            _ = Hub.BroadcastUpdatedAsync();
            return saved;
        }

        public Mixtape Update(string id, string name, string? description)
        {
            var old = Repository.GetById(id) ?? throw new KeyNotFoundException($"Playlist {id} not found");
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
            var m = Repository.GetById(mixtapeId) ?? throw new KeyNotFoundException($"Playlist {mixtapeId} not found");

            var libraryTrack = MusicRepository.GetByPath(filePath);
            var existing = Repository.GetTracks(mixtapeId);

            if (existing.Any(t => t.FilePath == filePath))
            {
                throw new InvalidOperationException("Track is already in this playlist");
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
                throw new KeyNotFoundException($"Playlist {mixtapeId} not found");
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
                throw new KeyNotFoundException($"Playlist {mixtapeId} not found");
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
            var m = Repository.GetById(id) ?? throw new KeyNotFoundException($"Playlist {id} not found");
            var token = m.PublicToken ?? Guid.NewGuid().ToString("N")[..16];
            var updated = m with { IsPublished = true, PublicToken = token, UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() };
            Repository.UpdateMixtape(updated);
            _ = Hub.BroadcastUpdatedAsync();
            return WithArtwork(updated with { Tracks = Repository.GetTracks(id) });
        }

        public void Unpublish(string id)
        {
            var m = Repository.GetById(id) ?? throw new KeyNotFoundException($"Playlist {id} not found");
            var updated = m with { IsPublished = false, UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() };
            Repository.UpdateMixtape(updated);
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
        /// Builds M3U playlist content for the given tracks, rendering each entry with <paramref name="uriFor"/>.
        /// </summary>
        /// <returns></returns>
        public string BuildM3uContent(IReadOnlyList<MixtapeTrack> tracks, Func<MixtapeTrack, string> uriFor)
        {
            var sb = new StringBuilder();
            sb.AppendLine("#EXTM3U");
            foreach (var track in tracks)
            {
                var duration = (int)(track.Duration ?? 0);
                var artist = track.Artist ?? string.Empty;
                var title = track.Title ?? Path.GetFileNameWithoutExtension(track.FilePath);
                var display = string.IsNullOrEmpty(artist) ? title : $"{artist} - {title}";
                sb.AppendLine($"#EXTINF:{duration},{display}");
                sb.AppendLine(uriFor(track));
            }

            return sb.ToString();
        }

        // Requested sizes follow each client's layout and pixel density, so round them up to a power of
        // two: a handful of files per mixtape rather than one for every size ever asked for.
        internal static int ThumbnailBucket(int size)
        {
            var bucket = 64;
            while (bucket < ArtworkResizer.Clamp(size))
            {
                bucket *= 2;
            }

            return Math.Min(bucket, ArtworkResizer.MaximumSize);
        }

        private static string MixtapeFolderName(Mixtape m) => SafeFileName(m.Name);

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

        private static string PlaylistLeafName(MixtapeTrack track)
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

        private void WriteM3U(string dir, string name, IReadOnlyList<MixtapeTrack> tracks)
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

            // Entries are sibling file names rather than server-local paths, which resolve nowhere
            // else; see ExportM3u for the playlist that streams back to a player over HTTP.
            var m3uPath = Path.Combine(dir, $"{SafeFileName(name)}.m3u");
            var content = BuildM3uContent(tracks, PlaylistLeafName);

            // No BOM: strict M3U parsers don't recognise a "﻿#EXTM3U" header.
            File.WriteAllText(m3uPath, content, new UTF8Encoding(false));
        }

        private string MixtapeDir(Mixtape m) => Path.Combine(MixtapesBaseDir, MixtapeFolderName(m));

        private string LegacyMixtapeDir(string id) => Path.Combine(MixtapesBaseDir, id);

        private string ArtworkFilePath(string id) => Path.Combine(ArtworkDir, id);

        private string ArtworkCtPath(string id) => Path.Combine(ArtworkDir, id + ".ct");

        private string ArtworkThumbnailPath(string id, int size) => Path.Combine(ArtworkDir, $"{id}.thumb-v2-{size}.jpg");

        private void DeleteArtworkThumbnails(string id)
        {
            if (!Directory.Exists(ArtworkDir))
            {
                return;
            }

            foreach (var file in Directory.EnumerateFiles(ArtworkDir, $"{id}.thumb-*"))
            {
                try
                {
                    File.Delete(file);
                }
                catch (Exception ex)
                {
                    Log.Warning("Failed to delete artwork thumbnail {File}: {Message}", file, ex.Message);
                }
            }
        }

        private Mixtape WithArtwork(Mixtape m) =>
            File.Exists(ArtworkFilePath(m.Id)) ? m with { HasArtwork = true } : m;

        // ── Folder + M3U management ───────────────────────────────────────────

        /// <summary>
        /// Writes the mixtape's folder and M3U. Called on every create/update/track change.
        /// </summary>
        private void WriteMixtapeFolder(Mixtape m, IReadOnlyList<MixtapeTrack> tracks)
        {
            lock (FolderSyncRoot)
            {
                try
                {
                    var dir = MixtapeDir(m);
                    Directory.CreateDirectory(dir);
                    WriteM3U(dir, m.Name, tracks);
                }
                catch (Exception ex)
                {
                    Log.Warning(ex, "Could not write mixtape folder for {Id}", m.Id);
                }
            }
        }

        /// <summary>
        /// Migrates legacy GUID-named folders to friendly names, then rebuilds every mixtape's M3U.
        /// Runs in the background at startup, so it can overlap user edits:
        /// each mixtape is re-read under the folder lock, so a concurrent edit is never overwritten
        /// with the state from before it.
        /// </summary>
        private void RebuildFolders()
        {
            foreach (var id in Repository.GetAll().Select(m => m.Id))
            {
                lock (FolderSyncRoot)
                {
                    var m = Repository.GetById(id);
                    if (m == null)
                    {
                        continue;
                    }

                    var legacyDir = LegacyMixtapeDir(m.Id);
                    var friendlyDir = MixtapeDir(m);
                    if (legacyDir != friendlyDir && Directory.Exists(legacyDir) && !Directory.Exists(friendlyDir))
                    {
                        try
                        {
                            Directory.Move(legacyDir, friendlyDir);
                        }
                        catch (Exception ex)
                        {
                            Log.Warning(ex, "Could not migrate mixtape folder {Old} → {New}", legacyDir, friendlyDir);
                        }
                    }

                    WriteMixtapeFolder(m, Repository.GetTracks(m.Id));
                }
            }
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
