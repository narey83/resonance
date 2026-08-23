namespace Resonance.Tests.Logs;

using global::resonance.Core.LogStore;

public class LogPartitioningTests
{
    [Fact]
    public void Bounds_SpansExactlyOneCalendarMonth()
    {
        var (start, end) = LogPartitioning.Bounds(2026, 2);

        Assert.Equal(new DateOnly(2026, 2, 1), start);
        Assert.Equal(new DateOnly(2026, 3, 1), end); // exclusive upper bound
    }

    [Fact]
    public void Bounds_HandlesDecemberRollingIntoJanuary()
    {
        var (start, end) = LogPartitioning.Bounds(2026, 12);

        Assert.Equal(new DateOnly(2026, 12, 1), start);
        Assert.Equal(new DateOnly(2027, 1, 1), end);
    }

    [Fact]
    public void TableName_IsZeroPadded()
    {
        Assert.Equal("LogEntries_202601", LogPartitioning.TableName(2026, 1));
        Assert.Equal("LogEntries_202612", LogPartitioning.TableName(2026, 12));
    }

    [Fact]
    public void RequiredPartitions_IncludesCurrentMonthAndTheLookahead()
    {
        var required = LogPartitioning.RequiredPartitions(new DateOnly(2026, 6, 15), monthsAhead: 2);

        Assert.Equal(new[] { (2026, 6), (2026, 7), (2026, 8) }, required);
    }

    [Fact]
    public void RequiredPartitions_RollsOverIntoTheNextYear()
    {
        var required = LogPartitioning.RequiredPartitions(new DateOnly(2026, 11, 30), monthsAhead: 2);

        Assert.Equal(new[] { (2026, 11), (2026, 12), (2027, 1) }, required);
    }

    [Fact]
    public void IsExpired_TrueOnlyOnceThePartitionsEntireRangeIsPastTheCutoff()
    {
        // August's partition covers [Aug 1, Sep 1). Only once the cutoff reaches Sep 1 has every
        // possible record in that partition become older than the retention window.
        Assert.False(LogPartitioning.IsExpired(2026, 8, cutoff: new DateOnly(2026, 8, 31)));
        Assert.True(LogPartitioning.IsExpired(2026, 8, cutoff: new DateOnly(2026, 9, 1)));
        Assert.True(LogPartitioning.IsExpired(2026, 8, cutoff: new DateOnly(2026, 10, 1)));
    }

    [Fact]
    public void ExpiredPartitions_KeepsAtLeastTheRetentionWindow_RoundedUpToTheMonth()
    {
        var existing = new[] { "LogEntries_202605", "LogEntries_202606", "LogEntries_202607", "LogEntries_202608" };

        // "now" is partway through August, 30-day retention -- the cutoff lands in July, so June
        // (and everything older) is fully past it, but July is not (some of July is still within
        // 30 days), and August/the current month never is.
        var expired = LogPartitioning.ExpiredPartitions(existing, now: new DateTime(2026, 8, 15), retentionDays: 30);

        Assert.Equal(new[] { "LogEntries_202605", "LogEntries_202606" }, expired);
    }

    [Fact]
    public void ExpiredPartitions_IgnoresNamesThatDoNotMatchThePartitionShape()
    {
        var existing = new[] { "LogEntries_202601", "SomeOtherTable", "LogEntries", "LogEntries_2026001", "LogEntries_abcdef" };

        var expired = LogPartitioning.ExpiredPartitions(existing, now: new DateTime(2030, 1, 1), retentionDays: 1);

        Assert.Equal(new[] { "LogEntries_202601" }, expired);
    }

    [Fact]
    public void ExpiredPartitions_ReturnsNothing_WhenNoneAreOldEnough()
    {
        var existing = new[] { "LogEntries_202608" };

        var expired = LogPartitioning.ExpiredPartitions(existing, now: new DateTime(2026, 8, 15), retentionDays: 30);

        Assert.Empty(expired);
    }
}
