namespace Resonance.Tests.Transfers;

using System;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Soulseek;
using Transfer = global::resonance.Transfers.Transfer;
using TransfersDbContext = global::resonance.Transfers.TransfersDbContext;

/// <summary>
///     Covers the self-referencing <c>Transfer.RetryOfId -&gt; Transfer.Id</c> foreign key added to
///     <see cref="TransfersDbContext"/>. This validates the EF model configuration itself -- the FK is
///     wired to the right column with no cascading delete -- against SQLite (with FK enforcement turned
///     on, since it's off by default) rather than a new, elaborate database-testing framework.
/// </summary>
/// <remarks>
///     What this deliberately does NOT cover: the production database is PostgreSQL-only
///     (<c>ConnectionStringDictionary.UsePostgres</c> is hardcoded true), and the idempotent startup
///     migration in <c>Program.cs</c> that adds this constraint to an *existing* Postgres installation
///     (<c>ALTER TABLE ... ADD CONSTRAINT ... NOT VALID</c>) is Postgres-specific raw SQL with no SQLite
///     equivalent. That path is validated by the production schema/build path instead -- confirmed by
///     starting the application against the existing dev database and inspecting
///     <c>information_schema</c>/<c>pg_constraint</c> for the constraint, rather than by an automated
///     test here.
/// </remarks>
public class TransferRetryOfIdForeignKeyTests
{
    [Fact]
    public void RetryOfId_Referencing_A_Nonexistent_Transfer_Cannot_Be_Persisted()
    {
        using var connection = new SqliteConnection("Data Source=:memory:");
        connection.Open();

        // SQLite does not enforce foreign keys by default; the constraint exists in the schema either
        // way, but only rejects violations once this pragma is on for the connection.
        using (var pragma = connection.CreateCommand())
        {
            pragma.CommandText = "PRAGMA foreign_keys = ON;";
            pragma.ExecuteNonQuery();
        }

        var options = new DbContextOptionsBuilder<TransfersDbContext>().UseSqlite(connection).Options;

        using (var seed = new TransfersDbContext(options))
        {
            seed.Database.EnsureCreated();
        }

        using var context = new TransfersDbContext(options);

        context.Add(new Transfer
        {
            Id = Guid.NewGuid(),
            Username = "alice",
            Direction = TransferDirection.Download,
            Filename = "track.mp3",
            RequestedAt = DateTime.UtcNow,
            State = TransferStates.Queued | TransferStates.Locally,
            RetryOfId = Guid.NewGuid(), // does not exist anywhere in the table
        });

        Assert.Throws<DbUpdateException>(() => context.SaveChanges());
    }

    [Fact]
    public void RetryOfId_Referencing_A_Real_Transfer_Can_Be_Persisted()
    {
        using var connection = new SqliteConnection("Data Source=:memory:");
        connection.Open();

        using (var pragma = connection.CreateCommand())
        {
            pragma.CommandText = "PRAGMA foreign_keys = ON;";
            pragma.ExecuteNonQuery();
        }

        var options = new DbContextOptionsBuilder<TransfersDbContext>().UseSqlite(connection).Options;

        using (var seed = new TransfersDbContext(options))
        {
            seed.Database.EnsureCreated();
        }

        var parentId = Guid.NewGuid();

        using (var seed = new TransfersDbContext(options))
        {
            seed.Add(new Transfer
            {
                Id = parentId,
                Username = "alice",
                Direction = TransferDirection.Download,
                Filename = "track.mp3",
                RequestedAt = DateTime.UtcNow,
                EndedAt = DateTime.UtcNow,
                State = TransferStates.Completed | TransferStates.Errored,
            });
            seed.SaveChanges();
        }

        using var context = new TransfersDbContext(options);

        context.Add(new Transfer
        {
            Id = Guid.NewGuid(),
            Username = "alice",
            Direction = TransferDirection.Download,
            Filename = "track.mp3",
            RequestedAt = DateTime.UtcNow,
            State = TransferStates.Queued | TransferStates.Locally,
            RetryOfId = parentId,
        });

        // should not throw
        context.SaveChanges();
    }
}
