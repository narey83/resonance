namespace resonance.MusicLibrary.Workspace;

using System;
using System.Collections.Generic;
using System.Data.Common;
using System.Linq;
using System.Text.Json;
using Dapper;

public partial class WorkspaceStore
{
    private string Sets => postgres ? "music.set_plans" : "set_plans";
    private const string SetColumns = "id AS Id, document AS Document, revision AS Revision, created_at AS CreatedAt, updated_at AS UpdatedAt, archived AS Archived";
    private sealed record SetRow(string Id, string Document, long Revision, long CreatedAt, long UpdatedAt, long Archived)
    {
        // Property mapping accepts both SQLite Int64 and PostgreSQL Int32
        // without requiring a different positional constructor signature.
        public SetRow() : this("", "", 0, 0, 0, 0) { }
    }

    private void InitializeSetPlans(DbConnection db) => db.Execute($@"CREATE TABLE IF NOT EXISTS {Sets} (
        id TEXT NOT NULL, username TEXT NOT NULL, name TEXT NOT NULL, document TEXT NOT NULL,
        revision BIGINT NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (id, username));
        CREATE INDEX IF NOT EXISTS set_plans_owner ON {Sets} (username, archived, updated_at);");

    private static SetPlan ReadSet(SetRow row)
    {
        var document = JsonSerializer.Deserialize<SetPlanRequest>(row.Document, Json);
        // Read old saved sets with a single master; clear retired checkpoints
        // without touching track order, notes or the optimistic revision.
        return new(row.Id, document.Name, document.Items.Select(item => item with { MasterBpm = null }).ToArray(), document.InitialMasterBpm, document.Bars,
            document.ExtendedTempo, document.Notes, row.Revision, row.CreatedAt, row.UpdatedAt, row.Archived != 0);
    }

    public IReadOnlyList<SetPlan> ListSets(string username)
    {
        using var db = Open();
        return db.Query<SetRow>($"SELECT {SetColumns} FROM {Sets} WHERE username=@username ORDER BY updated_at DESC, id", new { username }).Select(ReadSet).ToArray();
    }

    public SetPlan FindSet(string username, string id)
    {
        using var db = Open();
        var row = db.QuerySingleOrDefault<SetRow>($"SELECT {SetColumns} FROM {Sets} WHERE id=@id AND username=@username", new { id, username });
        return row == null ? null : ReadSet(row);
    }

    public SetPlan SaveSet(string username, string id, SetPlanRequest request)
    {
        request = request.Validated();
        using var db = Open();
        var document = JsonSerializer.Serialize(request with { Revision = 0 }, Json);
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        if (id == null)
        {
            if (db.ExecuteScalar<int>($"SELECT COUNT(*) FROM {Sets} WHERE username=@username", new { username }) >= 100)
                throw new ArgumentException("You can keep up to 100 sets, including archived sets.");
            id = Guid.NewGuid().ToString("N");
            db.Execute($"INSERT INTO {Sets} (id,username,name,document,revision,created_at,updated_at,archived) VALUES (@id,@username,@Name,@document,1,@now,@now,0)", new { id, username, request.Name, document, now });
        }
        else
        {
            if (!Guid.TryParseExact(id, "N", out _)) throw new ArgumentException("Set ID is invalid.");
            if (db.Execute($"UPDATE {Sets} SET name=@Name,document=@document,revision=revision+1,updated_at=@now WHERE id=@id AND username=@username AND revision=@Revision AND archived=0",
                new { id, username, request.Name, document, now, request.Revision }) != 1)
                throw new InvalidOperationException("This set changed in another window or was archived. Your draft is kept; reload the saved version or save a new copy.");
        }
        return FindSet(username, id);
    }

    public SetPlan ArchiveSet(string username, string id, long revision, bool archived)
    {
        using var db = Open();
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        if (db.Execute($"UPDATE {Sets} SET archived=@archived,revision=revision+1,updated_at=@now WHERE id=@id AND username=@username AND revision=@revision", new { id, username, revision, archived = archived ? 1 : 0, now }) != 1)
            throw new InvalidOperationException("This set changed. Reload it before archiving or restoring.");
        return FindSet(username, id);
    }
}
