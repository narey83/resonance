namespace resonance;

using System;
using System.Data.Common;
using System.IO;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Npgsql;

/// <summary>Validated, bootstrap-only database selection shared by all data stores.</summary>
public sealed record RuntimeDatabase(bool UsePostgres, string ConnectionString)
{
    public static RuntimeDatabase Resolve(Options.DatabaseOptions options, string applicationDirectory)
    {
        var provider = options.Provider ?? options.Type;
        // Existing installations supplied only a PostgreSQL connection string. Preserve them.
        provider ??= options.ConnectionString?.Contains("Host=", StringComparison.OrdinalIgnoreCase) == true
            ? "PostgreSql" : "Sqlite";
        try
        {
            if (provider.Equals("PostgreSql", StringComparison.OrdinalIgnoreCase))
            {
                var pg = new NpgsqlConnectionStringBuilder(options.ConnectionString ?? string.Empty);
                if (string.IsNullOrWhiteSpace(pg.Host) || string.IsNullOrWhiteSpace(pg.Database))
                    throw new ArgumentException("PostgreSql requires a connection string with Host and Database.");
                return new(true, pg.ConnectionString);
            }
            if (!provider.Equals("Sqlite", StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("Unsupported database provider. Supported providers: Sqlite, PostgreSql.");
            var sqlite = new SqliteConnectionStringBuilder(options.ConnectionString ?? "Data Source=data/resonance.db");
            if (string.IsNullOrWhiteSpace(sqlite.DataSource) || sqlite.DataSource == ":memory:" || sqlite.Mode == SqliteOpenMode.Memory)
                throw new ArgumentException("Sqlite requires a persistent database file path.");
            sqlite.DataSource = Path.GetFullPath(sqlite.DataSource, Path.GetFullPath(applicationDirectory));
            sqlite.ForeignKeys = true;
            sqlite.DefaultTimeout = 30;
            return new(false, sqlite.ConnectionString);
        }
        catch (ArgumentException ex)
        {
            // Never echo a connection string or credentials in configuration errors.
            throw new ArgumentException("Invalid database configuration. " +
                (ex.Message.StartsWith("Unsupported") || ex.Message.StartsWith("PostgreSql requires") || ex.Message.StartsWith("Sqlite requires")
                    ? ex.Message : "Check the connection string syntax and provider-specific options."));
        }
    }

    public DbConnection CreateConnection() => UsePostgres
        ? new NpgsqlConnection(ConnectionString) : new SqliteConnection(ConnectionString);

    public void Configure(DbContextOptionsBuilder options)
    {
        if (UsePostgres) options.UseNpgsql(ConnectionString);
        else options.UseSqlite(ConnectionString);
    }

    public void InitializeDirectory()
    {
        if (UsePostgres) return;
        var file = new SqliteConnectionStringBuilder(ConnectionString).DataSource;
        var directory = Path.GetDirectoryName(file)!;
        Directory.CreateDirectory(directory);
        var probe = Path.Combine(directory, ".resonance-write-" + Guid.NewGuid().ToString("N"));
        using (new FileStream(probe, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1, FileOptions.DeleteOnClose)) { }
        using var connection = (SqliteConnection)CreateConnection();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=30000;";
        command.ExecuteNonQuery();
    }
}
