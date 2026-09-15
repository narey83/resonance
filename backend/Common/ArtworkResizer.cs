// <copyright file="ArtworkResizer.cs" company="John Narey">
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

namespace resonance.Common
{
    using System;
    using System.IO;
    using SixLabors.ImageSharp;
    using SixLabors.ImageSharp.Formats;
    using SixLabors.ImageSharp.Formats.Jpeg;
    using SixLabors.ImageSharp.Processing;

    /// <summary>
    ///     Shrinks artwork to thumbnail sizes, for the endpoints that serve covers to small UI cells.
    /// </summary>
    public static class ArtworkResizer
    {
        /// <summary>The smallest size a thumbnail can be requested at.</summary>
        public const int MinimumSize = 32;

        /// <summary>The largest size a thumbnail can be requested at.</summary>
        public const int MaximumSize = 2048;

        /// <summary>
        ///     Clamps a requested thumbnail size into the supported range.
        /// </summary>
        /// <param name="size">The requested size, in pixels.</param>
        /// <returns>The size to resize to.</returns>
        public static int Clamp(int size) => Math.Clamp(size, MinimumSize, MaximumSize);

        /// <summary>
        ///     Resizes an image so that it fits within a <paramref name="size"/> pixel square, keeping its
        ///     aspect ratio, and encodes the result as a JPEG.
        /// </summary>
        /// <param name="source">The encoded source image.</param>
        /// <param name="size">The bounding square, in pixels; clamped to the supported range.</param>
        /// <returns>The encoded JPEG.</returns>
        public static byte[] ResizeToJpeg(ReadOnlySpan<byte> source, int size)
        {
            var s = Clamp(size);

            // Decode straight to roughly the size we want. Artwork is routinely far larger than the
            // thumbnail asked for, and decoding it at full resolution only to shrink it afterwards was the
            // bulk of a cold render — one cover measured 12.6s. JPEG can scale during decode, so this
            // skips most of it.
            using var img = Image.Load(new DecoderOptions { TargetSize = new Size(s, s) }, source);
            img.Mutate(x => x.Resize(new ResizeOptions
            {
                Size = new Size(s, s),
                Mode = ResizeMode.Max,
            }));

            using var ms = new MemoryStream();
            img.Save(ms, new JpegEncoder { Quality = 85 });
            return ms.ToArray();
        }
    }
}
