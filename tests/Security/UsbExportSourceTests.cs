namespace Resonance.Tests.Security;

using System.Diagnostics;
using System.Reflection;
using System.Text.Json;
using global::resonance;
using global::resonance.Analysis;
using global::resonance.Analysis.UsbExport;
using global::resonance.Common;
using global::resonance.Mixtapes;
using global::resonance.MusicLibrary;
using global::resonance.MusicLibrary.Workspace;
using Xunit.Abstractions;

[Collection("Music path configuration")]
public sealed class UsbExportSourceTests : IDisposable
{
    private readonly string previousRoot = MusicPath.Root;
    private readonly string root = Path.Combine(Path.GetTempPath(), "export-source-" + Guid.NewGuid().ToString("N"));
    private readonly MusicRepository repository;
    private readonly WorkspaceStore workspace;
    private readonly UsbExportService exports;
    private readonly ITestOutputHelper output;

    public UsbExportSourceTests(ITestOutputHelper output)
    {
        this.output = output;
        Directory.CreateDirectory(root);
        MusicPath.Configure(root);
        var connection = $"Data Source={Path.Combine(root,"test.db")};Pooling=False";
        repository = new(connection); repository.Initialize(); _ = new AnalysisStore(connection, false);
        workspace = new(new(new Dictionary<Database,ConnectionString> { [Database.Music] = connection }, false));
        var library = DispatchProxy.Create<IMusicLibraryService, Proxy>();
        ((Proxy)(object)library).Call = (method, args) => method.Name switch
        {
            "GetExportTracks" => repository.GetExportTracks((IReadOnlyList<string>)args![0]!),
            "GetFolders" => repository.GetFolders(),
            "QueryTracks" => repository.Query((string)args![0]!, (string)args[1]!, (string)args[2]!, (string)args[3]!,
                (int?)args[4], (string)args[5]!, (bool)args[6]!, (bool)args[7]!, (bool)args[8]!, (bool)args[9]!, (bool)args[10]!,
                (int)args[11]!, (int)args[12]!, (string)args[13]!, (bool)args[14]!, (string)args[15]!, (string)args[16]!, (string)args[17]!, (DjLibraryFilters)args[18]!),
            _ => throw new InvalidOperationException("Unexpected library call " + method.Name),
        };
        var playlists = DispatchProxy.Create<IMixtapeService, Proxy>();
        var entries = new[] { new MixtapeTrack("two", "mix", "album/two.flac", "Two", "Artist", "Album", 120, 2),
            new MixtapeTrack("one", "mix", "album/one.flac", "One", "Artist", "Album", 120, 1) };
        var mix = new Mixtape("mix", "Saved order", null, false, null, 1, 2, Tracks:entries);
        ((Proxy)(object)playlists).Call = (method, args) => method.Name switch
        {
            "GetAll" => new[] { mix },
            "GetById" => (string)args![0]! == "mix" ? mix : null,
            "GetTracks" => entries,
            _ => throw new InvalidOperationException("Unexpected playlist call " + method.Name),
        };
        exports = new(null!, null!, library, playlists, workspace);
    }

    private static MusicTrack Track(string path, int? bpm = 128, string? title = null) => new(path,
        Path.GetFileName(path), Path.GetDirectoryName(path) ?? "", "flac", 100, 1, 1, 120, title ?? path,
        "Artist", null!, "Album", 2026, 1, 1, "House", bpm, "Am", null!, false, "Xiph", 1000, 44100, 16);

    [Fact]
    public void Playlist_Resolution_Preserves_Order_Name_And_Identity()
    {
        var selection = exports.ResolveSource(new("playlist", "mix"), "alice");
        Assert.Equal(new[] { "album/one.flac", "album/two.flac" }, selection.Paths.Select(MusicPath.ToRelative));
        Assert.Equal("Saved order", selection.PlaylistName);
        Assert.Equal("playlist", selection.Source.Kind);
        Assert.Equal("mix", selection.Source.Id);
        Assert.Equal(2, selection.Source.Revision);
        Assert.Equal(64, selection.Source.PathsHash.Length);
        Assert.Equal(selection.SelectionId, exports.ResolveSource(new("playlist", "mix"), "alice").SelectionId);
    }

    [Fact]
    public void Source_Previews_Are_Owner_Bound_And_Cannot_Be_Reordered()
    {
        var selection = exports.ResolveSource(new("playlist", "mix"), "alice");
        var request = new UsbExportRequest(selection.Paths, selection.PlaylistName, SelectionId:selection.SelectionId);
        Assert.Throws<ArgumentException>(() => exports.Start(request, "bob"));
        Assert.Throws<ArgumentException>(() => exports.Start(request with { Paths = selection.Paths.Reverse().ToArray() }, "alice"));
        Assert.Throws<ArgumentException>(() => exports.Start(request with { SelectionId = new string('a',32) }, "alice"));
    }

