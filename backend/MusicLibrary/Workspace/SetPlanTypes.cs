// <copyright file="SetPlanTypes.cs" company="John Narey">
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
using resonance.Common;

public record SetPlanItem(string Path, double? MasterBpm = null, string Note = "");
public record SetPlanRequest(string Name, SetPlanItem[] Items, double? InitialMasterBpm = null,
    int Bars = 16, bool ExtendedTempo = false, string Notes = "", long Revision = 0)
{
    public SetPlanRequest Validated()
    {
        static bool InvalidTempo(double? bpm) => bpm.HasValue && (!double.IsFinite(bpm.Value) || bpm < 20 || bpm > 400);
        if (string.IsNullOrWhiteSpace(Name) || Name.Trim().Length > 80 || Name.Any(char.IsControl))
        {
            throw new ArgumentException("Use a set name of 1–80 visible characters.");
        }

        if (Items == null || Items.Length > 200)
        {
            throw new ArgumentException("A set can contain up to 200 tracks.");
        }

        if (Bars is not (8 or 16 or 32) || InvalidTempo(InitialMasterBpm))
        {
            throw new ArgumentException("Choose 8, 16 or 32 transition bars and a master tempo between 20 and 400 BPM.");
        }

        if (Notes?.Length > 2000 || Revision < 0)
        {
            throw new ArgumentException("Set notes can contain up to 2,000 characters.");
        }

        var items = Items.Select((item, index) =>
        {
            if (item == null || string.IsNullOrWhiteSpace(item.Path) || item.Path.Length > 4096 || item.Path.Any(char.IsControl))
            {
                throw new ArgumentException("Every set item needs a library track path.");
            }

            var path = MusicPath.ToRelative(item.Path).Replace('\\', '/');
            if (Path.IsPathRooted(path) || path.StartsWith('/') || (path.Length > 1 && path[1] == ':')
                || path.Split('/', StringSplitOptions.RemoveEmptyEntries).Any(part => part is "." or ".."))
            {
                throw new ArgumentException("Choose tracks inside the configured music library.");
            }

            if (item.MasterBpm.HasValue)
            {
                throw new ArgumentException("Use one master tempo for the whole set. Per-track tempo checkpoints are no longer supported.");
            }

            if (item.Note?.Length > 240)
            {
                throw new ArgumentException("Track notes can contain up to 240 characters.");
            }

            return item with { Path = path, Note = item.Note ?? string.Empty };
        }).ToArray();
        if (items.Select(item => item.Path).Distinct(StringComparer.Ordinal).Count() != items.Length)
        {
            throw new ArgumentException("Each track can appear once in this set.");
        }

        return this with { Name = Name.Trim(), Items = items, Notes = Notes ?? string.Empty };
    }
}

public record SetPlan(string Id, string Name, SetPlanItem[] Items, double? InitialMasterBpm,
    int Bars, bool ExtendedTempo, string Notes, long Revision, long CreatedAt, long UpdatedAt, bool Archived);
