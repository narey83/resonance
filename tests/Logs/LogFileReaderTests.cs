namespace Resonance.Tests.Logs;

using System.Reflection;
using global::resonance;
using global::resonance.Core.LogStore;

public class LogFileReaderTests
{
    // Query() treats the alphabetically-last file in the directory as "hot" (incrementally
    // cached); everything else is read fresh every call. Using dates keeps that ordering obvious
    // and matches the real {AppName}-yyyyMMdd.jsonl naming Query() globs for.
    private static string HotFileName(DirectoryInfo dir, string date) =>
        Path.Combine(dir.FullName, $"{Program.AppName}-{date}.jsonl");

    private static string Line(string timestamp, string level, string message, string context = "Application") =>
        $$"""{"Timestamp":"{{timestamp}}","Level":"{{level}}","Properties":{"SourceContext":"{{context}}"},"RenderedMessage":"{{message}}"}""";

    // Thin wrapper so call sites can pass C#'s bare `null` for the unused filter args without
    // triggering CS8625 against LogFileReader.Query's non-nullable parameter types -- Query()
    // itself treats a null levels/contexts/search exactly like "no filter", so this changes
    // nothing about what's being exercised.
    private static (List<LogRecord> Items, int Total) Query(
        string dir, string[]? levels = null, string[]? contexts = null, string? search = null,
        DateTime? from = null, DateTime? to = null, int offset = 0, int limit = 100) =>
        LogFileReader.Query(dir, levels!, contexts!, search!, from, to, offset, limit);

    // GetHotFileRecords() is a private implementation detail, but its whole point is to hand back
    // only the slice of the day's cache that's actually new -- that guarantee is invisible from
    // Query()'s output (a correctly-filtered result looks identical whether the internal list it
    // was filtered from was small or the size of the whole day), so proving it requires calling
    // the method directly rather than only asserting on Query()'s return value.
    private static List<LogRecord> InvokeGetHotFileRecords(string file, DateTime? from)
    {
        var method = typeof(LogFileReader).GetMethod("GetHotFileRecords", BindingFlags.NonPublic | BindingFlags.Static);
        return (List<LogRecord>)method!.Invoke(null, new object?[] { file, from, CancellationToken.None })!;
    }

    [Fact]
    public void Query_ReadsRecords_AcrossHotAndRolledOverFiles()
    {
        var dir = Directory.CreateTempSubdirectory("resonance-logfilereader");

        try
        {
            File.WriteAllText(
                HotFileName(dir, "20260101"),
                Line("2026-01-01T10:00:00.000Z", "Information", "day one, first") + "\n" +
                Line("2026-01-01T10:00:01.000Z", "Warning", "day one, second") + "\n");

            File.WriteAllText(
                HotFileName(dir, "20260102"),
                Line("2026-01-02T10:00:00.000Z", "Information", "day two, first") + "\n" +
                Line("2026-01-02T10:00:01.000Z", "Error", "day two, second") + "\n");

            var (items, total) = Query(dir.FullName, null, null, null, null, null, offset: 0, limit: 100);

            Assert.Equal(4, total);
            Assert.Equal(4, items.Count);

            // newest-first across days
            Assert.Equal("day two, second", items[0].Message);
            Assert.Equal("day two, first", items[1].Message);
            Assert.Equal("day one, second", items[2].Message);
            Assert.Equal("day one, first", items[3].Message);
        }
        finally
        {
            dir.Delete(recursive: true);
        }
    }

    [Fact]
    public void Query_Filters_ByLevelContextSearchAndDateRange()
    {
        var dir = Directory.CreateTempSubdirectory("resonance-logfilereader");

        try
        {
            File.WriteAllText(
                HotFileName(dir, "20260201"),
                Line("2026-02-01T10:00:00.000Z", "Information", "download started", "Transfers") + "\n" +
                Line("2026-02-01T10:00:01.000Z", "Error", "download failed", "Transfers") + "\n" +
                Line("2026-02-01T10:00:02.000Z", "Information", "share scan complete", "Shares") + "\n");

            var (byLevel, _) = Query(dir.FullName, new[] { "Error" }, null, null, null, null, 0, 100);
            Assert.Single(byLevel);
            Assert.Equal("download failed", byLevel[0].Message);

            var (byContext, _) = Query(dir.FullName, null, new[] { "Shares" }, null, null, null, 0, 100);
            Assert.Single(byContext);
            Assert.Equal("share scan complete", byContext[0].Message);

            var (bySearch, _) = Query(dir.FullName, null, null, "started", null, null, 0, 100);
            Assert.Single(bySearch);
            Assert.Equal("download started", bySearch[0].Message);

            var (byFrom, _) = Query(
                dir.FullName, null, null, null, DateTimeOffset.Parse("2026-02-01T10:00:01.000Z").UtcDateTime, null, 0, 100);
            Assert.Equal(2, byFrom.Count);
        }
        finally
        {
            dir.Delete(recursive: true);
        }
    }

