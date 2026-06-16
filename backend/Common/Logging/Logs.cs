// <copyright file="Logs.cs" company="JP Dillingham">
//           ▄▄▄▄     ▄▄▄▄     ▄▄▄▄
//     ▄▄▄▄▄▄█  █▄▄▄▄▄█  █▄▄▄▄▄█  █
//     █__ --█  █__ --█    ◄█  -  █
//     █▄▄▄▄▄█▄▄█▄▄▄▄▄█▄▄█▄▄█▄▄▄▄▄█
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) JP Dillingham.
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

namespace resonance
{
    public static class Logs
    {
        public const string Application = "Application";
        public const string Connection = "Connection";
        public const string Blacklist = "Blacklist";
        public const string Search = "Search";
        public const string Relay = "Relay";
        public const string Cast = "Cast";
        public const string Events = "Events";
        public const string Files = "Files";
        public const string Users = "Users";
        public const string Network = "Network";
        public const string Telemetry = "Telemetry";
        public const string Database = "Database";
        public const string Browser = "Browser";
        public const string Mobile = "Mobile";
        public const string Dlna = "DLNA";

        public static class Sessions
        {
            public const string Auth = "Sessions / Auth";
        }

        public static class Transfers
        {
            public const string Downloads = "Transfers / Downloads";
            public const string Uploads = "Transfers / Uploads";
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
            public const string BPM = "Music / BPM";
            public const string Key = "Music / Key";
            public const string Waveform = "Music / Waveform";
            public const string Tags = "Music / Tags";
            public const string Library = "Music / Library";
        }

        public static class Integrations
        {
            public const string VPN = "Integrations / VPN";
            public const string Webhooks = "Integrations / Webhooks";
            public const string Scripts = "Integrations / Scripts";
            public const string FTP = "Integrations / FTP";
            public const string Pushbullet = "Integrations / Pushbullet";
        }
    }
}
