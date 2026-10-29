// <copyright file="UsbExportService.Sources.cs" company="John Narey">
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

namespace resonance.Analysis.UsbExport;

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using resonance.Analysis.Imports;
using resonance.Common;
using resonance.Mixtapes;
using resonance.MusicLibrary.Workspace;

public record UsbExportSourceRequest(string Kind, string Id = null, string Folder = null);
public record UsbExportSource(string Kind, string Id, string Name, long? Revision, DateTimeOffset ResolvedAt, string PathsHash);
public record UsbExportSelection(string SelectionId, UsbExportSource Source, string PlaylistName, string[] Paths, int TrackCount);

/// <summary>Resolves and retains reviewed export source selections.</summary>
public sealed partial class UsbExportService
{
    private readonly IMixtapeService playlists;
    private readonly WorkspaceStore workspace;
    private readonly ConcurrentDictionary<string, SelectionSnapshot> selections = new();
    private readonly ConcurrentDictionary<string, UsbExportSource> jobSources = new();
    private readonly object selectionGate = new();

    public object Sources(string username) => new
    {
        playlists = playlists.GetAll().Select(playlist => new { playlist.Id, playlist.Name, trackCount = playlist.Tracks?.Count ?? playlists.GetTracks(playlist.Id).Count }).ToArray(),
        crates = workspace.ListCrates(username).Select(crate => new { crate.Id, crate.Name, crate.Revision }).ToArray(),
        folders = library.GetFolders().Where(folder => !string.IsNullOrWhiteSpace(MusicPath.ToRelative(folder.Path)) && MusicPath.ToRelative(folder.Path) != ".")
            .Select(folder => new { path = MusicPath.ToRelative(folder.Path), folder.Name, folder.TrackCount }).ToArray(),
    };

    public UsbExportSelection ResolveSource(UsbExportSourceRequest request, string username)
    {
        if (request == null || library == null)
        {
            throw new ArgumentException("Choose a playlist, smart crate or music folder.");
        }

        string name;
        string id;
        long? revision = null;
        string[] paths;
        var now = DateTimeOffset.UtcNow;
        if (request.Kind == "playlist")
        {
            var playlist = playlists?.GetById(request.Id ?? string.Empty) ?? throw new FileNotFoundException("Playlist not found.");
            name = playlist.Name;
            id = playlist.Id;
            revision = playlist.UpdatedAt;
            paths = playlists.GetTracks(id).OrderBy(track => track.SortOrder).Select(track => LibraryPath(track.FilePath)).ToArray();
        }
        else if (request.Kind == "smart-crate")
        {
            var crate = workspace?.FindCrate(username, request.Id ?? string.Empty) ?? throw new FileNotFoundException("Smart crate not found.");
            name = crate.Name;
            id = crate.Id;
            revision = crate.Revision;
            var rules = crate.Rules.Validated();
            var page = library.QueryTracks(null, null, null, rules.Genre, null, rules.Folder, false, false, false, false, false,
                10001, 0, "title", analysis: rules.Analysis, dj: rules.Filters(username, now));
            if (page.Total > 10000)
            {
                throw new ArgumentException("This crate matches more than 10000 tracks. Narrow its rules before exporting.");
            }

            paths = page.Tracks.Select(track => LibraryPath(track.Path)).ToArray();
        }
        else if (request.Kind == "folder")
        {
            if (string.IsNullOrWhiteSpace(request.Folder))
            {
                throw new ArgumentException("Choose a music folder.");
            }

            var folder = ImportedAnalysisContract.RequireLibraryPath(MusicPath.Root, LibraryPath(request.Folder));
            if (folder.TrimEnd(Path.DirectorySeparatorChar) == Path.GetFullPath(MusicPath.Root).TrimEnd(Path.DirectorySeparatorChar))
            {
                throw new ArgumentException("Choose a track folder rather than the Downloads root.");
            }

            name = Path.GetFileName(folder.TrimEnd(Path.DirectorySeparatorChar));
            id = MusicPath.ToRelative(folder);
            var page = library.QueryTracks(null, null, null, null, null, folder, false, false, false, false, false, 10001, 0, "track");
            if (page.Total > 10000)
            {
                throw new ArgumentException("This folder contains more than 10000 tracks. Choose a smaller folder.");
            }

            paths = page.Tracks.Select(track => LibraryPath(track.Path)).ToArray();
        }
        else
        {
            throw new ArgumentException("Source kind must be playlist, smart-crate or folder.");
        }

        if (paths.Length == 0 || paths.Length > 10000 || paths.Distinct(StringComparer.Ordinal).Count() != paths.Length)
        {
            throw new ArgumentException("Choose a source containing between 1 and 10000 distinct tracks.");
        }

        foreach (var path in paths)
        {
            ImportedAnalysisContract.RequireLibraryPath(MusicPath.Root, path);
        }

        var source = new UsbExportSource(request.Kind, id, name, revision, now,
            Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(paths))).ToLowerInvariant());
        var playlistName = name[..Math.Min(name.Length, 100)];
        if (char.IsHighSurrogate(playlistName[^1]))
        {
            playlistName = playlistName[..^1];
        }

        var selection = new UsbExportSelection(Guid.NewGuid().ToString("N"), source, playlistName, paths, paths.Length);
        lock (selectionGate)
        {
            foreach (var pair in selections.Where(pair => pair.Value.Expires <= now))
            {
                selections.TryRemove(pair.Key, out _);
            }

            var existing = selections.Values.FirstOrDefault(value => value.Username == username && value.Selection.Source.Kind == source.Kind
                && value.Selection.Source.Id == source.Id && value.Selection.Source.Revision == source.Revision && value.Selection.Source.PathsHash == source.PathsHash);
            if (existing != null)
            {
                return existing.Selection;
            }

            if (selections.Values.Count(value => value.Username == username) >= 25 || selections.Count >= 100)
            {
                throw new InvalidOperationException("Too many export previews. Use an existing preview or try again after it expires.");
            }

            selections[selection.SelectionId] = new SelectionSnapshot(username, now.AddHours(24), selection);
        }

        return selection;
    }

    private UsbExportSource ValidateSelection(UsbExportRequest request, string username)
    {
        if (request.SelectionId == null)
        {
            return null;
        }

        if (!Guid.TryParseExact(request.SelectionId, "N", out _) || !selections.TryGetValue(request.SelectionId, out var snapshot)
            || snapshot.Username != username || snapshot.Expires <= DateTimeOffset.UtcNow)
        {
            throw new ArgumentException("This export preview is unavailable or expired. Select its source again.");
        }

        if (!request.Paths.Select(LibraryPath).SequenceEqual(snapshot.Selection.Paths, StringComparer.Ordinal))
        {
            throw new ArgumentException("The reviewed source selection changed. Select its source again before exporting.");
        }

        return snapshot.Selection.Source;
    }

    private record SelectionSnapshot(string Username, DateTimeOffset Expires, UsbExportSelection Selection);
}