    [Fact]
    public void Query_Paginates_WithOffsetAndLimit_AndReportsTotal()
    {
        var dir = Directory.CreateTempSubdirectory("resonance-logfilereader");

        try
        {
            var lines = string.Concat(Enumerable.Range(0, 10)
                .Select(i => Line($"2026-03-01T10:00:{i:D2}.000Z", "Information", $"entry {i}") + "\n"));

            File.WriteAllText(HotFileName(dir, "20260301"), lines);

            var (page1, total1) = Query(dir.FullName, null, null, null, null, null, offset: 0, limit: 3);
            var (page2, total2) = Query(dir.FullName, null, null, null, null, null, offset: 3, limit: 3);

            Assert.Equal(10, total1);
            Assert.Equal(10, total2);
            Assert.Equal(new[] { "entry 9", "entry 8", "entry 7" }, page1.Select(r => r.Message));
            Assert.Equal(new[] { "entry 6", "entry 5", "entry 4" }, page2.Select(r => r.Message));
        }
        finally
        {
            dir.Delete(recursive: true);
        }
    }

    [Fact]
    public void Query_PicksUpNewlyAppendedLines_OnTheHotFile_WithoutReparsingWhatWasAlreadyRead()
    {
        var dir = Directory.CreateTempSubdirectory("resonance-logfilereader");

        try
        {
            var path = HotFileName(dir, "20260401");

            File.WriteAllText(path, Line("2026-04-01T10:00:00.000Z", "Information", "first") + "\n");

            var (first, firstTotal) = Query(dir.FullName, null, null, null, null, null, 0, 100);
            Assert.Equal(1, firstTotal);
            Assert.Equal("first", first[0].Message);

            // append while "open" -- exercises the incremental (seek-forward) read path, not a
            // fresh full-file read, since Query() already has this file cached as hot.
            File.AppendAllText(path, Line("2026-04-01T10:00:01.000Z", "Information", "second") + "\n");

            var (second, secondTotal) = Query(dir.FullName, null, null, null, null, null, 0, 100);
            Assert.Equal(2, secondTotal);
            Assert.Equal("second", second[0].Message);
            Assert.Equal("first", second[1].Message);

            File.AppendAllText(path, Line("2026-04-01T10:00:02.000Z", "Information", "third") + "\n");

            var (third, thirdTotal) = Query(dir.FullName, null, null, null, null, null, 0, 100);
            Assert.Equal(3, thirdTotal);
            Assert.Equal(new[] { "third", "second", "first" }, third.Select(r => r.Message));
        }
        finally
        {
            dir.Delete(recursive: true);
        }
    }

