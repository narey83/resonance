namespace Resonance.Tests.Transfers;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Threading;
using System.Threading.Tasks;
using global::resonance;
using AppOptions = global::resonance.Options;
using global::resonance.Transfers.Downloads;
using global::resonance.Transfers.Uploads;
using global::resonance.Users;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Soulseek;
using Transfer = global::resonance.Transfers.Transfer;
using TransfersDbContext = global::resonance.Transfers.TransfersDbContext;

/// <summary>
///     Covers the hardening applied to <c>AddOrSupersede</c>: it now shares the same per-user
///     (downloads) / per-(user, filename) (uploads) synchronization that <c>EnqueueAsync</c> already
///     used, specifically so that two concurrent calls against the same failed parent transfer can
///     never both link a new child to it -- see the concurrency review that preceded this change. These
///     tests exercise the real service methods against a real (SQLite, in-memory) database rather than
///     re-testing the locking primitives in isolation, since the point is to prove the *service* can't
///     fork a retry chain, not just that a semaphore works.
/// </summary>
public class RetrySynchronizationTests
{
    /// <summary>
    ///     DownloadService.EnqueueAsync waits its turn on a per-user semaphore rather than rejecting a
    ///     contending caller outright, so AddOrSupersede -- sharing that same semaphore -- is expected to
    ///     do the same: both concurrent calls run, but strictly one after the other, never overlapping.
    /// </summary>
    [Fact]
    public async Task AddOrSupersede_Cannot_Fork_A_Failed_Parent_For_Downloads()
    {
        using var connection = new SqliteConnection("Data Source=:memory:");
        connection.Open();

        var options = new DbContextOptionsBuilder<TransfersDbContext>().UseSqlite(connection).Options;

        using (var seed = new TransfersDbContext(options))
        {
            seed.Database.EnsureCreated();
        }

        var failedParentId = Guid.NewGuid();

        using (var seed = new TransfersDbContext(options))
        {
            seed.Add(new Transfer
            {
                Id = failedParentId,
                Username = "alice",
                Direction = TransferDirection.Download,
                Filename = "track.mp3",
                RequestedAt = DateTime.UtcNow,
                EndedAt = DateTime.UtcNow,
                State = TransferStates.Completed | TransferStates.Errored,
            });
            seed.SaveChanges();
        }

        var service = new DownloadService(
            optionsMonitor: new StubOptionsMonitor(new AppOptions()),
            soulseekClient: null!,
            contextFactory: new TestDbContextFactory(options),
            fileService: null!,
            relayService: null!,
            ftpClient: null!,
            eventBus: null!,
            errorNotifications: null!,
            userService: null!,
            connectionStrings: new ConnectionStringDictionary(new Dictionary<Database, ConnectionString>
            {
                [Database.Transfers] = "Data Source=:memory:",
            }));

        var childB = new Transfer
        {
            Id = Guid.NewGuid(),
            Username = "alice",
            Direction = TransferDirection.Download,
            Filename = "track.mp3",
            RequestedAt = DateTime.UtcNow,
            State = TransferStates.Queued | TransferStates.Locally,
        };

        var childC = new Transfer
        {
            Id = Guid.NewGuid(),
            Username = "alice",
            Direction = TransferDirection.Download,
            Filename = "track.mp3",
            RequestedAt = DateTime.UtcNow,
            State = TransferStates.Queued | TransferStates.Locally,
        };

        // fire both calls at as close to the same instant as possible
        using var barrier = new Barrier(2);

        var taskB = Task.Run(() =>
        {
            barrier.SignalAndWait();
            service.AddOrSupersede(childB);
        });

        var taskC = Task.Run(() =>
        {
            barrier.SignalAndWait();
            service.AddOrSupersede(childC);
        });

        await Task.WhenAll(taskB, taskC);

        using var assert = new TransfersDbContext(options);
        var childrenOfA = assert.Transfers.Where(t => t.RetryOfId == failedParentId).ToList();

        // the important invariant: at most one live child may ever be created from a given failed
        // parent through the protected service path. it must be exactly one here -- not zero, not two --
        // because one of the two concurrent calls is guaranteed to see the parent as the most recent
        // not-yet-removed failure and link to it; the loser (running strictly after, per the shared
        // semaphore) sees the winner's just-created row instead and links to that one, or not at all.
        Assert.Single(childrenOfA);
    }

