namespace Resonance.Tests.Database;

using global::resonance;
using Dapper;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using global::resonance.Messaging;

public class SqliteSchemaConcurrencyTests
{
    [Fact]
    public void CurrentMessagingSchemaCanBeCheckedWhileAnotherConnectionHoldsTheWriter()
    {
        var path = Path.Combine(Path.GetTempPath(), $"schema-lock-{Guid.NewGuid():N}.db");
        var connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = path,
            Pooling = false,
            DefaultTimeout = 1,
        }.ToString();
        try
        {
            using var connection = new SqliteConnection(connectionString);
            connection.Open();
            connection.Execute("PRAGMA journal_mode=WAL");
            var options = new DbContextOptionsBuilder<MessagingDbContext>().UseSqlite(connectionString).Options;
            using (var initial = new MessagingDbContext(options))
            {
                SqliteSchema.Initialize(initial);
            }

            using var writer = connection.BeginTransaction();
            connection.Execute("UPDATE __ResonanceSchema SET Version=Version WHERE Context='MessagingDbContext'", transaction: writer);
            using var current = new MessagingDbContext(options);
            SqliteSchema.Initialize(current);
            Assert.Equal(1, connection.ExecuteScalar<int>("SELECT Version FROM __ResonanceSchema WHERE Context='MessagingDbContext'", transaction: writer));
            writer.Rollback();
        }
        finally
        {
            foreach (var file in new[] { path, path + "-wal", path + "-shm" })
            {
                File.Delete(file);
            }
        }
    }
}
