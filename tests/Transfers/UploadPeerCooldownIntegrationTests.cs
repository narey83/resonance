namespace Resonance.Tests.Transfers;

using System.Threading.Channels;
using global::resonance;
using global::resonance.Events;
using global::resonance.Transfers;
using global::resonance.Transfers.Uploads;
using Soulseek;
using Transfer = global::resonance.Transfers.Transfer;

public sealed partial class UploadEnqueueTests
{
    [Fact]
    public async Task FailuresAcrossFilesPauseThePeerKeepExistingAndNewFilesQueuedAndAllowOtherPeers()
    {
        var clock = new ManualUploadClock();
        var calls = new UploadCalls();
        await using var service = CreateService([], upload: calls.Upload, cooldown: new UploadPeerCooldown(clock));
        var rows = Enumerable.Range(0, 4).Select(i => QueueTransfer("alice", $"album/{i}.mp3")).ToArray();
        var tasks = new List<Task<Transfer>>();
        try
        {
            tasks.Add(service.UploadAsync(rows[0]));
            var first = await calls.Next();
            tasks.AddRange(rows.Skip(1).Select(service.UploadAsync));
            first.ChangeState(TransferStates.Completed | TransferStates.Errored, started: clock.GetUtcNow().UtcDateTime);
            first.FailConnection();
            for (var i = 1; i < 3; i++)
            {
                var next = await calls.Next();
                Assert.Equal(rows[i].Filename, next.Filename);
                next.ChangeState(TransferStates.Completed | TransferStates.Errored, started: clock.GetUtcNow().UtcDateTime);
                next.FailConnection();
            }

            Assert.Equal(TimeSpan.FromMinutes(5), await clock.NextDelay());
            Assert.Equal(3, calls.Count);
            Assert.Equal(0, service.Queue.GetGroupInfo(Application.DefaultGroup).UsedSlots);
            AssertAllQueued(rows);
            Assert.Null(await service.EnqueueAsync("alice", rows[0].Filename));
            var newRow = await service.EnqueueAsync("alice", "album/new.mp3");
            Assert.NotNull(newRow);
            AssertAllQueued([newRow!]);
            using (var db = factory.CreateDbContext()) { Assert.Equal(5, db.Transfers.Count()); }

            var bob = QueueTransfer("bob", "album/other.mp3");
            var otherPeer = service.UploadAsync(bob);
            var otherCall = await calls.Next();
            Assert.Equal("bob", otherCall.Username);
            otherCall.Succeed(clock);
            Assert.Equal(TransferStates.Completed | TransferStates.Succeeded, (await otherPeer)!.State);
            Assert.Equal(4, calls.Count);
            AssertAllQueued(rows);

            clock.Advance(TimeSpan.FromMinutes(5));
            var probe = await calls.Next();
            Assert.Equal(rows[3].Filename, probe.Filename);
            probe.Succeed(clock);
            Assert.NotNull(await tasks[3].WaitAsync(TimeSpan.FromSeconds(5)));
            var resumed = await calls.Next();
            Assert.Equal("alice", resumed.Username);
            Assert.Equal(rows[0].Filename, resumed.Filename);
        }
        finally
        {
            await service.StopAsync().WaitAsync(TimeSpan.FromSeconds(5));
            await Task.WhenAll(tasks).WaitAsync(TimeSpan.FromSeconds(5));
        }

        AssertAllQueued(rows.Take(3));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task CooldownRetriesTheSameRecordAndLateCallbacksCannotUndoParkingOrSuccess(bool timeout)
    {
        var clock = new ManualUploadClock();
        var calls = new UploadCalls();
        await using var service = CreateService([], upload: calls.Upload, cooldown: new UploadPeerCooldown(clock));
        var row = QueueTransfer("alice", "album/retry.mp3");
        var task = service.UploadAsync(row);
        PendingUpload? stale = null;
        try
        {
            for (var i = 0; i < 3; i++)
            {
                stale = await calls.Next();
                stale.ChangeState(TransferStates.Initializing);
                if (timeout) { stale.Completion.SetException(new InvalidOperationException("upload failed", new TimeoutException("connection timed out"))); }
                else { stale.FailConnection(); }
            }

            await clock.NextDelay();
            stale!.ChangeState(TransferStates.Completed | TransferStates.Errored);
            AssertAllQueued([row]);
            clock.Advance(TimeSpan.FromMinutes(5));
            var probe = await calls.Next();
            Assert.Equal(row.Filename, probe.Filename);
            Assert.False(task.IsCompleted);
            Assert.Equal(4, calls.Count);
            probe.Succeed(clock);
            Assert.Equal(row.Id, (await task.WaitAsync(TimeSpan.FromSeconds(5)))!.Id);
            stale.ChangeState(TransferStates.Completed | TransferStates.Errored);
            using var db = factory.CreateDbContext();
            var saved = Assert.Single(db.Transfers);
            Assert.Equal(TransferStates.Completed | TransferStates.Succeeded, saved.State);
            Assert.Equal(100, saved.BytesTransferred);
            Assert.Null(saved.Exception);
        }
        finally
        {
            await service.StopAsync().WaitAsync(TimeSpan.FromSeconds(5));
            await task.WaitAsync(TimeSpan.FromSeconds(5));
        }
    }

    [Fact]
    public async Task FailedProbeKeepsTheFileQueuedAndPausesAgainWithoutTryingTheNextFile()
    {
        var clock = new ManualUploadClock();
        var calls = new UploadCalls();
        await using var service = CreateService([], upload: calls.Upload, cooldown: new UploadPeerCooldown(clock));
        var row = QueueTransfer("alice", "album/retry.mp3");
        var task = service.UploadAsync(row);
        try
        {
            for (var i = 0; i < 3; i++) { (await calls.Next()).FailConnection(); }
            await clock.NextDelay();
            clock.Advance(TimeSpan.FromMinutes(5));
            (await calls.Next()).FailConnection();
            Assert.Equal(TimeSpan.FromMinutes(5), await clock.NextDelay());
            Assert.Equal(4, calls.Count);
            AssertAllQueued([row]);
            Assert.True(service.TryCancel(row.Id));
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => task);
            using var db = factory.CreateDbContext();
            var saved = Assert.Single(db.Transfers);
            Assert.Equal(TransferStates.Completed | TransferStates.Cancelled, saved.State);
            Assert.NotNull(saved.EndedAt);
        }
        finally
        {
            await service.StopAsync().WaitAsync(TimeSpan.FromSeconds(5));
        }
    }

