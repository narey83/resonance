// <copyright file="MetadataLookupService.cs" company="John Narey">
//    ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮
//   ─╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰  resonance
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) 2026 John Narey.
//   │ Part of Resonance, a Soulseek client based on slskd.
//   │
//   │ This program is free software: you can redistribute it and/or modify
//   │ it under the terms of the GNU Affero General Public License as published
//   │ by the Free Software Foundation, version 3.
//   │
//   │ This program is distributed in the hope that it will be useful,
//   │ but WITHOUT ANY WARRANTY; without even the implied warranty of
//   │ MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
//   │ GNU Affero General Public License for more details.
//   │
//   │ You should have received a copy of the GNU Affero General Public License
//   │ along with this program.  If not, see https://www.gnu.org/licenses/.
//   │
//   │ This program is distributed with Additional Terms pursuant to Section 7
//   │ of the AGPLv3.  See the LICENSE file in the root directory of this
//   │ project for the complete terms and conditions.
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: John Narey
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

namespace resonance.MetadataLookup
{
    using System;
    using System.Collections.Concurrent;
    using System.Collections.Generic;
    using System.Linq;
    using System.Threading;
    using System.Threading.Channels;
    using System.Threading.Tasks;
    using Microsoft.Extensions.Hosting;
    using Microsoft.Extensions.Options;
    using resonance.Events;
    using resonance.MusicLibrary;
    using resonance.Shares;
    using Serilog;

    /// <summary>
    ///     Background service that automatically enriches tracks missing metadata using
    ///     <see cref="MusicBrainzClient"/>. Gated by a single enable/disable option; when enabled it
    ///     runs an enrichment pass on startup, whenever a download completes, and on a periodic timer.
    /// </summary>
    public class MetadataLookupService : IMetadataLookupService, IHostedService
    {
        private const int RecentCapacity = 50;
        private const int SaveEvery = 250;
        private static readonly TimeSpan StartupDelay = TimeSpan.FromSeconds(45);
        private static readonly TimeSpan SweepInterval = TimeSpan.FromMinutes(15);

        // already-attempted tracks are skipped until the file changes or this window elapses
        private static readonly TimeSpan RetryAfter = TimeSpan.FromDays(90);

        private static readonly HashSet<string> AudioExtensions = new(StringComparer.OrdinalIgnoreCase)
        {
            "mp3", "flac", "ogg", "wav", "m4a", "aac", "opus", "wma", "aiff", "aif",
        };

        // set via Interlocked, so must be fields rather than properties
        private int forceRequested;
        private int sinceLastSave;

        public MetadataLookupService(IShareService shareService, IOptionsMonitor<resonance.Options> optionsMonitor, MusicBrainzClient musicBrainz, DiscogsClient discogs, LastfmClient lastfm, DeezerClient deezer, EventBus eventBus, IMusicLibraryService musicLibrary = null)
        {
            ShareService = shareService;
            Options = optionsMonitor;
            MusicBrainz = musicBrainz;
            Discogs = discogs;
            Lastfm = lastfm;
            Deezer = deezer;
            Events = eventBus;
            MusicLibrary = musicLibrary;
            AttemptCache = new MetadataAttemptCache(
                System.IO.Path.Combine(Program.DataDirectory ?? System.IO.Path.GetTempPath(), "metadata-lookup-attempts.json"),
                Log);
        }

        private IShareService ShareService { get; }
        private IOptionsMonitor<resonance.Options> Options { get; }
        private MusicBrainzClient MusicBrainz { get; }
        private DiscogsClient Discogs { get; }
        private LastfmClient Lastfm { get; }
        private DeezerClient Deezer { get; }
        private EventBus Events { get; }
        private IMusicLibraryService MusicLibrary { get; }
        private MetadataAttemptCache AttemptCache { get; }
        private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", Logs.Music.Metadata);

        private Channel<bool> RunSignal { get; } = Channel.CreateBounded<bool>(new BoundedChannelOptions(1)
        {
            FullMode = BoundedChannelFullMode.DropWrite,
        });

        private CancellationTokenSource Cts { get; set; }
        private Task LoopTask { get; set; }
        private Task SweepTask { get; set; }
        private IDisposable OptionsSubscription { get; set; }

