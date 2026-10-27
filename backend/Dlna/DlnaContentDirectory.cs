// <copyright file="DlnaContentDirectory.cs" company="John Narey">
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

namespace resonance.Dlna
{
    using System;
    using System.Collections.Generic;
    using System.IO;
    using System.Linq;
    using System.Text;
    using System.Xml.Linq;
    using resonance.MusicLibrary;

    public static class DlnaContentDirectory
    {
        private const string DlnaFlags = "DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000";

        private static readonly Dictionary<string, string> MimeTypes = new(StringComparer.OrdinalIgnoreCase)
        {
            { ".mp3",  "audio/mpeg" },
            { ".flac", "audio/flac" },
            { ".ogg",  "audio/ogg" },
            { ".wav",  "audio/wav" },
            { ".aac",  "audio/aac" },
            { ".m4a",  "audio/mp4" },
            { ".wma",  "audio/x-ms-wma" },
            { ".opus", "audio/ogg; codecs=opus" },
            { ".aiff", "audio/aiff" },
            { ".aif",  "audio/aiff" },
            { ".ape",  "audio/x-ape" },
        };

        private static readonly HashSet<string> ImageExtensions = new(StringComparer.OrdinalIgnoreCase)
        {
            ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp",
        };

        // Only list officially-specified DLNA profiles. Non-standard formats (FLAC, OGG, AIFF, APE)
        // must NOT have a DLNA.ORG_PN — Sony Bravia rejects content with unknown profile names.
        private static readonly Dictionary<string, string> DlnaProfiles = new(StringComparer.OrdinalIgnoreCase)
        {
            { ".mp3",  "MP3" },
            { ".wav",  "LPCM" },
            { ".aac",  "AAC_ISO_320" },
            { ".m4a",  "AAC_ISO_320" },
            { ".wma",  "WMAFULL" },
        };

        internal static string SystemUpdateId { get; } = ((DateTimeOffset)DateTime.UtcNow).ToUnixTimeSeconds().ToString();

        internal static bool ServeArtwork { get; set; } = true;

        public static string GetMimeType(string extension) =>
            MimeTypes.TryGetValue(extension, out var mime) ? mime : "audio/mpeg";

        public static string GetProtocolInfo(string extension)
        {
            var mime = GetMimeType(extension);
            var profile = DlnaProfiles.TryGetValue(extension, out var p) ? $"DLNA.ORG_PN={p};" : string.Empty;
            return $"http-get:*:{mime}:{profile}{DlnaFlags}";
        }

        // Returns true if the path is a standalone image file, false if it's an audio file with embedded art
        public static bool IsImageFile(string path) =>
            ImageExtensions.Contains(Path.GetExtension(path));

        public static string HandleSoap(string soapBody, string serverBase, IMusicLibraryService musicLibrary)
        {
            try
            {
                var doc = XDocument.Parse(soapBody);
                XNamespace u = "urn:schemas-upnp-org:service:ContentDirectory:1";

                var browse = doc.Descendants(u + "Browse").FirstOrDefault();
                if (browse != null)
                {
                    return HandleBrowse(browse, serverBase, musicLibrary);
                }

                var search = doc.Descendants(u + "Search").FirstOrDefault();
                if (search != null)
                {
                    return HandleSearch(search, serverBase, musicLibrary);
                }

                // Handle by local name so we catch regardless of namespace prefix
                var action = doc.Descendants().FirstOrDefault(e => e.Parent?.Name.LocalName == "Body")?.Name.LocalName;
                if (action != null && action != "GetSystemUpdateID")
                {
                    Serilog.Log.ForContext("SourceContext", Logs.Dlna).Information("DLNA ContentDirectory action: {Action}", action);
                }

                if (action == "GetSystemUpdateID")
                {
                    return SystemUpdateIdResponse();
                }

                if (action == "GetSearchCapabilities")
                {
                    return SearchCapabilitiesResponse();
                }

                if (action == "X_GetObjectInfoEx")
                {
                    return ErrorResponse(401, "Invalid Action"); // Sony-specific, safe to ignore
                }

                if (action == "GetSortCapabilities")
                {
                    return SortCapabilitiesResponse();
                }

                if (action == "GetFeatureList")
                {
                    return FeatureListResponse();
                }

                return ErrorResponse(401, "Invalid Action");
            }
            catch (Exception ex)
            {
                Serilog.Log.Warning(ex, "DLNA ContentDirectory SOAP error");
                return ErrorResponse(501, "Action Not Implemented");
            }
        }

