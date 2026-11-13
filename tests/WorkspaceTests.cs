using Dapper;
using System.Data.Common;
using Microsoft.Data.Sqlite;
using resonance;
using resonance.Analysis;
using resonance.Analysis.Candidates;
using resonance.Common;
using resonance.MusicLibrary;
using resonance.MusicLibrary.Workspace;

[Collection("Music path configuration")]
public class WorkspaceTests : IDisposable
{
    private readonly string previousRoot = MusicPath.Root;
    private readonly string root = Path.Combine(Path.GetTempPath(), "resonance-workspace-" + Guid.NewGuid().ToString("N"));
    private readonly string connection;
    private readonly bool postgres;
    private string CacheTable => postgres ? "analysis.track_analysis" : "track_analysis";
    private readonly WorkspaceStore store;
    private readonly MusicRepository repository;
    private readonly FakeAnalysis analysis = new();
    private PreparationService Service => new(store,repository,null!,analysis,new(null!,null!,null!,null!));
    private static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    public WorkspaceTests()
    {
        Directory.CreateDirectory(root); MusicPath.Configure(root);
        var postgresConnection = Environment.GetEnvironmentVariable("RESONANCE_WORKSPACE_TEST_POSTGRES");
        postgres = !string.IsNullOrEmpty(postgresConnection);
        connection = postgresConnection ?? $"Data Source={Path.Combine(root,"test.db")}";
        if (postgres)
        {
            if (!new Npgsql.NpgsqlConnectionStringBuilder(connection).Database!.StartsWith("resonance_workspace_test")) throw new Exception("Only a dedicated workspace test database is allowed.");
            using var clean=Db();clean.Execute("DROP SCHEMA IF EXISTS music CASCADE; DROP SCHEMA IF EXISTS analysis CASCADE; DROP SCHEMA IF EXISTS library_activity CASCADE");
        }
        repository = new(connection,postgres); repository.Initialize(); _ = new AnalysisStore(connection,postgres);
        store = new(new(new Dictionary<Database,ConnectionString> { [Database.Music]=connection },postgres));
        using var db = Db();
        if(postgres)db.Execute("CREATE SCHEMA library_activity");
        db.Execute($"CREATE TABLE {(postgres ? "library_activity." : "")}\"PlayHistory\" (\"Id\" TEXT,\"Path\" TEXT,\"Username\" TEXT,\"PlayedAt\" BIGINT); CREATE TABLE {(postgres ? "library_activity." : "")}\"LovedTracks\" (\"Path\" TEXT,\"Username\" TEXT)");
    }
    [Fact]
    public void SelectedScanMetadataIsBoundedAndHandlesEmptyAndBatchedSelections()
    {
        var selected = Add("selected.mp3");
        var other = Add("other.mp3");
        using var db = Db();
        db.Execute($"INSERT INTO {CacheTable}(masked_filename,file_size,num_bars,lufs,detected_bpm,detected_key,analysed_at) VALUES(@path,100,1,-9,128,'Am',0)", new { path = selected.Path });
        db.Execute($"INSERT INTO {CacheTable}(masked_filename,file_size,detected_bpm,analysed_at) VALUES(@path,100,-1,0)", new { path = other.Path });
        var analysisStore = new AnalysisStore(connection, postgres);
        var paths = Enumerable.Range(0, 201).Select(index => $"missing-{index}.mp3").Append(selected.Path).Append(selected.Path).ToArray();
        var status = analysisStore.GetStatusMap(paths);
        Assert.True(Assert.Single(status).Value.HasWaveform);
        Assert.Equal(-9, status[selected.Path].Lufs);
        var tags = Assert.Single(analysisStore.GetDetectedTags(paths)).Value;
        Assert.Equal(128u, tags.Bpm);
        Assert.Equal("Am", tags.Key);
        Assert.Empty(analysisStore.GetStatusMap([]));
        Assert.Empty(analysisStore.GetDetectedTags([]));
    }

    [Fact]
    public void CoverageKeepsTagPrecedenceAndRejectsStaleCacheFallbacks()
    {
        var tagged = Add("coverage/tagged.mp3");
        var fallback = Add("coverage/fallback.mp3", bpm: 0);
        var stale = Add("coverage/stale.mp3", bpm: 0);
        using var db = Db();
        db.Execute("UPDATE " + (postgres ? "music.tracks" : "tracks") + " SET key_sig = NULL WHERE path <> @path", new { path = tagged.Path });
        foreach (var track in new[] { tagged, fallback, stale })
        {
            db.Execute($"INSERT INTO {CacheTable} (masked_filename,file_size,analysed_at,overall_peaks,lufs,dj_summary) VALUES(@path,@size,0,@peaks,-9,@summary)",
                new { path = track.Path, size = track == stale ? 99 : 100, peaks = new byte[] { 1 }, summary = "{\"bpm\":128,\"key\":\"Am\"}" });
        }
        var stats = repository.GetAnalysisStats();
        Assert.Equal(3, stats.Total);
        Assert.Equal(2, stats.Keyed);
        Assert.Equal(2, stats.Bpmed);
        Assert.Equal(2, stats.Complete);
        Assert.Equal(2, repository.GetFolders(analysis: "complete").Sum(folder => folder.TrackCount));
        Assert.Equal(1, repository.GetFolders(analysis: "incomplete").Sum(folder => folder.TrackCount));
        var rows = repository.Query(null!, null!, null!, null!, null!, null!, false, false, false, false, false, 10, 0, analysis: "incomplete");
        Assert.Equal(MusicPath.ToAbsolute(stale.Path), Assert.Single(rows.Tracks).Path);
    }