    [Fact]
    public async Task ConnectionFailureWithSdkStartTimestampStillKeepsTheOriginalFileQueued()
    {
        var calls = new UploadCalls();
        var clock = new ManualUploadClock();
        await using var service = CreateService([], upload: calls.Upload, cooldown: new UploadPeerCooldown(clock));
        var row = QueueTransfer("alice", "album/unreachable.mp3");
        var task = service.UploadAsync(row);
        try
        {
            for (var i = 0; i < 3; i++)
            {
                var attempt = await calls.Next();
                // Soulseek.NET stamps a start time even when connection establishment fails.
                attempt.ChangeState(TransferStates.Completed | TransferStates.Errored, started: clock.GetUtcNow().UtcDateTime);
                attempt.FailConnection();
            }

            Assert.Equal(TimeSpan.FromMinutes(5), await clock.NextDelay());
            AssertAllQueued([row]);
            Assert.False(task.IsCompleted);
            Assert.Equal(3, calls.Count);
        }
        finally
        {
            await service.StopAsync().WaitAsync(TimeSpan.FromSeconds(5));
            await task.WaitAsync(TimeSpan.FromSeconds(5));
        }
    }

    [Theory]
    [InlineData(0)]
    [InlineData(10)]
    public async Task ConnectionFailureAfterProgressRemainsTerminalAndIsNotRetried(long bytes)
    {
        var calls = new UploadCalls();
        var clock = new ManualUploadClock();
        await using var service = CreateService([], upload: calls.Upload, cooldown: new UploadPeerCooldown(clock));
        var row = QueueTransfer("alice", "album/interrupted.mp3");
        var task = service.UploadAsync(row);
        var attempt = await calls.Next();
        attempt.ChangeState(TransferStates.InProgress, bytes: bytes, started: clock.GetUtcNow().UtcDateTime);
        attempt.FailConnection();
        await Assert.ThrowsAnyAsync<Exception>(() => task);
        using var db = factory.CreateDbContext();
        var saved = Assert.Single(db.Transfers);
        Assert.Equal(TransferStates.Completed | TransferStates.Errored, saved.State);
        Assert.Equal(bytes, saved.BytesTransferred);
        Assert.NotNull(saved.EndedAt);
        Assert.Equal(1, calls.Count);
    }

