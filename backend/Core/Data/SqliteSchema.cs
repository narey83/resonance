namespace resonance;

using System;
using System.Linq;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;

/// <summary>SQLite-only, transactional schema versions for the existing independent EF contexts.</summary>
public static class SqliteSchema
{
    public static void Initialize(DbContext context)
    {
        if (!context.Database.IsSqlite()) throw new ArgumentException("SQLite schema initializer requires SQLite.");
        context.Database.OpenConnection();
        using var transaction = context.Database.BeginTransaction();
        context.Database.ExecuteSqlRaw("CREATE TABLE IF NOT EXISTS __ResonanceSchema (Context TEXT PRIMARY KEY, Version INTEGER NOT NULL)");
        var name = context.GetType().Name;
        var version = context.Database.SqlQuery<int>($"SELECT Version AS Value FROM __ResonanceSchema WHERE Context = {name}")
            .ToList();
        if (version.Count == 0)
        {
            // Generate from the SQLite model only. PostgreSQL DDL is never replayed here.
            var script = context.Database.GenerateCreateScript();
            script = Regex.Replace(script, @"\bCREATE TABLE\b", "CREATE TABLE IF NOT EXISTS");
            script = Regex.Replace(script, @"\bCREATE (UNIQUE )?INDEX\b", "CREATE $1INDEX IF NOT EXISTS");
            context.Database.ExecuteSqlRaw(script);
            context.Database.ExecuteSqlInterpolated($"INSERT INTO __ResonanceSchema(Context,Version) VALUES ({name},1)");
        }
        transaction.Commit();
    }
}
