namespace Resonance.Tests.Security;

using System.IO.Compression;
using System.Reflection;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using global::resonance;
using global::resonance.Mixtapes;
using global::resonance.Mixtapes.API;
using global::resonance.MusicLibrary;

public sealed class MixtapeFileSecurityTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "resonance-mixtape-security-" + Guid.NewGuid().ToString("N"));
    private readonly MixtapeRepository repository;
    private readonly MixtapeService service;
    private readonly MusicRepository music;
    private string Downloads => Path.Combine(root, "downloads");

    public MixtapeFileSecurityTests()
    {
        Directory.CreateDirectory(Downloads);
        var connection = $"Data Source={Path.Combine(root, "library.db")};Pooling=False";
        repository = new MixtapeRepository(connection);
        music = new MusicRepository(connection, false);
        music.Initialize();
        var client = Stub<IClientProxy>(Task.CompletedTask);
        var clients = Stub<IHubClients>(client);
        var hub = Stub<IHubContext<MixtapesHub>>(clients);
        service = new MixtapeService(repository, music, Downloads, Path.Combine(root, "artwork"), hub);
    }

    [Theory]
    [InlineData(".")]
    [InlineData("..")]
    public void DeletingDotNamedPlaylistPreservesBothParentDirectories(string name)
    {
        var playlistRoot = Directory.CreateDirectory(Path.Combine(Downloads, "mixtapes")).FullName;
        var download = Path.Combine(Downloads, "keep.m3u");
        var playlist = Path.Combine(playlistRoot, "keep.m3u");
        File.WriteAllText(download, "keep");
        File.WriteAllText(playlist, "keep");

        var item = service.Create(name, null);
        service.Delete(item.Id);

        Assert.True(File.Exists(download));
        Assert.True(File.Exists(playlist));
        Assert.Null(repository.GetById(item.Id));
    }

    [Fact]
    public void DeleteRequiresAnExistingPlaylistAndRemovesItsOwnFolder()
    {
        var parent = Directory.CreateDirectory(Path.Combine(Downloads, "mixtapes")).FullName;
        Assert.Throws<KeyNotFoundException>(() => service.Delete(".."));
        Assert.True(Directory.Exists(parent));

        var item = service.Create("Normal playlist", null);
        var folder = Path.Combine(parent, item.Name);
        Assert.True(Directory.Exists(folder));
        service.Delete(item.Id);
        Assert.False(Directory.Exists(folder));
    }

    [Fact]
    public void DeletionPreservesSharedFoldersAndUnrelatedFiles()
    {
        var first = service.Create("A/B", null);
        var folder = Path.Combine(Downloads, "mixtapes", "A_B");
        var unrelated = Path.Combine(folder, "keep.m3u");
        File.WriteAllText(unrelated, "keep");
        var second = service.Create("A_B", null);
        service.Delete(second.Id);
        Assert.True(Directory.Exists(folder));

        service.Delete(first.Id);
        Assert.Equal("keep", File.ReadAllText(unrelated));
    }

    [Fact]
    public void PublicDownloadsRecheckStoredPathsAndPreserveNormalDownloads()
    {
        var libraryRoot = Directory.CreateDirectory(Path.Combine(root, "library")).FullName;
        var privateFile = Path.Combine(root, "private.txt");
        var validFile = Path.Combine(libraryRoot, "track.mp3");
        var link = Path.Combine(libraryRoot, "escape.txt");
        var unindexed = Path.Combine(libraryRoot, "unindexed.txt");
        File.WriteAllText(privateFile, "synthetic private content");
        File.WriteAllText(validFile, "synthetic audio");
        File.CreateSymbolicLink(link, privateFile);
        File.WriteAllText(unindexed, "unindexed");
        foreach (var path in new[] { validFile, link })
        {
            music.Upsert(new(path, Path.GetFileName(path), libraryRoot, Path.GetExtension(path), 1, 0, 0,
                null, null!, null!, null!, null!, null, null, null, null!, null, null!, null!, false, null!, null, null, null));
        }
        var item = new Mixtape("published", "Published", null, true, "token", 0, 0);
        repository.InsertMixtape(item);
        Assert.Throws<KeyNotFoundException>(() => service.AddTrack(item.Id, privateFile));
        repository.InsertTrack(new("private", item.Id, privateFile, null, null, null, null, 0));
        repository.InsertTrack(new("link", item.Id, link, null, null, null, null, 1));
        repository.InsertTrack(new("valid", item.Id, validFile, null, null, null, null, 2));
        repository.InsertTrack(new("unindexed", item.Id, unindexed, null, null, null, null, 3));
        var library = new MusicLibraryService(new OptionsAtStartup { Shares = new() { Directories = [libraryRoot] } }, music, null!, null!, null!);
        var controller = new PublicMixtapesController(service, library);

        Assert.IsType<NotFoundResult>(controller.DownloadTrack("token", "private"));
        Assert.IsType<NotFoundResult>(controller.DownloadTrack("token", "link"));
        Assert.IsType<NotFoundResult>(controller.DownloadTrack("token", "unindexed"));
        var track = Assert.IsType<PhysicalFileResult>(controller.DownloadTrack("token", "valid"));
        Assert.Equal(global::resonance.Common.LibraryPathSecurity.Resolve(validFile), track.FileName);
        Assert.True(track.EnableRangeProcessing);

        var download = Assert.IsType<FileStreamResult>(controller.DownloadZip("token"));
        using var zip = new ZipArchive(download.FileStream, ZipArchiveMode.Read);
        Assert.Equal(new[] { "Published/Published.m3u", "Published/track.mp3" }, zip.Entries.Select(entry => entry.FullName));
    }

    public void Dispose() => Directory.Delete(root, recursive: true);

    private static T Stub<T>(object result) where T : class
    {
        var proxy = DispatchProxy.Create<T, ConstantProxy>();
        ((ConstantProxy)(object)proxy).Result = result;
        return proxy;
    }

    public class ConstantProxy : DispatchProxy
    {
        public object? Result { get; set; }

        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args) => Result;
    }
}