    [Fact]
    public async Task OfflinePeerIsParkedWithoutAnAutomaticRetryLoop()
    {
        var calls = new UploadCalls();
        await using var service = CreateService([], upload: calls.Upload);
        var row = QueueTransfer("alice", "album/offline.mp3");
        var task = service.UploadAsync(row);
        (await calls.Next()).Completion.SetException(new UserOfflineException("peer is offline"));
        Assert.Null(await task);
        AssertAllQueued([row]);
        Assert.Equal(1, calls.Count);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task OfflineSdkCallbacksCannotFailOrOverwriteAParkedUpload(bool wrapped)
    {
        var calls = new UploadCalls();
        var clock = new ManualUploadClock();
        await using var service = CreateService([], upload: calls.Upload);
        var row = QueueTransfer("alice", "album/offline-callback.mp3");
        var task = service.UploadAsync(row);
        var attempt = await calls.Next();
        attempt.ChangeState(TransferStates.Initializing);
        attempt.ChangeState(TransferStates.Completed | TransferStates.Errored, started: clock.GetUtcNow().UtcDateTime);
        Exception offline = new UserOfflineException("peer is offline");
        attempt.Completion.SetException(wrapped ? new InvalidOperationException("upload failed", offline) : offline);
        Assert.Null(await task.WaitAsync(TimeSpan.FromSeconds(5)));
        AssertAllQueued([row]);
        attempt.ChangeState(TransferStates.Completed | TransferStates.Errored);
        AssertAllQueued([row]);
        Assert.Equal(1, calls.Count);
        var resumed = service.UploadAsync(row);
        (await calls.Next()).Succeed(clock);
        Assert.Equal(row.Id, (await resumed.WaitAsync(TimeSpan.FromSeconds(5)))!.Id);
        using var db = factory.CreateDbContext();
        var saved = Assert.Single(db.Transfers);
        Assert.Equal(TransferStates.Completed | TransferStates.Succeeded, saved.State);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(10)]
    public async Task OfflineFailureAfterDataFlowRemainsTerminal(long bytes)
    {
        var calls = new UploadCalls();
        await using var service = CreateService([], upload: calls.Upload);
        var row = QueueTransfer("alice", "album/offline-in-progress.mp3");
        var task = service.UploadAsync(row);
        var attempt = await calls.Next();
        attempt.ChangeState(TransferStates.InProgress, bytes: bytes, started: DateTime.UtcNow);
        attempt.Completion.SetException(new UserOfflineException("peer is offline"));
        await Assert.ThrowsAnyAsync<Exception>(() => task);
        using var db = factory.CreateDbContext();
        var saved = Assert.Single(db.Transfers);
        Assert.True(saved.State.HasFlag(TransferStates.Completed));
        Assert.NotNull(saved.EndedAt);
        Assert.Equal(bytes, saved.BytesTransferred);
        Assert.Equal(1, calls.Count);
    }

    [Fact]
    public async Task LingeringCompletedSdkEntryDoesNotFailOrDuplicateTheQueuedRetry()
    {
        var calls = new UploadCalls();
        var tracked = new ObservedUploads();
        var clock = new ManualUploadClock();
        await using var service = CreateService(tracked, upload: calls.Upload);
        var row = QueueTransfer("alice", "album/lingering.mp3");
        var task = service.UploadAsync(row);
        try
        {
            var first = await calls.Next();
            tracked.Add(new Soulseek.Transfer(TransferDirection.Upload, "alice", row.Filename, 1,
                TransferStates.Completed | TransferStates.Errored, 100, 0));
            first.FailConnection();
            await tracked.Observed.Task.WaitAsync(TimeSpan.FromSeconds(5));
            Assert.Equal(1, calls.Count);
            AssertAllQueued([row]);
            tracked.Clear();
            (await calls.Next()).Succeed(clock);
            Assert.NotNull(await task.WaitAsync(TimeSpan.FromSeconds(5)));
            using var db = factory.CreateDbContext();
            Assert.Equal(TransferStates.Completed | TransferStates.Succeeded, Assert.Single(db.Transfers).State);
        }
        finally
        {
            await service.StopAsync().WaitAsync(TimeSpan.FromSeconds(5));
            await task.WaitAsync(TimeSpan.FromSeconds(5));
        }
    }

    [Theory]
    [InlineData("io")]
    [InlineData("empty-aggregate")]
    [InlineData("mixed-aggregate")]
    [InlineData("cancelled")]
    [InlineData("application")]
    public async Task NonConnectionFailureInsideSdkRemainsTerminalInsteadOfTriggeringPeerRetries(string kind)
    {
        var calls = new UploadCalls();
        await using var service = CreateService([], upload: calls.Upload);
        var row = QueueTransfer("alice", "album/io-error.mp3");
        var task = service.UploadAsync(row);
        Exception failure = kind switch
        {
            "io" => new IOException("local file read failed"),
            "empty-aggregate" => new AggregateException(),
            "mixed-aggregate" => new AggregateException(new ConnectionException("connection failed"), new IOException("local failure")),
            "cancelled" => new OperationCanceledException(),
            _ => new InvalidOperationException("application failure"),
        };
        (await calls.Next()).Completion.SetException(failure);
        Assert.Same(failure, await Assert.ThrowsAnyAsync<Exception>(() => task));
        using var db = factory.CreateDbContext();
        var saved = Assert.Single(db.Transfers);
        Assert.Equal(TransferStates.Completed | (kind == "cancelled" ? TransferStates.Cancelled : TransferStates.Errored), saved.State);
        Assert.Equal(1, calls.Count);
    }

    private Transfer QueueTransfer(string username, string filename)
    {
        var transfer = new Transfer
        {
            Id = Guid.NewGuid(),
            Username = username,
            Filename = filename,
            Direction = TransferDirection.Upload,
            Size = 100,
            State = TransferStates.Queued | TransferStates.Locally,
            RequestedAt = DateTime.UtcNow,
        };
        using var db = factory.CreateDbContext();
        db.Add(transfer);
        db.SaveChanges();
        return transfer;
    }

    private void AssertAllQueued(IEnumerable<Transfer> transfers)
    {
        using var db = factory.CreateDbContext();
        foreach (var transfer in transfers)
        {
            var saved = db.Transfers.Single(t => t.Id == transfer.Id);
            Assert.Equal(TransferStates.Queued | TransferStates.Locally, saved.State);
            Assert.Null(saved.StartedAt);
            Assert.Null(saved.EndedAt);
            Assert.Null(saved.Exception);
            Assert.False(saved.Removed);
        }
    }

    private sealed class UploadCalls
    {
        private readonly Channel<PendingUpload> calls = Channel.CreateUnbounded<PendingUpload>();
        private int count;
        public int Count => Volatile.Read(ref count);

        public async Task<Soulseek.Transfer> Upload(string username, string filename, TransferOptions options, CancellationToken token)
        {
            var transfer = new Soulseek.Transfer(TransferDirection.Upload, username, filename, 1, TransferStates.Initializing, 100, 0);
            await options.SlotAwaiter(transfer, token);
            try
            {
                var call = new PendingUpload(username, filename, options);
                Interlocked.Increment(ref count);
                calls.Writer.TryWrite(call);
                return await call.Completion.Task.WaitAsync(token);
            }
            finally
            {
                options.SlotReleased(transfer);
            }
        }

        public Task<PendingUpload> Next() => calls.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(5));
    }

