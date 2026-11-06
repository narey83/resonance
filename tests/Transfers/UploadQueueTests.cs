namespace Resonance.Tests.Transfers;

using System.Net;
using global::resonance;
using AppOptions = global::resonance.Options;
using global::resonance.Transfers;
using global::resonance.Users;
using Microsoft.Extensions.Options;
using Soulseek;

/// <summary>
///     Covers the queue position estimates, which run while other threads are mutating the queue: peers poll
///     place-in-queue continuously and every incoming search asks for a forecast, all while uploads are being
///     enqueued and completed.
/// </summary>
public class UploadQueueTests
{
    [Fact]
    public void ForgetRecipientRemovesWaitingEntriesWithoutReleasingAnActiveSlotOrAReplacementRequest()
    {
        var queue = new UploadQueue(new StubUserService(), StubOptions(slots: 1));
        var activeId = Guid.NewGuid();
        var oldId = Guid.NewGuid();
        var replacementId = Guid.NewGuid();
        queue.Enqueue("alice", "active-file", activeId);
        Assert.True(queue.AwaitStartAsync("alice", "active-file", activeId).IsCompletedSuccessfully);
        queue.Enqueue("alice", "same-file", oldId);
        Assert.False(queue.AwaitStartAsync("alice", "same-file", oldId).IsCompleted);

        Assert.Equal(1, queue.ForgetRecipient("alice", [activeId, oldId]));
        Assert.Equal(1, queue.GetGroupInfo(Application.DefaultGroup).UsedSlots);
        Assert.False(queue.TryComplete("alice", "same-file", oldId));

        queue.Enqueue("alice", "same-file", replacementId);
        Assert.False(queue.TryComplete("alice", "same-file", oldId));
        Assert.Equal(1, queue.GetGroupInfo(Application.DefaultGroup).UsedSlots);
        queue.Complete("alice", "active-file", activeId);
        Assert.True(queue.AwaitStartAsync("alice", "same-file", replacementId).IsCompletedSuccessfully);
        queue.Complete("alice", "same-file", replacementId);
        Assert.Equal(0, queue.GetGroupInfo(Application.DefaultGroup).UsedSlots);
    }

    [Fact]
    public void ForgetRecipientClearsAThousandWaitingEntriesInOnePass()
    {
        var queue = new UploadQueue(new StubUserService(), StubOptions(slots: 1));
        var activeId = Guid.NewGuid();
        queue.Enqueue("alice", "active-file", activeId);
        Assert.True(queue.AwaitStartAsync("alice", "active-file", activeId).IsCompletedSuccessfully);
        var waiting = Enumerable.Range(0, 1000).Select(_ => Guid.NewGuid()).ToArray();
        for (var i = 0; i < waiting.Length; i++)
        {
            queue.Enqueue("alice", $"waiting-{i}", waiting[i]);
        }

        Assert.Equal(waiting.Length, queue.ForgetRecipient("alice", waiting));
        Assert.Equal(1, queue.GetGroupInfo(Application.DefaultGroup).UsedSlots);
        Assert.False(queue.TryComplete("alice", "waiting-999", waiting[^1]));
        queue.Complete("alice", "active-file", activeId);
        Assert.Equal(0, queue.GetGroupInfo(Application.DefaultGroup).UsedSlots);
    }


    /// <summary>
    ///     Regression test: EstimatePosition orders and flattens the per-user upload lists, and LINQ buffers a source
    ///     by reading Count and then copying it. Reading without the lock that Enqueue/Complete hold raced a concurrent
    ///     Add/Remove and threw ("Destination array was not long enough"), leaving peers with no answer about whether
    ///     their queued files were still alive.
    /// </summary>
    [Fact]
    public void EstimatePosition_Does_Not_Throw_While_The_Queue_Is_Mutated()
    {
        var queue = new UploadQueue(new StubUserService(), StubOptions());

        AssertNoExceptionsWhileQueueChurns(
            queue,
            read: () =>
            {
                try
                {
                    queue.EstimatePosition("alice", "file-0");
                }
                catch (NotFoundException)
                {
                    // expected and benign: the file may legitimately not be enqueued at this instant
                }
            });
    }

