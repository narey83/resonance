namespace Resonance.Tests.Transfers;

using System.Collections.Concurrent;
using System.Linq.Expressions;
using global::resonance;
using global::resonance.Transfers;
using global::resonance.Transfers.Uploads;
using Microsoft.EntityFrameworkCore;
using Soulseek;
using Transfer = global::resonance.Transfers.Transfer;

public sealed partial class UploadEnqueueTests
{
    [Fact]
    public async Task LegacyBacklogSurvivesRecoveryWithOriginalIdsAndMetadataWithoutRewritingCleanRows()
    {
        using var storage = new RecoveryDatabase();
        var requested = DateTime.UtcNow.AddMinutes(-10);
        var prior = StoredUpload("old.mp3", state: TransferStates.Completed | TransferStates.Errored);
        prior.EndedAt = requested.AddMinutes(-1);
        prior.Exception = "Earlier peer failure";
        var batch = Guid.NewGuid();
        var queued = Enumerable.Range(0, 4250).Select(i => new Transfer
        {
            Id = Guid.NewGuid(),
            BatchId = batch,
            DestinationFolder = "original-destination",
            Username = "alice",
            Filename = $"album/{i}.mp3",
            Direction = TransferDirection.Upload,
            State = TransferStates.Queued | TransferStates.Locally,
            Size = 100 + i,
            RequestedAt = requested.AddTicks(i),
            EnqueuedAt = requested.AddTicks(i + 1),
            RetryOfId = i == 0 ? prior.Id : null,
        }).ToArray();
        storage.Save([prior, .. queued]);
        storage.Statements.Clear();
        var calls = new UploadCalls();
        await using var service = CreateService([], upload: calls.Upload, contexts: storage);
        var retained = await UploadRestartRecovery.PrepareAsync(service, "Application shut down", CancellationToken.None);
        Assert.True(queued.Select(t => t.Id).ToHashSet().SetEquals(retained));
        Assert.Equal(0, calls.Count);
        var scheduled = new List<string>();
        var dispatch = Stub<IUploadService>((method, args) => method.Name switch
        {
            "List" => service.List((Expression<Func<Transfer, bool>>)args![0]!, (bool)args[1]!),
            "ResumeParkedUploads" => RecordResume((string)args![0]!),
            _ => throw new InvalidOperationException(method.Name),
        });
        int RecordResume(string username) { scheduled.Add(username); return queued.Length; }
        Assert.Empty(UploadRestartRecovery.Resume(dispatch, retained));
        Assert.Equal("alice", Assert.Single(scheduled));

        Assert.DoesNotContain(storage.Statements, statement => statement.Contains("UPDATE \"Transfers\"", StringComparison.Ordinal));
        using var reopened = storage.CreateDbContext();
        var saved = reopened.Transfers.ToDictionary(t => t.Id);
        Assert.Equal(4251, saved.Count);
        foreach (var original in queued)
        {
            var row = saved[original.Id];
            Assert.Equal(original.Username, row.Username);
            Assert.Equal(original.Filename, row.Filename);
            Assert.Equal(original.Size, row.Size);
            Assert.Equal(original.RequestedAt, row.RequestedAt);
            Assert.Equal(original.EnqueuedAt, row.EnqueuedAt);
            Assert.Equal(original.BatchId, row.BatchId);
            Assert.Equal(original.DestinationFolder, row.DestinationFolder);
            Assert.Equal(original.RetryOfId, row.RetryOfId);
            Assert.Equal(TransferStates.Queued | TransferStates.Locally, row.State);
            Assert.False(row.Removed);
            Assert.Null(row.EndedAt);
            Assert.Null(row.Exception);
        }

        Assert.Equal(prior.Exception, saved[prior.Id].Exception);
        Assert.Equal(prior.EndedAt, saved[prior.Id].EndedAt);
    }

