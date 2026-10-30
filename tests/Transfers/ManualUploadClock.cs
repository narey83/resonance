namespace Resonance.Tests.Transfers;

using System.Threading.Channels;

internal sealed class ManualUploadClock : TimeProvider
{
    private readonly object gate = new();
    private readonly List<ManualTimer> timers = [];
    private readonly Channel<TimeSpan> delays = Channel.CreateUnbounded<TimeSpan>();
    private DateTimeOffset now = new(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);

    public override DateTimeOffset GetUtcNow() { lock (gate) { return now; } }

    public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period)
    {
        var timer = new ManualTimer(this, callback, state);
        timer.Change(dueTime, period);
        return timer;
    }

    public Task<TimeSpan> NextDelay() => delays.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(5));

    public void Advance(TimeSpan duration)
    {
        ManualTimer[] due;
        lock (gate)
        {
            now += duration;
            due = timers.Where(t => t.Due <= now).ToArray();
            foreach (var timer in due) { timers.Remove(timer); }
        }

        foreach (var timer in due) { timer.Fire(); }
    }

    private sealed class ManualTimer(ManualUploadClock owner, TimerCallback callback, object? state) : ITimer
    {
        public DateTimeOffset Due { get; private set; }

        public bool Change(TimeSpan dueTime, TimeSpan period)
        {
            Assert.Equal(Timeout.InfiniteTimeSpan, period);
            lock (owner.gate)
            {
                owner.timers.Remove(this);
                if (dueTime != Timeout.InfiniteTimeSpan)
                {
                    Due = owner.now + dueTime;
                    owner.timers.Add(this);
                    owner.delays.Writer.TryWrite(dueTime);
                }
            }

            return true;
        }

        public void Fire() => callback(state);
        public void Dispose() { lock (owner.gate) { owner.timers.Remove(this); } }
        public ValueTask DisposeAsync() { Dispose(); return ValueTask.CompletedTask; }
    }
}