        public static string EncodeSegment(string value) =>
            Convert.ToBase64String(Encoding.UTF8.GetBytes(value))
                .TrimEnd('=').Replace('+', '-').Replace('/', '_');

        public static string? DecodeSegment(string encoded)
        {
            try
            {
                var padded = encoded.Replace('-', '+').Replace('_', '/');
                var mod = padded.Length % 4;
                if (mod > 0)
                {
                    padded += new string('=', 4 - mod);
                }

                return Encoding.UTF8.GetString(Convert.FromBase64String(padded));
            }
            catch
            {
                return null;
            }
        }

        private static string HandleSearch(XElement search, string serverBase, IMusicLibraryService lib)
        {
            // Treat any Search as "give me all audio tracks from this container"
            var startingIndex = int.TryParse(search.Element("StartingIndex")?.Value, out var si) ? si : 0;
            var requestedCount = int.TryParse(search.Element("RequestedCount")?.Value, out var rc) ? rc : 0;
            if (requestedCount <= 0)
            {
                requestedCount = 200;
            }

            var result = lib.QueryTracks(null, null, null, null, null, null, false, false, false, false, false, requestedCount, startingIndex);
            var sb = new StringBuilder();
            foreach (var track in result.Tracks)
            {
                sb.Append(TrackItem(track, "T", serverBase));
            }

            var didl = WrapDidl(sb.ToString());
            var returned = result.Tracks.Count;
            return $"""
                <?xml version="1.0"?>
                <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
                  <s:Body>
                    <u:SearchResponse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
                      <Result>{EscapeXml(didl)}</Result>
                      <NumberReturned>{returned}</NumberReturned>
                      <TotalMatches>{result.Total}</TotalMatches>
                      <UpdateID>{SystemUpdateId}</UpdateID>
                    </u:SearchResponse>
                  </s:Body>
                </s:Envelope>
                """;
        }

        private static string HandleBrowse(XElement browse, string serverBase, IMusicLibraryService lib)
        {
            var objectId = browse.Element("ObjectID")?.Value ?? "0";
            var browseFlag = browse.Element("BrowseFlag")?.Value ?? "BrowseDirectChildren";
            var startingIndex = int.TryParse(browse.Element("StartingIndex")?.Value, out var si) ? si : 0;
            var requestedCount = int.TryParse(browse.Element("RequestedCount")?.Value, out var rc) ? rc : 0;
            if (requestedCount <= 0)
            {
                requestedCount = 500;
            }

            var (didl, total) = browseFlag == "BrowseMetadata"
                ? BuildMetadata(objectId, serverBase, lib)
                : BuildChildren(objectId, startingIndex, requestedCount, serverBase, lib);

            var returned = CountResults(didl);
            return BrowseResponse(didl, returned, total);
        }

        private static (string Didl, int Total) BuildChildren(string objectId, int start, int count, string serverBase, IMusicLibraryService lib)
        {
            return objectId switch
            {
                "0" => RootChildren(lib),
                "T" => AllTracksChildren(start, count, serverBase, lib),
                "A" => AlbumsChildren(start, count, serverBase, lib),
                "R" => ArtistsChildren(start, count, lib),
                "G" => GenresChildren(start, count, lib),
                "Y" => YearsChildren(start, count, lib),
                "F" => FoldersChildren(start, count, serverBase, lib),
                "MX" => MixtapesChildren(start, count, serverBase, lib),
                _ when objectId.StartsWith("A/", StringComparison.Ordinal) => AlbumTrackChildren(objectId[2..], objectId, start, count, serverBase, lib),
                _ when objectId.StartsWith("R/", StringComparison.Ordinal) => ArtistTrackChildren(objectId[2..], objectId, start, count, serverBase, lib),
                _ when objectId.StartsWith("G/", StringComparison.Ordinal) => GenreTrackChildren(objectId[2..], objectId, start, count, serverBase, lib),
                _ when objectId.StartsWith("Y/", StringComparison.Ordinal) => YearTrackChildren(objectId[2..], objectId, start, count, serverBase, lib),
                _ when objectId.StartsWith("F/", StringComparison.Ordinal) => FolderTrackChildren(objectId[2..], objectId, start, count, serverBase, lib),
                _ when objectId.StartsWith("MX/", StringComparison.Ordinal) => FolderTrackChildren(objectId[3..], objectId, start, count, serverBase, lib),
                _ => (EmptyDidl(), 0),
            };
        }

