namespace Resonance.Tests.Transfers;

using System.Reflection;
using global::resonance;
using AppOptions = global::resonance.Options;
using global::resonance.Shares;
using global::resonance.Transfers;
using global::resonance.Transfers.Uploads;
using global::resonance.Users;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Soulseek;
using Transfer = global::resonance.Transfers.Transfer;

public sealed partial class UploadEnqueueTests : IDisposable
{
    private readonly SqliteConnection connection = new("Data Source=:memory:");
    private readonly ContextFactory factory;

    public UploadEnqueueTests()
    {
        connection.Open();
        factory = new ContextFactory(new DbContextOptionsBuilder<TransfersDbContext>().UseSqlite(connection).Options);
        using var db = factory.CreateDbContext();
        db.Database.EnsureCreated();
        factory.Created = 0;
    }

    [Fact]
    public async Task ActiveSdkUploadAcceptsRepeatedRequestWithoutAddingOrFailingRecords()
    {
        var upload = SdkUpload(TransferStates.InProgress);
        var service = CreateService([upload]);
        Assert.Null(await service.EnqueueAsync("alice", "album/track.mp3"));
        Assert.Null(await service.EnqueueAsync("alice", "album/track.mp3"));
        Assert.Equal(2, factory.Created);
        using var db = factory.CreateDbContext();
        Assert.Empty(db.Transfers);
        Assert.Equal(TransferStates.InProgress, upload.State);
    }

    [Fact]
    public async Task CompletedSdkUploadAsksPeerToRetryWithoutClaimingItWasQueued()
    {
        var service = CreateService([SdkUpload(TransferStates.Completed | TransferStates.Succeeded)]);
        var error = await Assert.ThrowsAsync<DownloadEnqueueException>(() => service.EnqueueAsync("alice", "album/track.mp3"));
        Assert.Contains("retry", error.Message);
        Assert.Equal(1, factory.Created);
        using var db = factory.CreateDbContext();
        Assert.Empty(db.Transfers);
    }

    [Theory]
    [InlineData("bob", "album/track.mp3")]
    [InlineData("alice", "other/track.mp3")]
    public async Task DifferentPeerOrPathIsNotTreatedAsDuplicateAndPreInsertFailureSkipsCleanup(string username, string filename)
    {
        var failure = new IOException("share temporarily unavailable");
        var service = CreateService([SdkUpload(TransferStates.InProgress)], failure);
        var error = await Assert.ThrowsAsync<IOException>(() => service.EnqueueAsync(username, filename));
        Assert.Same(failure, error);
        // A bogus TryFail would open another context to look up an ID never inserted.
        Assert.Equal(1, factory.Created);
        using var db = factory.CreateDbContext();
        Assert.Empty(db.Transfers);
    }

    [Fact]
    public async Task ThreeRecentNetworkFailuresRejectAnotherRequestWithoutCreatingAQueueRecord()
    {
        SeedAttempts("alice", "album/track.mp3",
            TransferStates.Errored, TransferStates.TimedOut, TransferStates.Errored);
        var service = CreateService([]);
        var error = await Assert.ThrowsAsync<DownloadEnqueueException>(
            () => service.EnqueueAsync("alice", "album/track.mp3"));
        Assert.Contains("repeated transfer errors", error.Message);
        using var db = factory.CreateDbContext();
        Assert.Equal(3, db.Transfers.Count());
    }

    [Fact]
    public async Task ThreeExpiredFailuresAllowAFreshRequest()
    {
        SeedAttempts("alice", "album/track.mp3",
            TransferStates.Errored, TransferStates.TimedOut, TransferStates.Errored);
        using (var db = factory.CreateDbContext())
        {
            foreach (var attempt in db.Transfers)
                attempt.EndedAt = DateTime.UtcNow.AddHours(-1);
            db.SaveChanges();
        }

        var service = CreateService([], new IOException("share lookup reached"));
        await Assert.ThrowsAsync<IOException>(() => service.EnqueueAsync("alice", "album/track.mp3"));
    }

    [Fact]
    public async Task TwoFailuresAllowAnotherAttempt()
    {
        SeedAttempts("alice", "album/track.mp3",
            TransferStates.Errored, TransferStates.TimedOut);
        var service = CreateService([], new IOException("share lookup reached"));
        await Assert.ThrowsAsync<IOException>(() => service.EnqueueAsync("alice", "album/track.mp3"));
    }

    [Fact]
    public async Task RepeatedFailuresDoNotBlockAnotherPeerOrFile()
    {
        SeedAttempts("alice", "album/track.mp3",
            TransferStates.Errored, TransferStates.Errored, TransferStates.TimedOut);
        var service = CreateService([], new IOException("share lookup reached"));
        await Assert.ThrowsAsync<IOException>(() => service.EnqueueAsync("bob", "album/track.mp3"));
        await Assert.ThrowsAsync<IOException>(() => service.EnqueueAsync("alice", "album/other.mp3"));
    }

