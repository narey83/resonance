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
    [Theory]
    [InlineData(null)]
    [InlineData("Broken pipe")]
    [InlineData("Connection reset by peer")]
    public async Task ConnectionOrWriteFailureForgetsRecipientAndOtherPeersContinue(string? writeError)
    {
        var clock = new ManualUploadClock();
        var calls = new UploadCalls();
        await using var service = CreateService([], upload: calls.Upload, cooldown: new UploadPeerCooldown(clock));
        var rows = Enumerable.Range(0, 3).Select(i => QueueTransfer("alice", $"album/{i}.mp3")).ToArray();
        var firstTask = service.UploadAsync(rows[0]);
        var first = await calls.Next();
        var bob = service.UploadAsync(QueueTransfer("bob", "album/other.mp3"));
        var other = await calls.Next();
        Assert.Equal("bob", other.Username);

        if (writeError is not null)
        {
            first.ChangeState(TransferStates.InProgress, bytes: 10, started: clock.GetUtcNow().UtcDateTime);
            first.ChangeState(TransferStates.Completed | TransferStates.Errored, bytes: 10);
            first.Completion.SetException(new TransferException($"Transfer failed: Write error: Unable to write data to the transport connection: {writeError}."));
        }
        else
        {
            first.FailConnection();
        }

        Assert.Null(await firstTask.WaitAsync(TimeSpan.FromSeconds(5)));
        using (var db = factory.CreateDbContext())
        {
            Assert.All(db.Transfers.Where(t => t.Username == "alice"), t =>
            {
                Assert.Equal(TransferStates.Completed | TransferStates.Cancelled, t.State);
                Assert.Equal("Completed, Cancelled", t.StateDescription);
                Assert.Equal(Transfer.ForgottenUploadReason, t.Exception);
                Assert.True(t.Removed);
                Assert.NotNull(t.EndedAt);
            });
        }

        Assert.DoesNotContain(service.ListQueuePage("alice", 0, 10).Users, u => u.Username == "alice");
        Assert.Equal(1, service.Queue.GetGroupInfo(Application.DefaultGroup).UsedSlots);
        other.Succeed(clock);
        Assert.NotNull(await bob.WaitAsync(TimeSpan.FromSeconds(5)));
        Assert.Equal(2, calls.Count);

        var requestedAgain = await service.EnqueueAsync("alice", rows[0].Filename);
        Assert.NotNull(requestedAgain);
        Assert.NotEqual(rows[0].Id, requestedAgain!.Id);
        (await calls.Next()).Succeed(clock);
        await WaitUntilCompleted(requestedAgain.Id);
    }

    [Fact]
    public async Task OfflinePresenceForgetsPendingUploadsWithoutStartingThem()
    {
        var calls = new UploadCalls();
        await using var service = CreateService([], upload: calls.Upload, cachedPresence: UserPresence.Offline);
        var row = QueueTransfer("alice", "album/offline.mp3");
        Assert.Null(await service.UploadAsync(row));
        Assert.Equal(0, calls.Count);
        Assert.DoesNotContain(service.ListQueuePage("alice", 0, 10).Users, u => u.Username == "alice");
        using var db = factory.CreateDbContext();
        var saved = Assert.Single(db.Transfers);
        Assert.Equal(TransferStates.Completed | TransferStates.Cancelled, saved.State);
        Assert.Equal("Completed, Cancelled", saved.StateDescription);
        Assert.Equal(Transfer.ForgottenUploadReason, saved.Exception);
        Assert.True(saved.Removed);
    }

    [Fact]
    public async Task OfflineStatusForgetsIdleQueueAndAllowsLaterRequest()
    {
        var calls = new UploadCalls();
        var clock = new ManualUploadClock();
        await using var service = CreateService([], upload: calls.Upload);
        var old = QueueTransfer("alice", "album/offline.mp3");
        Assert.Equal(1, service.ForgetPendingUploads("alice"));
        Assert.Empty(service.ListQueuePage("alice", 0, 10).Users);

        var replacement = await service.EnqueueAsync("alice", old.Filename);
        Assert.NotNull(replacement);
        Assert.NotEqual(old.Id, replacement!.Id);
        (await calls.Next()).Succeed(clock);
        await WaitUntilCompleted(replacement.Id);
        using var db = factory.CreateDbContext();
        Assert.True(db.Transfers.Single(t => t.Id == old.Id).Removed);
        Assert.Equal(TransferStates.Completed | TransferStates.Succeeded,
            db.Transfers.Single(t => t.Id == replacement.Id).State);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task OfflineSdkCallbackCannotResurrectForgottenUpload(bool wrapped)
    {
        var calls = new UploadCalls();
        await using var service = CreateService([], upload: calls.Upload);
        var row = QueueTransfer("alice", "album/offline-callback.mp3");
        var task = service.UploadAsync(row);
        var attempt = await calls.Next();
        attempt.ChangeState(TransferStates.Initializing);
        Exception offline = new UserOfflineException("peer is offline");
        attempt.Completion.SetException(wrapped ? new InvalidOperationException("upload failed", offline) : offline);
        Assert.Null(await task.WaitAsync(TimeSpan.FromSeconds(5)));
        attempt.ChangeState(TransferStates.Completed | TransferStates.Errored);
        using var db = factory.CreateDbContext();
        var saved = Assert.Single(db.Transfers);
        Assert.True(saved.Removed);
        Assert.Equal(TransferStates.Completed | TransferStates.Cancelled, saved.State);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task RemoteCancellationForgetsOtherPendingFiles(bool wrapped)
    {
        var calls = new UploadCalls();
        await using var service = CreateService([], upload: calls.Upload);
        var cancelled = QueueTransfer("alice", "album/cancelled.mp3");
        var waiting = QueueTransfer("alice", "album/waiting.mp3");
        var firstTask = service.UploadAsync(cancelled);
        var first = await calls.Next();
        var waitingTask = service.UploadAsync(waiting);
        first.ChangeState(TransferStates.Completed | TransferStates.Rejected);
        Exception rejection = new TransferRejectedException("Transfer rejected: Cancelled");
        first.Completion.SetException(wrapped ? new InvalidOperationException("upload failed", rejection) : rejection);
        await Assert.ThrowsAnyAsync<Exception>(() => firstTask.WaitAsync(TimeSpan.FromSeconds(5)));
        Assert.Null(await waitingTask.WaitAsync(TimeSpan.FromSeconds(5)));
        using var db = factory.CreateDbContext();
        Assert.Equal(TransferStates.Completed | TransferStates.Rejected, db.Transfers.Single(t => t.Id == cancelled.Id).State);
        var forgotten = db.Transfers.Single(t => t.Id == waiting.Id);
        Assert.Equal(TransferStates.Completed | TransferStates.Cancelled, forgotten.State);
        Assert.True(forgotten.Removed);
        Assert.DoesNotContain(service.ListQueuePage("alice", 0, 10).Users, u => u.Username == "alice");
        Assert.Equal(1, calls.Count);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(10)]
    public async Task DisconnectAfterProgressForgetsRemainingFiles(long bytes)
    {
        var calls = new UploadCalls();
        await using var service = CreateService([], upload: calls.Upload);
        var row = QueueTransfer("alice", "album/interrupted.mp3");
        var waiting = QueueTransfer("alice", "album/next.mp3");
        var task = service.UploadAsync(row);
        var attempt = await calls.Next();
        attempt.ChangeState(TransferStates.InProgress, bytes: bytes, started: DateTime.UtcNow);
        attempt.FailConnection();
        await Assert.ThrowsAnyAsync<Exception>(() => task.WaitAsync(TimeSpan.FromSeconds(5)));
        using var db = factory.CreateDbContext();
        Assert.Equal(TransferStates.Completed | TransferStates.Errored, db.Transfers.Single(t => t.Id == row.Id).State);
        var forgotten = db.Transfers.Single(t => t.Id == waiting.Id);
        Assert.True(forgotten.Removed);
        Assert.Equal(TransferStates.Completed | TransferStates.Cancelled, forgotten.State);
    }

    [Theory]
    [InlineData("local")]
    [InlineData("cancelled-locally")]
    [InlineData("other-rejection")]
    [InlineData("mixed")]
    [InlineData("empty-aggregate")]
    [InlineData("application")]
    public async Task NonDisconnectFailurePreservesOtherQueuedFiles(string kind)
    {
        var calls = new UploadCalls();
        await using var service = CreateService([], upload: calls.Upload);
        var row = QueueTransfer("alice", "album/error.mp3");
        var waiting = QueueTransfer("alice", "album/waiting.mp3");
        var task = service.UploadAsync(row);
        Exception failure = kind switch
        {
            "local" => new IOException("local file read failed"),
            "cancelled-locally" => new OperationCanceledException(),
            "other-rejection" => new TransferRejectedException("Transfer rejected: Complete"),
            "mixed" => new AggregateException(new ConnectionException("connection failed"), new IOException("local failure")),
            "empty-aggregate" => new AggregateException(),
            _ => new InvalidOperationException("application failure"),
        };
        (await calls.Next()).Completion.SetException(failure);
        Assert.Same(failure, await Assert.ThrowsAnyAsync<Exception>(() => task.WaitAsync(TimeSpan.FromSeconds(5))));
        AssertAllQueued([waiting]);
    }

    [Fact]
    public async Task RepeatedCancellationDoesNotHoldARecipientCooldown()
    {
        var calls = new UploadCalls();
        var cooldown = new UploadPeerCooldown(new ManualUploadClock());
        await using var service = CreateService([], upload: calls.Upload, cooldown: cooldown);
        for (var i = 0; i < 3; i++)
        {
            var row = QueueTransfer("alice", $"album/retry-{i}.mp3");
            var task = service.UploadAsync(row);
            (await calls.Next()).Completion.SetException(new TransferRejectedException("Transfer rejected: Cancelled"));
            await Assert.ThrowsAnyAsync<Exception>(() => task.WaitAsync(TimeSpan.FromSeconds(5)));
            Assert.Null(cooldown.GetRetryAt("alice"));
        }
    }

    private async Task WaitUntilCompleted(Guid id)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        while (true)
        {
            using var db = factory.CreateDbContext();
            if (db.Transfers.Single(t => t.Id == id).State.HasFlag(TransferStates.Completed))
            {
                return;
            }

            await Task.Delay(10, timeout.Token);
        }
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
            Assert.Equal(0, saved.BytesTransferred);
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
