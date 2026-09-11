// <copyright file="WaveformResampler.cs" company="John Narey">
//    ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮
//   ─╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰  resonance
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) 2026 John Narey.
//   │ Part of Resonance, a Soulseek client based on slskd.
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

namespace resonance.Analysis;

using System;

/// <summary>
///     Reduces stored waveform peaks to a smaller number of bars for clients that draw at a fixed,
///     small width (the mobile player's seek bar), matching how the web player resamples.
/// </summary>
public static class WaveformResampler
{
    // Mirrors RMS_ABOVE in frontend/src/lib/waveform.js: once a bar spans several stored peaks,
    // their maximum lands near the loudest moment almost every time and the waveform reads as a
    // solid block, so RMS over the span is used instead; peak still wins for narrow spans.
    private const int RmsAbove = 4;

    /// <summary>
    ///     Resamples <paramref name="data"/> to <paramref name="bars"/> values.
    /// </summary>
    /// <param name="data">The stored peaks; null passes through.</param>
    /// <param name="bars">The number of values wanted.</param>
    /// <returns>The resampled peaks, or <paramref name="data"/> unchanged if it is already no longer.</returns>
    public static float[] Resample(float[] data, int bars)
    {
        if (data == null || bars <= 0 || data.Length <= bars)
        {
            return data;
        }

        var result = new float[bars];
        var useRms = data.Length / (double)bars >= RmsAbove;

        for (var bar = 0; bar < bars; bar++)
        {
            var start = (int)Math.Floor(bar / (double)bars * data.Length);
            var end = Math.Min(data.Length, Math.Max(start + 1, (int)Math.Floor((bar + 1) / (double)bars * data.Length)));

            if (useRms)
            {
                double sum = 0;
                for (var i = start; i < end; i++)
                {
                    sum += data[i] * (double)data[i];
                }

                result[bar] = (float)Math.Sqrt(sum / (end - start));
            }
            else
            {
                var peak = 0f;
                for (var i = start; i < end; i++)
                {
                    peak = Math.Max(peak, data[i]);
                }

                result[bar] = peak;
            }
        }

        return result;
    }
}