    [Fact]
    public async Task CancellationAndAnOldFailureDoNotTriggerTheCircuitBreaker()
    {
        SeedAttempts("alice", "album/track.mp3",
            TransferStates.Cancelled, TransferStates.Errored, TransferStates.TimedOut);
        using (var db = factory.CreateDbContext())
        {
            var old = db.Transfers.First(t => t.State == (TransferStates.Completed | TransferStates.TimedOut));
            old.EndedAt = DateTime.UtcNow.AddHours(-2);
            db.SaveChanges();
        }
        var service = CreateService([], new IOException("share lookup reached"));
        await Assert.ThrowsAsync<IOException>(() => service.EnqueueAsync("alice", "album/track.mp3"));
    }

    [Fact]
    public async Task RecentSuccessfulUploadResetsTheErrorStreak()
    {
        SeedAttempts("alice", "album/track.mp3",
            TransferStates.Errored, TransferStates.Errored, TransferStates.Errored,
            TransferStates.Succeeded, TransferStates.Errored);
        var service = CreateService([], new IOException("share lookup reached"));
        await Assert.ThrowsAsync<IOException>(() => service.EnqueueAsync("alice", "album/track.mp3"));
    }

    private void SeedAttempts(string username, string filename, params TransferStates[] outcomes)
    {
        using var db = factory.CreateDbContext();
        var now = DateTime.UtcNow;
        for (var i = 0; i < outcomes.Length; i++)
        {
            db.Transfers.Add(new Transfer
            {
                Id = Guid.NewGuid(),
                Username = username,
                Filename = filename,
                Direction = TransferDirection.Upload,
                RequestedAt = now.AddMinutes(-outcomes.Length + i),
                EndedAt = now.AddMinutes(-outcomes.Length + i),
                State = TransferStates.Completed | outcomes[i],
                Removed = true,
            });
        }
        db.SaveChanges();
    }

    [Fact]
    public async Task ShareLookupErrorDuringUploadRemainsCompletedAndErrored()
    {
        var transfer = new Transfer
        {
            Id = Guid.NewGuid(),
            Username = "alice",
            Filename = "album/failing.mp3",
            Direction = TransferDirection.Upload,
            State = TransferStates.Queued | TransferStates.Locally,
            RequestedAt = DateTime.UtcNow,
        };
        using (var db = factory.CreateDbContext())
        {
            db.Transfers.Add(transfer);
            db.SaveChanges();
        }

        var service = CreateService([], new IOException("share lookup failed"));
        await Assert.ThrowsAsync<IOException>(() => service.UploadAsync(transfer));

        using var dbAfter = factory.CreateDbContext();
        var saved = Assert.Single(dbAfter.Transfers);
        Assert.Equal(TransferStates.Completed | TransferStates.Errored, saved.State);
        Assert.NotNull(saved.EndedAt);
        Assert.Contains("share lookup failed", saved.Exception);
    }

    [Fact]
    public async Task MissingFileDuringUploadRemainsTerminalInsteadOfBeingOverwritten()
    {
        var transfer = new Transfer
        {
            Id = Guid.NewGuid(),
            Username = "alice",
            Filename = "album/missing.mp3",
            Direction = TransferDirection.Upload,
            State = TransferStates.Queued | TransferStates.Locally,
            RequestedAt = DateTime.UtcNow,
        };
        using (var db = factory.CreateDbContext())
        {
            db.Transfers.Add(transfer);
            db.SaveChanges();
        }

        var service = CreateService([], new NotFoundException("file disappeared"));
        await Assert.ThrowsAsync<NotFoundException>(() => service.UploadAsync(transfer));

        using var context = factory.CreateDbContext();
        var saved = Assert.Single(context.Transfers);
        Assert.Equal(TransferStates.Completed | TransferStates.Aborted, saved.State);
        Assert.NotNull(saved.EndedAt);
        Assert.Contains("File could not be found", saved.Exception);
    }

    [Fact]
    public async Task ShutdownRejectsNewEnqueuesAndUploadsBeforeAccessingDependencies()
    {
        var service = CreateService([]);
        await service.StopAsync();
        await Assert.ThrowsAsync<OperationCanceledException>(() => service.EnqueueAsync("alice", "album/track.mp3"));
        await Assert.ThrowsAsync<OperationCanceledException>(() => service.UploadAsync(new Transfer()));
        Assert.Equal(0, factory.Created);
    }