    [Fact]
    public void EnhancedCoverageUsesCurrentIndexedTracksWithoutOpeningAudioFiles()
    {
        var valid = Add("coverage/current.mp3");
        Add("coverage/stale.mp3");
        const string summary = """{"complete":true,"coverageVersion":1,"coverage":{"beats":true,"downbeats":true,"vocals":true,"stems":false,"sections":false,"phrases":false,"genre":true,"energy":true,"cues":false,"loops":false,"similarity":true}}""";
        using var db = Db();
        foreach (var (path, size) in new[] { (valid.Path, 100), ("coverage/stale.mp3", 99), ("coverage/deleted.mp3", 100) })
        {
            db.Execute($"INSERT INTO {CacheTable} (masked_filename,file_size,analysed_at,dj_summary) VALUES(@path,@size,0,@summary)", new { path, size, summary });
        }
        var stats = repository.GetAnalysisStats();
        Assert.Equal(2, stats.Total);
        Assert.Equal(1, stats.Enhanced.Saved);
        Assert.Equal(1, stats.Enhanced.Complete);
        Assert.Equal(1, stats.Enhanced.Features["beats"]);
        Assert.Equal(0, stats.Enhanced.Features["stems"]);
        Assert.False(File.Exists(Path.Combine(root, valid.Path)));
    }

    [Fact]
    public void FolderTotalsMatchFilteredTrackQueriesWithoutLoadingTracks()
    {
        var ready = Add("parent/ready.mp3");
        Add("parent/incomplete.mp3", bpm: 0);
        Add("parent/child/other.mp3");
        Complete(ready.Path);
        Assert.Equal(3, repository.GetFolders().Sum(folder => folder.TrackCount));
        Assert.Equal(1, repository.GetFolders(analysis: "complete").Single().TrackCount);
        Assert.Equal(2, repository.GetFolders(analysis: "incomplete").Sum(folder => folder.TrackCount));
        Assert.Equal(1, repository.GetFolders(analysis: "enhanced").Sum(folder => folder.TrackCount));
        Assert.Equal(2, repository.GetFolders(analysis: "pending").Sum(folder => folder.TrackCount));
        Assert.EndsWith("parent/child", repository.GetFolders(search: "other.mp3").Single().Path.Replace('\\', '/'));
        Assert.Empty(repository.GetFolders(search: "' OR 1=1 --"));
    }

    [Fact]
    public void FolderFileTypesCountDirectTracksAndRespectFilters()
    {
        Add("parent/one.mp3");
        repository.Upsert(Add("parent/two.flac") with { Extension = "FLAC" });
        repository.Upsert(Add("parent/three.flac") with { Extension = ".flac" });
        repository.Upsert(Add("parent/child/four.wav") with { Extension = "wav" });

        var folders = repository.GetFolders();
        var parent = folders.Single(folder => folder.Name == "parent");
        Assert.Equal(3, parent.TrackCount);
        Assert.Equal(1, parent.FileTypes["MP3"]);
        Assert.Equal(2, parent.FileTypes["FLAC"]);
        Assert.Equal(1, folders.Single(folder => folder.Name == "child").FileTypes["WAV"]);

        var matching = Assert.Single(repository.GetFolders(search: "two.flac"));
        Assert.Equal(1, matching.TrackCount);
        Assert.Equal(1, matching.FileTypes["FLAC"]);
    }

    [Fact]
    public void ExactFolderWindowsExcludeDescendantsWhileExistingRecursiveQueriesArePreserved()
    {
        Add("parent/one.mp3");
        Add("parent/child/two.mp3");
        var directory = Path.Combine(root, "parent");
        var recursive = repository.Query(null!, null!, null!, null!, null, directory, false, false, false, false, false, 100, 0);
        var direct = repository.Query(null!, null!, null!, null!, null, directory, false, false, false, false, false, 100, 0, recursive: false);
        Assert.Equal(2, recursive.Total);
        Assert.Equal(1, direct.Total);
        Assert.EndsWith("one.mp3", direct.Tracks.Single().Path);
    }

