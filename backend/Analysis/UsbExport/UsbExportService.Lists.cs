// <copyright file="UsbExportService.Lists.cs" company="John Narey">
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
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using resonance.Analysis.Imports;
using resonance.Common;

public record SavedUsbList(string Id, string PlaylistName, string Profile, string PlayerModel, string[] Paths, DateTimeOffset SavedAt);
public record SavedUsbListStatus(string Id, string PlaylistName, string Profile, string PlayerModel, int TrackCount, int MissingCount, string[] MissingTracks, DateTimeOffset SavedAt);

/// <summary>Persists track selections independently of individual export jobs.</summary>
public sealed partial class UsbExportService
{
    private string ListsDirectory => Path.Combine(root ?? string.Empty, "saved-lists");

    public SavedUsbList SaveList(string jobId)
    {
        if (!Guid.TryParseExact(jobId, "N", out _) || string.IsNullOrWhiteSpace(root)
            || (!File.Exists(Path.Combine(root, jobId, "export-complete")) && !Read(jobId).DownloadAvailable))
        {
            throw new FileNotFoundException("Completed export not found.");
        }

        var source = Path.Combine(root, jobId, "manifest.json");
        using var document = JsonDocument.Parse(File.ReadAllText(source));
        var manifest = document.RootElement;
        var paths = manifest.GetProperty("tracks").EnumerateArray()
            .Select(track => MusicPath.ToRelative(ImportedAnalysisContract.RequireLibraryPath(MusicPath.Root, track.GetProperty("sourcePath").GetString())))
            .ToArray();
        var list = new SavedUsbList(jobId, manifest.GetProperty("playlistName").GetString(), manifest.GetProperty("profile").GetString(),
            manifest.TryGetProperty("playerModel", out var model) && model.ValueKind == JsonValueKind.String ? model.GetString() : null,
            paths, DateTimeOffset.UtcNow);
        ValidateSavedList(list);
        if (list.Profile == "network")
        {
            throw new ArgumentException("Network Link exports cannot be reused as USB lists.");
        }

        Directory.CreateDirectory(ListsDirectory);
        var destination = Path.Combine(ListsDirectory, jobId + ".json");
        if (File.Exists(destination))
        {
            return GetSavedList(jobId);
        }

        var temporary = Path.Combine(ListsDirectory, jobId + "." + Guid.NewGuid().ToString("N") + ".tmp");
        try
        {
            File.WriteAllText(temporary, JsonSerializer.Serialize(list, JsonOptions));
            File.Move(temporary, destination, false);
        }
        catch (IOException) when (File.Exists(destination))
        {
            return GetSavedList(jobId);
        }
        finally
        {
            if (File.Exists(temporary))
            {
                File.Delete(temporary);
            }
        }

        return list;
    }

    public SavedUsbListStatus[] SavedLists()
    {
        if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(ListsDirectory))
        {
            return [];
        }

        var lists = new List<SavedUsbList>();
        foreach (var file in new DirectoryInfo(ListsDirectory).EnumerateFiles("*.json")
            .OrderByDescending(file => file.LastWriteTimeUtc).Take(500))
        {
            try
            {
                lists.Add(GetSavedList(Path.GetFileNameWithoutExtension(file.Name)));
            }
            catch (Exception exception) when (exception is IOException or JsonException or ArgumentException)
            {
                // A damaged saved list must not hide the others.
            }
        }

        if (lists.Count == 0)
        {
            return [];
        }

        var allPaths = lists.SelectMany(list => list.Paths).Distinct(StringComparer.Ordinal).ToArray();
        var indexed = library?.GetExportTracks(allPaths).Select(track => LibraryPath(track.Path)).ToHashSet(StringComparer.Ordinal)
            ?? analysis.GetAllTracks().Select(track => LibraryPath(track.OriginalFilename)).ToHashSet(StringComparer.Ordinal);
        return lists.Select(list =>
        {
            var missing = list.Paths.Where(path =>
            {
                var full = LibraryPath(path);
                return !indexed.Contains(full) || !File.Exists(full);
            }).ToArray();
            return new SavedUsbListStatus(list.Id, list.PlaylistName, list.Profile, list.PlayerModel, list.Paths.Length, missing.Length, missing, list.SavedAt);
        }).OrderByDescending(list => list.SavedAt).ToArray();
    }

    public SavedUsbList GetSavedList(string id)
    {
        if (!Guid.TryParseExact(id, "N", out _) || string.IsNullOrWhiteSpace(root))
        {
            throw new FileNotFoundException("Saved export list not found.");
        }

        var path = Path.Combine(ListsDirectory, id + ".json");
        if (!File.Exists(path) || new FileInfo(path).Length > 8 * 1024 * 1024)
        {
            throw new FileNotFoundException("Saved export list not found.");
        }

        var list = JsonSerializer.Deserialize<SavedUsbList>(File.ReadAllText(path), JsonOptions);
        if (list?.Id != id)
        {
            throw new InvalidDataException("Saved export list is invalid.");
        }

        ValidateSavedList(list);
        return list;
    }

    public void DeleteSavedList(string id)
    {
        _ = GetSavedList(id);
        File.Delete(Path.Combine(ListsDirectory, id + ".json"));
    }

    private static void ValidateSavedList(SavedUsbList list)
    {
        if (list == null)
        {
            throw new ArgumentException("Saved export list is invalid.");
        }

        Validate(new UsbExportRequest(list.Paths, list.PlaylistName, list.Profile, PlayerModel: list.PlayerModel));
        foreach (var path in list.Paths)
        {
            if (Path.IsPathRooted(path) || MusicPath.ToRelative(ImportedAnalysisContract.RequireLibraryPath(MusicPath.Root, LibraryPath(path))) != path)
            {
                throw new ArgumentException("Saved export list contains an invalid track path.");
            }
        }
    }

    private string[] MissingSavedTracks(string[] paths)
    {
        var indexed = library?.GetExportTracks(paths).Select(track => LibraryPath(track.Path)).ToHashSet(StringComparer.Ordinal)
            ?? analysis.GetAllTracks().Select(track => LibraryPath(track.OriginalFilename)).ToHashSet(StringComparer.Ordinal);
        return paths.Where(path => !indexed.Contains(path) || !File.Exists(path)).ToArray();
    }
}
