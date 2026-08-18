// <copyright file="Logs.cs" company="John Narey">
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

namespace resonance
{
    using System;
    using System.Collections.Generic;
    using System.Linq;
    using System.Reflection;

    public static class Logs
    {
        public const string Application = "Application";
        public const string Connection = "Connection";
        public const string Blacklist = "Blacklist";
        public const string Browse = "Browse";
        public const string Search = "Search";
        public const string Relay = "Relay";
        public const string Cast = "Cast";
        public const string Events = "Events";
        public const string Files = "Files";
        public const string Users = "Users";
        public const string Network = "Network";
        public const string Settings = "Settings";
        public const string Telemetry = "Telemetry";
        public const string Database = "Database";
        public const string Browser = "Browser";
        public const string Mobile = "Mobile";
        public const string Dlna = "DLNA";
        public const string SystemStats = "System Stats";
        public const string DiskSpace = "Disk Space";

        /// <summary>
        ///     Gets every context defined in this registry, sorted.
        /// </summary>
        /// <remarks>
        ///     Lets the UI offer the full set of filterable contexts up front, instead of only the
        ///     handful that happen to be sitting in the live buffer.
        /// </remarks>
        public static IReadOnlyList<string> All { get; } = Collect(typeof(Logs))
            .Distinct()
            .OrderBy(c => c, StringComparer.OrdinalIgnoreCase)
            .ToList();

        private static IEnumerable<string> Collect(Type type)
        {
            foreach (var field in type.GetFields(BindingFlags.Public | BindingFlags.Static | BindingFlags.FlattenHierarchy))
            {
                if (field.IsLiteral && field.FieldType == typeof(string))
                {
                    yield return (string)field.GetRawConstantValue();
                }
            }

            foreach (var nested in type.GetNestedTypes(BindingFlags.Public))
            {
                foreach (var context in Collect(nested))
                {
                    yield return context;
                }
            }
        }

        public static class Sessions
        {
            public const string Auth = "Sessions / Auth";
        }

        public static class Transfers
        {
            public const string Downloads = "Transfers / Downloads";
            public const string Uploads = "Transfers / Uploads";
            public const string Notifications = "Transfers / Notifications";
        }

        public static class Shares
        {
            public const string Service = "Shares / Service";
            public const string Scan = "Shares / Scan";
            public const string Cache = "Shares / Cache";
        }

        public static class Messaging
        {
            public const string Private = "Messaging / Private";
            public const string Rooms = "Messaging / Rooms";
        }

        public static class Music
        {
            public const string Analysis = "Music / Analysis";
            public const string Tags = "Music / Tags";
            public const string Library = "Music / Library";
            public const string Metadata = "Music / Metadata";
            public const string Activity = "Music / Activity";
            public const string Converter = "Music / Converter";
            public const string Ffmpeg = "Music / FFmpeg";
            public const string Mixtapes = "Music / Mixtapes";
        }

        public static class Integrations
        {
            public const string VPN = "Integrations / VPN";
            public const string UPnP = "Integrations / UPnP";
            public const string Webhooks = "Integrations / Webhooks";
            public const string Scripts = "Integrations / Scripts";
            public const string FTP = "Integrations / FTP";
            public const string Pushbullet = "Integrations / Pushbullet";
            public const string YtDlp = "Integrations / yt-dlp";
        }
    }
}