    /// <summary>
    ///     UploadService.EnqueueAsync rejects a contending caller outright (TryAdd/TryRemove, no queueing),
    ///     so AddOrSupersede -- sharing that same lock name -- is expected to do the same: exactly one of
    ///     two concurrent calls does any work at all, and the other is a silent no-op.
    /// </summary>
    [Fact]
    public async Task AddOrSupersede_Cannot_Fork_A_Failed_Parent_For_Uploads()
    {
        using var connection = new SqliteConnection("Data Source=:memory:");
        connection.Open();

        var options = new DbContextOptionsBuilder<TransfersDbContext>().UseSqlite(connection).Options;

        using (var seed = new TransfersDbContext(options))
        {
            seed.Database.EnsureCreated();
        }

        var failedParentId = Guid.NewGuid();

        using (var seed = new TransfersDbContext(options))
        {
            seed.Add(new Transfer
            {
                Id = failedParentId,
                Username = "alice",
                Direction = TransferDirection.Upload,
                Filename = "track.mp3",
                RequestedAt = DateTime.UtcNow,
                EndedAt = DateTime.UtcNow,
                State = TransferStates.Completed | TransferStates.Errored,
            });
            seed.SaveChanges();
        }

        var service = new UploadService(
            fileService: null!,
            userService: new StubUserService(),
            soulseekClient: null!,
            optionsMonitor: new StubOptionsMonitor(new AppOptions()),
            shareService: null!,
            relayService: null!,
            contextFactory: new TestDbContextFactory(options),
            eventBus: null!,
            errorNotifications: null!,
            connectionStrings: new ConnectionStringDictionary(new Dictionary<Database, ConnectionString>
            {
                [Database.Transfers] = "Data Source=:memory:",
            }));

        var childB = new Transfer
        {
            Id = Guid.NewGuid(),
            Username = "alice",
            Direction = TransferDirection.Upload,
            Filename = "track.mp3",
            RequestedAt = DateTime.UtcNow,
            State = TransferStates.Queued | TransferStates.Locally,
        };

        var childC = new Transfer
        {
            Id = Guid.NewGuid(),
            Username = "alice",
            Direction = TransferDirection.Upload,
            Filename = "track.mp3",
            RequestedAt = DateTime.UtcNow,
            State = TransferStates.Queued | TransferStates.Locally,
        };

        using var barrier = new Barrier(2);

        var taskB = Task.Run(() =>
        {
            barrier.SignalAndWait();
            service.AddOrSupersede(childB);
        });

        var taskC = Task.Run(() =>
        {
            barrier.SignalAndWait();
            service.AddOrSupersede(childC);
        });

        await Task.WhenAll(taskB, taskC);

        using var assert = new TransfersDbContext(options);

        // uploads reject a contending caller outright rather than queueing it, so exactly one new
        // transfer should exist at all (the other call was a no-op), and it must be the one linked
        // to the failed parent.
        var created = assert.Transfers.Where(t => t.Id == childB.Id || t.Id == childC.Id).ToList();
        Assert.Single(created);
        Assert.Equal(failedParentId, created[0].RetryOfId);
    }

    private sealed class TestDbContextFactory(DbContextOptions<TransfersDbContext> options) : IDbContextFactory<TransfersDbContext>
    {
        public TransfersDbContext CreateDbContext() => new(options);
    }

    private sealed class StubOptionsMonitor(AppOptions value) : IOptionsMonitor<AppOptions>
    {
        public AppOptions CurrentValue { get; } = value;

        public AppOptions Get(string? name) => CurrentValue;

        public IDisposable? OnChange(Action<AppOptions, string?> listener) => null;
    }

    /// <summary>
    ///     UploadGovernor/UploadQueue (constructed internally by UploadService) only ever ask for a
    ///     group; AddOrSupersede itself never touches the user service at all.
    /// </summary>
    private sealed class StubUserService : IUserService
    {
        public IReadOnlyList<User> Users => throw new NotImplementedException();

        public IReadOnlyList<string> WatchedUsernames => throw new NotImplementedException();

        public string GetGroup(string username) => Application.DefaultGroup;

        public Task<Info> GetInfoAsync(string username) => throw new NotImplementedException();

        public Task<IPEndPoint> GetIPEndPointAsync(string username) => throw new NotImplementedException();

        public Task<string> GetOrFetchGroupAsync(string username, bool forceFetch = false) => throw new NotImplementedException();

        public Task<Statistics> GetStatisticsAsync(string username) => throw new NotImplementedException();

        public Task<Status> GetStatusAsync(string username) => throw new NotImplementedException();

        public bool TryGetCachedPresence(string username, out UserPresence presence) => throw new NotImplementedException();

        public Task GrantPrivilegesAsync(string username, int days) => throw new NotImplementedException();

        public bool IsBlacklisted(string username, IPAddress? ipAddress = null, bool bypassCache = true) => throw new NotImplementedException();

        public Task<bool> IsPrivilegedAsync(string username) => throw new NotImplementedException();

        public bool IsWatched(string username) => throw new NotImplementedException();

        public Task WatchAsync(string username) => throw new NotImplementedException();
    }
}
