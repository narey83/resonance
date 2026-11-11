// <copyright file="LibraryIndexSnapshotService.cs" company="John Narey">
//    ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮
//   ─╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰  resonance
//   │ Copyright (c) 2026 John Narey.
//   │ SPDX-License-Identifier: AGPL-3.0-only
// </copyright>

namespace resonance.MusicLibrary;

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using resonance.Common;

/// <summary>Stores index-only snapshots in the application's private data directory.</summary>
public sealed record LibraryIndexSnapshot(Guid Id, DateTime CreatedAtUtc, int TrackCount, string Sha256);

public sealed class LibraryIndexSnapshotService(MusicRepository repository, string directory)
{
    private readonly object gate = new();

    public IReadOnlyList<LibraryIndexSnapshot> List()
    {
        if (!Directory.Exists(directory))
        {
            return Array.Empty<LibraryIndexSnapshot>();
        }

        var snapshots = new List<LibraryIndexSnapshot>();
        foreach (var path in Directory.EnumerateFiles(directory, "*.meta.json"))
        {
            try
            {
                var snapshot = JsonSerializer.Deserialize<LibraryIndexSnapshot>(File.ReadAllBytes(path));
                if (snapshot is not null && File.Exists(DataPath(snapshot.Id)))
                {
                    snapshots.Add(snapshot);
                }
            }
            catch (JsonException)
            {
                // A damaged manifest is not an available restore point.
            }
        }

        return snapshots.OrderByDescending(snapshot => snapshot.CreatedAtUtc).ToArray();
    }

    public LibraryIndexSnapshot Create()
    {
        lock (gate)
        {
            var tracks = repository.GetIndexTracks()
                .Select(track => track with
                {
                    Path = MusicPath.ToRelative(track.Path),
                    Directory = MusicPath.ToRelative(track.Directory),
                })
                .ToArray();
            if (tracks.Length == 0)
            {
                throw new InvalidOperationException("The library index is empty; there is nothing to snapshot.");
            }

            Directory.CreateDirectory(directory);
            if (!OperatingSystem.IsWindows())
            {
                File.SetUnixFileMode(directory, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
            }

            var id = Guid.NewGuid();
            var bytes = JsonSerializer.SerializeToUtf8Bytes(tracks);
            var snapshot = new LibraryIndexSnapshot(id, DateTime.UtcNow, tracks.Length, Convert.ToHexString(SHA256.HashData(bytes)));
            var dataTemp = DataPath(id) + ".tmp";
            var metaTemp = MetaPath(id) + ".tmp";
            try
            {
                File.WriteAllBytes(dataTemp, bytes);
                File.WriteAllBytes(metaTemp, JsonSerializer.SerializeToUtf8Bytes(snapshot));
                RestrictFile(dataTemp);
                RestrictFile(metaTemp);
                File.Move(dataTemp, DataPath(id));
                File.Move(metaTemp, MetaPath(id));
                return snapshot;
            }
            finally
            {
                if (File.Exists(dataTemp))
                {
                    File.Delete(dataTemp);
                }

                if (File.Exists(metaTemp))
                {
                    File.Delete(metaTemp);
                }
            }
        }
    }

    public LibraryIndexSnapshot Restore(Guid id)
    {
        lock (gate)
        {
            LibraryIndexSnapshot snapshot;
            try
            {
                snapshot = JsonSerializer.Deserialize<LibraryIndexSnapshot>(File.ReadAllBytes(MetaPath(id)))
                    ?? throw new InvalidDataException("Snapshot manifest is empty.");
            }
            catch (JsonException exception)
            {
                throw new InvalidDataException("Snapshot manifest is damaged; the index was not changed.", exception);
            }

            if (snapshot.Id != id || snapshot.TrackCount <= 0)
            {
                throw new InvalidDataException("Snapshot manifest is invalid.");
            }

            var bytes = File.ReadAllBytes(DataPath(id));
            var actualHash = Convert.ToHexString(SHA256.HashData(bytes));
            if (!string.Equals(actualHash, snapshot.Sha256, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidDataException("Snapshot integrity check failed; the index was not changed.");
            }

            List<MusicTrack> tracks;
            try
            {
                tracks = JsonSerializer.Deserialize<List<MusicTrack>>(bytes)
                    ?? throw new InvalidDataException("Snapshot contains no tracks.");
            }
            catch (JsonException exception)
            {
                throw new InvalidDataException("Snapshot rows are damaged; the index was not changed.", exception);
            }

            if (tracks.Count != snapshot.TrackCount || tracks.Any(track =>
                    track is null || !ValidRelativePath(track.Path, allowEmpty: false) ||
                    !ValidRelativePath(track.Directory, allowEmpty: true) ||
                    string.IsNullOrWhiteSpace(track.Filename) || track.IndexedAt <= 0) ||
                tracks.Select(track => track.Path).Distinct(StringComparer.Ordinal).Count() != tracks.Count)
            {
                throw new InvalidDataException("Snapshot rows are invalid; the index was not changed.");
            }

            repository.RestoreIndex(tracks.Select(track => track with
            {
                Path = MusicPath.ToAbsolute(track.Path),
                Directory = MusicPath.ToAbsolute(track.Directory),
            }).ToArray());
            return snapshot;
        }
    }

    private bool ValidRelativePath(string path, bool allowEmpty)
        => path is not null && (allowEmpty || path.Length > 0) &&
            !Path.IsPathRooted(path) &&
            !path.Split(new[] { '/', '\\' }, StringSplitOptions.None).Any(part => part is "." or "..");

    private string DataPath(Guid id) => Path.Combine(directory, $"{id:N}.tracks.json");

    private string MetaPath(Guid id) => Path.Combine(directory, $"{id:N}.meta.json");

    private void RestrictFile(string path)
    {
        if (!OperatingSystem.IsWindows())
        {
            File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        }
    }
}