    [Fact]
    public async Task ShutdownWaitsForAnUploadAlreadyInsideUserLookup()
    {
        var watch = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var service = CreateService([], new IOException("share unavailable"), watch.Task);
        var transfer = new Transfer
        {
            Id = Guid.NewGuid(),
            Username = "alice",
            Filename = "album/track.mp3",
            Direction = TransferDirection.Upload,
            State = TransferStates.Queued | TransferStates.Locally,
        };
        using (var db = factory.CreateDbContext()) { db.Add(transfer); db.SaveChanges(); }
        var upload = service.UploadAsync(transfer);
        Assert.False(upload.IsCompleted);
        var stopped = service.StopAsync();
        Assert.False(stopped.IsCompleted);
        watch.SetResult();
        Assert.Null(await upload.WaitAsync(TimeSpan.FromSeconds(5)));
        await stopped.WaitAsync(TimeSpan.FromSeconds(5));
        using var context = factory.CreateDbContext();
        var saved = Assert.Single(context.Transfers);
        Assert.Null(saved.EndedAt);
        Assert.Null(saved.Exception);
    }

    private static Soulseek.Transfer SdkUpload(TransferStates state) => new(
        Soulseek.TransferDirection.Upload, "alice", "album/track.mp3", 1, state, 100, 0);

    private UploadService CreateService(IReadOnlyCollection<Soulseek.Transfer> uploads, Exception? failure = null, Task? watch = null,
        Func<string, string, TransferOptions, CancellationToken, Task<Soulseek.Transfer>>? upload = null, UploadPeerCooldown? cooldown = null)
    {
        var options = new AppOptions();
        var monitor = Stub<IOptionsMonitor<AppOptions>>((m, _) => m.Name switch
        {
            "get_CurrentValue" or "Get" => options,
            "OnChange" => null,
            _ => throw new InvalidOperationException(m.Name),
        });
        var users = Stub<IUserService>((m, args) =>
        {
            if (m.Name == "TryGetCachedPresence")
            {
                args![1] = default(UserPresence);
                return false;
            }

            return m.Name switch
            {
                "GetGroup" => Application.DefaultGroup,
                "IsWatched" => false,
                "WatchAsync" => watch ?? Task.CompletedTask,
                _ => throw new InvalidOperationException(m.Name),
            };
        });
        var client = Stub<ISoulseekClient>((m, args) => m.Name switch
        {
            "get_Uploads" => uploads,
            "UploadAsync" when upload is not null => upload((string)args![0]!, (string)args[1]!,
                args.OfType<TransferOptions>().Single(), args.OfType<CancellationToken>().Single()),
            _ => throw new InvalidOperationException(m.Name),
        });
        var shares = Stub<IShareService>((m, args) =>
        {
            if (m.Name != "ResolveFileAsync") { throw new InvalidOperationException(m.Name); }
            if (failure is not null) { return Task.FromException<(string, string, long)>(failure); }
            if (upload is not null) { return Task.FromResult(("relay", (string)args![0]!, 100L)); }
            throw new InvalidOperationException("Unexpected share lookup");
        });
        var relay = Stub<global::resonance.Relay.IRelayService>((m, _) => m.Name switch
        {
            "GetFileInfoAsync" => Task.FromResult((true, 100L)),
            "TryCloseFileStream" => true,
            _ => throw new InvalidOperationException(m.Name),
        });
        var notifications = Stub<ITransferErrorNotificationService>((m, _) => m.Name switch
        {
            "NotifyUploadErrorAsync" or "NotifyUploadRejectedAsync" => Task.CompletedTask,
            _ => throw new InvalidOperationException(m.Name),
        });
        return new UploadService(null!, users, client, monitor, shares, relay, factory, new QuietEvents(), notifications,
            new ConnectionStringDictionary(new Dictionary<Database, ConnectionString>
            {
                [Database.Transfers] = "Data Source=:memory:",
            }))
        { PeerCooldown = cooldown ?? new UploadPeerCooldown() };
    }

    private static T Stub<T>(Func<MethodInfo, object?[]?, object?> call) where T : class
    {
        var proxy = DispatchProxy.Create<T, InterfaceProxy>();
        ((InterfaceProxy)(object)proxy).Call = call;
        return proxy;
    }

    public class InterfaceProxy : DispatchProxy
    {
        public Func<MethodInfo, object?[]?, object?> Call { get; set; } = null!;
        protected override object? Invoke(MethodInfo? method, object?[]? args) => Call(method!, args);
    }

    private sealed class ContextFactory(DbContextOptions<TransfersDbContext> options) : IDbContextFactory<TransfersDbContext>
    {
        public int Created { get; set; }
        public TransfersDbContext CreateDbContext() { Created++; return new(options); }
    }

    public void Dispose() => connection.Dispose();
}
