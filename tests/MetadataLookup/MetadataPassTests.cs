namespace Resonance.Tests.MetadataLookup;

using System.Net;
using System.Reflection;
using System.Text;
using System.Text.Json;
using global::resonance;
using global::resonance.Common;
using global::resonance.MetadataLookup;
using global::resonance.Shares;
using Microsoft.Extensions.Options;
using Serilog;
using Serilog.Core;
using Serilog.Events;
using AppOptions = global::resonance.Options;

[Collection("Music path configuration")]
public sealed class MetadataPassTests : IDisposable
{
    private readonly string previousRoot = MusicPath.Root;
    private readonly string directory = Path.Combine(Path.GetTempPath(), "metadata-pass-" + Guid.NewGuid());
    private readonly Sink sink = new();
    private readonly MetadataLookupService service;
    private TaggedFile[] files = [];
    private bool enableProvider;
    private bool ignoreWrites;
    private bool failWrites;
    private string CacheFile => Path.Combine(directory, "metadata-lookup-attempts.json");

    public MetadataPassTests()
    {
        Directory.CreateDirectory(directory);
        MusicPath.Configure(directory);
        var monitor = DispatchProxy.Create<IStateMonitor<ShareState>, Proxy>();
        ((Proxy)(object)monitor).Call = (_, _) => new ShareState { Ready = true };
        var shares = DispatchProxy.Create<IShareService, Proxy>();
        ((Proxy)(object)shares).Call = (method, args) => method.Name switch
        {
            "get_StateMonitor" => monitor,
            "GetTaggedFiles" => files,
            "GetUntaggedFiles" => Array.Empty<UntaggedFile>(),
            "WriteFileTags" => Save((FileTags)args![1]!),
            _ => throw new InvalidOperationException(method.Name),
        };
        var options = DispatchProxy.Create<IOptionsMonitor<AppOptions>, Proxy>();
        ((Proxy)(object)options).Call = (_, _) => new AppOptions
        {
            MetadataLookup = new()
            {
                Enabled = true,
                MusicBrainz = new() { Enabled = enableProvider },
                RateLimitPerSecond = 100,
                Discogs = new() { Enabled = false },
                Lastfm = new() { Enabled = false },
                Deezer = new() { Enabled = false },
            },
        };
        var logger = new LoggerConfiguration().MinimumLevel.Debug().WriteTo.Sink(sink).CreateLogger();
        var provider = new MusicBrainzClient(new HttpFactory(), options);
        service = new MetadataLookupService(shares, options, provider, null!, null!, null!, null!, null!, directory, logger);
    }

    [Fact]
    public async Task EmptyChecksDoNotLogCompletedPassesOrCreateCache()
    {
        await RunPass();
        await RunPass();
        Assert.DoesNotContain(sink.Events, e => e.Level >= LogEventLevel.Information);
        Assert.False(File.Exists(CacheFile));
        Assert.False(service.State.Scanning);
        Assert.True(service.State.Completed);
        Assert.Equal(0, service.State.Total);
    }

    [Fact]
    public async Task RealPassPersistsAttemptAndNextCheckStaysQuietWithoutRewritingCache()
    {
        files = [new TaggedFile("share\\song.mp3", "song.mp3", "share", "song.mp3", "mp3", null!)];
        await RunPass();
        Assert.Equal(1, service.State.Total);
        Assert.Equal(1, service.State.Skipped);
        Assert.Contains(sink.Events, e => e.MessageTemplate.Text.StartsWith("Metadata enrichment pass started"));
        Assert.Contains(sink.Events, e => e.MessageTemplate.Text.StartsWith("Metadata enrichment pass complete"));
        using (var json = JsonDocument.Parse(File.ReadAllText(CacheFile)))
            Assert.Equal("nomatch", json.RootElement.GetProperty("song.mp3").GetProperty("Outcome").GetString());
        var timestamp = DateTime.UtcNow.AddDays(-1);
        File.SetLastWriteTimeUtc(CacheFile, timestamp);
        var savedTimestamp = File.GetLastWriteTimeUtc(CacheFile);
        sink.Events.Clear();
        await RunPass();
        Assert.Equal(0, service.State.Total);
        Assert.DoesNotContain(sink.Events, e => e.Level >= LogEventLevel.Information);
        Assert.Equal(savedTimestamp, File.GetLastWriteTimeUtc(CacheFile));
    }

