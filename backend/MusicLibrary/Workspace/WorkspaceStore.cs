// <copyright file="WorkspaceStore.cs" company="John Narey">
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
using System.Data.Common;
using System.Linq;
using System.Text.Json;
using Dapper;

// Crate definitions and preparation progress belong to the selected database provider.
// Crate membership is always queried from the current library; it is never a copied track list.

/// <summary>Stores crate definitions and preparation progress against the selected database.</summary>
public partial class WorkspaceStore
{
    private const string ItemColumns = "path AS Path, file_size AS FileSize, file_modified AS FileModified, state AS State, attempts AS Attempts, next_attempt_at AS NextAttemptAt, detail AS Detail, updated_at AS UpdatedAt";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly ConnectionStringDictionary connections;
    private readonly bool postgres;
    private readonly MusicRepository repository;

    public WorkspaceStore(ConnectionStringDictionary connections, MusicRepository repository = null)
    {
        this.connections = connections;
        this.repository = repository;
        postgres = connections.UsePostgres;
        using var db = Open();
        if (postgres)
        {
            db.Execute("CREATE SCHEMA IF NOT EXISTS music");
        }

        db.Execute($@"CREATE TABLE IF NOT EXISTS {Crates} (
            id TEXT NOT NULL, username TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL,
            rules TEXT NOT NULL, revision BIGINT NOT NULL, PRIMARY KEY (id, username));
            CREATE TABLE IF NOT EXISTS {Preparation} (
            path TEXT PRIMARY KEY, file_size BIGINT NOT NULL, file_modified BIGINT NOT NULL,
            state TEXT NOT NULL, attempts INTEGER NOT NULL, next_attempt_at BIGINT NOT NULL,
            detail TEXT NOT NULL, updated_at BIGINT NOT NULL);
            CREATE INDEX IF NOT EXISTS preparation_due ON {Preparation} (state, next_attempt_at);
            CREATE TABLE IF NOT EXISTS {Settings} (key TEXT PRIMARY KEY, value TEXT NOT NULL);");
        InitializeSetPlans(db);
        InitializeDiscovery(db);
    }

    public static IReadOnlyList<SmartCrate> Starters { get; } = new[]
    {
        new SmartCrate("recent", "Fresh arrivals", "Added in the last 30 days. Your next discoveries start here.", new(AddedWithinDays: 30), 0, true),
        new SmartCrate("unplayed", "Not played yet", "Tracks you have not played in Resonance.", new(NeverPlayed: true), 0, true),
        new SmartCrate("instrumental", "Instrumental picks", "Analysis found no voice. A useful starting point for layering.", new(Vocals: "no", Analysis: "enhanced"), 0, true),
    };

    public bool Paused
    {
        get
        {
            using var db = Open();
            return db.ExecuteScalar<string>($"SELECT value FROM {Settings} WHERE key='preparation-paused'") == "true";
        }
        set
        {
            using var db = Open();
            db.Execute($"INSERT INTO {Settings} (key,value) VALUES ('preparation-paused',@value) ON CONFLICT(key) DO UPDATE SET value=excluded.value", new { value = value ? "true" : "false" });
        }
    }

    private string Crates => postgres ? "music.smart_crates" : "smart_crates";
    private string Preparation => postgres ? "music.preparation_items" : "preparation_items";
    private string Settings => postgres ? "music.workspace_settings" : "workspace_settings";
    private string Tracks => postgres ? "music.tracks" : "tracks";

    public IReadOnlyList<SmartCrate> ListCrates(string username)
    {
        using var db = Open();
        return (repository?.AutomaticCrates() ?? Array.Empty<SmartCrate>()).Concat(Starters).Concat(db.Query<CrateRow>($"SELECT id AS Id, name AS Name, description AS Description, rules AS Rules, revision AS Revision FROM {Crates} WHERE username=@username ORDER BY LOWER(name), id", new { username }).Select(Crate)).ToArray();
    }

    public SmartCrate FindCrate(string username, string id) => ListCrates(username).FirstOrDefault(row => row.Id == id);
    public SmartCrate SaveCrate(string username, string id, SaveCrateRequest request)
    {
        request = request.Validated();
        using var db = Open();
        var rules = JsonSerializer.Serialize(request.Rules, Json);
        if (id == null)
        {
            if (db.ExecuteScalar<int>($"SELECT COUNT(*) FROM {Crates} WHERE username=@username", new { username }) >= 50)
            {
                throw new ArgumentException("You can save up to 50 smart crates.");
            }

            id = Guid.NewGuid().ToString("N");
            db.Execute($"INSERT INTO {Crates} (id,username,name,description,rules,revision) VALUES (@id,@username,@Name,@Description,@rules,1)", new { id, username, request.Name, request.Description, rules });
            return new(id, request.Name, request.Description, request.Rules, 1);
        }

        if (!Guid.TryParseExact(id, "N", out _))
        {
            throw new ArgumentException("Starter crates can be duplicated but cannot be edited.");
        }

        var changed = db.Execute($"UPDATE {Crates} SET name=@Name, description=@Description, rules=@rules, revision=revision+1 WHERE id=@id AND username=@username AND revision=@Revision",
            new { id, username, request.Name, request.Description, rules, request.Revision });
        if (changed != 1)
        {
            throw new InvalidOperationException("This crate changed in another window. Refresh it before saving.");
        }

        return new(id, request.Name, request.Description, request.Rules, request.Revision + 1);
    }

