namespace Resonance.Tests.Transfers;

using System;
using RepeatedFailureLog = global::resonance.Transfers.Uploads.RepeatedFailureLog;

/// <summary>
///     Covers the collapsing of repeated identical transfer failures.
/// </summary>
/// <remarks>
///     The properties that matter: a failure on its own is never hidden, a storm is reduced to a few
///     examples plus a count, and every suppressed failure is eventually counted somewhere.
/// </remarks>
public class RepeatedFailureLogTests
{
    private static readonly DateTime Now = new(2026, 9, 17, 14, 46, 0, DateTimeKind.Utc);

    private static RepeatedFailureLog Subject(int verbose = 3, int summariseEvery = 250) =>
        new(verbose, summariseEvery, TimeSpan.FromMinutes(1));

    [Fact]
    public void A_Single_Failure_Is_Always_Logged()
    {
        var log = Subject();

        var decision = log.Record("peer|IOException", Now);

        Assert.True(decision.Verbose);
        Assert.Equal(0, decision.Suppressed);
    }

    [Fact]
    public void The_First_Few_Of_A_Kind_Are_Logged_In_Full()
    {
        var log = Subject(verbose: 3);

        for (var i = 0; i < 3; i++)
        {
            Assert.True(log.Record("peer|IOException", Now).Verbose);
        }

        Assert.False(log.Record("peer|IOException", Now).Verbose);
    }

    [Fact]
    public void Suppressed_Failures_Are_Reported_As_A_Count()
    {
        var log = Subject(verbose: 3, summariseEvery: 10);

        // 3 verbose, then 9 quietly counted
        for (var i = 0; i < 12; i++)
        {
            Assert.Equal(0, log.Record("peer|IOException", Now).Suppressed);
        }

        // the tenth suppressed one reports the batch
        var decision = log.Record("peer|IOException", Now);

        Assert.False(decision.Verbose);
        Assert.Equal(10, decision.Suppressed);
    }

    [Fact]
    public void The_Count_Restarts_After_Being_Reported()
    {
        var log = Subject(verbose: 1, summariseEvery: 5);

        log.Record("peer|IOException", Now);

        for (var i = 0; i < 5; i++)
        {
            log.Record("peer|IOException", Now);
        }

        // reported once; the next batch starts from zero again
        Assert.Equal(0, log.Record("peer|IOException", Now).Suppressed);
    }

    [Fact]
    public void A_Quiet_Period_Ends_The_Group_And_Flushes_What_Was_Pending()
    {
        var log = Subject(verbose: 1, summariseEvery: 1000);

        log.Record("peer|IOException", Now);
        log.Record("peer|IOException", Now);
        log.Record("peer|IOException", Now);

        // two were suppressed; a failure after the window reports them and is itself logged in full
        var decision = log.Record("peer|IOException", Now.AddMinutes(2));

        Assert.True(decision.Verbose);
        Assert.Equal(2, decision.Suppressed);
    }

    [Fact]
    public void Flush_Reports_And_Clears_A_Pending_Count()
    {
        var log = Subject(verbose: 1, summariseEvery: 1000);

        log.Record("peer|IOException", Now);
        log.Record("peer|IOException", Now);
        log.Record("peer|IOException", Now);

        Assert.Equal(2, log.Flush("peer|IOException"));
        Assert.Equal(0, log.Flush("peer|IOException"));
    }

    [Fact]
    public void Flushing_An_Unknown_Group_Reports_Nothing()
    {
        Assert.Equal(0, Subject().Flush("never-seen"));
    }

    [Fact]
    public void Groups_Are_Independent()
    {
        var log = Subject(verbose: 1);

        log.Record("alice|IOException", Now);
        log.Record("alice|IOException", Now);

        // a different peer, and a different failure on the same peer, both start fresh
        Assert.True(log.Record("bob|IOException", Now).Verbose);
        Assert.True(log.Record("alice|TimeoutException", Now).Verbose);
    }

    [Fact]
    public void A_Storm_Is_Fully_Accounted_For()
    {
        var log = Subject(verbose: 3, summariseEvery: 250);

        var verbose = 0;
        var counted = 0;

        // the 2026-09-17 cascade: one cause, 4,163 queued uploads to a single peer
        for (var i = 0; i < 4163; i++)
        {
            var decision = log.Record("lokodriss|InvalidOperationException", Now);

            if (decision.Verbose)
            {
                verbose++;
            }

            counted += decision.Suppressed;
        }

        counted += log.Flush("lokodriss|InvalidOperationException");

        // every failure is either shown or counted, and the whole storm costs 3 + 17 lines
        Assert.Equal(3, verbose);
        Assert.Equal(4163, verbose + counted);
    }
}