    [Fact]
    public async Task CooldownQueueSurvivesServiceShutdownAndNewInstanceResumesTheSameRows()
    {
        using var storage = new RecoveryDatabase();
        var queued = Enumerable.Range(0, 4).Select(i => StoredUpload($"album/{i}.mp3")).ToArray();
        storage.Save(queued);
        var clock = new ManualUploadClock();
        var oldCalls = new UploadCalls();
        await using (var old = CreateService([], upload: oldCalls.Upload, cooldown: new UploadPeerCooldown(clock), contexts: storage))
        {
            var tasks = queued.Select(old.UploadAsync).ToArray();
            for (var i = 0; i < 3; i++) { (await oldCalls.Next()).FailConnection(); }
            await clock.NextDelay();
            await old.StopAsync().WaitAsync(TimeSpan.FromSeconds(5));
            await Task.WhenAll(tasks).WaitAsync(TimeSpan.FromSeconds(5));
        }

        var newCalls = new UploadCalls();
        await using var replacement = CreateService([], upload: newCalls.Upload, contexts: storage);
        var retained = await UploadRestartRecovery.PrepareAsync(replacement, "Application shut down", CancellationToken.None);
        Assert.Equal(4, retained.Count);
        Assert.Equal(0, newCalls.Count);
        Assert.Empty(UploadRestartRecovery.Resume(replacement, retained));
        for (var i = 0; i < 4; i++) { (await newCalls.Next()).Succeed(clock); }
        await WaitForSuccess(storage, 4);
        await replacement.StopAsync().WaitAsync(TimeSpan.FromSeconds(5));
        using var reopened = storage.CreateDbContext();
        var saved = reopened.Transfers.ToList();
        Assert.True(queued.Select(t => t.Id).ToHashSet().SetEquals(saved.Select(t => t.Id)));
        Assert.All(saved, row => Assert.Equal(TransferStates.Completed | TransferStates.Succeeded, row.State));
    }

    [Fact]
    public async Task RecoveryRequeuesInterruptedUploadsButNeverResurrectsRemovedCancelledOrCompletedHistory()
    {
        using var storage = new RecoveryDatabase();
        var initializing = StoredUpload("initializing.mp3", state: TransferStates.Initializing);
        var interrupted = StoredUpload("interrupted.mp3", state: TransferStates.InProgress);
        interrupted.StartedAt = DateTime.UtcNow.AddMinutes(-1);
        interrupted.BytesTransferred = 40;
        interrupted.AverageSpeed = 10;
        interrupted.PlaceInQueue = 2;
        var staleEnd = StoredUpload("stale-end.mp3");
        staleEnd.EndedAt = DateTime.UtcNow.AddMinutes(-1);
        staleEnd.Exception = "stale state";
        var removed = StoredUpload("removed.mp3");
        removed.Removed = true;
        var cancelled = StoredUpload("cancelled.mp3", state: TransferStates.Completed | TransferStates.Cancelled);
        cancelled.Exception = "User cancelled";
        var complete = StoredUpload("complete-missing-end.mp3", state: TransferStates.Completed | TransferStates.Succeeded);
        complete.BytesTransferred = complete.Size;
        var oldFailure = StoredUpload("old-failure.mp3", state: TransferStates.Completed | TransferStates.Errored);
        oldFailure.EndedAt = DateTime.UtcNow.AddMinutes(-30);
        oldFailure.Exception = "Application shut down";
        var download = new Transfer { Id = Guid.NewGuid(), Username = "alice", Filename = "download.mp3", Direction = TransferDirection.Download, RequestedAt = DateTime.UtcNow, State = TransferStates.Queued | TransferStates.Locally };
        storage.Save([initializing, interrupted, staleEnd, removed, cancelled, complete, oldFailure, download]);
        await using var service = CreateService([], contexts: storage);
        var retained = await UploadRestartRecovery.PrepareAsync(service, "Application shut down", CancellationToken.None);
        Assert.True(new[] { initializing.Id, interrupted.Id, staleEnd.Id }.ToHashSet().SetEquals(retained));
        using var db = storage.CreateDbContext();
        var rows = db.Transfers.ToDictionary(t => t.Id);
        foreach (var id in retained)
        {
            Assert.Equal(TransferStates.Queued | TransferStates.Locally, rows[id].State);
            Assert.Null(rows[id].StartedAt);
            Assert.Null(rows[id].EndedAt);
            Assert.Null(rows[id].Exception);
            Assert.Equal(0, rows[id].BytesTransferred);
            Assert.Equal(0, rows[id].AverageSpeed);
            Assert.Null(rows[id].PlaceInQueue);
        }

        Assert.True(rows[removed.Id].Removed);
        Assert.True(rows[removed.Id].State.HasFlag(TransferStates.Completed));
        Assert.Equal(cancelled.State, rows[cancelled.Id].State);
        Assert.Equal(cancelled.Exception, rows[cancelled.Id].Exception);
        Assert.Equal(complete.State, rows[complete.Id].State);
        Assert.Equal(complete.Size, rows[complete.Id].BytesTransferred);
        Assert.NotNull(rows[complete.Id].EndedAt);
        Assert.Equal(oldFailure.EndedAt, rows[oldFailure.Id].EndedAt);
        Assert.Equal(oldFailure.Exception, rows[oldFailure.Id].Exception);
        Assert.Equal(download.State, rows[download.Id].State);
        Assert.Null(rows[download.Id].EndedAt);
    }

