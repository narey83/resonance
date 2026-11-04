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
    using resonance.Common;
    using resonance.Events;
    using resonance.MusicLibrary;
    using resonance.Shares;
    using resonance.TagSanitization;
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

        private static readonly HashSet<string> AudioExtensions = new(StringComparer.OrdinalIgnoreCase)
        {
            "mp3", "flac", "ogg", "wav", "m4a", "aac", "opus", "wma", "aiff", "aif",
        };

        // set via Interlocked, so must be fields rather than properties
        private int forceRequested;
        private int fullRescanRequested;
        private int sinceLastSave;

        public MetadataLookupService(IShareService shareService, IOptionsMonitor<resonance.Options> optionsMonitor, MusicBrainzClient musicBrainz, DiscogsClient discogs, LastfmClient lastfm, DeezerClient deezer, EventBus eventBus, IMusicLibraryService musicLibrary = null)
            : this(shareService, optionsMonitor, musicBrainz, discogs, lastfm, deezer, eventBus, musicLibrary,
                Program.DataDirectory ?? System.IO.Path.GetTempPath())
        {
        }

        internal MetadataLookupService(IShareService shareService, IOptionsMonitor<resonance.Options> optionsMonitor, MusicBrainzClient musicBrainz, DiscogsClient discogs, LastfmClient lastfm, DeezerClient deezer, EventBus eventBus, IMusicLibraryService musicLibrary, string dataDirectory, ILogger logger = null)
        {
            Log = logger ?? Serilog.Log.ForContext("SourceContext", Logs.Music.Metadata);
            ShareService = shareService;
            IndexGate = new EnrichmentIndexGate(() => ShareService.StateMonitor.CurrentValue);
            Options = optionsMonitor;
            MusicBrainz = musicBrainz;
            Discogs = discogs;
            Lastfm = lastfm;
            Deezer = deezer;
            Events = eventBus;
            MusicLibrary = musicLibrary;
            AttemptCache = new MetadataAttemptCache(
                System.IO.Path.Combine(dataDirectory, "metadata-lookup-attempts.json"),
                Log);
            Activity = new MetadataActivityStore(
                System.IO.Path.Combine(dataDirectory, "metadata-lookup-activity.jsonl"), Log);
        }

        public MetadataScanState State
        {
            get
            {
                var enabled = Options.CurrentValue.MetadataLookup.Enabled;
                lock (StateLock)
                {
                    var done = Written + Skipped + Failed;
                    var progress = Total > 0 ? (double)done / Total : 0;
                    var paused = Scanning && IndexGate.Blocked;
                    var eta = paused ? 0 : EstimateEtaSeconds(done);

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
                        Recent: recent,
                        Paused: paused,
                        PauseReason: paused ? "Waiting for share indexing" : null,
                        Providers: EnabledProviders());
                }
            }
        }

        private IShareService ShareService { get; }
        private EnrichmentIndexGate IndexGate { get; }
        private IOptionsMonitor<resonance.Options> Options { get; }
        private MusicBrainzClient MusicBrainz { get; }
        private DiscogsClient Discogs { get; }
        private LastfmClient Lastfm { get; }
        private DeezerClient Deezer { get; }
        private EventBus Events { get; }
        private IMusicLibraryService MusicLibrary { get; }
        private MetadataAttemptCache AttemptCache { get; }
        private MetadataActivityStore Activity { get; }
        private ConcurrentDictionary<string, PendingMatch> PendingMatches { get; } = new();
        private ILogger Log { get; }

        private Channel<bool> RunSignal { get; } = Channel.CreateBounded<bool>(new BoundedChannelOptions(1)
        {
            FullMode = BoundedChannelFullMode.DropWrite,
        });

        private CancellationTokenSource Cts { get; set; }

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

        // True while a user-initiated tag sanitization scan is running. Per-file safety is
        // guaranteed by FileWriteLock; this is an optimization to avoid spending provider
        // lookups on files a sanitization scan is about to rewrite anyway.
        private bool SanitizationActive => MusicLibrary?.IsQueueActive(TagSanitizationService.QueueName) == true;

        private CancellationTokenSource PassCts { get; set; }
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

        /// <summary>
        ///     Merges a match onto existing tags fill-only: a provider value is used only when the
        ///     existing field is empty (or zero). A value already in the file — whether from the
        ///     original tags or a user edit — is never overwritten by an online lookup. Exposed for
        ///     testing.
        /// </summary>
        /// <returns>The merged tags to write.</returns>
        public static FileTags MergeTags(FileTags? existing, MetadataMatch match)
        {
            var baseTags = existing ?? new FileTags(null, null, null, null, 0, 0);

            return baseTags with
            {
                Title = Fill(baseTags.Title, match.Title),
                Artist = Fill(baseTags.Artist, match.Artist),
                Album = Fill(baseTags.Album, match.Album),
                AlbumArtist = Fill(baseTags.AlbumArtist, !string.IsNullOrWhiteSpace(match.AlbumArtist) ? match.AlbumArtist : match.Artist),
                Year = baseTags.Year != 0 ? baseTags.Year : match.Year,
                TrackNumber = baseTags.TrackNumber != 0 ? baseTags.TrackNumber : match.TrackNumber,
                DiscNumber = baseTags.DiscNumber != 0 ? baseTags.DiscNumber : match.DiscNumber,
                Genre = Fill(baseTags.Genre, match.Genre),
            };

            static string Fill(string existingValue, string matchValue)
                => string.IsNullOrWhiteSpace(existingValue) && !string.IsNullOrWhiteSpace(matchValue) ? matchValue : existingValue;
        }

        public MetadataActivityPage GetActivity(int page, int pageSize, string search, string outcome)
        {
            var summaries = Activity.Summaries();
            var paths = new Dictionary<string, string>(StringComparer.Ordinal);
            var tracks = ShareService.GetTaggedFiles().Select(file => (file.MaskedFilename, file.OriginalFilename, file.Filename, file.Directory, file.Extension))
                .Concat(ShareService.GetUntaggedFiles().Select(file => (file.MaskedFilename, file.OriginalFilename, file.Filename, file.Directory, file.Extension)))
                .Where(file => AudioExtensions.Contains(file.Extension))
                .DistinctBy(file => file.MaskedFilename)
                .Select(file =>
                {
                    paths[file.MaskedFilename] = file.OriginalFilename;
                    summaries.TryGetValue(MusicPath.ToRelative(file.OriginalFilename), out var evidence);
                    var state = evidence.Latest?.Status ?? (AttemptCache.ShouldSkip(file.OriginalFilename) ? "Unknown" : "NotChecked");
                    return new MetadataTrackActivity(file.MaskedFilename, file.Filename, file.Directory, state,
                        evidence.Latest == null ? [] : [evidence.Latest], evidence.LastUpdate);
                }).ToArray();
            var updated = tracks.Count(track => track.LastUpdate != null);
            var unknown = tracks.Count(track => track.LastUpdate == null && track.Status is "Unknown" or "NotChecked");
            var filtered = tracks.Where(track => (string.IsNullOrWhiteSpace(search)
                    || (track.Filename + " " + track.Directory).Contains(search, StringComparison.OrdinalIgnoreCase))
                && (string.IsNullOrEmpty(outcome) || outcome == "all"
                    || (outcome == "updated" && track.LastUpdate != null)
                    || (outcome == "notupdated" && track.LastUpdate == null && track.Status is not "Unknown" and not "NotChecked")
                    || (outcome == "unknown" && track.LastUpdate == null && track.Status is "Unknown" or "NotChecked")))
                .OrderByDescending(track => track.History.FirstOrDefault()?.At)
                .ThenBy(track => track.MaskedFilename, StringComparer.Ordinal).ToArray();
            return new MetadataActivityPage(tracks.Length, updated, tracks.Length - updated - unknown, unknown,
                page, pageSize, filtered.Length, Activity.Healthy, filtered.Skip((page - 1) * pageSize).Take(pageSize)
                    .Select(track => track with { History = Activity.Get(paths[track.MaskedFilename]).History }).ToArray());
        }

        public void WriteLookupTags(string maskedFilename, FileTags tags, string lookupId)
        {
            if (!PendingMatches.TryGetValue(lookupId, out var pending) || pending.Expires <= DateTimeOffset.UtcNow
                || pending.MaskedFilename != maskedFilename)
            {
                throw new ArgumentException("The lookup preview expired. Look up this track again before saving.");
            }

            var file = ShareService.FindFiles([maskedFilename]).FirstOrDefault() ?? throw new NotFoundException("Track not found");
            var expected = MetadataTagEvidence.Values(MergeTags(null, pending.Match));
            var submitted = MetadataTagEvidence.Values(tags);
            var sources = pending.Match.FieldSources.Where(pair => expected[pair.Key] == submitted[pair.Key])
                .ToDictionary(pair => pair.Key, pair => pair.Value);
            try
            {
                var result = MetadataTagEvidence.Write(MusicPath.ToAbsolute(file.OriginalFilename), _ => tags,
                    sources, proposed => ShareService.WriteFileTags(maskedFilename, proposed));
                AddActivity(file.OriginalFilename, result.Fields.Count > 0 ? "Updated" : "Unchanged", "Editor",
                    result.Fields.Count > 0 ? "Saved online metadata" : "Saved draft; no changed online fields confirmed", result.Fields);
                PendingMatches.TryRemove(lookupId, out _);
            }
            catch
            {
                AddActivity(file.OriginalFilename, "Failed", "Editor", "Could not confirm saved online metadata");
                throw;
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
                else
                {
                    RequestStop();
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
        public void RequestRun(bool fullRescan = false)
        {
            Interlocked.Exchange(ref forceRequested, 1);
            if (fullRescan)
            {
                Interlocked.Exchange(ref fullRescanRequested, 1);
            }

            Signal();
        }

        public void RequestStop()
        {
            try
            {
                PassCts?.Cancel();
            }
            catch (ObjectDisposedException)
            {
                // the pass finished between the null check and Cancel(); nothing to do
            }
        }

        public async Task<IReadOnlyList<MetadataMatch>> LookupAsync(MetadataLookupRequest request)
        {
            var (artist, title, album) = ResolveQuery(request);
            if (string.IsNullOrWhiteSpace(title))
            {
                return Array.Empty<MetadataMatch>();
            }

            var file = string.IsNullOrEmpty(request.MaskedFilename) ? null : ShareService.FindFiles([request.MaskedFilename]).FirstOrDefault();
            try
            {
                foreach (var provider in EnabledProviders())
                {
                    var results = await LookupProviderAsync(provider, artist, title, album);
                    if (results.Count == 0)
                    {
                        continue;
                    }

                    if (file == null)
                    {
                        return results;
                    }

                    foreach (var key in PendingMatches.Where(pair => pair.Value.Expires <= DateTimeOffset.UtcNow).Select(pair => pair.Key))
                    {
                        PendingMatches.TryRemove(key, out _);
                    }

                    // Bound candidate memory even if clients repeatedly preview without saving.
                    while (PendingMatches.Count >= 1000)
                    {
                        PendingMatches.TryRemove(PendingMatches.First().Key, out _);
                    }

                    var issued = results.Take(10).Select(match =>
                    {
                        var id = Guid.NewGuid().ToString("N");
                        var sourced = WithSources(match, provider);
                        PendingMatches[id] = new PendingMatch(file.MaskedFilename, sourced, DateTimeOffset.UtcNow.AddHours(2));
                        return sourced with { LookupId = id };
                    }).ToArray();
                    AddActivity(file.OriginalFilename, "Preview", "Editor", "Match found; draft has not been saved");
                    return issued;
                }

                if (file != null)
                {
                    AddActivity(file.OriginalFilename, "NoMatch", "Editor", "No online match found; no tags updated");
                }

                return Array.Empty<MetadataMatch>();
            }
            catch
            {
                if (file != null)
                {
                    AddActivity(file.OriginalFilename, "Failed", "Editor", "Online lookup failed; no update confirmed");
                }

                throw;
            }
        }

        private static IReadOnlyDictionary<string, string> MergeSources(MetadataMatch acc, MetadataMatch next)
        {
            var sources = new Dictionary<string, string>(acc.FieldSources);
            var values = MetadataTagEvidence.Values(new FileTags(acc.Artist, acc.AlbumArtist, acc.Album, acc.Title,
                acc.TrackNumber, acc.Year, Genre: acc.Genre, DiscNumber: acc.DiscNumber));
            var nextValues = MetadataTagEvidence.Values(new FileTags(next.Artist, next.AlbumArtist, next.Album, next.Title,
                next.TrackNumber, next.Year, Genre: next.Genre, DiscNumber: next.DiscNumber));
            foreach (var field in new[] { "Album", "Album artist", "Year", "Track number", "Disc number", "Genre" })
            {
                if ((string.IsNullOrWhiteSpace(values[field]) || values[field] == "0")
                    && !string.IsNullOrWhiteSpace(nextValues[field]) && nextValues[field] != "0")
                {
                    sources[field] = next.FieldSources[field];
                }
            }

            return sources;
        }

        private static MetadataMatch WithSources(MetadataMatch match, string provider)
        {
            var source = match.Source ?? provider switch
            {
                "musicbrainz" => "MusicBrainz",
                "discogs" => "Discogs",
                "lastfm" => "Last.fm",
                "deezer" => "Deezer",
                _ => provider,
            };
            return match with
            {
                Source = source,
                FieldSources = MetadataTagEvidence.Values(MergeTags(null, match))
                    .Where(pair => !string.IsNullOrWhiteSpace(pair.Value) && pair.Value != "0")
                    .ToDictionary(pair => pair.Key, _ => source),
            };
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
            FieldSources = MergeSources(acc, next),
        };

        private static bool IsComplete(MetadataMatch m)
            => !string.IsNullOrWhiteSpace(m.Album) && m.Year != 0 && !string.IsNullOrWhiteSpace(m.Genre);

        // A stable, normalized identity for the lookup query (artist|title|album). Normalization
        // (trim, collapse whitespace, lowercase) keeps trivial tag tidy-ups from looking like a change.
        private static string BuildIdentity(string artist, string title, string album)
            => string.Join('|', NormalizeField(artist), NormalizeField(title), NormalizeField(album));

        private static string NormalizeField(string value)
            => string.IsNullOrWhiteSpace(value)
                ? string.Empty
                : string.Join(' ', value.Split((char[])null, StringSplitOptions.RemoveEmptyEntries)).ToLowerInvariant();

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

        private static string FormatSummary(MetadataMatch match)
        {
            var year = match.Year != 0 ? $" ({match.Year})" : string.Empty;
            var artist = string.IsNullOrWhiteSpace(match.Artist) ? string.Empty : $"{match.Artist} – ";
            return $"{artist}{match.Title}{year}";
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

        // queries enabled providers in priority order, merging missing fields from each (the first
        // provider sets the identity; later ones fill empty album/year/genre/track gaps) and stopping
        // once the enrichment fields are complete
        private async Task<MetadataMatch> FindBestAsync(string artist, string title, string album, int minScore, CancellationToken ct)
        {
            MetadataMatch accumulated = null;

            foreach (var provider in EnabledProviders())
            {
                await IndexGate.WaitAsync(ct);
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

            return match != null && match.Score >= minScore ? WithSources(match, provider) : null;
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
                    var fullRescan = Interlocked.Exchange(ref fullRescanRequested, 0) == 1;
                    if (!force && !Options.CurrentValue.MetadataLookup.Enabled)
                    {
                        continue;
                    }

                    try
                    {
                        await RunPassAsync(ct, fullRescan);
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
                // Keep network probes out of startup, even when enrichment is disabled.
                // Perform this optional cleanup once, on an enabled scheduled sweep.
                var cleanupPending = true;
                using var timer = new PeriodicTimer(SweepInterval);
                while (await timer.WaitForNextTickAsync(ct))
                {
                    if (Options.CurrentValue.MetadataLookup.Enabled)
                    {
                        if (cleanupPending && !IndexGate.Blocked)
                        {
                            AttemptCache.PruneMissing(ct);
                            cleanupPending = false;
                        }

                        Signal();
                    }
                }
            }
            catch (OperationCanceledException)
            {
                // shutting down
            }
        }

        // Re-arm the loop after a short delay so deferred/aborted passes resume once the
        // sanitization scan releases the files (DeregisterQueue does not signal us directly).
        private void ScheduleRetry(CancellationToken ct)
        {
            _ = Task.Run(async () =>
            {
                try
                {
                    await Task.Delay(TimeSpan.FromSeconds(30), ct);
                    Signal();
                }
                catch (OperationCanceledException)
                {
                    // shutting down
                }
            });
        }

        private async Task RunPassAsync(CancellationToken ct, bool fullRescan = false)
        {
            if (SanitizationActive)
            {
                Log.Information("Metadata enrichment deferred — tag sanitization in progress.");
                ScheduleRetry(ct);
                return;
            }

            // Install the cancellation source before waiting so Stop/disable also cancels a queued pass.
            using var passCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            PassCts = passCts;
            var passToken = passCts.Token;
            var registered = false;
            lock (StateLock)
            {
                Scanning = true;
                Completed = false;
                Total = 0;
                Written = 0;
                Skipped = 0;
                Failed = 0;
                PassStartUtc = DateTime.UtcNow;
                InFlightItems.Clear();
                RecentItems.Clear();
            }

            try
            {
                // Do not enumerate the share/tag caches while their index is being rebuilt.
                await IndexGate.WaitAsync(passToken);
                var candidates = BuildCandidates(fullRescan);
                lock (StateLock)
                {
                    Total = candidates.Count;
                }

                if (candidates.Count == 0)
                {
                    Log.Debug("Metadata enrichment check found no eligible tracks");
                    return;
                }

                Log.Information("Metadata enrichment pass started for {Count} track(s)", candidates.Count);
                MusicLibrary?.RegisterQueue("metadata");
                registered = true;
                var workers = Math.Max(1, Options.CurrentValue.MetadataLookup.Workers);
                var channel = Channel.CreateUnbounded<Candidate>();
                foreach (var candidate in candidates)
                {
                    await channel.Writer.WriteAsync(candidate, passToken);
                }

                channel.Writer.Complete();
                var tasks = Enumerable.Range(0, workers)
                    .Select(_ => Task.Run(() => WorkerAsync(channel.Reader, passToken), passToken))
                    .ToArray();
                await Task.WhenAll(tasks);
            }
            catch (OperationCanceledException)
            {
                // expected on stop, disable or shutdown
            }
            finally
            {
                PassCts = null;
                if (registered)
                {
                    MusicLibrary?.DeregisterQueue("metadata");
                }

                if (registered)
                {
                    AttemptCache.Save();
                }

                lock (StateLock)
                {
                    Scanning = false;
                    Completed = !passToken.IsCancellationRequested;
                    InFlightItems.Clear();
                }

                if (registered)
                {
                    Log.Information("Metadata enrichment pass complete. Written: {Written}, Skipped: {Skipped}, Failed: {Failed}", Written, Skipped, Failed);
                }
            }
        }

        private async Task WorkerAsync(System.Threading.Channels.ChannelReader<Candidate> reader, CancellationToken ct)
        {
            var minScore = Options.CurrentValue.MetadataLookup.MinScore;

            await foreach (var candidate in reader.ReadAllAsync(ct))
            {
                // Honour a mid-pass disable from config; without this a pass over a large
                // backlog keeps hitting providers for days after the feature is switched off.
                if (ct.IsCancellationRequested || !Options.CurrentValue.MetadataLookup.Enabled)
                {
                    break;
                }

                await IndexGate.WaitAsync(ct);
                MarkLooking(candidate);
                var started = System.Diagnostics.Stopwatch.GetTimestamp();
                using var trackScope = Serilog.Context.LogContext.PushProperty("TrackId", candidate.Masked);
                Log.Debug("Online lookup started with {ProviderCount} available providers", EnabledProviders().Count);

                try
                {
                    var match = await FindBestAsync(candidate.Artist, candidate.Title, candidate.Album, minScore, ct);
                    await IndexGate.WaitAsync(ct);

                    if (match == null)
                    {
                        RecordOutcome(candidate, MetadataItemStatus.NoMatch, "no confident match");
                        AddActivity(candidate.OriginalPath, "NoMatch", "Automatic", "No confident match; no tags updated");

                        // a no-match is permanent for this query: automatic passes never retry it
                        // (the providers are very unlikely to find it later); only a retag of the
                        // file or a user-requested full re-scan queries it again
                        RecordAttempt(candidate.OriginalPath, BuildIdentity(candidate.Artist, candidate.Title, candidate.Album), MetadataAttemptCache.OutcomeNoMatch);
                        continue;
                    }

                    // Keep an already-fetched match in memory until indexing finishes.
                    await IndexGate.WaitAsync(ct);
                    var result = MetadataTagEvidence.Write(MusicPath.ToAbsolute(candidate.OriginalPath), existing => MergeTags(existing, match),
                        match.FieldSources, proposed => ShareService.WriteFileTags(candidate.Masked, proposed));
                    var written = result.Tags;
                    var changed = result.Fields.Count > 0;
                    Log.Debug("Online lookup confirmed {ChangedCount} changed fields: {ChangedFields}", result.Fields.Count, result.Fields.Keys);
                    if (changed)
                    {
                        Log.Information("Metadata enriched for {Track}. Updated fields: {ChangedFields}", candidate.Filename, result.Fields.Keys);
                    }

                    AddActivity(candidate.OriginalPath, changed ? "Updated" : "Unchanged", "Automatic",
                        changed ? "Saved online metadata" : "Match supplied no changed fields confirmed on disk", result.Fields);

                    // record against the post-write identity so the enriched file isn't re-queried
                    // next pass (the write may have changed artist/title/album)
                    RecordAttempt(candidate.OriginalPath, BuildIdentity(written.Artist, written.Title, written.Album), changed ? MetadataAttemptCache.OutcomeWritten : "unchanged");
                    RecordOutcome(candidate, changed ? MetadataItemStatus.Written : MetadataItemStatus.Unchanged, FormatSummary(match));
                }
                catch (OperationCanceledException)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    Log.Warning("Online lookup or tag verification failed: {ErrorType}, code {ErrorCode}", ex.GetType().Name, ex.HResult);
                    Log.Debug("Online lookup failure details: {Diagnostic}", resonance.Core.Http.SensitiveData.RedactText(ex.ToString()));
                    RecordOutcome(candidate, MetadataItemStatus.Failed, "Lookup or write failed");
                    AddActivity(candidate.OriginalPath, "Failed", "Automatic", "Lookup or write failed; no update confirmed");
                }
                finally
                {
                    Log.Debug("Online lookup finished in {ElapsedMilliseconds:F1}ms", System.Diagnostics.Stopwatch.GetElapsedTime(started).TotalMilliseconds);
                }
            }
        }

        // ── Candidate selection ─────────────────────────────────────────────────
        private List<Candidate> BuildCandidates(bool fullRescan = false)
        {
            var result = new List<Candidate>();
            var skipped = 0;

            foreach (var file in ShareService.GetTaggedFiles())
            {
                if (!AudioExtensions.Contains(file.Extension) || !NeedsEnrichment(file.Tags))
                {
                    continue;
                }

                var (artist, title) = ResolveArtistTitle(file.Tags?.Artist, file.Tags?.Title, file.Filename);
                var album = file.Tags?.Album;

                if (!fullRescan && AlreadyAttempted(file.OriginalFilename))
                {
                    skipped++;
                    continue;
                }

                result.Add(new Candidate(file.MaskedFilename, file.OriginalFilename, file.Filename, artist, title, album));
            }

            foreach (var file in ShareService.GetUntaggedFiles())
            {
                if (!AudioExtensions.Contains(file.Extension))
                {
                    continue;
                }

                var (artist, title) = ParseFilename(file.Filename);
                if (string.IsNullOrWhiteSpace(title))
                {
                    continue;
                }

                if (!fullRescan && AlreadyAttempted(file.OriginalFilename))
                {
                    skipped++;
                    continue;
                }

                result.Add(new Candidate(file.MaskedFilename, file.OriginalFilename, file.Filename, artist, title, null));
            }

            if (skipped > 0)
            {
                Log.Debug("Skipped {Skipped} already-attempted track(s)", skipped);
            }

            return result;
        }

        // true when this file has already been looked up once. Automatic passes never retry an
        // attempted file — not for retag, provider or age reasons — because mass re-attempts
        // rewrite tags users already fixed. A forced full re-scan bypasses this entirely.
        private bool AlreadyAttempted(string path)
            => AttemptCache.ShouldSkip(path);

        // records the attempt (keyed by the given query identity) and persists periodically
        private void RecordAttempt(string path, string identity, string outcome = null)
        {
            AttemptCache.Record(path, identity, ActiveProviderSet, outcome);

            if (Interlocked.Increment(ref sinceLastSave) >= SaveEvery)
            {
                Interlocked.Exchange(ref sinceLastSave, 0);
                AttemptCache.Save();
            }
        }

        private void AddActivity(string path, string status, string origin, string summary, IReadOnlyDictionary<string, string> fields = null)
            => Activity.Record(path, new MetadataActivityEvent(Guid.NewGuid().ToString("N"), DateTimeOffset.UtcNow,
                status, origin, summary, fields ?? new Dictionary<string, string>()));

        private (string Artist, string Title, string Album) ResolveQuery(MetadataLookupRequest request)
        {
            if (!string.IsNullOrWhiteSpace(request.Title))
            {
                return (request.Artist, request.Title, request.Album);
            }

            if (!string.IsNullOrWhiteSpace(request.MaskedFilename))
            {
                var tags = ShareService.GetTags(request.MaskedFilename);
                if (tags != null && (!string.IsNullOrWhiteSpace(tags.Title) || !string.IsNullOrWhiteSpace(tags.Artist)))
                {
                    var (artist, title) = ResolveArtistTitle(tags.Artist, tags.Title, LeafName(request.MaskedFilename));
                    return (artist, title, tags.Album);
                }

                var parsed = ParseFilename(LeafName(request.MaskedFilename));
                return (parsed.Artist, parsed.Title, null);
            }

            return (request.Artist, null, request.Album);
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
                    case MetadataItemStatus.Unchanged:
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

        private sealed record PendingMatch(string MaskedFilename, MetadataMatch Match, DateTimeOffset Expires);
        private sealed record Candidate(string Masked, string OriginalPath, string Filename, string Artist, string Title, string Album);
    }
}
