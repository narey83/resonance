// <copyright file="WorkspaceTypes.cs" company="John Narey">
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

namespace resonance.MusicLibrary.Workspace;

using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using resonance.Common;

public record SmartCrateRules(
    double? BpmMin = null, double? BpmMax = null, string[] Keys = null,
    string Genre = null, string Energy = null, string Vocals = null,
    int? AddedWithinDays = null, int? NotPlayedWithinDays = null,
    bool NeverPlayed = false, bool LovedOnly = false, string Analysis = null, string Folder = null, bool AnalysedOnly = false, bool BpmMaxExclusive = false)
{
    public SmartCrateRules Validated()
    {
        if ((BpmMin is double min && (!double.IsFinite(min) || min < 20 || min > 400))
            || (BpmMax is double max && (!double.IsFinite(max) || max < 20 || max > 400))
            || BpmMin > BpmMax)
        {
            throw new ArgumentException("Use a BPM range between 20 and 400, with the minimum first.");
        }

        if (AddedWithinDays is < 1 or > 3650 || NotPlayedWithinDays is < 1 or > 3650)
        {
            throw new ArgumentException("Date rules must be between 1 and 3650 days.");
        }

        if (Energy is not (null or "" or "low" or "medium" or "high")
            || Vocals is not (null or "" or "yes" or "no")
            || Analysis is not (null or "" or "enhanced" or "pending" or "complete" or "incomplete"))
        {
            throw new ArgumentException("One of the crate rules is unsupported.");
        }

        if (Keys?.Length > 24 || Keys?.Any(key => string.IsNullOrWhiteSpace(key) || key.Length > 12) == true
            || Genre?.Length > 100 || Folder?.Length > 4096)
        {
            throw new ArgumentException("One of the crate rules is too long.");
        }

        var folder = Folder == null ? null : MusicPath.ToRelative(Folder.Trim());
        if (folder != null && (Path.IsPathRooted(folder) || folder.Split(['/', '\\'], StringSplitOptions.RemoveEmptyEntries).Any(part => part is ".." or ".")))
        {
            throw new ArgumentException("Choose a folder inside this music library.");
        }

        return this with { Genre = Genre?.Trim(), Keys = Keys?.Distinct(StringComparer.OrdinalIgnoreCase).ToArray(), Folder = folder };
    }

    public DjLibraryFilters Filters(string username, DateTimeOffset now) => new(
        BpmMin, BpmMax, Keys, Energy, Vocals,
        AddedAfter: AddedWithinDays.HasValue ? now.AddDays(-AddedWithinDays.Value).ToUnixTimeMilliseconds() : null,
        NotPlayedSince: NotPlayedWithinDays.HasValue ? now.AddDays(-NotPlayedWithinDays.Value).ToUnixTimeMilliseconds() : null,
        NeverPlayed: NeverPlayed, LovedOnly: LovedOnly, Username: username, AnalysedOnly: AnalysedOnly, BpmMaxExclusive: BpmMaxExclusive);
}

public record SmartCrate(string Id, string Name, string Description, SmartCrateRules Rules, long Revision, bool Starter = false, string Collection = null, int? TrackCount = null);
public record SaveCrateRequest(string Name, string Description, SmartCrateRules Rules, long Revision = 0)
{
    public SaveCrateRequest Validated()
    {
        if (string.IsNullOrWhiteSpace(Name) || Name.Trim().Length > 60 || Description?.Length > 200)
        {
            throw new ArgumentException("Give the crate a name of 1–60 characters and a description of up to 200 characters.");
        }

        return this with { Name = Name.Trim(), Description = Description?.Trim() ?? string.Empty, Rules = (Rules ?? new()).Validated() };
    }
}

public record PreparationItem(string Path, long FileSize, long FileModified, string State, int Attempts,
    long NextAttemptAt, string Detail, long UpdatedAt)
{
    // SQLite reports INTEGER as Int64; property mapping also accepts PostgreSQL's Int32 attempts.
    public PreparationItem()
        : this(string.Empty, 0, 0, string.Empty, 0, 0, string.Empty, 0)
    {
    }
}

public static class PreparationPolicy
{
    public const int MaxAttempts = 3;
    public static bool BasicComplete(MusicTrack track) => track.HasWaveform == true && track.Bpm is > 0
        && !string.IsNullOrWhiteSpace(track.Key) && track.Lufs.HasValue;
    public static bool EnhancedComplete(MusicTrack track)
    {
        try
        {
            if (track.DjSummary == null)
            {
                return false;
            }

            using var document = JsonDocument.Parse(track.DjSummary);
            return document.RootElement.TryGetProperty("complete", out var flag) && flag.ValueKind == JsonValueKind.True;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    public static string CompletedState(MusicTrack track, bool enhancedEnabled) =>
        BasicComplete(track) && EnhancedComplete(track) ? "complete"
        : BasicComplete(track) && !enhancedEnabled ? "basic" : null;
    public static PreparationItem Failed(PreparationItem item, long now, string detail) => item with
    {
        State = item.Attempts >= MaxAttempts ? "failed" : "retrying",
        NextAttemptAt = now + (item.Attempts <= 1 ? 30_000 : 300_000),
        Detail = detail,
        UpdatedAt = now,
    };
}