    [Fact]
    public async Task ChangesAfterRecoveryAreRecheckedBeforeLoginResumption()
    {
        using var storage = new RecoveryDatabase();
        var cancelled = StoredUpload("cancelled.mp3");
        var removed = StoredUpload("removed.mp3");
        storage.Save([cancelled, removed]);
        var calls = new UploadCalls();
        await using var service = CreateService([], upload: calls.Upload, contexts: storage);
        var retained = await UploadRestartRecovery.PrepareAsync(service, "Application shut down", CancellationToken.None);
        Assert.True(service.TryCancel(cancelled.Id));
        using (var db = storage.CreateDbContext())
        {
            db.Transfers.Single(t => t.Id == removed.Id).Removed = true;
            db.SaveChanges();
        }

        Assert.Empty(UploadRestartRecovery.Resume(service, retained));
        Assert.Equal(0, calls.Count);
    }

    [Fact]
    public async Task FailedPeerResumptionRetainsItsIdsAndDoesNotBlockOtherPeers()
    {
        using var storage = new RecoveryDatabase();
        var alice = StoredUpload("alice.mp3");
        var bob = StoredUpload("bob.mp3", username: "bob");
        storage.Save([alice, bob]);
        var calls = new UploadCalls();
        await using var service = CreateService([], upload: calls.Upload, contexts: storage);
        var retained = await UploadRestartRecovery.PrepareAsync(service, "Application shut down", CancellationToken.None);
        var failing = Stub<IUploadService>((method, args) => method.Name switch
        {
            "List" => service.List((Expression<Func<Transfer, bool>>)args![0]!, (bool)args[1]!),
            "ResumeParkedUploads" when (string)args![0]! == "alice" => throw new IOException("Temporary scheduling failure"),
            "ResumeParkedUploads" => service.ResumeParkedUploads((string)args![0]!),
            _ => throw new InvalidOperationException(method.Name),
        });
        var retry = UploadRestartRecovery.Resume(failing, retained);
        Assert.Equal(alice.Id, Assert.Single(retry));
        var otherPeer = await calls.Next();
        Assert.Equal("bob", otherPeer.Username);
        otherPeer.Succeed(new ManualUploadClock());
        Assert.Empty(UploadRestartRecovery.Resume(service, retry));
        var recovered = await calls.Next();
        Assert.Equal("alice", recovered.Username);
        recovered.Succeed(new ManualUploadClock());
        await WaitForSuccess(storage, 2);
        await service.StopAsync().WaitAsync(TimeSpan.FromSeconds(5));
    }

    [Fact]
    public async Task OfflineRecoveredFileRemainsQueuedUntilThePeerReturns()
    {
        using var storage = new RecoveryDatabase();
        var row = StoredUpload("offline.mp3");
        storage.Save([row]);
        var calls = new UploadCalls();
        await using (var offline = CreateService([], upload: calls.Upload, contexts: storage, cachedPresence: UserPresence.Offline))
        {
            var retained = await UploadRestartRecovery.PrepareAsync(offline, "Application shut down", CancellationToken.None);
            Assert.Equal(row.Id, Assert.Single(retained));
            Assert.Null(await offline.UploadAsync(row));
            Assert.Equal(0, calls.Count);
        }

        await using var online = CreateService([], upload: calls.Upload, contexts: storage);
        var restored = await UploadRestartRecovery.PrepareAsync(online, "Application shut down", CancellationToken.None);
        Assert.Equal(row.Id, Assert.Single(restored));
        Assert.Empty(UploadRestartRecovery.Resume(online, restored));
        (await calls.Next()).Succeed(new ManualUploadClock());
        await WaitForSuccess(storage, 1);
        await online.StopAsync().WaitAsync(TimeSpan.FromSeconds(5));
        using var db = storage.CreateDbContext();
        Assert.Equal(TransferStates.Completed | TransferStates.Succeeded, Assert.Single(db.Transfers).State);
    }

    [Fact]
    public async Task InterruptedRecoveryCanRestartWithoutLosingRowsAndCleanRecoveryIsIdempotent()
    {
        using var storage = new RecoveryDatabase();
        var queued = new[]
        {
            StoredUpload("first.mp3", state: TransferStates.Initializing),
            StoredUpload("second.mp3", state: TransferStates.InProgress),
        };
        storage.Save(queued);
        await using var service = CreateService([], contexts: storage);
        using var cancelled = new CancellationTokenSource();
        var interrupt = Stub<IUploadService>((method, args) => method.Name switch
        {
            "ListForRecovery" => service.ListForRecovery(),
            "Update" => UpdateAndInterrupt((Transfer)args![0]!),
            _ => throw new InvalidOperationException(method.Name),
        });
        object? UpdateAndInterrupt(Transfer transfer)
        {
            service.Update(transfer);
            cancelled.Cancel();
            return null;
        }
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            UploadRestartRecovery.PrepareAsync(interrupt, "Application shut down", cancelled.Token));
        using (var db = storage.CreateDbContext())
        {
            Assert.Equal(2, db.Transfers.Count());
            Assert.All(db.Transfers, row => Assert.False(row.State.HasFlag(TransferStates.Completed)));
        }