        // ── scan state (guarded by StateLock) ──────────────────────────────────
        private object StateLock { get; } = new();
        private bool Scanning { get; set; }
        private bool Completed { get; set; }
        private int Total { get; set; }
        private int Written { get; set; }
        private int Skipped { get; set; }
        private int Failed { get; set; }
        private DateTime PassStartUtc { get; set; }
        private ConcurrentDictionary<string, MetadataScanItem> InFlightItems { get; } = new();
        private LinkedList<MetadataScanItem> RecentItems { get; } = new();

        public MetadataScanState State
        {
            get
            {
                var enabled = Options.CurrentValue.MetadataLookup.Enabled;
                lock (StateLock)
                {
                    var done = Written + Skipped + Failed;
                    var progress = Total > 0 ? (double)done / Total : 0;
                    var eta = EstimateEtaSeconds(done);

                    var recent = InFlightItems.Values
                        .Concat(RecentItems)
                        .Take(RecentCapacity)
                        .ToList();

                    return new MetadataScanState(
                        Enabled: enabled,
                        Scanning: Scanning,
                        Completed: Completed,
                        Total: Total,
                        Written: Written,
                        Skipped: Skipped,
                        Failed: Failed,
                        Progress: progress,
                        InFlight: InFlightItems.Count,
                        EtaSeconds: eta,
                        Recent: recent);
                }
            }
        }

        // ── IHostedService ──────────────────────────────────────────────────────
        public Task StartAsync(CancellationToken cancellationToken)
        {
            Cts = CancellationTokenSource.CreateLinkedTokenSource(Program.MasterCancellationTokenSource.Token);
            var ct = Cts.Token;

            Events.Subscribe<DownloadDirectoryCompleteEvent>(nameof(MetadataLookupService), _ => Signal());
            Events.Subscribe<DownloadFileCompleteEvent>(nameof(MetadataLookupService), _ => Signal());

            OptionsSubscription = Options.OnChange(o =>
            {
                if (o.MetadataLookup.Enabled)
                {
                    Signal();
                }
            });

            LoopTask = Task.Run(() => RunLoopAsync(ct), ct);
            SweepTask = Task.Run(() => RunSweepAsync(ct), ct);

            // kick off an initial pass shortly after startup if already enabled
            _ = Task.Run(async () =>
            {
                try
                {
                    await Task.Delay(StartupDelay, ct);
                    Signal();
                }
                catch (OperationCanceledException)
                {
                    // shutting down
                }
            });

            return Task.CompletedTask;
        }

        public async Task StopAsync(CancellationToken cancellationToken)
        {
            OptionsSubscription?.Dispose();

            if (Cts != null && !Cts.IsCancellationRequested)
            {
                Cts.Cancel();
            }

            try
            {
                await Task.WhenAll(new[] { LoopTask, SweepTask }.Where(t => t != null)).WaitAsync(cancellationToken);
            }
            catch
            {
                // cancelled or timed out during shutdown — acceptable
            }
        }

        // ── Public API ────────────────────────────────────────────────────────
        public void RequestRun()
        {
            Interlocked.Exchange(ref forceRequested, 1);
            Signal();
        }

        public async Task<IReadOnlyList<MetadataMatch>> LookupAsync(MetadataLookupRequest request)
        {
            var (artist, title, album) = ResolveQuery(request);
            if (string.IsNullOrWhiteSpace(title))
            {
                return Array.Empty<MetadataMatch>();
            }

            foreach (var provider in EnabledProviders())
            {
                var results = await LookupProviderAsync(provider, artist, title, album);
                if (results.Count > 0)
                {
                    return results;
                }
            }

            return Array.Empty<MetadataMatch>();
        }

        // returns candidate list for a single provider (used by the per-track editor lookup)
        private async Task<IReadOnlyList<MetadataMatch>> LookupProviderAsync(string provider, string artist, string title, string album)
        {
            switch (provider)
            {
                case "discogs":
                    // Discogs search results already include genre/year inline
                    return await Discogs.SearchAsync(artist, title, album, limit: 5, CancellationToken.None);
                case "lastfm":
                    var lastfm = await Lastfm.SearchAsync(artist, title, CancellationToken.None);
                    return lastfm == null ? Array.Empty<MetadataMatch>() : new[] { lastfm };
                case "deezer":
                    var deezer = await Deezer.SearchAsync(artist, title, CancellationToken.None);
                    return deezer == null ? Array.Empty<MetadataMatch>() : new[] { deezer };
                default: // musicbrainz
                    var candidates = await MusicBrainz.SearchRecordingsAsync(artist, title, album, limit: 5, CancellationToken.None);
                    if (candidates.Count == 0)
                    {
                        return candidates;
                    }

                    // fill in genre for the top candidate (a second request) so the editor shows it
                    var top = candidates[0];
                    var genre = await MusicBrainz.ResolveGenreAsync(top.RecordingMbid, CancellationToken.None);
                    if (genre != null)
                    {
                        candidates = candidates.ToList();
                        ((List<MetadataMatch>)candidates)[0] = top with { Genre = genre };
                    }

                    return candidates;
            }
        }

