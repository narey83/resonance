namespace Resonance.Tests.MetadataLookup;

using System.Net;
using System.Reflection;
using System.Text;
using global::resonance.MetadataLookup;
using global::resonance.Shares;
using Microsoft.Extensions.Options;
using AppOptions = global::resonance.Options;

[Collection("Music path configuration")]
public sealed class MetadataEditorEvidenceTests : IDisposable
{
    private readonly string previousRoot = global::resonance.Common.MusicPath.Root;
    private readonly string directory = Path.Combine(Path.GetTempPath(), "lookup-editor-" + Guid.NewGuid());
    private readonly MetadataLookupService service;
    private readonly string path;
    private readonly IShareService shares;
    private bool failWrites;
    private bool ignoreWrites;
    private const string Masked = "share\\song.wav";

    public MetadataEditorEvidenceTests()
    {
        Directory.CreateDirectory(directory);
        global::resonance.Common.MusicPath.Configure(directory);
        path = Path.Combine(directory, "song.wav");
        // Small valid PCM wave; tag reads and writes use the real TagLib implementation.
        using (var stream = File.Create(path))
        using (var writer = new BinaryWriter(stream))
        {
            writer.Write(Encoding.ASCII.GetBytes("RIFF")); writer.Write(36 + 200);
            writer.Write(Encoding.ASCII.GetBytes("WAVEfmt ")); writer.Write(16);
            writer.Write((short)1); writer.Write((short)1); writer.Write(44100); writer.Write(88200);
            writer.Write((short)2); writer.Write((short)16);
            writer.Write(Encoding.ASCII.GetBytes("data")); writer.Write(200); writer.Write(new byte[200]);
        }
        Save(new FileTags("Artist", "Artist", null, "Track", 0, 0, Comment: "Preserve"));
        shares = DispatchProxy.Create<IShareService, Proxy>();
        ((Proxy)(object)shares).Call = (method, args) => method.Name switch
        {
            "GetTags" => MetadataTagEvidence.Read(path),
            "FindFiles" or "GetTaggedFiles" => new[] { new TaggedFile(Masked, path, "share", "song.wav", "wav", MetadataTagEvidence.Read(path)) },
            "GetUntaggedFiles" => Array.Empty<UntaggedFile>(),
            "WriteFileTags" => Save((FileTags)args![1]!),
            _ => throw new InvalidOperationException(method.Name),
        };
        var options = DispatchProxy.Create<IOptionsMonitor<AppOptions>, Proxy>();
        ((Proxy)(object)options).Call = (_, _) => new AppOptions
        {
            MetadataLookup = new AppOptions.MetadataLookupOptions
            {
                Enabled = false,
                RateLimitPerSecond = 100,
            },
        };
        var musicBrainz = new MusicBrainzClient(new HttpFactory(), options);
        service = new MetadataLookupService(shares, options, musicBrainz, null!, null!, null!, null!, null!, directory);
    }

    [Fact]
    public async Task PreviewThenSaveRecordsOnlyVerifiedProviderFields()
    {
        var candidate = Assert.Single(await service.LookupAsync(new MetadataLookupRequest(MaskedFilename: Masked)));
        Assert.False(service.State.Enabled); // A preview remains available with automatic enrichment disabled.
        var preview = Assert.Single(service.GetActivity(1, 50, "", "all").Items);
        Assert.Equal("Preview", preview.Status);
        Assert.Null(preview.LastUpdate);
        Assert.Equal("MusicBrainz", candidate.Source);
        var tags = MetadataTagEvidence.Read(path) with { Album = candidate.Album, Year = candidate.Year, Title = "My custom title" };
        Assert.Throws<ArgumentException>(() => service.WriteLookupTags("other-track", tags, candidate.LookupId!));
        service.WriteLookupTags(Masked, tags, candidate.LookupId!);
        var result = Assert.Single(service.GetActivity(1, 50, "", "all").Items);
        Assert.Equal("Updated", result.Status);
        Assert.Equal(new[] { "Album", "Year" }, result.LastUpdate!.Fields.Keys.Order().ToArray());
        Assert.All(result.LastUpdate.Fields.Values, source => Assert.Equal("MusicBrainz", source));
        Assert.Equal("Preserve", MetadataTagEvidence.Read(path).Comment);
        Assert.Throws<ArgumentException>(() => service.WriteLookupTags(Masked, tags, candidate.LookupId!));
    }

    [Theory]
    [InlineData(true, false, "Failed")]
    [InlineData(false, true, "Unchanged")]
    public async Task FailedOrUnpersistedEditorWritesCannotBecomeUpdates(bool fail, bool ignore, string expected)
    {
        var candidate = Assert.Single(await service.LookupAsync(new MetadataLookupRequest(MaskedFilename: Masked)));
        failWrites = fail;
        ignoreWrites = ignore;
        var tags = MetadataTagEvidence.Read(path) with { Album = candidate.Album };
        if (fail) Assert.Throws<IOException>(() => service.WriteLookupTags(Masked, tags, candidate.LookupId!));
        else service.WriteLookupTags(Masked, tags, candidate.LookupId!);
        var result = Assert.Single(service.GetActivity(1, 50, "", "all").Items);
        Assert.Equal(expected, result.Status);
        Assert.Null(result.LastUpdate);
    }

    private object? Save(FileTags tags)
    {
        if (failWrites) throw new IOException("Synthetic failure");
        if (ignoreWrites) return null;
        using var file = TagLib.File.Create(path);
        file.Tag.Performers = [tags.Artist]; file.Tag.AlbumArtists = [tags.AlbumArtist];
        file.Tag.Title = tags.Title; file.Tag.Album = tags.Album; file.Tag.Year = tags.Year; file.Tag.Comment = tags.Comment;
        file.Save();
        return null;
    }

    public void Dispose()
    {
        global::resonance.Common.MusicPath.Configure(previousRoot);
        Directory.Delete(directory, true);
    }

    public class Proxy : DispatchProxy
    {
        public Func<MethodInfo, object?[]?, object?> Call { get; set; } = null!;
        protected override object? Invoke(MethodInfo? method, object?[]? args) => Call(method!, args);
    }

    private sealed class HttpFactory : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(new Handler());
    }

    private sealed class Handler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var json = request.RequestUri!.Query.Contains("query=")
                ? """{"recordings":[{"id":"test-id","title":"Track","score":100,"artist-credit":[{"name":"Artist"}],"releases":[{"title":"Online Album","date":"2024-01-01"}]}]}"""
                : """{"genres":[{"name":"trance","count":5}]}""";
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(json) });
        }
    }
}
