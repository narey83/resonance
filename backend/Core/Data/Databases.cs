// <copyright file="Databases.cs" company="JP Dillingham">
//           ▄▄▄▄     ▄▄▄▄     ▄▄▄▄
//     ▄▄▄▄▄▄█  █▄▄▄▄▄█  █▄▄▄▄▄█  █
//     █__ --█  █__ --█    ◄█  -  █
//     █▄▄▄▄▄█▄▄█▄▄▄▄▄█▄▄█▄▄█▄▄▄▄▄█
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) JP Dillingham.
//   │ Copyright (c) 2026 John Narey.
//   │ Modified as part of Resonance, a modified version of slskd;
//   │ see the project repository for the nature of the changes.
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
//   │ https://slskd.org
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: JP Dillingham
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

namespace resonance;

/// <summary>
///     A primitive type for Database names and a static value for each of them. And a list.
/// </summary>
public class Database
{
    public static Database Search { get; } = new Database { Name = nameof(Search).ToLower() };
    public static Database Transfers { get; } = new Database { Name = nameof(Transfers).ToLower() };
    public static Database Messaging { get; } = new Database { Name = nameof(Messaging).ToLower() };
    public static Database Events { get; } = new Database { Name = nameof(Events).ToLower() };
    public static Database Users { get; } = new Database { Name = "resonance-users" };
    public static Database SoulseekUser { get; } = new Database { Name = "soulseek-user" };
    public static Database LibraryActivity { get; } = new Database { Name = "library-activity" };
    public static Database Preferences { get; } = new Database { Name = "preferences" };
    public static Database Settings { get; } = new Database { Name = "settings" };
    public static Database YtDlp { get; } = new Database { Name = "ytdlp" };
    public static Database AppLogs { get; } = new Database { Name = "logs" };
    public static Database Music { get; } = new Database { Name = "music" };
    public static Database Waveform { get; } = new Database { Name = "waveform" };
    public static Database Loudness { get; } = new Database { Name = "loudness" };
    public static Database Mixtapes { get; } = new Database { Name = "mixtapes" };
    public static Database[] List { get; } = [Search, Transfers, Messaging, Events, Users, LibraryActivity, Preferences, Settings, YtDlp, AppLogs, Music, Waveform, Loudness, Mixtapes];

    public required string Name { get; init; }

    public override string ToString() => Name;
}
