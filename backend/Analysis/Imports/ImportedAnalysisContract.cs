// <copyright file="ImportedAnalysisContract.cs" company="John Narey">
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

namespace resonance.Analysis.Imports
{
    using System;
    using System.IO;
    using System.Linq;
    using System.Security.Cryptography;
    using System.Text;
    using System.Text.Json;
    using System.Text.RegularExpressions;

    public record ImportAnalysisRequest(
        string CollectionSha256,
        string LibraryPath,
        string DocumentSha256,
        string ExportJson,
        double AllowedEndOverrunSeconds = 0,
        string SourceXmlSha256 = null);

    public record ValidatedImport(string TrackId, string AudioSha256, long AudioBytes, string DocumentSha256, string Json);

    public static class ImportedAnalysisContract
    {
        public const int MaxDocumentBytes = 12 * 1024 * 1024;

        public static bool IsSha256(string value) => value != null && Regex.IsMatch(value, "^[a-fA-F0-9]{64}$");

        public static ValidatedImport Validate(ImportAnalysisRequest request)
        {
            ArgumentNullException.ThrowIfNull(request);
            if (!IsSha256(request.CollectionSha256) || !IsSha256(request.SourceXmlSha256) || !IsSha256(request.DocumentSha256)
                || string.IsNullOrWhiteSpace(request.LibraryPath) || request.ExportJson == null
                || Encoding.UTF8.GetByteCount(request.ExportJson) > MaxDocumentBytes
                || !double.IsFinite(request.AllowedEndOverrunSeconds)
                || request.AllowedEndOverrunSeconds < 0 || request.AllowedEndOverrunSeconds > 1)
            {
                throw new ArgumentException("Invalid import envelope.");
            }

            var digest = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(request.ExportJson))).ToLowerInvariant();
            if (!digest.Equals(request.DocumentSha256, StringComparison.OrdinalIgnoreCase))
            {
                throw new ArgumentException("Export JSON bytes do not match document SHA256.");
            }

            using var document = JsonDocument.Parse(request.ExportJson, new JsonDocumentOptions { MaxDepth = 64 });
            var root = document.RootElement;
            if (root.GetProperty("schemaVersion").GetInt32() != 1)
            {
                throw new ArgumentException("Unsupported source schema.");
            }

            var trackId = root.GetProperty("trackId").GetString();
            if (string.IsNullOrWhiteSpace(trackId) || trackId.Length > 128)
            {
                throw new ArgumentException("Missing source track ID.");
            }

            var audio = root.GetProperty("audioIdentity");
            var audioSha = audio.GetProperty("sha256").GetString();
            var audioBytes = audio.GetProperty("bytes").GetInt64();
            if (audio.GetProperty("status").GetString() != "file-bytes-observed" || !IsSha256(audioSha) || audioBytes < 0)
            {
                throw new ArgumentException("Source export does not attest readable audio bytes; explicit matching is required.");
            }

            // Keep optional and missing source features missing. Do not synthesize confidences.
            if (root.TryGetProperty("bpm", out var bpm) && (!bpm.TryGetDouble(out var tempo) || !double.IsFinite(tempo) || tempo < 0))
            {
                throw new ArgumentException("Invalid source BPM.");
            }

            if (root.TryGetProperty("beats", out var beats))
            {
                if (beats.ValueKind != JsonValueKind.Array || beats.GetArrayLength() > 1000000
                    || !root.TryGetProperty("durationSeconds", out var durationValue)
                    || !durationValue.TryGetDouble(out var duration) || !double.IsFinite(duration) || duration <= 0)
                {
                    throw new ArgumentException("Invalid grid duration or size.");
                }

                var previous = -1.0;
                var downbeats = new System.Collections.Generic.List<double>();
                foreach (var beat in beats.EnumerateArray())
                {
                    var time = beat.GetProperty("timeSeconds").GetDouble();
                    var number = beat.GetProperty("beatInBar").GetInt32();
                    var localBpm = beat.GetProperty("bpm").GetDouble();
                    if (!double.IsFinite(time) || time < 0 || time <= previous
                        || time > duration + request.AllowedEndOverrunSeconds || number < 1 || number > 4
                        || !double.IsFinite(localBpm) || localBpm <= 0)
                    {
                        throw new ArgumentException("Invalid source grid entry.");
                    }

                    previous = time;
                    if (number == 1)
                    {
                        downbeats.Add(time);
                    }
                }

                if (root.TryGetProperty("downbeatsSeconds", out var supplied)
                    && !downbeats.SequenceEqual(supplied.EnumerateArray().Select(value => value.GetDouble())))
                {
                    throw new ArgumentException("Downbeat array disagrees with explicit bar indexes.");
                }
            }
            else if (root.TryGetProperty("downbeatsSeconds", out _))
            {
                throw new ArgumentException("Downbeats require an explicit source beat grid.");
            }

            return new ValidatedImport(trackId, audioSha.ToLowerInvariant(), audioBytes, digest, request.ExportJson);
        }

        // MusicPath itself intentionally permits outside-root paths. Imports require a stricter boundary.
        public static string RequireLibraryPath(string configuredRoot, string supplied)
        {
            if (string.IsNullOrWhiteSpace(configuredRoot))
            {
                throw new ArgumentException("Music root is not configured.");
            }

            var root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(configuredRoot));
            var path = Path.GetFullPath(Path.IsPathRooted(supplied) ? supplied : Path.Combine(root, supplied));
            if (!path.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.Ordinal))
            {
                throw new ArgumentException("Import path is outside the music root.");
            }

            // Reject symlinks rather than following user-supplied filesystem targets while hashing.
            var current = path;
            while (current.Length >= root.Length)
            {
                FileSystemInfo entry = Directory.Exists(current) ? new DirectoryInfo(current) : new FileInfo(current);
                if (entry.LinkTarget != null)
                {
                    throw new ArgumentException("Symbolic link import paths are unsupported.");
                }

                if (current == root)
                {
                    break;
                }

                current = Path.GetDirectoryName(current);
            }

            return path;
        }
    }
}
