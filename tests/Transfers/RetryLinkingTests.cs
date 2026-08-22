namespace Resonance.Tests.Transfers;

using System;
using System.Collections.Generic;
using Soulseek;
using Transfer = global::resonance.Transfers.Transfer;
using RetryLinking = global::resonance.Transfers.RetryLinking;

/// <summary>
///     Covers the retry-correlation logic that lets the transfer history UI present a failed attempt
///     followed by a successful retry as one resolved outcome instead of two unrelated rows. The decision
///     of whether a new transfer should be linked, via <see cref="global::resonance.Transfers.Transfer.RetryOfId"/>,
///     to an earlier attempt is deliberately factored out into a small pure function so it can be tested
///     without a database.
/// </summary>
public class RetryLinkingTests
{
    private static Transfer MakeTransfer(string filename, TransferStates state, bool removed = false, DateTime? endedAt = null) =>
        new()
        {
            Id = Guid.NewGuid(),
            Username = "someone",
            Direction = TransferDirection.Download,
            Filename = filename,
            RequestedAt = DateTime.UtcNow,
            State = state,
            Removed = removed,
            EndedAt = endedAt ?? DateTime.UtcNow,
        };

    [Fact]
    public void Returns_Null_When_There_Are_No_Candidates()
    {
        var result = RetryLinking.FindPriorFailedAttempt([], "track.mp3");

        Assert.Null(result);
    }

    [Fact]
    public void Links_To_A_Prior_Errored_Attempt_At_The_Same_File()
    {
        var failed = MakeTransfer("track.mp3", TransferStates.Completed | TransferStates.Errored);

        var result = RetryLinking.FindPriorFailedAttempt([failed], "track.mp3");

        Assert.Same(failed, result);
    }

    /// <summary>
    ///     A deliberate second download/upload of a file that already succeeded is a new, independent
    ///     transfer -- not a retry recovering from an error -- so it must never be linked, even though it's
    ///     still present (not yet Removed) at enqueue time.
    /// </summary>
    [Fact]
    public void Does_Not_Link_To_A_Prior_Successful_Attempt()
    {
        var succeeded = MakeTransfer("track.mp3", TransferStates.Completed | TransferStates.Succeeded);

        var result = RetryLinking.FindPriorFailedAttempt([succeeded], "track.mp3");

        Assert.Null(result);
    }

    /// <summary>
    ///     A failed record that has already been superseded (by an earlier retry, or a since-cleared record)
    ///     must not be re-linked; only the most recent not-yet-removed record is eligible.
    /// </summary>
    [Fact]
    public void Ignores_Failed_Candidates_That_Are_Already_Removed()
    {
        var failed = MakeTransfer("track.mp3", TransferStates.Completed | TransferStates.Errored, removed: true);

        var result = RetryLinking.FindPriorFailedAttempt([failed], "track.mp3");

        Assert.Null(result);
    }

    [Fact]
    public void Ignores_Candidates_For_A_Different_Filename()
    {
        var failed = MakeTransfer("other-track.mp3", TransferStates.Completed | TransferStates.Errored);

        var result = RetryLinking.FindPriorFailedAttempt([failed], "track.mp3");

        Assert.Null(result);
    }

    /// <summary>
    ///     Covers every state TransferStateCategories.Failed recognizes -- Cancelled, TimedOut, Errored,
    ///     Rejected, and Aborted -- since a retry can follow any of them, not just an outright error.
    /// </summary>
    [Theory]
    [InlineData(TransferStates.Cancelled)]
    [InlineData(TransferStates.TimedOut)]
    [InlineData(TransferStates.Errored)]
    [InlineData(TransferStates.Rejected)]
    [InlineData(TransferStates.Aborted)]
    public void Links_To_Any_Recognized_Failure_State(TransferStates failureFlag)
    {
        var failed = MakeTransfer("track.mp3", TransferStates.Completed | failureFlag);

        var result = RetryLinking.FindPriorFailedAttempt([failed], "track.mp3");

        Assert.Same(failed, result);
    }

    /// <summary>
    ///     Multiple failed retries in a row (attempt 1, 2, and 3 all failing before attempt 4 succeeds) must
    ///     link the new attempt to the *most recent* failure, not an earlier one further back in the chain --
    ///     otherwise walking RetryOfId back from the eventual success would skip attempts.
    /// </summary>
    [Fact]
    public void Links_To_The_Most_Recent_Failure_When_Several_Precede_It()
    {
        var now = DateTime.UtcNow;
        var attempt1 = MakeTransfer("track.mp3", TransferStates.Completed | TransferStates.Errored, endedAt: now.AddMinutes(-10));
        var attempt2 = MakeTransfer("track.mp3", TransferStates.Completed | TransferStates.Errored, endedAt: now.AddMinutes(-5));

        var result = RetryLinking.FindPriorFailedAttempt([attempt1, attempt2], "track.mp3");

        Assert.Same(attempt2, result);
    }

    /// <summary>
    ///     A batch of unrelated in-flight/completed transfers for other files must not confuse the match --
    ///     only same-filename, not-removed, failed candidates are eligible.
    /// </summary>
    [Fact]
    public void Only_Considers_Matching_Filename_Among_Mixed_Candidates()
    {
        var unrelatedSucceeded = MakeTransfer("other.mp3", TransferStates.Completed | TransferStates.Succeeded);
        var unrelatedFailed = MakeTransfer("another.mp3", TransferStates.Completed | TransferStates.Errored);
        var matchingFailed = MakeTransfer("track.mp3", TransferStates.Completed | TransferStates.Errored);

        var result = RetryLinking.FindPriorFailedAttempt([unrelatedSucceeded, unrelatedFailed, matchingFailed], "track.mp3");

        Assert.Same(matchingFailed, result);
    }
}
