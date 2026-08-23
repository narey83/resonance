namespace Resonance.Tests.Logs;

using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using global::resonance;
using global::resonance.Core.LogStore;

/// <summary>
///     Shared SQLite-backed test scaffolding for the Postgres-designed logging stack. Per
///     <see cref="global::Resonance.Tests.Transfers.TransferRetryOfIdForeignKeyTests"/>'s precedent:
///     this validates entity mapping, filtering, and batching logic against SQLite rather than a new
///     database-testing framework. What it deliberately does NOT cover: native Postgres range
///     partitioning, the trigram GIN index, and the raw-DDL paths in LogsSchemaInitializer/the
///     partition-maintenance half of LogPersistenceService -- SQLite has no equivalent for any of
///     those, and they're Postgres-only by design. Those are verified against the real dev database
///     instead (see the session notes/deploy verification, not an automated test here).
/// </summary>
internal static class LogsTestSupport
{
    public static SqliteConnection OpenConnection()
    {
        var connection = new SqliteConnection("Data Source=:memory:");
        connection.Open();
        return connection;
    }

    public static DbContextOptions<LogsDbContext> Options(SqliteConnection connection) =>
        new DbContextOptionsBuilder<LogsDbContext>().UseSqlite(connection).Options;

    public static LogsDbContext CreateSchema(SqliteConnection connection)
    {
        var options = Options(connection);
        var context = new LogsDbContext(options);
        context.Database.EnsureCreated();
        return context;
    }

    public static ConnectionStringDictionary FakeConnectionStrings() => new(new Dictionary<Database, ConnectionString>
    {
        [Database.Logs] = "Host=unused;Database=unused;Username=unused;Password=unused",
    });

    public static IOptionsMonitor<global::resonance.Options> OptionsMonitor(global::resonance.Options value = null!) =>
        new StubOptionsMonitor(value ?? new global::resonance.Options());

    public sealed class TestDbContextFactory : IDbContextFactory<LogsDbContext>
    {
        public TestDbContextFactory(DbContextOptions<LogsDbContext> options)
        {
            Options = options;
        }

        private DbContextOptions<LogsDbContext> Options { get; }

        public LogsDbContext CreateDbContext() => new(Options);
    }

    private sealed class StubOptionsMonitor : IOptionsMonitor<global::resonance.Options>
    {
        public StubOptionsMonitor(global::resonance.Options value)
        {
            CurrentValue = value;
        }

        public global::resonance.Options CurrentValue { get; }

        public global::resonance.Options Get(string? name) => CurrentValue;

        public IDisposable? OnChange(Action<global::resonance.Options, string?> listener) => null;
    }
}