        private static (string Didl, int Total) BuildMetadata(string objectId, string serverBase, IMusicLibraryService lib)
        {
            if (objectId == "0")
            {
                return (WrapDidl(Container("0", "-1", "Root", "object.container")), 1);
            }

            if (objectId.StartsWith("T/", StringComparison.Ordinal))
            {
                var maskedPath = DecodeSegment(objectId[2..]);
                if (maskedPath == null)
                {
                    return (EmptyDidl(), 0);
                }

                var fname = Path.GetFileNameWithoutExtension(maskedPath);
                var result = lib.QueryTracks(fname, null, null, null, null, null, false, false, false, false, false, 50, 0);
                var track = result.Tracks.FirstOrDefault(t => t.Path == maskedPath);
                if (track == null)
                {
                    return (EmptyDidl(), 0);
                }

                return (WrapDidl(TrackItem(track, "M/T", serverBase)), 1);
            }

            return (EmptyDidl(), 0);
        }

        private static (string Didl, int Total) RootChildren(IMusicLibraryService lib)
        {
            var trackResult = lib.QueryTracks(null, null, null, null, null, null, false, false, false, false, false, 1, 0);
            var trackTotal = trackResult.Total;
            var allFolders = lib.GetFolders();
            var folderCount = allFolders.Count;
            var mixtapeCount = allFolders.Count(f => IsMixtapeFolder(f.Path));
            var albumCount = lib.GetAlbums().Count(a => !string.IsNullOrEmpty(a.Album));
            var artistCount = lib.GetArtists().Count;
            var genreCount = lib.GetGenres().Count;
            var yearCount = lib.GetYears().Count;

            var sb = new StringBuilder();
            sb.Append(Container("T", "0", "All Tracks", "object.container.storageFolder", trackTotal, searchable: true));
            sb.Append(Container("MX", "0", "Playlists", "object.container.storageFolder", mixtapeCount, searchable: true));
            sb.Append(Container("F", "0", "Folders", "object.container.storageFolder", folderCount, searchable: true));
            sb.Append(Container("A", "0", "Albums", "object.container.album.musicAlbum", albumCount, searchable: true));
            sb.Append(Container("R", "0", "Artists", "object.container.person.musicArtist", artistCount, searchable: true));
            sb.Append(Container("G", "0", "Genres", "object.container.genre.musicGenre", genreCount, searchable: true));
            sb.Append(Container("Y", "0", "Year", "object.container.storageFolder", yearCount, searchable: true));
            return (WrapDidl(sb.ToString()), 7);
        }

        private static bool IsMixtapeFolder(string path) =>
            Path.GetDirectoryName(path)?.EndsWith("mixtapes", StringComparison.OrdinalIgnoreCase) == true;

        // Sony Bravia Google TV shows "Please try again later" if Browse(0) has no direct items.
        // This overload adds a few tracks at root so Sony sees immediately-playable content.
        private static (string Didl, int Total) RootChildrenWithTracks(IMusicLibraryService lib, string serverBase)
        {
            // Query extra tracks to have enough after filtering out symlink stubs (tiny files)
            var trackResult = lib.QueryTracks(null, null, null, null, null, null, false, false, false, false, false, 20, 0);
            trackResult = trackResult with { Tracks = trackResult.Tracks.Where(t => t.FileSize >= 10_000).Take(5).ToList() };
            var trackTotal = trackResult.Total;
            var folderCount = lib.GetFolders().Count;
            var albumCount = lib.GetAlbums().Count(a => !string.IsNullOrEmpty(a.Album));
            var artistCount = lib.GetArtists().Count;
            var genreCount = lib.GetGenres().Count;

            var sb = new StringBuilder();
            sb.Append(Container("T", "0", "All Tracks", "object.container.storageFolder", trackTotal, searchable: true));
            sb.Append(Container("F", "0", "Folders", "object.container.storageFolder", folderCount, searchable: true));
            sb.Append(Container("A", "0", "Albums", "object.container.album.musicAlbum", albumCount, searchable: true));
            sb.Append(Container("R", "0", "Artists", "object.container.person.musicArtist", artistCount, searchable: true));
            sb.Append(Container("G", "0", "Genres", "object.container.genre.musicGenre", genreCount, searchable: true));
            foreach (var track in trackResult.Tracks)
            {
                sb.Append(TrackItem(track, "0", serverBase));
            }

            return (WrapDidl(sb.ToString()), 5 + trackResult.Tracks.Count);
        }