    private DbConnection Db() { DbConnection db = postgres ? new Npgsql.NpgsqlConnection(connection) : new SqliteConnection(connection); db.Open(); return db; }
    private MusicTrack Add(string path="nested/a.mp3", int bpm=128, long? added=null)
    {
        var track=new MusicTrack(path,Path.GetFileName(path),Path.GetDirectoryName(path) ?? string.Empty,"mp3",100,1,added??Now,120,"Track "+path,"Artist",null!,"Album",2026,1,1,"Trance",bpm,"Am",null!,false,"ID3",320,44100,16);
        repository.Upsert(track);return track;
    }
    private MusicLibraryQueryResult Query(SmartCrateRules rules,string user="alice",int limit=100,int offset=0) => repository.Query(null!,null!,null!,rules.Genre,null!,rules.Folder,false,false,false,false,false,limit,offset,"title",analysis:rules.Analysis,dj:rules.Filters(user,DateTimeOffset.UtcNow));
    private void Complete(string path, bool enhanced=true)
    {
        using var db=Db();
        db.Execute($"INSERT INTO {CacheTable} (masked_filename,file_size,overall_peaks,lufs,analysed_at,dj_summary) VALUES (@path,100,@peaks,-8,@now,@summary) ON CONFLICT(masked_filename) DO UPDATE SET overall_peaks=excluded.overall_peaks,lufs=excluded.lufs,dj_summary=excluded.dj_summary",new { path,peaks=new byte[]{1,2,3},now=Now,summary=enhanced?"{\"complete\":true,\"vocals\":false,\"genre\":\"Trance\",\"energy\":0.2}":null });
    }
    [Fact] public void DiscoveryNotesPersistPerAccountAndRejectStaleEdits()
    {
        var saved = store.SaveTrackPreparation("alice", new("nested/a.mp3", "opener", "Intro works", [new("cue", 42, "Bass enters")]));
        Assert.Equal(1, saved.Revision);
        Assert.Empty(store.ListTrackPreparation("bob"));
        var reopened = new WorkspaceStore(new(new Dictionary<Database,ConnectionString>{[Database.Music]=connection},postgres));
        Assert.Equal(42, reopened.ListTrackPreparation("alice").Single().Bookmarks.Single().Seconds);
        var updated = reopened.SaveTrackPreparation("alice", saved with { Notes = "Desktop edit" });
        Assert.Equal(2, updated.Revision);
        Assert.Throws<InvalidOperationException>(() => store.SaveTrackPreparation("alice", saved));
        Assert.Throws<InvalidOperationException>(() => store.SaveTrackPreparation("alice", saved with { Revision = 0 }));
        Assert.Throws<ArgumentException>(() => store.SaveTrackPreparation("alice", saved with { Bookmarks = [new("bad", double.NaN, "Invalid")] }));
    }
    [Fact] public void AutoCuesPreserveManualBookmarksAndRemainAccountScoped()
    {
        store.SaveTrackPreparation("alice", new("nested/a.mp3", "opener", "Keep this note", [new("manual", 10, "My cue")]));
        var saved = store.SaveAutoCues("alice", "nested/a.mp3", [10.2, 30, 45]);
        Assert.Equal("Keep this note", saved.Notes);
        Assert.Equal(3, saved.Bookmarks.Length);
        Assert.Equal("My cue", saved.Bookmarks[0].Label);
        Assert.Equal([30.0, 45.0], store.AutoCues("alice", "nested/a.mp3").Select(cue => cue.Seconds).ToArray());
        Assert.Empty(store.AutoCues("bob", "nested/a.mp3"));
        saved = store.SaveAutoCues("alice", "nested/a.mp3", [60]);
        Assert.Equal([60.0], store.AutoCues("alice", "nested/a.mp3").Select(cue => cue.Seconds).ToArray());
        Assert.Equal("My cue", saved.Bookmarks[0].Label);
    }
    [Fact] public void WantedSearchesAreAccountScopedAndDeletionsCannotCrossAccounts()
    {
        var wish = store.AddWish("alice", "  Artist release  ");
        Assert.Equal("Artist release", wish.Query);
        Assert.Empty(store.ListWishes("bob"));
        store.DeleteWish("bob", wish.Id);
        Assert.Single(store.ListWishes("alice"));
        store.DeleteWish("alice", wish.Id);
        Assert.Empty(store.ListWishes("alice"));
        Assert.Throws<ArgumentException>(() => store.AddWish("alice", " "));
    }
    [Fact] public void CratesPersistPerAccountAndDetectConflictingEdits()
    {
        var crate=store.SaveCrate("alice",null!,new("My set","",new(BpmMin:125,BpmMax:130)));
        Assert.DoesNotContain(store.ListCrates("bob"),row=>row.Id==crate.Id);
        var reloaded=new WorkspaceStore(new(new Dictionary<Database,ConnectionString>{[Database.Music]=connection},postgres));
        Assert.Equal(125,reloaded.FindCrate("alice",crate.Id).Rules.BpmMin);
        var updated=reloaded.SaveCrate("alice",crate.Id,new("Updated","",crate.Rules,crate.Revision));
        Assert.Equal(2,updated.Revision);
        Assert.Throws<InvalidOperationException>(()=>store.SaveCrate("alice",crate.Id,new("Stale","",crate.Rules,crate.Revision)));
        Assert.False(store.DeleteCrate("bob",crate.Id,2)); Assert.False(store.DeleteCrate("alice",crate.Id,1));
        Assert.True(store.DeleteCrate("alice",crate.Id,2)); Assert.Null(store.FindCrate("alice",crate.Id));
    }
    [Theory][InlineData(10,130)][InlineData(125,500)][InlineData(140,120)]
    public void InvalidTempoRulesAreRejected(double minimum,double maximum) => Assert.Throws<ArgumentException>(()=>new SmartCrateRules(BpmMin:minimum,BpmMax:maximum).Validated());
    [Fact] public void RulesFilterAllPagesAndUpdateAsTracksArrive()
    {
        for(var i=0;i<205;i++) Add($"nested/{i:D3}.mp3",128);
        var rules=new SmartCrateRules(BpmMin:125,BpmMax:130);
        var first=Query(rules,limit:200);var second=Query(rules,limit:200,offset:200);
        Assert.Equal(205,first.Total);Assert.Equal(5,second.Tracks.Count);Assert.Empty(first.Tracks.Select(t=>t.Path).Intersect(second.Tracks.Select(t=>t.Path)));
        Add("nested/new.mp3",127);Add("nested/outside.mp3",140);Assert.Equal(206,Query(rules).Total);
        repository.DeletePaths(["nested/new.mp3"]);Assert.Equal(205,Query(rules).Total);
    }
    [Fact] public void PlayHistoryAndLovedRulesRespectTheCurrentAccount()
    {
        Add("a.mp3");Add("b.mp3");
        using var db=Db();db.Execute($"INSERT INTO {(postgres ? "library_activity." : "")}\"PlayHistory\" VALUES ('1','a.mp3','bob',@now); INSERT INTO {(postgres ? "library_activity." : "")}\"LovedTracks\" VALUES ('a.mp3','bob')",new {now=Now});
        Assert.Equal(2,Query(new(NeverPlayed:true),"alice").Total);Assert.Equal(1,Query(new(NeverPlayed:true),"bob").Total);
        Assert.Equal(0,Query(new(LovedOnly:true),"alice").Total);Assert.Equal(1,Query(new(LovedOnly:true),"bob").Total);
        Assert.Equal(1,Query(new(NotPlayedWithinDays:30),"bob").Total);
    }
    [Fact] public void DateFolderAndUnknownVoiceRulesAreAccurate()
    {
        Add("nested/a.mp3");Add("nested/deep/b.mp3",128,Now-40L*86400000);Add("other/c.mp3");Complete("nested/a.mp3");
        Assert.Equal(2,Query(new(AddedWithinDays:30)).Total);Assert.Equal(2,Query(new(Folder:"nested")).Total);
        Assert.Equal(1,Query(new(Vocals:"no")).Total);
        Assert.Equal(0,Query(new(Vocals:"yes")).Total);
    }
    [Fact] public void FolderRulesTreatPercentAndUnderscoreAsLiteralNames()
    {
        Add("Trance_100%/deep/a.mp3");Add("TranceX100anything/deep/b.mp3");
        Assert.Equal(1,Query(new(Folder:"Trance_100%")).Total);
    }
    [Fact] public void SavedFolderRulesRemainRelativeWhenTheLibraryMoves()
    {
        Add("nested/deep/a.mp3");
        var crate=store.SaveCrate("alice",null!,new("Nested","",new(Folder:Path.Combine(root,"nested"))));
        Assert.Equal("nested",store.FindCrate("alice",crate.Id).Rules.Folder);
        MusicPath.Configure(Path.Combine(root,"moved"));
        Assert.Equal(1,Query(crate.Rules).Total);
        Assert.Throws<ArgumentException>(()=>store.SaveCrate("alice",null!,new("Outside","",new(Folder:"../outside"))));
    }
    [Fact] public async Task BusyAndPlaybackDoNotConsumeOrDropQueuedTracks()
    {
        Add();var service=Service;service.Reconcile();
        analysis.ScanState=new(true,false,false,1,0,0,0,0);await service.ProcessNext(default);
        Assert.Equal("queued",store.Find("nested/a.mp3").State);Assert.Equal(0,analysis.Starts);
        analysis.ScanState=new(false,false,false,0,0,0,0,0);analysis.PlaybackActive=true;await service.ProcessNext(default);
        Assert.Equal(0,store.Find("nested/a.mp3").Attempts);
        analysis.PlaybackActive=false;analysis.OnStart=()=>Complete("nested/a.mp3",false);await service.ProcessNext(default);
        Assert.Equal(1,analysis.Starts);Assert.Equal("basic",store.Find("nested/a.mp3").State);
    }
    [Fact] public async Task AScanRacePreservesRetryBudget()
    {
        Add();var service=Service;service.Reconcile();analysis.Reject=true;await service.ProcessNext(default);
        Assert.Equal("queued",store.Find("nested/a.mp3").State);Assert.Equal(0,store.Find("nested/a.mp3").Attempts);
    }
    [Fact] public async Task UnexpectedStartFailureDoesNotLeaveTheQueueRunningForever()
    {
        Add();var service=Service;service.Reconcile();analysis.OnStart=()=>throw new IOException("Interrupted");await service.ProcessNext(default);
        Assert.Equal("retrying",store.Find("nested/a.mp3").State);Assert.Equal(1,store.Find("nested/a.mp3").Attempts);
    }
    [Fact] public void InterruptedAttemptsHaveAFiniteBudgetAcrossRestarts()
    {
        Add();store.Put(new("nested/a.mp3",100,1,"running",3,0,"",Now));store.RecoverInterrupted();
        Assert.Equal("failed",store.Find("nested/a.mp3").State);Assert.Null(store.Due(Now));
    }
    [Fact] public async Task FailedAnalysisRetriesThreeTimesThenStopsUntilRequested()
    {
        Add();var service=Service;service.Reconcile();
        for(var i=1;i<=3;i++)
        {
            await service.ProcessNext(default);var row=store.Find("nested/a.mp3");Assert.Equal(i,row.Attempts);
            Assert.Equal(i==3?"failed":"retrying",row.State);
            store.Put(row with { NextAttemptAt=0 });
        }
        await service.ProcessNext(default);Assert.Equal(3,analysis.Starts);
        service.Reconcile();Assert.Equal("failed",store.Find("nested/a.mp3").State);
        service.Retry("nested/a.mp3");Assert.Equal(0,store.Find("nested/a.mp3").Attempts);
    }
    [Fact] public async Task PauseAndCancelledScanAreRespected()
    {
        Add();var service=Service;service.Reconcile();store.Paused=true;await service.ProcessNext(default);Assert.Equal(0,analysis.Starts);
        store.Paused=false;analysis.Cancelled=true;await service.ProcessNext(default);
        Assert.True(store.Paused);Assert.Equal("queued",store.Find("nested/a.mp3").State);Assert.Equal(0,store.Find("nested/a.mp3").Attempts);
    }
    [Fact] public async Task MissingPackagesPauseTheQueueAndExposeTheFailureWithoutConsumingRetries()
    {
        Add();var service=Service;service.Reconcile();analysis.DependencyFailure=true;
        await service.ProcessNext(default);
        Assert.True(store.Paused);
        Assert.Equal("failed",store.Find("nested/a.mp3").State);
        Assert.Equal(0,store.Find("nested/a.mp3").Attempts);
        Assert.Contains("Essentia",store.Find("nested/a.mp3").Detail);
        Assert.Equal(analysis.ScanState.Error,service.DependencyError);
        Assert.Equal(analysis.ScanState.Error,service.WaitingReason);
        await service.ProcessNext(default);Assert.Equal(1,analysis.Starts);
    }
    [Fact] public void RestartRecoveryAndCombinedFiltersAgreeWithCounts()
    {
        Add();store.Put(new("nested/a.mp3",100,1,"running",1,0,"",Now));store.RecoverInterrupted();
        Assert.Equal("queued",store.Find("nested/a.mp3").State);Assert.Equal(1,store.Page("waiting",null!,50,0).Total);
        Complete("nested/a.mp3");Service.Reconcile();Assert.Equal(1,store.Page("analysed",null!,50,0).Total);
        repository.DeletePaths(["nested/a.mp3"]);Service.Reconcile();Assert.Empty(store.Counts());
    }
    [Fact] public async Task ExistingAnalysisAndChangedFilesAreHandledWithoutResettingResults()
    {
        var track=Add();Complete("nested/a.mp3");var service=Service;service.Reconcile();await service.ProcessNext(default);
        Assert.Equal(0,analysis.Starts);Assert.Equal("complete",store.Find("nested/a.mp3").State);
        repository.Upsert(track with {FileSize=101,FileModified=2});service.Reconcile();Assert.Equal("queued",store.Find("nested/a.mp3").State);
        using var db=Db();Assert.Equal(1,db.ExecuteScalar<int>($"SELECT COUNT(*) FROM {CacheTable}"));
        Assert.Throws<ArgumentException>(()=>service.Retry("../../outside.mp3"));
    }
    [Fact] public void PreparationPagesKeepTheirCursorWhenEarlierRowsAreDeletedAndTitlesTie()
    {
        foreach (var name in new[] { "a", "b", "c", "d", "e" })
            repository.Upsert(Add($"nested/{name}.mp3") with { Title = "Same title" });
        var first = repository.GetPreparationPage(limit: 2);
        Assert.Equal(new[] { "nested/a.mp3", "nested/b.mp3" }, first.Select(t => MusicPath.ToRelative(t.Path)));
        repository.DeletePaths(["nested/a.mp3"]);
        Add("nested/c'quoted.mp3");
        var rest = new List<MusicTrack>();
        var cursor = first[^1].Path;
        while (true)
        {
            var page = repository.GetPreparationPage(cursor, 2);
            if (page.Count == 0) break;
            rest.AddRange(page);
            cursor = page[^1].Path;
        }
        Assert.Equal(new[] { "nested/c'quoted.mp3", "nested/c.mp3", "nested/d.mp3", "nested/e.mp3" }, rest.Select(t => MusicPath.ToRelative(t.Path)).OrderBy(p => p, StringComparer.Ordinal));
        Assert.Throws<ArgumentOutOfRangeException>(() => repository.GetPreparationPage(limit: 0));
        Assert.Throws<ArgumentOutOfRangeException>(() => repository.GetPreparationPage(limit: 2001));
    }
    [Fact] public void PreparationPagesMatchLibraryCacheFallbacksAndRejectStaleAnalysis()
    {
        foreach (var name in new[] { "cached", "tagged", "stale" })
        {
            var track = Add($"nested/{name}.mp3", 0);
            repository.Upsert(track with { Key = null! });
            Complete($"nested/{name}.mp3");
        }
        repository.Upsert(Add("nested/tagged.mp3", 140) with { Key = "F#m" });
        using (var db = Db())
        {
            db.Execute($"UPDATE {CacheTable} SET detected_bpm=127,detected_key='G#'");
            db.Execute($"UPDATE {CacheTable} SET file_size=99 WHERE masked_filename='nested/stale.mp3'");
        }
        var expected = repository.Query(null!, null!, null!, null!, null!, null!, false, false, false, false, false, 100, 0).Tracks.ToDictionary(t => t.Path);
        var tracks = repository.GetPreparationPage().ToDictionary(t => MusicPath.ToRelative(t.Path));
        Assert.All(tracks.Values, t => Assert.Equal(expected[t.Path], t));
        Assert.Equal(127, tracks["nested/cached.mp3"].Bpm);
        Assert.Equal("G#", tracks["nested/cached.mp3"].Key);
        Assert.Equal(140, tracks["nested/tagged.mp3"].Bpm);
        Assert.Equal("F#m", tracks["nested/tagged.mp3"].Key);
        Assert.False(tracks["nested/stale.mp3"].HasWaveform);
        Assert.Null(tracks["nested/stale.mp3"].Lufs);
        Assert.Null(tracks["nested/stale.mp3"].Bpm);
        Assert.Null(tracks["nested/stale.mp3"].Key);
    }
    [Fact] public void ReconciliationCrossesPageBoundariesAndHonoursCancellation()
    {
        for (var i = 0; i < 503; i++) Add($"nested/{i:D4}.mp3");
        var service = Service;
        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();
        Assert.Throws<OperationCanceledException>(() => service.Reconcile(cancelled.Token));
        Assert.Empty(store.Counts());
        Assert.Equal(0, service.LastCheckedAt);
        service.Reconcile();
        Assert.Equal(503, store.Counts()["queued"]);
        Assert.NotNull(store.Find("nested/0502.mp3"));
        Assert.True(service.LastCheckedAt > 0);
        service.Reconcile();
        Assert.Equal(503, store.Counts()["queued"]);
    }
    [Fact] public async Task AutomaticBatchFillsCpuSlotsAndLeavesRemainingTracksQueued()
    {
        foreach (var name in new[] { "a", "b", "c" }) Add($"nested/{name}.mp3");
        var service = new PreparationService(store, repository, null!, analysis, new(null!, null!, null!, null!)) { BatchSize = 2 };
        service.Reconcile();
        analysis.OnStart = () =>
        {
            Assert.Equal(analysis.LastRequest!.OnlyPaths!.Length, store.Counts()["running"]);
            foreach (var path in analysis.LastRequest.OnlyPaths) Complete(MusicPath.ToRelative(path), false);
        };
        await service.ProcessNext(default);
        Assert.Equal(2, analysis.LastRequest!.OnlyPaths!.Length);
        Assert.Equal(1, analysis.Starts);
        Assert.Equal(2, store.Counts()["basic"]);
        Assert.Equal("queued", store.Find("nested/c.mp3").State);
        Assert.Equal(0, store.Find("nested/c.mp3").Attempts);
        await service.ProcessNext(default);
        Assert.Single(analysis.LastRequest.OnlyPaths!);
        Assert.Equal(2, analysis.Starts);
        Assert.Equal(3, store.Counts()["basic"]);
    }
    [Fact] public async Task AutomaticModePersistsAndChangesTheNextBatchWithoutDiscardingBasicResults()
    {
        Add("nested/a.mp3");
        var worker = new CandidateAnalysisOptions("python", "worker.py", "config.json", "results");
        var service = new PreparationService(store, repository, null!, analysis, worker);
        Assert.Equal("enhanced", service.Mode);
        service.SetMode("basic");
        var reopened = new WorkspaceStore(new(new Dictionary<Database,ConnectionString> { [Database.Music] = connection }, postgres));
        Assert.Equal("basic", reopened.PreparationMode);
        service.Reconcile();
        analysis.OnStart = () => Complete("nested/a.mp3", false);
        await service.ProcessNext(default);
        Assert.False(analysis.LastRequest!.Enhanced);
        Assert.Equal("basic", store.Find("nested/a.mp3").State);

        service.SetMode("enhanced");
        service.Reconcile();
        Assert.Equal("queued", store.Find("nested/a.mp3").State);
        analysis.OnStart = () => Complete("nested/a.mp3", true);
        await service.ProcessNext(default);
        Assert.True(analysis.LastRequest!.Enhanced);
        Assert.Equal("complete", store.Find("nested/a.mp3").State);
        Assert.Equal("enhanced", reopened.PreparationMode);
    }
    [Fact] public void AutomaticModeRejectsUnavailableEnhancedWorkerAndInvalidValues()
    {
        var service = Service;
        Assert.Equal("basic", service.Mode);
        Assert.Throws<InvalidOperationException>(() => service.SetMode("enhanced"));
        Assert.Throws<ArgumentException>(() => service.SetMode("other"));
        Assert.Equal("basic", service.Mode);
    }
    [Fact] public async Task CustomBackgroundModePersistsAndRunsSelectedFeaturesWithoutScanningOtherTracks()
    {
        Add("nested/a.mp3");
        Add("nested/other.mp3");
        var worker = new CandidateAnalysisOptions("python", "worker.py", "config.json", "results");
        var service = new PreparationService(store, repository, null!, analysis, worker) { BatchSize = 1 };
        service.SetMode("custom", ["beats", "genre"], true, "alice");
        var reopened = new WorkspaceStore(new(new Dictionary<Database, ConnectionString> { [Database.Music] = connection }, postgres));
        Assert.Equal("custom", reopened.PreparationMode);
        Assert.Equal(["beats", "genre", "cues"], reopened.PreparationSettings.Features);
        Assert.Equal("alice", reopened.PreparationSettings.CueUsername);
        Assert.Throws<ArgumentException>(() => service.SetMode("custom", []));
        Assert.Throws<ArgumentException>(() => service.SetMode("custom", ["beats"], true));
        service.Reconcile();
        analysis.OnStart = () =>
        {
            var path = MusicPath.ToRelative(analysis.LastRequest!.OnlyPaths![0]);
            using var db = Db();
            db.Execute($"INSERT INTO {CacheTable} (masked_filename,file_size,overall_peaks,lufs,analysed_at,dj_summary) VALUES (@path,100,@peaks,-8,@now,@summary) ON CONFLICT(masked_filename) DO UPDATE SET overall_peaks=excluded.overall_peaks,lufs=excluded.lufs,dj_summary=excluded.dj_summary",
                new { path, peaks = new byte[] { 1, 2, 3 }, now = Now, summary = "{\"availableFeatures\":[\"beats\",\"genre\",\"cues\"]}" });
        };
        await service.ProcessNext(default);
        Assert.Single(analysis.LastRequest!.OnlyPaths!);
        Assert.True(analysis.LastRequest.Enhanced);
        Assert.Equal(["beats", "genre", "cues"], analysis.LastRequest.EnhancedFeatures);
        Assert.True(analysis.LastRequest.WriteAutoCues);
        Assert.Equal("alice", analysis.LastRequest.CueUsername);
        var scanned = MusicPath.ToRelative(analysis.LastRequest.OnlyPaths[0]);
        Assert.Equal("selected", store.Find(scanned).State);
        Assert.Equal("queued", store.Find(scanned == "nested/a.mp3" ? "nested/other.mp3" : "nested/a.mp3").State);
        service.SetMode("custom", ["stems"]);
        service.Reconcile();
        Assert.Equal("queued", store.Find(scanned).State);
    }
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task StoppedBatchKeepsCompletedTracksAndRestoresUnfinishedRetryBudgets(bool dependency)
    {
        foreach (var name in new[] { "a", "b", "c" }) Add($"nested/{name}.mp3");
        var service = new PreparationService(store, repository, null!, analysis, new(null!, null!, null!, null!)) { BatchSize = 2 };
        service.Reconcile();
        analysis.OnStart = () => Complete("nested/a.mp3", false);
        analysis.DependencyFailure = dependency;
        analysis.Cancelled = !dependency;
        await service.ProcessNext(default);
        Assert.True(store.Paused);
        Assert.Equal("basic", store.Find("nested/a.mp3").State);
        Assert.Equal(1, store.Find("nested/a.mp3").Attempts);
        Assert.Equal(dependency ? "failed" : "queued", store.Find("nested/b.mp3").State);
        Assert.Equal(0, store.Find("nested/b.mp3").Attempts);
        Assert.Equal("queued", store.Find("nested/c.mp3").State);
        await service.ProcessNext(default);
        Assert.Equal(1, analysis.Starts);
    }
    [Fact] public async Task FailedTrackInBatchDoesNotDiscardOtherTracksOrSpendTheirRetries()
    {
        Add("nested/a.mp3"); Add("nested/b.mp3");
        var service = new PreparationService(store, repository, null!, analysis, new(null!, null!, null!, null!)) { BatchSize = 2 };
        service.Reconcile();
        analysis.OnStart = () => Complete("nested/a.mp3", false);
        await service.ProcessNext(default);
        Assert.False(store.Paused);
        Assert.Equal("basic", store.Find("nested/a.mp3").State);
        Assert.Equal("retrying", store.Find("nested/b.mp3").State);
        Assert.Equal(1, store.Find("nested/b.mp3").Attempts);
    }
    [Fact] public async Task RejectedBatchRestoresEveryQueueRecordWithoutSpendingRetries()
    {
        Add("nested/a.mp3"); Add("nested/b.mp3");
        var service = new PreparationService(store, repository, null!, analysis, new(null!, null!, null!, null!)) { BatchSize = 2 };
        service.Reconcile();
        var before = store.DueBatch(Now, 2);
        analysis.Reject = true;
        await service.ProcessNext(default);
        Assert.Equal(before, store.DueBatch(Now, 2));
        Assert.Equal(0, analysis.Starts);
    }
    [Fact] public async Task PauseDuringBatchFinishesItsTracksButDoesNotStartTheNextGroup()
    {
        foreach (var name in new[] { "a", "b", "c" }) Add($"nested/{name}.mp3");
        var service = new PreparationService(store, repository, null!, analysis, new(null!, null!, null!, null!)) { BatchSize = 2 };
        service.Reconcile();
        analysis.OnStart = () =>
        {
            store.Paused = true;
            foreach (var path in analysis.LastRequest!.OnlyPaths!) Complete(MusicPath.ToRelative(path), false);
        };
        await service.ProcessNext(default);
        await service.ProcessNext(default);
        Assert.Equal(1, analysis.Starts);
        Assert.Equal(2, store.Counts()["basic"]);
        Assert.Equal("queued", store.Find("nested/c.mp3").State);
    }
    [Fact] public void SetsPersistOrderTemposNotesPerAccountAndDetectConcurrentEdits()
    {
        var a=Add("nested/a.mp3");var b=Add("nested/b.mp3",138);
        var request=new SetPlanRequest("My set",[new(a.Path),new(b.Path,Note:"Swap bass after arrival")],InitialMasterBpm:140,Bars:16,Notes:"Late room");
        var saved=store.SaveSet("alice",null!,request);
        Assert.Equal(new[]{"nested/a.mp3","nested/b.mp3"},saved.Items.Select(item=>item.Path));
        Assert.Null(store.FindSet("bob",saved.Id));Assert.Empty(store.ListSets("bob"));
        var reloaded=new WorkspaceStore(new(new Dictionary<Database,ConnectionString>{[Database.Music]=connection},postgres));
        Assert.Equal(140,reloaded.FindSet("alice",saved.Id).InitialMasterBpm);
        Assert.All(reloaded.FindSet("alice",saved.Id).Items,item=>Assert.Null(item.MasterBpm));
        Assert.Equal("Late room",reloaded.FindSet("alice",saved.Id).Notes);
        var updated=store.SaveSet("alice",saved.Id,request with {Name="Reordered",Items=[new(b.Path),new(a.Path)],Revision=saved.Revision});
        Assert.Equal(2,updated.Revision);Assert.Equal("nested/b.mp3",updated.Items[0].Path);
        Assert.Throws<InvalidOperationException>(()=>store.SaveSet("alice",saved.Id,request with {Revision=1}));
        Assert.Throws<InvalidOperationException>(()=>store.SaveSet("bob",saved.Id,request with {Revision=2}));
        var archived=store.ArchiveSet("alice",saved.Id,updated.Revision,true);Assert.True(archived.Archived);
        Assert.Throws<InvalidOperationException>(()=>store.SaveSet("alice",saved.Id,request with {Revision=archived.Revision}));
        Assert.Throws<InvalidOperationException>(()=>store.ArchiveSet("alice",saved.Id,updated.Revision,false));
        var restored=store.ArchiveSet("alice",saved.Id,archived.Revision,false);Assert.False(restored.Archived);Assert.Equal(4,restored.Revision);
        MusicPath.Configure(Path.Combine(root,"moved"));Assert.Equal("nested/b.mp3",store.FindSet("alice",saved.Id).Items[0].Path);
    }
    [Fact] public void LegacySetCheckpointsAreRetiredWithoutChangingOrderNotesOrRevision()
    {
        var request=new SetPlanRequest("Legacy set",[new("a.mp3"),new("b.mp3",Note:"Bass swap")],InitialMasterBpm:138);
        var saved=store.SaveSet("alice",null!,request);
        var legacy=request with {Items=[new("a.mp3"),new("b.mp3",145,"Bass swap")]};
        using var db=Db();
        var table=postgres ? "music.set_plans" : "set_plans";
        db.Execute($"UPDATE {table} SET document=@document WHERE id=@id",new {document=System.Text.Json.JsonSerializer.Serialize(legacy),id=saved.Id});
        var found=store.FindSet("alice",saved.Id);
        Assert.Equal(1,found.Revision);Assert.Equal(138,found.InitialMasterBpm);
        Assert.Equal(new[]{"a.mp3","b.mp3"},found.Items.Select(item=>item.Path));
        Assert.All(found.Items,item=>Assert.Null(item.MasterBpm));Assert.Equal("Bass swap",found.Items[1].Note);
        var updated=store.SaveSet("alice",saved.Id,request with {Items=found.Items,Revision=found.Revision});
        Assert.Equal(2,updated.Revision);Assert.All(updated.Items,item=>Assert.Null(item.MasterBpm));
    }
    [Theory][InlineData("../outside.mp3")][InlineData("nested/../outside.mp3")][InlineData("C:\\outside.mp3")][InlineData("\\\\server\\outside.mp3")]
    public void SetPathsCannotEscapeOrBecomeAbsoluteAfterAMove(string path) => Assert.Throws<ArgumentException>(()=>new SetPlanRequest("Set",[new(path)]).Validated());
    [Fact] public void SetValidationRejectsInvalidNamesLengthsDuplicateTracksAndTempos()
    {
        var request=new SetPlanRequest("Set",[new("a.mp3")]);
        Assert.Throws<ArgumentException>(()=>(request with {Name=""}).Validated());
        Assert.Throws<ArgumentException>(()=>(request with {Name="Bad\nname"}).Validated());
        Assert.Throws<ArgumentException>(()=>(request with {Bars=7}).Validated());
        Assert.Throws<ArgumentException>(()=>(request with {InitialMasterBpm=double.NaN}).Validated());
        Assert.Throws<ArgumentException>(()=>(request with {Notes=new string('x',2001)}).Validated());
        Assert.Throws<ArgumentException>(()=>(request with {Items=[new("a.mp3"),new("a.mp3")]}).Validated());
        Assert.Throws<ArgumentException>(()=>(request with {Items=[new("a.mp3",128)]}).Validated());
        Assert.Throws<ArgumentException>(()=>(request with {Items=[new("a.mp3"),new("b.mp3",401)]}).Validated());
        Assert.Throws<ArgumentException>(()=>(request with {Items=[new("a.mp3"),new("b.mp3",140)]}).Validated());
        Assert.Throws<ArgumentException>(()=>(request with {Items=Enumerable.Range(0,201).Select(i=>new SetPlanItem($"{i}.mp3")).ToArray()}).Validated());
        Assert.Empty((request with {Items=[]}).Validated().Items);
    }
    [Fact] public void MixtapeSetSnapshotsAreAtomicIdempotentAndKeepOrder()
    {
        var mixtapes=new resonance.Mixtapes.MixtapeRepository(connection,postgres);mixtapes.Initialize();
        var id=Guid.NewGuid().ToString("N");
        var mixtape=new resonance.Mixtapes.Mixtape(id,"Set",null,false,null,Now,Now);
        var rows=new[]{new resonance.Mixtapes.MixtapeTrack(Guid.NewGuid().ToString("N"),id,Path.Combine(root,"b.mp3"),"B","Artist",null,120,0),new resonance.Mixtapes.MixtapeTrack(Guid.NewGuid().ToString("N"),id,Path.Combine(root,"a.mp3"),"A","Artist",null,120,1)};
        Assert.True(mixtapes.InsertSnapshot(mixtape,rows));Assert.False(mixtapes.InsertSnapshot(mixtape,rows));
        Assert.Equal(new[]{"B","A"},mixtapes.GetTracks(id).Select(track=>track.Title));
        var brokenId=Guid.NewGuid().ToString("N");
        var brokenTrack=rows[0] with {Id=Guid.NewGuid().ToString("N"),MixtapeId=brokenId};
        Assert.ThrowsAny<DbException>(()=>mixtapes.InsertSnapshot(mixtape with {Id=brokenId},[brokenTrack,brokenTrack]));
        Assert.Null(mixtapes.GetById(brokenId));Assert.Empty(mixtapes.GetTracks(brokenId));
    }
    [Fact] public void AutomaticCollectionsAppearAfterBasicResultsWithoutEnhancedAnalysis()
    {
        Add();
        Assert.Empty(repository.AutomaticCrates());
        Complete("nested/a.mp3", false);
        var crates = repository.AutomaticCrates();
        Assert.Equal(new[] { "BPM", "Genre", "Key" }, crates.Select(crate => crate.Collection).Order().ToArray());
        Assert.All(crates, crate => Assert.Equal(1, Query(crate.Rules).Total));
        Assert.All(crates, crate => Assert.Equal(1, crate.TrackCount));
        var injected = new WorkspaceStore(new(new Dictionary<Database,ConnectionString> { [Database.Music]=connection },postgres), repository);
        Assert.Equal(3, injected.ListCrates("alice").Count(crate => crate.Collection != null));
    }