        // The providers to query, in priority order, for the current config. Discogs is preferred
        // (far better for electronic/vinyl/underground) when enabled with a token; MusicBrainz follows.
        // Extend this list to add more services.
        private List<string> EnabledProviders()
        {
            var opts = Options.CurrentValue.MetadataLookup;
            var providers = new List<string>();

            if (opts.Discogs.Enabled && !string.IsNullOrWhiteSpace(opts.Discogs.Token))
            {
                providers.Add("discogs");
            }

            if (opts.MusicBrainz.Enabled)
            {
                providers.Add("musicbrainz");
            }

            if (opts.Lastfm.Enabled && !string.IsNullOrWhiteSpace(opts.Lastfm.ApiKey))
            {
                providers.Add("lastfm");
            }

            if (opts.Deezer.Enabled)
            {
                providers.Add("deezer");
            }

            return providers;
        }

        // a stable signature of the enabled provider set, used as the cache key — so changing which
        // providers are enabled gives every track a fresh attempt (legacy entries = "musicbrainz")
        private string ActiveProviderSet
        {
            get
            {
                var providers = EnabledProviders();
                return providers.Count == 0 ? "none" : string.Join("+", providers);
            }
        }

        // queries enabled providers in priority order, merging missing fields from each (the first
        // provider sets the identity; later ones fill empty album/year/genre/track gaps) and stopping
        // once the enrichment fields are complete
        private async Task<MetadataMatch> FindBestAsync(string artist, string title, string album, int minScore, CancellationToken ct)
        {
            MetadataMatch accumulated = null;

            foreach (var provider in EnabledProviders())
            {
                var match = await QueryProviderAsync(provider, artist, title, album, minScore, ct);
                if (match == null)
                {
                    continue;
                }

                accumulated = accumulated == null ? match : Merge(accumulated, match);
                if (IsComplete(accumulated))
                {
                    break;
                }
            }

            return accumulated;
        }

        // fills empty fields of acc from next; acc's identity (title/artist/source/score) is kept
        private static MetadataMatch Merge(MetadataMatch acc, MetadataMatch next) => acc with
        {
            Album = string.IsNullOrWhiteSpace(acc.Album) ? next.Album : acc.Album,
            AlbumArtist = string.IsNullOrWhiteSpace(acc.AlbumArtist) ? next.AlbumArtist : acc.AlbumArtist,
            Year = acc.Year != 0 ? acc.Year : next.Year,
            TrackNumber = acc.TrackNumber != 0 ? acc.TrackNumber : next.TrackNumber,
            DiscNumber = acc.DiscNumber != 0 ? acc.DiscNumber : next.DiscNumber,
            Genre = string.IsNullOrWhiteSpace(acc.Genre) ? next.Genre : acc.Genre,
        };

        private static bool IsComplete(MetadataMatch m)
            => !string.IsNullOrWhiteSpace(m.Album) && m.Year != 0 && !string.IsNullOrWhiteSpace(m.Genre);

        private async Task<MetadataMatch> QueryProviderAsync(string provider, string artist, string title, string album, int minScore, CancellationToken ct)
        {
            MetadataMatch match = null;

            switch (provider)
            {
                case "discogs":
                    match = (await Discogs.SearchAsync(artist, title, album, limit: 5, ct)).FirstOrDefault();
                    break;
                case "lastfm":
                    match = await Lastfm.SearchAsync(artist, title, ct);
                    break;
                case "deezer":
                    match = await Deezer.SearchAsync(artist, title, ct);
                    break;
                default: // musicbrainz
                    var top = (await MusicBrainz.SearchRecordingsAsync(artist, title, album, limit: 3, ct)).FirstOrDefault();
                    if (top != null)
                    {
                        match = top with { Genre = await MusicBrainz.ResolveGenreAsync(top.RecordingMbid, ct) };
                    }

                    break;
            }

            return match != null && match.Score >= minScore ? match : null;
        }