    /// <summary>
    ///     ForecastPosition runs on the incoming search path and deliberately stays off SyncRoot, so it must only ever
    ///     read each list's Count rather than enumerate the entries a concurrent Enqueue/Complete may be mutating.
    /// </summary>
    [Fact]
    public void ForecastPosition_Counts_Queued_Files_Without_Enumerating_Them()
    {
        var queue = new UploadQueue(new StubUserService(), StubOptions(slots: 1, strategy: QueueStrategy.FirstInFirstOut));

        // occupy the group's only slot so the forecast can't short-circuit on slot availability
        queue.Enqueue("bob", "bob-file");
        queue.AwaitStartAsync("bob", "bob-file");

        foreach (var i in Enumerable.Range(0, 5))
        {
            queue.Enqueue("alice", $"file-{i}");
        }

        // bob's in-progress file plus alice's five, and the caller would land behind all of them
        Assert.Equal(7, queue.ForecastPosition("carol"));
    }

    /// <summary>
    ///     GetGroup can name a group that isn't in the dictionary (a user-defined group dropped from the config while a
    ///     user is still assigned to it). That used to be dereferenced without a null check and threw a
    ///     NullReferenceException out of the place-in-queue and search resolvers.
    /// </summary>
    [Fact]
    public void Position_Estimates_Fall_Back_To_The_Default_Group_For_An_Unknown_Group()
    {
        var queue = new UploadQueue(new StubUserService(group: "a-group-that-is-not-configured"), StubOptions());

        // no slot is in use, so the default group has one free and the user would start immediately
        Assert.Equal(0, queue.ForecastPosition("alice"));

        queue.Enqueue("alice", "file-0");
        Assert.Equal(0, queue.EstimatePosition("alice", "file-0"));
    }

    private static void AssertNoExceptionsWhileQueueChurns(UploadQueue queue, Action read)
    {
        // seed enough entries that the lists are large enough to be copied rather than trivially small
        for (var i = 0; i < 200; i++)
        {
            queue.Enqueue("alice", $"file-{i}");
        }

        var failures = new System.Collections.Concurrent.ConcurrentQueue<Exception>();
        using var stop = new CancellationTokenSource(TimeSpan.FromSeconds(2));

        void Run(Action action)
        {
            try
            {
                while (!stop.IsCancellationRequested)
                {
                    action();
                }
            }
            catch (Exception ex)
            {
                failures.Enqueue(ex);
                stop.Cancel();
            }
        }

        var churn = Task.Run(() =>
        {
            var n = 200;

            Run(() =>
            {
                // add and remove continuously so list Count changes under any concurrent read
                queue.Enqueue("alice", $"file-{n}");
                queue.TryComplete("alice", $"file-{n}");
                n++;
            });
        });

        var readers = Enumerable.Range(0, 4).Select(_ => Task.Run(() => Run(read))).ToArray();

        Task.WaitAll([churn, .. readers]);

        Assert.Empty(failures);
    }

    private static IOptionsMonitor<AppOptions> StubOptions(int slots = 10, QueueStrategy strategy = QueueStrategy.RoundRobin)
        => new StubOptionsMonitor(new AppOptions
        {
            Transfers = new AppOptions.TransfersOptions
            {
                Upload = new AppOptions.TransfersOptions.GlobalUploadOptions { Slots = slots },
                Groups = new AppOptions.TransfersOptions.GroupsOptions
                {
                    Default = new AppOptions.TransfersOptions.GroupsOptions.BaseGroupOptions
                    {
                        Upload = new AppOptions.TransfersOptions.GroupsOptions.BaseGroupOptions.GroupUploadOptions
                        {
                            Strategy = strategy.ToString().ToLowerInvariant(),
                        },
                    },
                },
            },
        });

    private sealed class StubOptionsMonitor(AppOptions value) : IOptionsMonitor<AppOptions>
    {
        public AppOptions CurrentValue { get; } = value;

        public AppOptions Get(string? name) => CurrentValue;

        public IDisposable? OnChange(Action<AppOptions, string?> listener) => null;
    }

    /// <summary>
    ///     UploadQueue only ever asks the user service for a group; everything else is unreachable from it.
    /// </summary>
    private sealed class StubUserService(string group = Application.DefaultGroup) : IUserService
    {
        public IReadOnlyList<User> Users => throw new NotImplementedException();

        public IReadOnlyList<string> WatchedUsernames => throw new NotImplementedException();

        public string GetGroup(string username) => group;

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
