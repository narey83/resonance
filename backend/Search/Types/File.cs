// <copyright file="File.cs" company="JP Dillingham">
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

namespace resonance.Search
{
    using SoulseekFile = Soulseek.File;

    public class File
    {
        public int? BitDepth { get; init; }
        public int? BitRate { get; init; }
        public int Code { get; init; }
        public string Extension { get; init; }
        public string Filename { get; init; }
        public bool? IsVariableBitRate { get; init; }
        public int? Length { get; init; }
        public int? SampleRate { get; init; }
        public long Size { get; init; }
        public bool IsLocked { get; init; }

        // Returns only the immediate parent directory + filename, stripping any
        // leading path segments (e.g. "Music\Shared\Artist - Album\01.flac" → "Artist - Album\01.flac").
        public string DisplayFilename
        {
            get
            {
                if (string.IsNullOrEmpty(Filename))
                {
                    return Filename;
                }

                var sep = Filename.Contains('\\') ? '\\' : '/';
                var parts = Filename.Split(sep);
                return parts.Length <= 2 ? Filename : $"{parts[^2]}{sep}{parts[^1]}";
            }
        }

        public static File FromSoulseekFile(SoulseekFile file)
        {
            return new File()
            {
                BitDepth = file.BitDepth,
                BitRate = file.BitRate,
                Code = file.Code,
                Extension = file.Extension,
                Filename = file.Filename,
                IsVariableBitRate = file.IsVariableBitRate,
                Length = file.Length,
                SampleRate = file.SampleRate,
                Size = file.Size,
            };
        }
    }
}
