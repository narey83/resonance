// <copyright file="LibraryActivityService.cs" company="JP Dillingham">
//           ▄▄▄▄     ▄▄▄▄     ▄▄▄▄
//     ▄▄▄▄▄▄█  █▄▄▄▄▄█  █▄▄▄▄▄█  █
//     █__ --█  █__ --█    ◄█  -  █
//     █▄▄▄▄▄█▄▄█▄▄▄▄▄█▄▄█▄▄█▄▄▄▄▄█
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) JP Dillingham.
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
//   │ https://slskd.org
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: JP Dillingham
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

namespace resonance.MusicLibrary.Activity;

using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using resonance.MusicLibrary;
using resonance.MusicLibrary.API;
using Serilog;

public class LibraryActivityService : ILibraryActivityService
{
    public LibraryActivityService(
        IDbContextFactory<LibraryActivityDbContext> contextFactory,
        IHubContext<LibraryActivityHub> hub,
        MusicRepository musicRepository)
    {
        ContextFactory = contextFactory;
        Hub = hub;
        MusicRepo = musicRepository;
    }

    private IDbContextFactory<LibraryActivityDbContext> ContextFactory { get; }
    private IHubContext<LibraryActivityHub> Hub { get; }
    private MusicRepository MusicRepo { get; }
    private ILogger Log { get; } = Serilog.Log.ForContext<LibraryActivityService>();

    private (string Title, string Artist, string Folder) ResolveMetadata(string path)
    {
        var track = MusicRepo.GetByPath(path);
        if (track != null)
        {
            var title = !string.IsNullOrEmpty(track.Title) ? track.Title : Path.GetFileNameWithoutExtension(track.Filename);
            var artist = track.Artist ?? track.AlbumArtist ?? string.Empty;
            var folder = track.Directory ?? string.Empty;
            return (title, artist, folder);
        }

        // Fallback for tracks not in the library
        var filename = Path.GetFileNameWithoutExtension(Path.GetFileName(path));
        var directory = Path.GetDirectoryName(path) ?? string.Empty;
        return (filename, string.Empty, directory);
    }

    public string[] GetLovedPaths(string username)
    {
        using var ctx = ContextFactory.CreateDbContext();
        return ctx.LovedTracks
            .Where(t => t.Username == username)
            .Select(t => t.Path)
            .ToArray();
    }

    public async Task LoveTrackAsync(string username, string path)
    {
        using var ctx = ContextFactory.CreateDbContext();

        var existing = await ctx.LovedTracks.FindAsync(path, username);
        if (existing != null)
        {
            return;
        }

        var (title, artist, folder) = ResolveMetadata(path);

        ctx.LovedTracks.Add(new LovedTrack
        {
            Path = path,
            Username = username,
            LovedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            Title = title,
            Artist = artist,
            Folder = folder,
        });
        await ctx.SaveChangesAsync();

        await Hub.BroadcastTrackLovedAsync(username, path);
    }

    public async Task UnloveTrackAsync(string username, string path)
    {
        using var ctx = ContextFactory.CreateDbContext();

        var existing = await ctx.LovedTracks.FindAsync(path, username);
        if (existing == null)
        {
            return;
        }

        ctx.LovedTracks.Remove(existing);
        await ctx.SaveChangesAsync();

        await Hub.BroadcastTrackUnlovedAsync(username, path);
    }

    public async Task ClearAllLovedAsync(string username)
    {
        using var ctx = ContextFactory.CreateDbContext();

        var all = ctx.LovedTracks.Where(t => t.Username == username).ToList();
        ctx.LovedTracks.RemoveRange(all);
        await ctx.SaveChangesAsync();

        await Hub.BroadcastAllUnlovedAsync(username);
    }