        private static (string Didl, int Total) AllTracksChildren(int start, int count, string serverBase, IMusicLibraryService lib)
        {
            var result = lib.QueryTracks(null, null, null, null, null, null, false, false, false, false, false, count, start);
            var sb = new StringBuilder();
            foreach (var track in result.Tracks)
            {
                sb.Append(TrackItem(track, "T", serverBase));
            }

            return (WrapDidl(sb.ToString()), result.Total);
        }

        private static (string Didl, int Total) FoldersChildren(int start, int count, string serverBase, IMusicLibraryService lib)
        {
            var folders = lib.GetFolders();
            var page = folders.Skip(start).Take(count).ToList();
            var sb = new StringBuilder();
            foreach (var folder in page)
            {
                sb.Append(FolderContainer(folder, serverBase));
            }

            return (WrapDidl(sb.ToString()), folders.Count);
        }

        private static (string Didl, int Total) AlbumsChildren(int start, int count, string serverBase, IMusicLibraryService lib)
        {
            var albums = lib.GetAlbums().Where(a => !string.IsNullOrEmpty(a.Album)).ToList();
            var page = albums.Skip(start).Take(count).ToList();
            var sb = new StringBuilder();
            foreach (var album in page)
            {
                sb.Append(AlbumContainer(album, serverBase));
            }

            return (WrapDidl(sb.ToString()), albums.Count);
        }

        private static (string Didl, int Total) ArtistsChildren(int start, int count, IMusicLibraryService lib)
        {
            var artists = lib.GetArtists();
            var page = artists.Skip(start).Take(count).ToList();
            var sb = new StringBuilder();
            foreach (var artist in page)
            {
                sb.Append(ArtistContainer(artist));
            }

            return (WrapDidl(sb.ToString()), artists.Count);
        }

        private static (string Didl, int Total) GenresChildren(int start, int count, IMusicLibraryService lib)
        {
            var genres = lib.GetGenres();
            var page = genres.Skip(start).Take(count).ToList();
            var sb = new StringBuilder();
            foreach (var genre in page)
            {
                sb.Append(GenreContainer(genre));
            }

            return (WrapDidl(sb.ToString()), genres.Count);
        }

        private static (string Didl, int Total) YearsChildren(int start, int count, IMusicLibraryService lib)
        {
            var years = lib.GetYears().OrderByDescending(y => y.Year).ToList();
            var page = years.Skip(start).Take(count).ToList();
            var sb = new StringBuilder();
            foreach (var y in page)
            {
                sb.Append(YearContainer(y));
            }

            return (WrapDidl(sb.ToString()), years.Count);
        }

        private static (string Didl, int Total) YearTrackChildren(string encodedId, string parentId, int start, int count, string serverBase, IMusicLibraryService lib)
        {
            if (!int.TryParse(DecodeSegment(encodedId), out var year))
            {
                return (EmptyDidl(), 0);
            }

            var result = lib.QueryTracks(null, null, null, null, year, null, false, false, false, false, false, count, start);
            var sb = new StringBuilder();
            foreach (var track in result.Tracks)
            {
                sb.Append(TrackItem(track, parentId, serverBase));
            }

            return (WrapDidl(sb.ToString()), result.Total);
        }

        private static (string Didl, int Total) MixtapesChildren(int start, int count, string serverBase, IMusicLibraryService lib)
        {
            var folders = lib.GetFolders().Where(f => IsMixtapeFolder(f.Path)).ToList();
            var page = folders.Skip(start).Take(count).ToList();
            var sb = new StringBuilder();
            foreach (var folder in page)
            {
                sb.Append(MixtapeContainer(folder, serverBase));
            }

            return (WrapDidl(sb.ToString()), folders.Count);
        }

        private static (string Didl, int Total) FolderTrackChildren(string encodedId, string parentId, int start, int count, string serverBase, IMusicLibraryService lib)
        {
            var folderPath = DecodeSegment(encodedId);
            if (folderPath == null)
            {
                return (EmptyDidl(), 0);
            }

            var result = lib.QueryTracks(null, null, null, null, null, folderPath, false, false, false, false, false, count, start);
            var sb = new StringBuilder();
            foreach (var track in result.Tracks)
            {
                sb.Append(TrackItem(track, parentId, serverBase));
            }

            return (WrapDidl(sb.ToString()), result.Total);
        }

