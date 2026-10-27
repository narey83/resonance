// <copyright file="DiscoveryStore.cs" company="John Narey">
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

namespace resonance.MusicLibrary.Workspace;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Dapper;

public record CueBookmark(string Id, double Seconds, string Label);
public record TrackPreparation(string Path, string Role, string Notes, CueBookmark[] Bookmarks, long Revision = 0);
public record DiggingWish(string Id, string Query, long CreatedAt);

/// <summary>Stores track notes, cue bookmarks and digging wishes.</summary>
public partial class WorkspaceStore
{
    private string NotesTable => postgres ? "music.track_preparation" : "track_preparation";
    private string WishesTable => postgres ? "music.digging_wishes" : "digging_wishes";

    public IReadOnlyList<TrackPreparation> ListTrackPreparation(string username)
    {
        using var db = Open();
        return db.Query<string>($"SELECT document FROM {NotesTable} WHERE username=@username", new { username })
            .Select(value => JsonSerializer.Deserialize<TrackPreparation>(value, Json)).ToArray();
    }

    public TrackPreparation SaveTrackPreparation(string username, TrackPreparation request)
    {
        if (request == null || string.IsNullOrWhiteSpace(request.Path) || request.Path.Length > 4096 ||
            (request.Notes?.Length ?? 0) > 10000 || (request.Bookmarks?.Length ?? 0) > 100 ||
            request.Role is not (null or "" or "opener" or "peak" or "closer") ||
            (request.Bookmarks?.Any(cue => cue == null || !double.IsFinite(cue.Seconds) || cue.Seconds < 0 || (cue.Label?.Length ?? 0) > 200) ?? false))
        {
            throw new ArgumentException("Preparation details are invalid.");
        }

        using var db = Open();
        var path = resonance.Common.MusicPath.ToRelative(request.Path);
        var saved = request with { Path = path, Revision = request.Revision + 1, Bookmarks = request.Bookmarks ?? [] };
        var document = JsonSerializer.Serialize(saved, Json);
        if (request.Revision == 0)
        {
            var inserted = db.Execute($"INSERT INTO {NotesTable} (username,path,document,revision) VALUES (@username,@path,@document,1) ON CONFLICT (username,path) DO NOTHING", new { username, path, document });
            if (inserted != 1)
            {
                throw new InvalidOperationException("Notes changed elsewhere. Refresh before saving.");
            }
        }
        else if (db.Execute($"UPDATE {NotesTable} SET document=@document,revision=revision+1 WHERE username=@username AND path=@path AND revision=@Revision", new { username, path, document, request.Revision }) != 1)
        {
            throw new InvalidOperationException("Notes changed elsewhere. Refresh before saving.");
        }

        return saved;
    }

    public IReadOnlyList<DiggingWish> ListWishes(string username)
    {
        using var db = Open();
        return db.Query<DiggingWish>($"SELECT id AS Id, query AS Query, created_at AS CreatedAt FROM {WishesTable} WHERE username=@username ORDER BY created_at DESC", new { username }).ToArray();
    }

    public DiggingWish AddWish(string username, string query)
    {
        if (string.IsNullOrWhiteSpace(query) || query.Length > 300)
        {
            throw new ArgumentException("Enter a search of up to 300 characters.");
        }

        using var db = Open();
        if (db.ExecuteScalar<int>($"SELECT COUNT(*) FROM {WishesTable} WHERE username=@username", new { username }) >= 100)
        {
            throw new ArgumentException("Keep up to 100 saved searches.");
        }

        query = query.Trim();
        var existing = db.QuerySingleOrDefault<DiggingWish>($"SELECT id AS Id, query AS Query, created_at AS CreatedAt FROM {WishesTable} WHERE username=@username AND LOWER(query)=LOWER(@query) LIMIT 1", new { username, query });
        if (existing != null)
        {
            return existing;
        }

        var wish = new DiggingWish(Guid.NewGuid().ToString("N"), query, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        db.Execute($"INSERT INTO {WishesTable} (username,id,query,created_at) VALUES (@username,@Id,@Query,@CreatedAt)", new { username, wish.Id, wish.Query, wish.CreatedAt });
        return wish;
    }

    public void DeleteWish(string username, string id)
    {
        using var db = Open();
        db.Execute($"DELETE FROM {WishesTable} WHERE username=@username AND id=@id", new { username, id });
    }

    private void InitializeDiscovery(System.Data.Common.DbConnection db) => db.Execute($@"
        CREATE TABLE IF NOT EXISTS {NotesTable} (username TEXT NOT NULL, path TEXT NOT NULL, document TEXT NOT NULL, revision BIGINT NOT NULL, PRIMARY KEY (username,path));
        CREATE TABLE IF NOT EXISTS {WishesTable} (username TEXT NOT NULL, id TEXT NOT NULL, query TEXT NOT NULL, created_at BIGINT NOT NULL, PRIMARY KEY (username,id));");
}