    public async Task ReconcileLovedTracksAsync()
    {
        using var ctx = ContextFactory.CreateDbContext();

        var loved = ctx.LovedTracks.ToList();
        if (loved.Count == 0)
        {
            return;
        }

        var repointed = 0;
        var pruned = 0;

        foreach (var entry in loved)
        {
            // Still present in the library at its stored path — nothing to do.
            if (MusicRepo.GetByPath(entry.Path) != null)
            {
                continue;
            }

            // The file's extension may have changed (e.g. opus→mp3). Re-point to the new path.
            var replacement = MusicRepo.FindByPathIgnoringExtension(entry.Path);
            if (replacement != null)
            {
                var (title, artist, folder) = ResolveMetadata(replacement.Path);

                ctx.LovedTracks.Remove(entry);
                ctx.LovedTracks.Add(new LovedTrack
                {
                    Path = replacement.Path,
                    Username = entry.Username,
                    LovedAt = entry.LovedAt,
                    Title = title,
                    Artist = artist,
                    Folder = folder,
                });
                await ctx.SaveChangesAsync();

                await Hub.BroadcastTrackUnlovedAsync(entry.Username, entry.Path);
                await Hub.BroadcastTrackLovedAsync(entry.Username, replacement.Path);

                Log.Information(
                    "Loved track re-pointed after extension change: {Old} → {New}",
                    entry.Path, replacement.Path);
                repointed++;
                continue;
            }

            // Not in the library under any extension. Only prune if the containing directory still
            // exists on disk — otherwise the volume may simply be unmounted and the file isn't gone.
            var directory = Path.GetDirectoryName(entry.Path);
            if (string.IsNullOrEmpty(directory) || !Directory.Exists(directory))
            {
                continue;
            }

            ctx.LovedTracks.Remove(entry);
            await ctx.SaveChangesAsync();

            await Hub.BroadcastTrackUnlovedAsync(entry.Username, entry.Path);

            Log.Information("Loved track pruned — file no longer exists: {Path}", entry.Path);
            pruned++;
        }

        if (repointed > 0 || pruned > 0)
        {
            Log.Information(
                "Loved track reconciliation complete — re-pointed={Repointed} pruned={Pruned}",
                repointed, pruned);
        }
    }

    public async Task<PlayStat> RecordPlayAsync(string username, string path, string title = null, string artist = null, string folder = null, string source = null)
    {
        using var ctx = ContextFactory.CreateDbContext();

        var (resolvedTitle, resolvedArtist, resolvedFolder) = ResolveMetadata(path);

        var record = new PlayRecord
        {
            Id = Guid.NewGuid().ToString(),
            Path = path,
            Username = username,
            PlayedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            Title = !string.IsNullOrEmpty(title) ? title : resolvedTitle,
            Artist = !string.IsNullOrEmpty(artist) ? artist : resolvedArtist,
            Folder = !string.IsNullOrEmpty(folder) ? folder : resolvedFolder,
            Source = source ?? string.Empty,
        };

        ctx.PlayHistory.Add(record);
        await ctx.SaveChangesAsync();

        var stat = ctx.PlayHistory
            .Where(p => p.Username == username && p.Path == path)
            .GroupBy(p => p.Path)
            .Select(g => new PlayStat(g.Key, g.Count(), g.Max(p => (long?)p.PlayedAt)))
            .FirstOrDefault() ?? new PlayStat(path, 1, null);

        await Hub.BroadcastTrackPlayedAsync(username, stat, record);
        return stat;
    }

    public PlayRecord[] GetPlayHistory(string username, int limit = 100, int offset = 0)
    {
        using var ctx = ContextFactory.CreateDbContext();
        return ctx.PlayHistory
            .Where(p => p.Username == username)
            .OrderByDescending(p => p.PlayedAt)
            .Skip(offset)
            .Take(limit)
            .ToArray();
    }

    public async Task DeletePlayAsync(string username, string id)
    {
        using var ctx = ContextFactory.CreateDbContext();

        var record = await ctx.PlayHistory.FindAsync(id);
        if (record == null || record.Username != username)
        {
            return;
        }

        ctx.PlayHistory.Remove(record);
        await ctx.SaveChangesAsync();

        await Hub.BroadcastPlayDeletedAsync(username, id);
    }

    public async Task ClearHistoryAsync(string username)
    {
        using var ctx = ContextFactory.CreateDbContext();

        var all = ctx.PlayHistory.Where(p => p.Username == username).ToList();
        ctx.PlayHistory.RemoveRange(all);
        await ctx.SaveChangesAsync();

        await Hub.BroadcastHistoryClearedAsync(username);
    }

    public PlayStat[] GetPlayStats(string username, string[] paths = null)
    {
        using var ctx = ContextFactory.CreateDbContext();

        var query = ctx.PlayHistory.Where(p => p.Username == username);
        if (paths is { Length: > 0 })
        {
            query = query.Where(p => paths.Contains(p.Path));
        }

        return query
            .GroupBy(p => p.Path)
            .Select(g => new PlayStat(g.Key, g.Count(), g.Max(p => (long?)p.PlayedAt)))
            .ToArray();
    }
}