        private static (string Didl, int Total) AlbumTrackChildren(string encodedId, string parentId, int start, int count, string serverBase, IMusicLibraryService lib)
        {
            var key = DecodeSegment(encodedId);
            if (key == null)
            {
                return (EmptyDidl(), 0);
            }

            var parts = key.Split("|||", 2);
            var albumTitle = parts[0];
            var artist = parts.Length > 1 ? parts[1] : null;

            // Query by album name; also filter by artist if album is empty to avoid returning everything
            var result = string.IsNullOrEmpty(albumTitle)
                ? lib.QueryTracks(null, artist, null, null, null, null, false, false, false, false, false, count, start)
                : lib.QueryTracks(null, null, albumTitle, null, null, null, false, false, false, false, false, count, start);
            var sb = new StringBuilder();
            foreach (var track in result.Tracks)
            {
                sb.Append(TrackItem(track, parentId, serverBase));
            }

            return (WrapDidl(sb.ToString()), result.Total);
        }

        private static (string Didl, int Total) ArtistTrackChildren(string encodedId, string parentId, int start, int count, string serverBase, IMusicLibraryService lib)
        {
            var artist = DecodeSegment(encodedId);
            if (artist == null)
            {
                return (EmptyDidl(), 0);
            }

            var result = lib.QueryTracks(null, artist, null, null, null, null, false, false, false, false, false, count, start);
            var sb = new StringBuilder();
            foreach (var track in result.Tracks)
            {
                sb.Append(TrackItem(track, parentId, serverBase));
            }

            return (WrapDidl(sb.ToString()), result.Total);
        }

        private static (string Didl, int Total) GenreTrackChildren(string encodedId, string parentId, int start, int count, string serverBase, IMusicLibraryService lib)
        {
            var genre = DecodeSegment(encodedId);
            if (genre == null)
            {
                return (EmptyDidl(), 0);
            }

            var result = lib.QueryTracks(null, null, null, genre, null, null, false, false, false, false, false, count, start);
            var sb = new StringBuilder();
            foreach (var track in result.Tracks)
            {
                sb.Append(TrackItem(track, parentId, serverBase));
            }

            return (WrapDidl(sb.ToString()), result.Total);
        }

        private static string Container(string id, string parentId, string title, string upnpClass, int? childCount = null, bool searchable = false)
        {
            var cc = childCount.HasValue ? $@" childCount=""{childCount}""" : @" childCount=""1""";
            var s = searchable ? @" searchable=""1""" : string.Empty;
            return $@"<container id=""{EscapeXml(id)}"" parentID=""{EscapeXml(parentId)}"" restricted=""1""{cc}{s}><dc:title>{EscapeXml(title)}</dc:title><upnp:class>{upnpClass}</upnp:class></container>";
        }

        private static string FolderContainer(MusicFolder folder, string serverBase)
        {
            var id = $"F/{EncodeSegment(folder.Path)}";
            var artXml = BuildArtXml(folder.HasArtwork, folder.CoverPath, serverBase);
            return $@"<container id=""{EscapeXml(id)}"" parentID=""F"" restricted=""1"" childCount=""{folder.TrackCount}""><dc:title>{EscapeXml(folder.Name ?? folder.Path)}</dc:title><upnp:class>object.container.storageFolder</upnp:class>{artXml}</container>";
        }

        private static string AlbumContainer(MusicAlbum album, string serverBase)
        {
            // Use Album|||Artist as key so albums with same name but different artists are distinct
            var id = $"A/{EncodeSegment($"{album.Album}|||{album.Artist}")}";
            var title = !string.IsNullOrEmpty(album.Album) ? album.Album : album.Artist ?? "Unknown";
            var artistName = album.AlbumArtist ?? album.Artist ?? string.Empty;
            var artistXml = !string.IsNullOrEmpty(artistName) ? $"<upnp:artist>{EscapeXml(artistName)}</upnp:artist>" : string.Empty;
            var yearXml = album.Year.HasValue ? $"<dc:date>{album.Year}</dc:date>" : string.Empty;
            var artXml = BuildArtXml(album.HasArtwork, album.CoverPath, serverBase);
            return $@"<container id=""{EscapeXml(id)}"" parentID=""A"" restricted=""1"" childCount=""{album.TrackCount}""><dc:title>{EscapeXml(title)}</dc:title><upnp:class>object.container.album.musicAlbum</upnp:class>{artistXml}{yearXml}{artXml}</container>";
        }