    private sealed record PendingUpload(string Username, string Filename, TransferOptions Options)
    {
        public TaskCompletionSource<Soulseek.Transfer> Completion { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public void FailConnection() => Completion.SetException(new InvalidOperationException("upload failed", new ConnectionException("connection failed")));
        public void ChangeState(TransferStates state, long bytes = 0, DateTime? started = null) => Options.StateChanged((TransferStates.Initializing,
            new Soulseek.Transfer(TransferDirection.Upload, Username, Filename, 1, state, 100, 0, bytesTransferred: bytes, startTime: started)));
        public void Succeed(ManualUploadClock clock) => Completion.SetResult(new Soulseek.Transfer(TransferDirection.Upload, Username, Filename, 1,
            TransferStates.Completed | TransferStates.Succeeded, 100, 0, bytesTransferred: 100,
            startTime: clock.GetUtcNow().UtcDateTime, endTime: clock.GetUtcNow().UtcDateTime));
    }

    private sealed class ObservedUploads : IReadOnlyCollection<Soulseek.Transfer>
    {
        private readonly System.Collections.Concurrent.ConcurrentQueue<Soulseek.Transfer> uploads = new();
        public TaskCompletionSource Observed { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public int Count => uploads.Count;
        public void Add(Soulseek.Transfer transfer) => uploads.Enqueue(transfer);
        public void Clear() { while (uploads.TryDequeue(out _)) { } }
        public IEnumerator<Soulseek.Transfer> GetEnumerator()
        {
            var snapshot = uploads.ToArray();
            if (snapshot.Length > 0) { Observed.TrySetResult(); }
            return ((IEnumerable<Soulseek.Transfer>)snapshot).GetEnumerator();
        }
        System.Collections.IEnumerator System.Collections.IEnumerable.GetEnumerator() => GetEnumerator();
    }

    private sealed class QuietEvents() : EventBus(null!)
    {
        public override void Raise<T>(T data) { }
    }
}