        // ── Background loop ─────────────────────────────────────────────────────
        private void Signal() => RunSignal.Writer.TryWrite(true);

        private async Task RunLoopAsync(CancellationToken ct)
        {
            try
            {
                while (await RunSignal.Reader.WaitToReadAsync(ct))
                {
                    // drain any coalesced signals; one pass covers them all
                    while (RunSignal.Reader.TryRead(out _))
                    {
                        // discard
                    }

                    var force = Interlocked.Exchange(ref forceRequested, 0) == 1;
                    if (!force && !Options.CurrentValue.MetadataLookup.Enabled)
                    {
                        continue;
                    }

                    try
                    {
                        await RunPassAsync(ct);
                    }
                    catch (OperationCanceledException)
                    {
                        break;
                    }
                    catch (Exception ex)
                    {
                        Log.Error(ex, "Metadata enrichment pass failed unexpectedly");
                    }
                }
            }
            catch (OperationCanceledException)
            {
                // shutting down
            }
        }

        private async Task RunSweepAsync(CancellationToken ct)
        {
            try
            {
                using var timer = new PeriodicTimer(SweepInterval);
                while (await timer.WaitForNextTickAsync(ct))
                {
                    if (Options.CurrentValue.MetadataLookup.Enabled)
                    {
                        Signal();
                    }
                }
            }
            catch (OperationCanceledException)
            {
                // shutting down
            }
        }

        private async Task RunPassAsync(CancellationToken ct)
        {
            var candidates = BuildCandidates();

            lock (StateLock)
            {
                Scanning = true;
                Completed = false;
                Total = candidates.Count;
                Written = 0;
                Skipped = 0;
                Failed = 0;
                PassStartUtc = DateTime.UtcNow;
                InFlightItems.Clear();
                RecentItems.Clear();
            }

            if (candidates.Count == 0)
            {
                lock (StateLock)
                {
                    Scanning = false;
                    Completed = true;
                }

                return;
            }

            Log.Information("Metadata enrichment pass started for {Count} track(s)", candidates.Count);
            MusicLibrary?.RegisterQueue("metadata");

            try
            {
                var workers = Math.Max(1, Options.CurrentValue.MetadataLookup.Workers);
                var channel = Channel.CreateUnbounded<Candidate>();
                foreach (var candidate in candidates)
                {
                    await channel.Writer.WriteAsync(candidate, ct);
                }

                channel.Writer.Complete();

                var tasks = Enumerable.Range(0, workers)
                    .Select(_ => Task.Run(() => WorkerAsync(channel.Reader, ct), ct))
                    .ToArray();

                await Task.WhenAll(tasks);
            }
            catch (OperationCanceledException)
            {
                // expected on cancel
            }
            finally
            {
                MusicLibrary?.DeregisterQueue("metadata");
                AttemptCache.Save();
                lock (StateLock)
                {
                    Scanning = false;
                    Completed = !ct.IsCancellationRequested;
                    InFlightItems.Clear();
                }

                Log.Information("Metadata enrichment pass complete. Written: {Written}, Skipped: {Skipped}, Failed: {Failed}", Written, Skipped, Failed);
            }
        }

        private async Task WorkerAsync(System.Threading.Channels.ChannelReader<Candidate> reader, CancellationToken ct)
        {
            var minScore = Options.CurrentValue.MetadataLookup.MinScore;

            await foreach (var candidate in reader.ReadAllAsync(ct))
            {
                if (ct.IsCancellationRequested)
                {
                    break;
                }

                MarkLooking(candidate);

                try
                {
                    var match = await FindBestAsync(candidate.Artist, candidate.Title, candidate.Album, minScore, ct);

                    if (match == null)
                    {
                        RecordOutcome(candidate, MetadataItemStatus.NoMatch, "no confident match");
                        RecordAttempt(candidate.OriginalPath);
                        continue;
                    }

                    WriteMatch(candidate.Masked, match);

                    // record after writing so the cached fingerprint reflects the post-write file
                    RecordAttempt(candidate.OriginalPath);
                    RecordOutcome(candidate, MetadataItemStatus.Written, FormatSummary(match));
                }
                catch (OperationCanceledException)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    Log.Debug("Metadata enrichment failed for '{File}': {Error}", candidate.Filename, ex.Message);
                    RecordOutcome(candidate, MetadataItemStatus.Failed, ex.Message);
                }
            }
        }