        private static string BuildArtXml(bool hasArtwork, string? coverPath, string serverBase)
        {
            if (!ServeArtwork || !hasArtwork || string.IsNullOrEmpty(coverPath))
            {
                return string.Empty;
            }

            // If CoverPath is a standalone image file, serve it directly; otherwise extract via TagLib
            var route = IsImageFile(coverPath) ? "img" : "emb";
            return $"<upnp:albumArtURI>{EscapeXml($"{serverBase}/art/{route}/{EncodeSegment(coverPath)}")}</upnp:albumArtURI>";
        }

        private static string ArtistContainer(MusicArtist artist)
        {
            var id = $"R/{EncodeSegment(artist.Artist)}";
            return $@"<container id=""{EscapeXml(id)}"" parentID=""R"" restricted=""1"" childCount=""{artist.TrackCount}""><dc:title>{EscapeXml(artist.Artist ?? string.Empty)}</dc:title><upnp:class>object.container.person.musicArtist</upnp:class></container>";
        }

        private static string GenreContainer(MusicGenre genre)
        {
            var id = $"G/{EncodeSegment(genre.Genre)}";
            return $@"<container id=""{EscapeXml(id)}"" parentID=""G"" restricted=""1"" childCount=""{genre.TrackCount}""><dc:title>{EscapeXml(genre.Genre ?? string.Empty)}</dc:title><upnp:class>object.container.genre.musicGenre</upnp:class></container>";
        }

        private static string YearContainer(MusicYear year)
        {
            var id = $"Y/{EncodeSegment(year.Year.ToString())}";
            return $@"<container id=""{EscapeXml(id)}"" parentID=""Y"" restricted=""1"" childCount=""{year.TrackCount}""><dc:title>{year.Year}</dc:title><upnp:class>object.container.storageFolder</upnp:class></container>";
        }

        private static string MixtapeContainer(MusicFolder folder, string serverBase)
        {
            var id = $"MX/{EncodeSegment(folder.Path)}";
            var artXml = BuildArtXml(folder.HasArtwork, folder.CoverPath, serverBase);
            return $@"<container id=""{EscapeXml(id)}"" parentID=""MX"" restricted=""1"" childCount=""{folder.TrackCount}""><dc:title>{EscapeXml(folder.Name ?? folder.Path)}</dc:title><upnp:class>object.container.storageFolder</upnp:class>{artXml}</container>";
        }

        private static string TrackItem(MusicTrack track, string parentId, string serverBase)
        {
            var id = $"T/{EncodeSegment(track.Path)}";
            var streamUrl = $"{serverBase}/stream/{EncodeSegment(track.Path)}";
            var rawExt = track.Extension ?? Path.GetExtension(track.Filename).TrimStart('.');
            var ext = rawExt.StartsWith('.') ? rawExt : $".{rawExt}";
            var protocolInfo = GetProtocolInfo(ext);
            var duration = track.Duration.HasValue ? FormatDuration(track.Duration.Value) : null;
            var sizeAttr = track.FileSize > 0 ? $@" size=""{track.FileSize}""" : string.Empty;
            var durationAttr = duration != null ? $@" duration=""{duration}""" : string.Empty;
            var title = !string.IsNullOrEmpty(track.Title) ? track.Title : Path.GetFileNameWithoutExtension(track.Filename);

            var parts = new StringBuilder();
            if (!string.IsNullOrEmpty(track.Artist))
            {
                parts.Append($"<upnp:artist>{EscapeXml(track.Artist)}</upnp:artist><dc:creator>{EscapeXml(track.Artist)}</dc:creator>");
            }

            if (!string.IsNullOrEmpty(track.Album))
            {
                parts.Append($"<upnp:album>{EscapeXml(track.Album)}</upnp:album>");
            }

            if (track.TrackNumber.HasValue)
            {
                parts.Append($"<upnp:originalTrackNumber>{track.TrackNumber}</upnp:originalTrackNumber>");
            }

            if (!string.IsNullOrEmpty(track.Genre))
            {
                parts.Append($"<upnp:genre>{EscapeXml(track.Genre)}</upnp:genre>");
            }

            if (track.HasArtwork && ServeArtwork)
            {
                parts.Append($"<upnp:albumArtURI>{EscapeXml($"{serverBase}/art/t/{EncodeSegment(track.Path)}")}</upnp:albumArtURI>");
            }

            return $@"<item id=""{EscapeXml(id)}"" parentID=""{EscapeXml(parentId)}"" restricted=""1""><dc:title>{EscapeXml(title)}</dc:title><upnp:class>object.item.audioItem.musicTrack</upnp:class>{parts}<res protocolInfo=""{EscapeXml(protocolInfo)}""{sizeAttr}{durationAttr}>{EscapeXml(streamUrl)}</res></item>";
        }