    [Fact]
    public void Smart_Crates_Resolve_Current_User_Rules_Into_A_Fixed_Selection()
    {
        repository.Upsert(Track("album/one.flac", 128)); repository.Upsert(Track("album/two.flac", 100));
        var crate = workspace.SaveCrate("alice", null!, new("Fast", "", new(BpmMin:120)));
        Assert.Throws<FileNotFoundException>(() => exports.ResolveSource(new("smart-crate", crate.Id), "bob"));
        var selection = exports.ResolveSource(new("smart-crate", crate.Id), "alice");
        Assert.Equal("album/one.flac", MusicPath.ToRelative(Assert.Single(selection.Paths)));
        Assert.Equal(crate.Revision, selection.Source.Revision);
        workspace.SaveCrate("alice", crate.Id, new("Fast", "", new(BpmMin:140), crate.Revision));
        Assert.Throws<ArgumentException>(() => exports.ResolveSource(new("smart-crate", crate.Id), "alice"));
        Assert.Single(selection.Paths);
    }

    [Fact]
    public void Folder_Export_Includes_Descendants_But_Rejects_Root_And_Traversal()
    {
        repository.Upsert(Track("album/one.flac")); repository.Upsert(Track("album/disc2/two.flac")); repository.Upsert(Track("other/three.flac"));
        var selection = exports.ResolveSource(new("folder", Folder:"album"), "alice");
        Assert.Equal(2, selection.TrackCount);
        Assert.All(selection.Paths, path => Assert.StartsWith(Path.Combine(root,"album") + Path.DirectorySeparatorChar,path));
        Assert.Equal("album", selection.PlaylistName);
        Assert.Throws<ArgumentException>(() => exports.ResolveSource(new("folder", Folder:root), "alice"));
        Assert.Throws<ArgumentException>(() => exports.ResolveSource(new("folder", Folder:"../outside"), "alice"));
        Assert.Throws<ArgumentException>(() => exports.ResolveSource(new("folder", Folder:"empty"), "alice"));
        Assert.Throws<ArgumentException>(() => exports.ResolveSource(new("unknown"), "alice"));
    }

    [Fact]
    public void Indexed_Export_Metadata_Is_Scoped_And_Does_Not_Read_The_Analysis_Service()
    {
        repository.Upsert(Track("album/one.flac", title:"Indexed title"));repository.Upsert(Track("other/two.flac"));
        var response = JsonSerializer.SerializeToElement(exports.Library(["album/one.flac"]));
        var track = Assert.Single(response.GetProperty("tracks").EnumerateArray());
        Assert.Equal("Indexed title", track.GetProperty("title").GetString());
        Assert.EndsWith("album/one.flac", track.GetProperty("path").GetString());
        Assert.Empty(repository.GetExportTracks(["missing' OR 1=1 --"]));
        Assert.Equal(2, repository.GetExportTracks().Count);
        Assert.Throws<ArgumentException>(() => exports.Library(["../outside"]));
    }

    [Fact]
    public void Large_Indexed_Lists_Are_Complete_And_Oversized_Folder_Exports_Are_Rejected()
    {
        repository.UpsertMany(Enumerable.Range(0,59400).Select(index => Track($"album/{index:D5}.flac")).ToArray());
        var timer = Stopwatch.StartNew();var all = repository.GetExportTracks();timer.Stop();
        output.WriteLine($"59400 indexed export summaries: {timer.Elapsed.TotalMilliseconds:F1}ms");
        Assert.Equal(59400, all.Count);
        timer.Restart();var scoped = repository.GetExportTracks(["album/00001.flac","album/59399.flac"]);timer.Stop();
        output.WriteLine($"2 scoped summaries: {timer.Elapsed.TotalMilliseconds:F1}ms");
        Assert.Equal(2,scoped.Count);
        Assert.Throws<ArgumentException>(() => exports.ResolveSource(new("folder", Folder:"album"), "alice"));
    }

    public void Dispose()
    {
        exports.Dispose();MusicPath.Configure(previousRoot);Directory.Delete(root,true);
    }
    public class Proxy : DispatchProxy
    {
        public Func<MethodInfo, object?[]?, object?> Call { get; set; } = null!;
        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args) => Call(targetMethod!, args);
    }
}