        var retained = await UploadRestartRecovery.PrepareAsync(service, "Application shut down", CancellationToken.None);
        Assert.True(queued.Select(t => t.Id).ToHashSet().SetEquals(retained));
        storage.Statements.Clear();
        var repeated = await UploadRestartRecovery.PrepareAsync(service, "Application shut down", CancellationToken.None);
        Assert.True(retained.ToHashSet().SetEquals(repeated));
        Assert.DoesNotContain(storage.Statements, statement => statement.Contains("UPDATE \"Transfers\"", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData(false, false)]
    [InlineData(false, true)]
    [InlineData(true, false)]
    public async Task RecoveredUploadsWaitForBothLoginAndShareReadiness(bool loggedIn, bool sharesReady)
    {
        using var storage = new RecoveryDatabase();
        var row = StoredUpload("wait-for-index.mp3");
        storage.Save([row]);
        var calls = new UploadCalls();
        await using var service = CreateService([], upload: calls.Upload, contexts: storage);
        var retained = await UploadRestartRecovery.PrepareAsync(service, "Application shut down", CancellationToken.None);
        var waiting = UploadRestartRecovery.Resume(service, retained, loggedIn, sharesReady);
        Assert.Equal(row.Id, Assert.Single(waiting));
        Assert.Equal(0, calls.Count);
        Assert.Empty(UploadRestartRecovery.Resume(service, waiting, loggedIn: true, sharesReady: true));
        (await calls.Next()).Succeed(new ManualUploadClock());
        await WaitForSuccess(storage, 1);
    }

    [Theory]
    [InlineData(TransferStates.Succeeded)]
    [InlineData(TransferStates.Cancelled)]
    [InlineData(TransferStates.TimedOut)]
    [InlineData(TransferStates.Errored)]
    [InlineData(TransferStates.Rejected)]
    [InlineData(TransferStates.Aborted)]
    public async Task TerminalOutcomeWithoutCompletedBitIsRepairedWithoutResurrectingTheFile(TransferStates outcome)
    {
        using var storage = new RecoveryDatabase();
        var row = StoredUpload("terminal.mp3", state: outcome);
        row.Exception = outcome == TransferStates.Succeeded ? null : "Original terminal outcome";
        storage.Save([row]);
        await using var service = CreateService([], contexts: storage);
        Assert.Empty(await UploadRestartRecovery.PrepareAsync(service, "Application shut down", CancellationToken.None));
        using var db = storage.CreateDbContext();
        var saved = Assert.Single(db.Transfers);
        Assert.Equal(TransferStates.Completed | outcome, saved.State);
        Assert.Equal(row.Exception, saved.Exception);
        Assert.NotNull(saved.EndedAt);
    }

    private static async Task WaitForSuccess(RecoveryDatabase storage, int count)
    {
        var deadline = DateTime.UtcNow.AddSeconds(5);
        while (true)
        {
            using var db = storage.CreateDbContext();
            if (db.Transfers.Count(t => t.State == (TransferStates.Completed | TransferStates.Succeeded)) == count) { return; }
            Assert.True(DateTime.UtcNow < deadline, "Background uploads did not finish");
            await Task.Delay(10);
        }
    }

    private static Transfer StoredUpload(string filename, string username = "alice", TransferStates state = TransferStates.Queued | TransferStates.Locally) => new()
    {
        Id = Guid.NewGuid(),
        Username = username,
        Filename = filename,
        Direction = TransferDirection.Upload,
        State = state,
        Size = 100,
        RequestedAt = DateTime.UtcNow.AddMinutes(-1),
    };

    private sealed class RecoveryDatabase : IDbContextFactory<TransfersDbContext>, IDisposable
    {
        private readonly string directory = Path.Combine(Path.GetTempPath(), "resonance-upload-recovery-" + Guid.NewGuid().ToString("N"));
        private readonly DbContextOptions<TransfersDbContext> options;
        public ConcurrentQueue<string> Statements { get; } = new();

        public RecoveryDatabase()
        {
            System.IO.Directory.CreateDirectory(directory);
            options = new DbContextOptionsBuilder<TransfersDbContext>()
                .UseSqlite($"Data Source={Path.Combine(directory, "transfers.db")};Pooling=False")
                .LogTo(message => Statements.Enqueue(message)).Options;
            using var db = CreateDbContext();
            db.Database.EnsureCreated();
        }

        public TransfersDbContext CreateDbContext() => new(options);
        public void Save(IEnumerable<Transfer> rows) { using var db = CreateDbContext(); db.AddRange(rows); db.SaveChanges(); }
        public void Dispose() => System.IO.Directory.Delete(directory, recursive: true);
    }
}