    public bool DeleteCrate(string username, string id, long revision)
    {
        using var db = Open();
        return db.Execute($"DELETE FROM {Crates} WHERE id=@id AND username=@username AND revision=@revision", new { id, username, revision }) == 1;
    }

    public PreparationItem Find(string path)
    {
        using var db = Open();
        return db.QuerySingleOrDefault<PreparationItem>($"SELECT {ItemColumns} FROM {Preparation} WHERE path=@path", new { path });
    }

    public Dictionary<string, PreparationItem> FindMany(IEnumerable<string> paths)
    {
        using var db = Open();
        var predicate = postgres ? "path = ANY(@paths)" : "path IN @paths";
        return db.Query<PreparationItem>($"SELECT {ItemColumns} FROM {Preparation} WHERE {predicate}", new { paths = paths.ToArray() }).ToDictionary(row => row.Path);
    }

    public void PutMany(IEnumerable<PreparationItem> items)
    {
        using var db = Open();
        using var transaction = db.BeginTransaction();
        db.Execute($@"INSERT INTO {Preparation} (path,file_size,file_modified,state,attempts,next_attempt_at,detail,updated_at)
            VALUES (@Path,@FileSize,@FileModified,@State,@Attempts,@NextAttemptAt,@Detail,@UpdatedAt)
            ON CONFLICT(path) DO UPDATE SET file_size=excluded.file_size,file_modified=excluded.file_modified,
            state=excluded.state,attempts=excluded.attempts,next_attempt_at=excluded.next_attempt_at,detail=excluded.detail,updated_at=excluded.updated_at", items, transaction);
        transaction.Commit();
    }

    public void Put(PreparationItem item)
    {
        using var db = Open();
        db.Execute($@"INSERT INTO {Preparation} (path,file_size,file_modified,state,attempts,next_attempt_at,detail,updated_at)
            VALUES (@Path,@FileSize,@FileModified,@State,@Attempts,@NextAttemptAt,@Detail,@UpdatedAt)
            ON CONFLICT(path) DO UPDATE SET file_size=excluded.file_size,file_modified=excluded.file_modified,
            state=excluded.state,attempts=excluded.attempts,next_attempt_at=excluded.next_attempt_at,detail=excluded.detail,updated_at=excluded.updated_at", item);
    }

    public void RecoverInterrupted()
    {
        using var db = Open();
        db.Execute($"UPDATE {Preparation} SET state=CASE WHEN attempts>=3 THEN 'failed' ELSE 'queued' END, detail='Previous analysis was interrupted' WHERE state='running'");
    }

    public void RemoveDeleted()
    {
        using var db = Open();
        db.Execute($"DELETE FROM {Preparation} WHERE NOT EXISTS (SELECT 1 FROM {Tracks} t WHERE t.path={Preparation}.path)");
    }

    public PreparationItem Due(long now)
    {
        using var db = Open();
        return db.QueryFirstOrDefault<PreparationItem>($"SELECT {ItemColumns} FROM {Preparation} WHERE state IN ('queued','retrying') AND next_attempt_at<=@now ORDER BY next_attempt_at,updated_at,path LIMIT 1", new { now });
    }

    public Dictionary<string, int> Counts()
    {
        using var db = Open();
        return db.Query<(string State, int Count)>($"SELECT state,COUNT(*) FROM {Preparation} GROUP BY state").ToDictionary(row => row.State, row => row.Count);
    }

    public (int Total, IReadOnlyList<PreparationItem> Items) Page(string state, string search, int limit, int offset)
    {
        using var db = Open();
        var clause = $"FROM {Preparation} p JOIN {Tracks} t ON t.path=p.path WHERE (@state='' OR p.state=@state OR (@state='analysed' AND p.state IN ('complete','basic')) OR (@state='waiting' AND p.state IN ('queued','retrying'))) AND (@search='' OR LOWER(COALESCE(t.title,t.filename)) LIKE @pattern OR LOWER(COALESCE(t.artist,'')) LIKE @pattern)";
        var args = new { state = state ?? string.Empty, search = search?.Trim() ?? string.Empty, pattern = "%" + search?.Trim().ToLowerInvariant() + "%", limit, offset };
        var total = db.ExecuteScalar<int>($"SELECT COUNT(*) {clause}", args);
        var columns = string.Join(",", ItemColumns.Split(',').Select(column => "p." + column.Trim()));
        return (total, db.Query<PreparationItem>($"SELECT {columns} {clause} ORDER BY LOWER(COALESCE(t.title,t.filename)),p.path LIMIT @limit OFFSET @offset", args).ToArray());
    }

    private static SmartCrate Crate(CrateRow row) => new(row.Id, row.Name, row.Description, JsonSerializer.Deserialize<SmartCrateRules>(row.Rules, Json), row.Revision);

    private DbConnection Open()
    {
        var db = connections.CreateConnection(Database.Music);
        db.Open();
        return db;
    }

    private record CrateRow(string Id, string Name, string Description, string Rules, long Revision);
}