    [Fact]
    public async Task CancellationBeforeWorkDoesNotReportACompletedPass()
    {
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        await RunPass(cancellation.Token);
        Assert.False(service.State.Completed);
        Assert.DoesNotContain(sink.Events, e => e.Level >= LogEventLevel.Information);
        Assert.False(File.Exists(CacheFile));
    }

    [Theory]
    [InlineData(false, false, 1)]
    [InlineData(true, false, 0)]
    [InlineData(false, true, 0)]
    public async Task EnrichedTrackIsLoggedOnlyAfterChangesAreConfirmedOnDisk(bool ignore, bool fail, int expected)
    {
        enableProvider = true;
        ignoreWrites = ignore;
        failWrites = fail;
        using (var writer = new BinaryWriter(File.Create(Path.Combine(directory, "song.wav"))))
        {
            writer.Write(Encoding.ASCII.GetBytes("RIFF")); writer.Write(236);
            writer.Write(Encoding.ASCII.GetBytes("WAVEfmt ")); writer.Write(16);
            writer.Write((short)1); writer.Write((short)1); writer.Write(44100); writer.Write(88200);
            writer.Write((short)2); writer.Write((short)16);
            writer.Write(Encoding.ASCII.GetBytes("data")); writer.Write(200); writer.Write(new byte[200]);
        }

        files = [new TaggedFile("share\\song.wav", "song.wav", "share", "song.wav", "wav", null!)];
        await RunPass();
        var updates = sink.Events.Where(e => e.MessageTemplate.Text.StartsWith("Metadata enriched for")).ToArray();
        Assert.Equal(expected, updates.Length);
        Assert.Equal(expected, service.State.Written);
        if (expected == 1)
        {
            var update = Assert.Single(updates);
            Assert.Equal(LogEventLevel.Information, update.Level);
            Assert.Equal("song.wav", ((ScalarValue)update.Properties["Track"]).Value);
            Assert.Contains("Album", update.Properties["ChangedFields"].ToString());
            Assert.Equal("Online Album", MetadataTagEvidence.Read(Path.Combine(directory, "song.wav")).Album);
        }
    }

    private object? Save(FileTags tags)
    {
        if (failWrites) throw new IOException("Synthetic failure");
        if (ignoreWrites) return null;
        using var file = TagLib.File.Create(Path.Combine(directory, "song.wav"));
        file.Tag.Performers = [tags.Artist]; file.Tag.AlbumArtists = [tags.AlbumArtist];
        file.Tag.Title = tags.Title; file.Tag.Album = tags.Album; file.Tag.Year = tags.Year;
        file.Tag.Genres = [tags.Genre];
        file.Save();
        return null;
    }

    private Task RunPass(CancellationToken ct = default)
        => (Task)typeof(MetadataLookupService).GetMethod("RunPassAsync", BindingFlags.Instance | BindingFlags.NonPublic)!
            .Invoke(service, [ct, false])!;

    public void Dispose()
    {
        MusicPath.Configure(previousRoot);
        Directory.Delete(directory, true);
    }

    public class Proxy : DispatchProxy
    {
        public Func<MethodInfo, object?[]?, object?> Call { get; set; } = null!;
        protected override object? Invoke(MethodInfo? method, object?[]? args) => Call(method!, args);
    }

    private sealed class Sink : ILogEventSink
    {
        public List<LogEvent> Events { get; } = [];
        public void Emit(LogEvent logEvent) => Events.Add(logEvent);
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
                ? """{"recordings":[{"id":"test-id","title":"song","score":100,"artist-credit":[{"name":"Artist"}],"releases":[{"title":"Online Album","date":"2024-01-01"}]}]}"""
                : """{"genres":[{"name":"trance","count":5}]}""";
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(json) });
        }
    }
}