    [Fact] public void EnhancedOnlyFactsPopulateCollectionsAndNeverInventVocals()
    {
        var track = Add() with { Bpm = null, Key = null!, Genre = null! };
        repository.Upsert(track);
        using var db = Db();
        db.Execute($"INSERT INTO {CacheTable} (masked_filename,file_size,analysed_at,dj_summary) VALUES (@path,100,@now,@summary)",
            new { path="nested/a.mp3", now=Now, summary="{\"complete\":false,\"genre\":\"Techno\",\"key\":\"Am\",\"bpm\":130.1}" });
        var crates = repository.AutomaticCrates();
        Assert.Equal(3, crates.Count);
        Assert.All(crates, crate => Assert.Equal(crate.TrackCount, Query(crate.Rules).Total));
        Assert.Equal(0, Query(new(Vocals:"no")).Total);
        Assert.Equal(1, Query(new(Keys:["am"])).Total);
    }

    [Fact] public void TempoCollectionsHaveExclusiveUpperBoundsAndExcludeChangedFiles()
    {
        Add("nested/a.mp3",129); Complete("nested/a.mp3",false);
        Add("nested/b.mp3",130); Complete("nested/b.mp3",false);
        var tempo = repository.AutomaticCrates().Where(crate => crate.Collection == "BPM").ToArray();
        Assert.Equal(2, tempo.Length);
        Assert.All(tempo, crate => Assert.Equal(1, Query(crate.Rules).Total));
        var first = tempo.Single(crate => crate.Rules.BpmMin == 120);
        Assert.True(first.Rules.BpmMaxExclusive);
        repository.Upsert(Add("nested/a.mp3",129) with { FileSize = 101 });
        Assert.DoesNotContain(repository.AutomaticCrates(), crate => crate.Id == first.Id);
    }

