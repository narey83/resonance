namespace resonance.Migrations;

using System;
using System.Linq;
using Microsoft.Data.Sqlite;
using Serilog;

/// <summary>
///     Adds the Source column to the PlayHistory table.
/// </summary>
public class Z2026_06_17_PlayHistorySourceMigration : IMigration
{
    public Z2026_06_17_PlayHistorySourceMigration(ConnectionStringDictionary connectionStrings)
    {
        ConnectionString = connectionStrings[Database.LibraryActivity];
    }

    private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", Logs.Database);
    private string ConnectionString { get; }

    public bool NeedsToBeApplied()
    {
        var schema = SchemaInspector.GetDatabaseSchema(ConnectionString);
        return schema.ContainsKey("PlayHistory") &&
               !schema["PlayHistory"].Any(c => c.Name == "Source");
    }

    public void Apply()
    {
        if (!NeedsToBeApplied())
        {
            Log.Information("> Migration {Name} is not necessary or has already been applied", nameof(Z2026_06_17_PlayHistorySourceMigration));
            return;
        }

        using var connection = new SqliteConnection(ConnectionString);
        connection.Open();

        using var transaction = connection.BeginTransaction();

        try
        {
            Log.Information("> Adding Source column to PlayHistory...");

            using var cmd = new SqliteCommand(
                "ALTER TABLE PlayHistory ADD COLUMN Source TEXT NOT NULL DEFAULT '';",
                connection, transaction);
            cmd.ExecuteNonQuery();

            transaction.Commit();
            Log.Information("> Done!");
        }
        catch (Exception)
        {
            transaction.Rollback();
            throw;
        }
    }
}