    [Fact]
    public void Query_IgnoresATrailingUnterminatedLine_UntilItsNewlineArrives()
    {
        var dir = Directory.CreateTempSubdirectory("resonance-logfilereader");

        try
        {
            var path = HotFileName(dir, "20260501");

            File.WriteAllText(path, Line("2026-05-01T10:00:00.000Z", "Information", "complete") + "\n");

            using (var stream = new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.ReadWrite))
            using (var writer = new StreamWriter(stream))
            {
                // simulate the file sink mid-write: a line with no trailing '\n' yet
                writer.Write(Line("2026-05-01T10:00:01.000Z", "Information", "in-progress"));
            }

            var (beforeNewline, beforeTotal) = Query(dir.FullName, null, null, null, null, null, 0, 100);
            Assert.Equal(1, beforeTotal);
            Assert.Equal("complete", beforeNewline[0].Message);

            File.AppendAllText(path, "\n");

            var (afterNewline, afterTotal) = Query(dir.FullName, null, null, null, null, null, 0, 100);
            Assert.Equal(2, afterTotal);
            Assert.Equal("in-progress", afterNewline[0].Message);
        }
        finally
        {
            dir.Delete(recursive: true);
        }
    }

    [Fact]
    public void Query_ReadsThePreviousHotFile_CorrectlyOnceItRollsOver()
    {
        var dir = Directory.CreateTempSubdirectory("resonance-logfilereader");

        try
        {
            var day1 = HotFileName(dir, "20260601");
            File.WriteAllText(day1, Line("2026-06-01T23:59:00.000Z", "Information", "yesterday") + "\n");

            // Prime the hot-file cache against day1 (it's the only, and therefore newest, file).
            var (before, _) = Query(dir.FullName, null, null, null, null, null, 0, 100);
            Assert.Equal("yesterday", before[0].Message);

            // day rollover: a new, later-named file appears and becomes hot; day1 is now
            // immutable and must still be read correctly even though it's no longer files[0].
            var day2 = HotFileName(dir, "20260602");
            File.WriteAllText(day2, Line("2026-06-02T00:00:00.000Z", "Information", "today") + "\n");

            var (after, afterTotal) = Query(dir.FullName, null, null, null, null, null, 0, 100);
            Assert.Equal(2, afterTotal);
            Assert.Equal(new[] { "today", "yesterday" }, after.Select(r => r.Message));
        }
        finally
        {
            dir.Delete(recursive: true);
        }
    }

    [Fact]
    public void Query_ReturnsEmpty_WhenDirectoryDoesNotExist()
    {
        var (items, total) = Query(
            Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString()), null, null, null, null, null, 0, 100);

        Assert.Empty(items);
        Assert.Equal(0, total);
    }

    [Fact]
    public void GetHotFileRecords_ReturnsOnlyTheDelta_NotTheWholeDaysAccumulatedCache()
    {
        var dir = Directory.CreateTempSubdirectory("resonance-logfilereader");

        try
        {
            var path = HotFileName(dir, "20260701");
            var baseTime = DateTime.Parse("2026-07-01T00:00:00.000Z").ToUniversalTime();

            var backlog = string.Concat(Enumerable.Range(0, 5_000)
                .Select(i => Line(baseTime.AddSeconds(i).ToString("yyyy-MM-ddTHH:mm:ss.fffZ"), "Information", $"entry {i}") + "\n"));

            File.WriteAllText(path, backlog);

            // Prime the cache: this is the one full read/parse the whole approach still pays once.
            var primed = InvokeGetHotFileRecords(path, from: null);
            Assert.Equal(5_000, primed.Count);

            // Simulate the live-tail's next poll: strictly after the newest record it already has
            // (the `>=` boundary is inclusive, so this avoids re-matching that last backlog entry).
            var lastSeen = primed[^1].Timestamp.AddMilliseconds(500);

            File.AppendAllText(
                path,
                Line(baseTime.AddSeconds(5_000).ToString("yyyy-MM-ddTHH:mm:ss.fffZ"), "Information", "new one") + "\n" +
                Line(baseTime.AddSeconds(5_001).ToString("yyyy-MM-ddTHH:mm:ss.fffZ"), "Information", "new two") + "\n" +
                Line(baseTime.AddSeconds(5_002).ToString("yyyy-MM-ddTHH:mm:ss.fffZ"), "Information", "new three") + "\n");

            var delta = InvokeGetHotFileRecords(path, lastSeen);

            // The cache now holds 5,003 records, but the poll only asked for what's new -- proving
            // the returned (and therefore copied/filtered/paginated) set tracks the delta, not the
            // day's accumulated total.
            Assert.Equal(3, delta.Count);
            Assert.Equal(new[] { "new one", "new two", "new three" }, delta.Select(r => r.Message));
        }
        finally
        {
            dir.Delete(recursive: true);
        }
    }

    [Fact]
    public void Query_TailPoll_ReturnsOnlyNewRecords_AgainstALargeExistingBacklog()
    {
        var dir = Directory.CreateTempSubdirectory("resonance-logfilereader");

        try
        {
            var path = HotFileName(dir, "20260801");
            var baseTime = DateTime.Parse("2026-08-01T00:00:00.000Z").ToUniversalTime();

            var backlog = string.Concat(Enumerable.Range(0, 2_000)
                .Select(i => Line(baseTime.AddSeconds(i).ToString("yyyy-MM-ddTHH:mm:ss.fffZ"), "Information", $"entry {i}") + "\n"));

            File.WriteAllText(path, backlog);

            var (initial, initialTotal) = Query(dir.FullName, limit: 2_000);
            Assert.Equal(2_000, initialTotal);

            // Strictly after the newest already-loaded record (rather than equal to it) so this
            // exercises the same not-inclusive-of-what's-already-loaded shape as a real tail poll,
            // without also having to account for the inclusive boundary re-send the UI dedupes.
            var pollFrom = initial[0].Timestamp.AddMilliseconds(500);

            File.AppendAllText(path, Line(baseTime.AddSeconds(2_000).ToString("yyyy-MM-ddTHH:mm:ss.fffZ"), "Warning", "fresh") + "\n");

            var (polled, polledTotal) = Query(dir.FullName, from: pollFrom, limit: 200);

            Assert.Equal(1, polledTotal);
            Assert.Equal("fresh", polled[0].Message);
        }
        finally
        {
            dir.Delete(recursive: true);
        }
    }

    [Fact]
    public void Query_UnfilteredInitialLoad_ReturnsExactTotal_AcrossManyRolledOverFiles()
    {
        var dir = Directory.CreateTempSubdirectory("resonance-logfilereader");

        try
        {
            // Three rolled-over (non-hot) days plus a hot day, none individually huge, but the
            // page-fills-from-the-newest-file-alone shape is what exercises the count-only path
            // for everything older -- this proves it still adds up to the exact total, not an
            // approximation, once files beyond the filled page stop being fully parsed.
            for (var day = 1; day <= 3; day++)
            {
                var lines = string.Concat(Enumerable.Range(0, 300)
                    .Select(i => Line($"2026-09-0{day}T{i / 3600:D2}:{i / 60 % 60:D2}:{i % 60:D2}.000Z", "Information", $"day{day} entry {i}") + "\n"));
                File.WriteAllText(HotFileName(dir, $"2026090{day}"), lines);
            }

            var hotLines = string.Concat(Enumerable.Range(0, 10)
                .Select(i => Line($"2026-09-04T00:00:{i:D2}.000Z", "Information", $"hot entry {i}") + "\n"));
            File.WriteAllText(HotFileName(dir, "20260904"), hotLines);

            // The hot day's 10 records alone fill this page, so all three older 300-line days are
            // beyond it -- they only need to contribute to `total`, not to `items`.
            var (items, total) = Query(dir.FullName, limit: 10);

            Assert.Equal(10, items.Count);
            Assert.Equal(910, total); // 10 hot + 3*300 older
            Assert.All(items, r => Assert.StartsWith("hot entry", r.Message));
        }
        finally
        {
            dir.Delete(recursive: true);
        }
    }

    [Fact]
    public void Query_UnfilteredTotal_ExcludesAMalformedTrailingLine_InARolledOverFile_BeyondTheFilledPage()
    {
        var dir = Directory.CreateTempSubdirectory("resonance-logfilereader");

        try
        {
            // An older file whose last line got cut off mid-write (e.g. the process was killed) --
            // ReadFileRecords/TryParseLine would silently drop it, and the count-only fast path
            // (which only fully parses a rolled-over file's *last* line, since that's the only one
            // that could possibly be incomplete) has to agree, or `total` would overcount.
            var olderLines = string.Concat(Enumerable.Range(0, 5)
                .Select(i => Line($"2026-09-01T00:00:0{i}.000Z", "Information", $"entry {i}") + "\n"));
            olderLines += """{"Timestamp":"2026-09-01T00:00:06.000Z","Level":"Information","Proper""";
            File.WriteAllText(HotFileName(dir, "20260901"), olderLines);

            var hotLines = string.Concat(Enumerable.Range(0, 5)
                .Select(i => Line($"2026-09-02T00:00:0{i}.000Z", "Information", $"hot entry {i}") + "\n"));
            File.WriteAllText(HotFileName(dir, "20260902"), hotLines);

            // Page fills entirely from the hot day, so the older day takes the count-only path.
            var (items, total) = Query(dir.FullName, limit: 5);

            Assert.Equal(5, items.Count);
            Assert.Equal(10, total); // 5 hot + 5 valid older (the truncated 6th line excluded)
        }
        finally
        {
            dir.Delete(recursive: true);
        }
    }
}