        private static string FormatDuration(double seconds)
        {
            var ts = TimeSpan.FromSeconds(seconds);
            return $"{(int)ts.TotalHours}:{ts.Minutes:D2}:{ts.Seconds:D2}.000";
        }

        private static string BrowseResponse(string didl, int returned, int total) => $"""
            <?xml version="1.0"?>
            <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
              <s:Body>
                <u:BrowseResponse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
                  <Result>{EscapeXml(didl)}</Result>
                  <NumberReturned>{returned}</NumberReturned>
                  <TotalMatches>{total}</TotalMatches>
                  <UpdateID>{SystemUpdateId}</UpdateID>
                </u:BrowseResponse>
              </s:Body>
            </s:Envelope>
            """;

        private static string SearchCapabilitiesResponse() => """
            <?xml version="1.0"?>
            <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
              <s:Body>
                <u:GetSearchCapabilitiesResponse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
                  <SearchCaps>dc:title,upnp:artist,upnp:album,upnp:genre,upnp:class</SearchCaps>
                </u:GetSearchCapabilitiesResponse>
              </s:Body>
            </s:Envelope>
            """;

        private static string SortCapabilitiesResponse() => """
            <?xml version="1.0"?>
            <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
              <s:Body>
                <u:GetSortCapabilitiesResponse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
                  <SortCaps></SortCaps>
                </u:GetSortCapabilitiesResponse>
              </s:Body>
            </s:Envelope>
            """;

        private static string FeatureListResponse() => """
            <?xml version="1.0"?>
            <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
              <s:Body>
                <u:GetFeatureListResponse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
                  <FeatureList></FeatureList>
                </u:GetFeatureListResponse>
              </s:Body>
            </s:Envelope>
            """;

        private static string SystemUpdateIdResponse() => $"""
            <?xml version="1.0"?>
            <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
              <s:Body>
                <u:GetSystemUpdateIDResponse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
                  <Id>{SystemUpdateId}</Id>
                </u:GetSystemUpdateIDResponse>
              </s:Body>
            </s:Envelope>
            """;

        private static string ErrorResponse(int code, string description) => $"""
            <?xml version="1.0"?>
            <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
              <s:Body>
                <s:Fault>
                  <faultcode>s:Client</faultcode>
                  <faultstring>UPnPError</faultstring>
                  <detail>
                    <UPnPError xmlns="urn:schemas-upnp-org:control-1-0">
                      <errorCode>{code}</errorCode>
                      <errorDescription>{EscapeXml(description)}</errorDescription>
                    </UPnPError>
                  </detail>
                </s:Fault>
              </s:Body>
            </s:Envelope>
            """;

        private static int CountResults(string didl)
        {
            int count = 0, idx = 0;
            while ((idx = didl.IndexOf("<container ", idx, StringComparison.Ordinal)) >= 0)
            {
                count++;
                idx++;
            }

            idx = 0;
            while ((idx = didl.IndexOf("<item ", idx, StringComparison.Ordinal)) >= 0)
            {
                count++;
                idx++;
            }

            return count;
        }

        private static string WrapDidl(string inner) =>
            $@"<DIDL-Lite xmlns=""urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"" xmlns:dc=""http://purl.org/dc/elements/1.1/"" xmlns:upnp=""urn:schemas-upnp-org:metadata-1-0/upnp/"">{inner}</DIDL-Lite>";

        private static string EmptyDidl() => WrapDidl(string.Empty);

        private static string EscapeXml(string s) =>
            s.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;").Replace("\"", "&quot;");
    }
}