    [Fact] public void ReanalysisUpdatesMembershipWithoutSavingCratesAgain()
    {
        var track = Add() with { Bpm = null, Key = null! };
        repository.Upsert(track); Complete("nested/a.mp3",false);
        using var db = Db();
        db.Execute($"UPDATE {CacheTable} SET detected_bpm=128,detected_key='Am' WHERE masked_filename='nested/a.mp3'");
        var old = repository.AutomaticCrates().Single(crate => crate.Collection == "BPM");
        db.Execute($"UPDATE {CacheTable} SET detected_bpm=142,detected_key='C' WHERE masked_filename='nested/a.mp3'");
        Assert.Equal(0, Query(old.Rules).Total);
        Assert.Contains(repository.AutomaticCrates(), crate => crate.Collection == "BPM" && crate.Rules.BpmMin == 140);
    }

    public void Dispose() { SqliteConnection.ClearAllPools();Directory.Delete(root,true);MusicPath.Configure(previousRoot); }
    private class FakeAnalysis : IAnalysisService
    {
        public AnalysisScanState ScanState {get;set;}=new(false,false,false,0,0,0,0,0);
        public bool PlaybackActive {get;set;}
        public int Starts;public bool Reject;public bool Cancelled;public bool DependencyFailure;public Action? OnStart;
        public AnalysisScanRequest? LastRequest;
        public Task StartScanAsync(AnalysisScanRequest request) { if(Reject)throw new InvalidOperationException();Starts++;LastRequest=request;Assert.True(request.SkipAnalysed);Assert.False(request.ResetAll);OnStart?.Invoke();ScanState=new(false,!Cancelled&&!DependencyFailure,Cancelled,request.OnlyPaths?.Length??1,DependencyFailure?0:1,0,DependencyFailure?1:0,1) { DependencyUnavailable=DependencyFailure,Error=DependencyFailure?"Basic analysis stopped: Essentia is missing":string.Empty };return Task.CompletedTask; }
        public void RecordPlaybackActivity(){} public IEnumerable<TrackAnalysisInfo> GetAllTracks()=>[];public bool CancelScan()=>false;public bool PauseScan()=>false;public bool ResumeScan()=>false;public bool EndScan()=>false;
        public Task<WaveformData> GetWaveformAsync(string path,CancellationToken ct,bool cachedOnly=false)=>throw new NotImplementedException();
        public BeatAnalysis GetBeatInfo(string path)=>throw new NotImplementedException();
        public Task<LoudnessData> GetLoudnessAsync(string path,CancellationToken ct)=>throw new NotImplementedException();
        public void SetBpm(string path,uint bpm){}public void SetKey(string path,string key){}public void ClearBpm(string path){}public void ClearKey(string path){}public string ResolveMaskedFilename(string path)=>null!;
    }
}