        private void WriteMatch(string maskedFilename, MetadataMatch match)
        {
            var existing = ShareService.GetAllTags().TryGetValue(maskedFilename, out var tags) ? tags : null;
            ShareService.WriteFileTags(maskedFilename, MergeTags(existing, match));
        }

        /// <summary>
        ///     Merges a match onto existing tags: matched fields overwrite, but a missing match field
        ///     (empty/zero) never clobbers an existing value. Exposed for testing.
        /// </summary>
        /// <returns>The merged tags to write.</returns>
        public static FileTags MergeTags(FileTags existing, MetadataMatch match)
        {
            var baseTags = existing ?? new FileTags(null, null, null, null, 0, 0);

            return baseTags with
            {
                Title = string.IsNullOrWhiteSpace(match.Title) ? baseTags.Title : match.Title,
                Artist = string.IsNullOrWhiteSpace(match.Artist) ? baseTags.Artist : match.Artist,
                Album = string.IsNullOrWhiteSpace(match.Album) ? baseTags.Album : match.Album,
                AlbumArtist = !string.IsNullOrWhiteSpace(match.AlbumArtist) ? match.AlbumArtist
                    : !string.IsNullOrWhiteSpace(match.Artist) ? match.Artist
                    : baseTags.AlbumArtist,
                Year = match.Year != 0 ? match.Year : baseTags.Year,
                TrackNumber = match.TrackNumber != 0 ? match.TrackNumber : baseTags.TrackNumber,
                DiscNumber = match.DiscNumber != 0 ? match.DiscNumber : baseTags.DiscNumber,
                Genre = string.IsNullOrWhiteSpace(match.Genre) ? baseTags.Genre : match.Genre,
            };
        }

        // ── Candidate selection ─────────────────────────────────────────────────
        private List<Candidate> BuildCandidates()
        {
            var result = new List<Candidate>();
            var skipped = 0;

            foreach (var file in ShareService.GetTaggedFiles())
            {
                if (!AudioExtensions.Contains(file.Extension) || !NeedsEnrichment(file.Tags))
                {
                    continue;
                }

                if (AlreadyAttempted(file.OriginalFilename))
                {
                    skipped++;
                    continue;
                }

                var (artist, title) = ResolveArtistTitle(file.Tags?.Artist, file.Tags?.Title, file.Filename);
                result.Add(new Candidate(file.MaskedFilename, file.OriginalFilename, file.Filename, artist, title, file.Tags?.Album));
            }

            foreach (var file in ShareService.GetUntaggedFiles())
            {
                if (!AudioExtensions.Contains(file.Extension))
                {
                    continue;
                }

                if (AlreadyAttempted(file.OriginalFilename))
                {
                    skipped++;
                    continue;
                }

                var (artist, title) = ParseFilename(file.Filename);
                if (!string.IsNullOrWhiteSpace(title))
                {
                    result.Add(new Candidate(file.MaskedFilename, file.OriginalFilename, file.Filename, artist, title, null));
                }
            }

            if (skipped > 0)
            {
                Log.Debug("Skipped {Skipped} already-attempted track(s)", skipped);
            }

            return result;
        }

        // true when the file has already been looked up by the active provider (same fingerprint,
        // within the retry window). Switching providers gives every file a fresh attempt.
        private bool AlreadyAttempted(string path)
            => TryFingerprint(path, out var size, out var modified)
                && AttemptCache.ShouldSkip(path, size, modified, ActiveProviderSet, RetryAfter);

        private static bool TryFingerprint(string path, out long size, out long modified)
        {
            size = 0;
            modified = 0;
            try
            {
                var info = new System.IO.FileInfo(path);
                if (!info.Exists)
                {
                    return false;
                }

                size = info.Length;
                modified = info.LastWriteTimeUtc.Ticks;
                return true;
            }
            catch
            {
                return false;
            }
        }

        // records the attempt (with the file's current, post-write fingerprint) and persists periodically
        private void RecordAttempt(string path)
        {
            if (TryFingerprint(path, out var size, out var modified))
            {
                AttemptCache.Record(path, size, modified, ActiveProviderSet);
            }

            if (Interlocked.Increment(ref sinceLastSave) >= SaveEvery)
            {
                Interlocked.Exchange(ref sinceLastSave, 0);
                AttemptCache.Save();
            }
        }

