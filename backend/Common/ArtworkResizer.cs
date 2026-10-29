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
    using SkiaSharp;

    /// <summary>
    ///     Shrinks artwork to thumbnail sizes, for the endpoints that serve covers to small UI cells.
    /// </summary>
    public static class ArtworkResizer
    {
        /// <summary>The smallest size a thumbnail can be requested at.</summary>
        public const int MinimumSize = 32;

        /// <summary>The bounded size used when a caller omits a valid size.</summary>
        public const int DefaultSize = 256;

        /// <summary>The largest size a thumbnail can be requested at.</summary>
        public const int MaximumSize = 2048;

        /// <summary>
        ///     Clamps a requested thumbnail size into the supported range.
        /// </summary>
        /// <param name="size">The requested size, in pixels.</param>
        /// <returns>The size to resize to.</returns>
        public static int Clamp(int size) => Math.Clamp(size, MinimumSize, MaximumSize);

        /// <summary>Maps layout-specific requests to a small reusable set of thumbnails.</summary>
        /// <param name="size">The requested maximum image dimension, or null for the default.</param>
        /// <returns>The reusable thumbnail size in pixels.</returns>
        public static int Bucket(int? size)
        {
            var requested = size is > 0 ? Clamp(size.Value) : DefaultSize;
            foreach (var bucket in new[] { 64, 128, 192, 256, 384, 512, 768, 1024, 1280, 2048 })
            {
                if (requested <= bucket)
                {
                    return bucket;
                }
            }

            return MaximumSize;
        }

        /// <summary>
        ///     Resizes an image so that it fits within a <paramref name="size"/> pixel square, keeping its
        ///     aspect ratio, and encodes the result as a JPEG.
        /// </summary>
        /// <param name="source">The encoded source image.</param>
        /// <param name="size">The bounding square, in pixels; clamped to the supported range.</param>
        /// <returns>The encoded JPEG.</returns>
        public static byte[] ResizeToJpeg(ReadOnlySpan<byte> source, int size) => ResizeToJpeg(source, size, false);

        /// <summary>Produces a bounded JPEG, optionally cropping a square for DLNA clients.</summary>
        /// <param name="source">The encoded source image.</param>
        /// <param name="size">The requested maximum output dimension in pixels.</param>
        /// <param name="square">Whether to crop the output to a square.</param>
        /// <returns>The encoded JPEG image.</returns>
        public static byte[] ResizeToJpeg(ReadOnlySpan<byte> source, int size, bool square)
        {
            var bound = Clamp(size);
            using var data = SKData.CreateCopy(source);
            using var codec = SKCodec.Create(data) ?? throw new InvalidDataException("Unsupported image format.");
            var original = codec.Info;
            if (original.Width <= 0 || original.Height <= 0 || (long)original.Width * original.Height > 100_000_000)
            {
                throw new InvalidDataException("Image dimensions exceed the supported limit.");
            }

            var scale = Math.Min(1f, (float)bound / (square ? Math.Min(original.Width, original.Height) : Math.Max(original.Width, original.Height)));
            var decodedSize = codec.GetScaledDimensions(scale);
            if ((long)decodedSize.Width * decodedSize.Height > 32_000_000)
            {
                throw new InvalidDataException("Image requires too much decode memory.");
            }

            using var colourSpace = SKColorSpace.CreateSrgb();
            using var bitmap = new SKBitmap(new SKImageInfo(decodedSize.Width, decodedSize.Height, SKColorType.Bgra8888, SKAlphaType.Premul, colourSpace));
            if (codec.GetPixels(bitmap.Info, bitmap.GetPixels()) != SKCodecResult.Success)
            {
                throw new InvalidDataException("Could not decode image.");
            }

            using var oriented = Orient(bitmap, codec.EncodedOrigin);
            var ratio = Math.Min(1d, (double)bound / (square ? Math.Min(oriented.Width, oriented.Height) : Math.Max(oriented.Width, oriented.Height)));
            var width = square ? Math.Min(bound, Math.Min(oriented.Width, oriented.Height)) : Math.Max(1, (int)Math.Round(oriented.Width * ratio));
            var height = square ? width : Math.Max(1, (int)Math.Round(oriented.Height * ratio));
            using var output = new SKBitmap(new SKImageInfo(width, height, SKColorType.Bgra8888, SKAlphaType.Opaque, colourSpace));
            using (var canvas = new SKCanvas(output))
            {
                canvas.Clear(SKColors.White);
                var crop = square ? Math.Min(oriented.Width, oriented.Height) : 0;
                var sourceRect = square
                    ? SKRect.Create((oriented.Width - crop) / 2f, (oriented.Height - crop) / 2f, crop, crop)
                    : SKRect.Create(oriented.Width, oriented.Height);
                canvas.DrawBitmap(oriented, sourceRect, SKRect.Create(width, height), new SKSamplingOptions(SKFilterMode.Linear, SKMipmapMode.Linear));
            }

            using var image = SKImage.FromBitmap(output);
            using var encoded = image.Encode(SKEncodedImageFormat.Jpeg, 78);
            return encoded.ToArray();
        }

        private static SKBitmap Orient(SKBitmap bitmap, SKEncodedOrigin origin)
        {
            var w = bitmap.Width;
            var h = bitmap.Height;
            var swap = origin is SKEncodedOrigin.LeftTop or SKEncodedOrigin.RightTop or SKEncodedOrigin.RightBottom or SKEncodedOrigin.LeftBottom;
            var output = new SKBitmap(swap ? h : w, swap ? w : h);
            using var canvas = new SKCanvas(output);
            var matrix = origin switch
            {
                SKEncodedOrigin.TopRight => Matrix(-1, 0, w, 0, 1, 0),
                SKEncodedOrigin.BottomRight => Matrix(-1, 0, w, 0, -1, h),
                SKEncodedOrigin.BottomLeft => Matrix(1, 0, 0, 0, -1, h),
                SKEncodedOrigin.LeftTop => Matrix(0, 1, 0, 1, 0, 0),
                SKEncodedOrigin.RightTop => Matrix(0, -1, h, 1, 0, 0),
                SKEncodedOrigin.RightBottom => Matrix(0, -1, h, -1, 0, w),
                SKEncodedOrigin.LeftBottom => Matrix(0, 1, 0, -1, 0, w),
                _ => SKMatrix.Identity,
            };
            canvas.SetMatrix(matrix);
            canvas.DrawBitmap(bitmap, 0, 0, new SKSamplingOptions(SKFilterMode.Nearest));
            return output;
        }

        private static SKMatrix Matrix(float a, float b, float x, float c, float d, float y) => new()
        {
            ScaleX = a, SkewX = b, TransX = x, SkewY = c, ScaleY = d, TransY = y, Persp2 = 1,
        };
    }
}
