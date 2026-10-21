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
    private PreparationService Service => new(store,repository,null,analysis,new(null,null,null,null));
    private static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    public WorkspaceTests()
    {
        Directory.CreateDirectory(root); MusicPath.Configure(root);
        connection = Environment.GetEnvironmentVariable("RESONANCE_WORKSPACE_TEST_POSTGRES");
        postgres = !string.IsNullOrEmpty(connection);
        connection ??= $"Data Source={Path.Combine(root,"test.db")}";
        if (postgres)
        {
            if (!new Npgsql.NpgsqlConnectionStringBuilder(connection).Database.StartsWith("resonance_workspace_test")) throw new Exception("Only a dedicated workspace test database is allowed.");
            using var clean=Db();clean.Execute("DROP SCHEMA IF EXISTS music CASCADE; DROP SCHEMA IF EXISTS analysis CASCADE; DROP SCHEMA IF EXISTS library_activity CASCADE");
        }
        repository = new(connection,postgres); repository.Initialize(); _ = new AnalysisStore(connection,postgres);
        store = new(new(new Dictionary<Database,ConnectionString> { [Database.Music]=connection },postgres));
        using var db = Db();
        if(postgres)db.Execute("CREATE SCHEMA library_activity");
        db.Execute($"CREATE TABLE {(postgres ? "library_activity." : "")}\"PlayHistory\" (\"Id\" TEXT,\"Path\" TEXT,\"Username\" TEXT,\"PlayedAt\" BIGINT); CREATE TABLE {(postgres ? "library_activity." : "")}\"LovedTracks\" (\"Path\" TEXT,\"Username\" TEXT)");
    }
    private DbConnection Db() { DbConnection db = postgres ? new Npgsql.NpgsqlConnection(connection) : new SqliteConnection(connection); db.Open(); return db; }
    private MusicTrack Add(string path="nested/a.mp3", int bpm=128, long? added=null)
    {
        var track=new MusicTrack(path,Path.GetFileName(path),Path.GetDirectoryName(path),"mp3",100,1,added??Now,120,"Track "+path,"Artist",null,"Album",2026,1,1,"Trance",bpm,"Am",null,false,"ID3",320,44100,16);
        repository.Upsert(track);return track;
    }
    private MusicLibraryQueryResult Query(SmartCrateRules rules,string user="alice",int limit=100,int offset=0) => repository.Query(null,null,null,rules.Genre,null,rules.Folder,false,false,false,false,false,limit,offset,"title",analysis:rules.Analysis,dj:rules.Filters(user,DateTimeOffset.UtcNow));
    private void Complete(string path, bool enhanced=true)
    {
        using var db=Db();
        db.Execute($"INSERT INTO {CacheTable} (masked_filename,file_size,overall_peaks,lufs,analysed_at,dj_summary) VALUES (@path,100,@peaks,-8,@now,@summary) ON CONFLICT(masked_filename) DO UPDATE SET overall_peaks=excluded.overall_peaks,lufs=excluded.lufs,dj_summary=excluded.dj_summary",new { path,peaks=new byte[]{1,2,3},now=Now,summary=enhanced?"{\"complete\":true,\"vocals\":false,\"genre\":\"Trance\",\"energy\":0.2}":null });
    }
    [Fact] public void CratesPersistPerAccountAndDetectConflictingEdits()
    {
        var crate=store.SaveCrate("alice",null,new("My set","",new(BpmMin:125,BpmMax:130)));
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
        var crate=store.SaveCrate("alice",null,new("Nested","",new(Folder:Path.Combine(root,"nested"))));
        Assert.Equal("nested",store.FindCrate("alice",crate.Id).Rules.Folder);
        MusicPath.Configure(Path.Combine(root,"moved"));
        Assert.Equal(1,Query(crate.Rules).Total);
        Assert.Throws<ArgumentException>(()=>store.SaveCrate("alice",null,new("Outside","",new(Folder:"../outside"))));
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
    [Fact] public void RestartRecoveryAndCombinedFiltersAgreeWithCounts()
    {
        Add();store.Put(new("nested/a.mp3",100,1,"running",1,0,"",Now));store.RecoverInterrupted();
        Assert.Equal("queued",store.Find("nested/a.mp3").State);Assert.Equal(1,store.Page("waiting",null,50,0).Total);
        Complete("nested/a.mp3");Service.Reconcile();Assert.Equal(1,store.Page("analysed",null,50,0).Total);
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
    [Fact] public void SetsPersistOrderTemposNotesPerAccountAndDetectConcurrentEdits()
    {
        var a=Add("nested/a.mp3");var b=Add("nested/b.mp3",138);
        var request=new SetPlanRequest("My set",[new(a.Path),new(b.Path,Note:"Swap bass after arrival")],InitialMasterBpm:140,Bars:16,Notes:"Late room");
        var saved=store.SaveSet("alice",null,request);
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
        var saved=store.SaveSet("alice",null,request);
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
    public void Dispose() { SqliteConnection.ClearAllPools();Directory.Delete(root,true);MusicPath.Configure(previousRoot); }
    private class FakeAnalysis : IAnalysisService
    {
        public AnalysisScanState ScanState {get;set;}=new(false,false,false,0,0,0,0,0);
        public bool PlaybackActive {get;set;}
        public int Starts;public bool Reject;public bool Cancelled;public Action OnStart;
        public Task StartScanAsync(AnalysisScanRequest request) { if(Reject)throw new InvalidOperationException();Starts++;Assert.True(request.SkipAnalysed);Assert.False(request.ResetAll);OnStart?.Invoke();ScanState=new(false,!Cancelled,Cancelled,1,1,0,0,1);return Task.CompletedTask; }
        public void RecordPlaybackActivity(){} public IEnumerable<TrackAnalysisInfo> GetAllTracks()=>[];public bool CancelScan()=>false;
        public Task<WaveformData> GetWaveformAsync(string path,CancellationToken ct,bool cachedOnly=false)=>throw new NotImplementedException();
        public BeatAnalysis GetBeatInfo(string path)=>throw new NotImplementedException();
        public Task<LoudnessData> GetLoudnessAsync(string path,CancellationToken ct)=>throw new NotImplementedException();
        public void SetBpm(string path,uint bpm){}public void SetKey(string path,string key){}public void ClearBpm(string path){}public void ClearKey(string path){}public string ResolveMaskedFilename(string path)=>null;
    }
}