        private static bool NeedsEnrichment(FileTags tags)
        {
            if (tags == null)
            {
                return true;
            }

            return string.IsNullOrWhiteSpace(tags.Title)
                || string.IsNullOrWhiteSpace(tags.Artist)
                || string.IsNullOrWhiteSpace(tags.Album)
                || tags.Year == 0
                || string.IsNullOrWhiteSpace(tags.Genre);
        }

        private (string Artist, string Title, string Album) ResolveQuery(MetadataLookupRequest request)
        {
            if (!string.IsNullOrWhiteSpace(request.Title))
            {
                return (request.Artist, request.Title, request.Album);
            }

            if (!string.IsNullOrWhiteSpace(request.MaskedFilename))
            {
                if (ShareService.GetAllTags().TryGetValue(request.MaskedFilename, out var tags) && tags != null
                    && (!string.IsNullOrWhiteSpace(tags.Title) || !string.IsNullOrWhiteSpace(tags.Artist)))
                {
                    var (artist, title) = ResolveArtistTitle(tags.Artist, tags.Title, LeafName(request.MaskedFilename));
                    return (artist, title, tags.Album);
                }

                var parsed = ParseFilename(LeafName(request.MaskedFilename));
                return (parsed.Artist, parsed.Title, null);
            }

            return (request.Artist, null, request.Album);
        }

        private static (string Artist, string Title) ResolveArtistTitle(string artist, string title, string filename)
        {
            if (!string.IsNullOrWhiteSpace(title))
            {
                return (artist, title);
            }

            return ParseFilename(filename);
        }

        private static (string Artist, string Title) ParseFilename(string filename)
        {
            if (string.IsNullOrWhiteSpace(filename))
            {
                return (null, null);
            }

            var name = System.IO.Path.GetFileNameWithoutExtension(filename);
            var separator = name.IndexOf(" - ", StringComparison.Ordinal);
            if (separator > 0)
            {
                var artist = name[..separator].Trim();
                var title = name[(separator + 3)..].Trim();
                return (string.IsNullOrWhiteSpace(artist) ? null : artist, string.IsNullOrWhiteSpace(title) ? null : title);
            }

            return (null, name.Trim());
        }

        private static string LeafName(string maskedFilename)
        {
            var separator = maskedFilename.LastIndexOf('\\');
            return separator >= 0 ? maskedFilename[(separator + 1)..] : maskedFilename;
        }

        // ── State helpers ────────────────────────────────────────────────────────
        private void MarkLooking(Candidate candidate)
        {
            InFlightItems[candidate.Masked] = new MetadataScanItem(candidate.Masked, candidate.Filename, MetadataItemStatus.Looking, null);
        }

        private void RecordOutcome(Candidate candidate, MetadataItemStatus status, string summary)
        {
            InFlightItems.TryRemove(candidate.Masked, out _);
            var item = new MetadataScanItem(candidate.Masked, candidate.Filename, status, summary);

            lock (StateLock)
            {
                RecentItems.AddFirst(item);
                while (RecentItems.Count > RecentCapacity)
                {
                    RecentItems.RemoveLast();
                }

                switch (status)
                {
                    case MetadataItemStatus.Written:
                        Written++;
                        break;
                    case MetadataItemStatus.NoMatch:
                        Skipped++;
                        break;
                    case MetadataItemStatus.Failed:
                        Failed++;
                        break;
                }
            }
        }

        private int EstimateEtaSeconds(int done)
        {
            var remaining = Total - done;
            if (remaining <= 0)
            {
                return 0;
            }

            if (done > 0)
            {
                var perItem = (DateTime.UtcNow - PassStartUtc).TotalSeconds / done;
                return (int)Math.Round(perItem * remaining);
            }

            // before anything completes, estimate ~2 requests per track at the configured rate
            var rate = Math.Max(0.1, Options.CurrentValue.MetadataLookup.RateLimitPerSecond);
            return (int)Math.Round(remaining * 2 / rate);
        }

        private static string FormatSummary(MetadataMatch match)
        {
            var year = match.Year != 0 ? $" ({match.Year})" : string.Empty;
            var artist = string.IsNullOrWhiteSpace(match.Artist) ? string.Empty : $"{match.Artist} – ";
            return $"{artist}{match.Title}{year}";
        }

        private sealed record Candidate(string Masked, string OriginalPath, string Filename, string Artist, string Title, string Album);
    }
}
