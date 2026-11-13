// <copyright file="BarAnchorDetector.cs" company="John Narey">
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
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌ ╌
//   │ SPDX-FileCopyrightText: John Narey
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ── ──┈  ┈
// </copyright>

namespace resonance.Analysis;

using System;
using System.Linq;

/// <summary>
/// Finds the first bass attack on the saved beat grid for Basic waveform display.
/// This is an estimated phrase origin, not a measured musical downbeat.
/// </summary>
internal static class BarAnchorDetector
{
    public static Result Estimate(float[]? beats, WaveformData? waveform)
    {
        if (beats is not { Length: > 0 } || waveform?.LowPeaks is not { Length: > 0 }
            || waveform.DurationSeconds is not > 0)
        {
            return null;
        }

        var count = Math.Min(beats.Length, 32);
        var peaks = new double[count];
        var rises = new double[count];
        for (var index = 0; index < count; index++)
        {
            if (!float.IsFinite(beats[index]) || beats[index] < 0
                || (index > 0 && beats[index] <= beats[index - 1]))
            {
                return null;
            }

            var time = beats[index];
            peaks[index] = WindowMax(waveform, time - 0.06, time + 0.15);
            rises[index] = WindowMean(waveform, time - 0.06, time + 0.15)
                - WindowMean(waveform, time - 0.22, time - 0.06);
        }

        var ordered = peaks.OrderBy(value => value).ToArray();
        var strongPeak = ordered[(int)Math.Floor((ordered.Length - 1) * 0.75)];
        for (var index = 0; index < count; index++)
        {
            if (peaks[index] >= Math.Max(0.01, strongPeak * 0.9)
                && rises[index] >= peaks[index] * 0.08)
            {
                return new Result(beats[index], index, "bass-attack");
            }
        }

        // Preserve a usable Basic grid when the cached bass band has no clear
        // attack. The source names the uncertainty instead of implying a kick.
        return new Result(beats[0], 0, "first-detected-beat");
    }

    public static BarMarker[] Markers(float[]? beats, Result? anchor)
    {
        if (beats == null || anchor == null)
        {
            return Array.Empty<BarMarker>();
        }

        var count = Math.Max(0, (beats.Length - anchor.BeatIndex + 63) / 64);
        var markers = new BarMarker[count];
        for (var index = 0; index < count; index++)
        {
            var beatIndex = anchor.BeatIndex + (index * 64);
            markers[index] = new BarMarker(beats[beatIndex], index % 2 == 0 ? 2 : 1);
        }

        return markers;
    }

    private static double WindowMax(WaveformData waveform, double start, double end)
    {
        var (first, last) = WindowRange(waveform, start, end);
        var value = 0.0;
        for (var index = first; index < last; index++)
        {
            value = Math.Max(value, Math.Max(0, waveform.LowPeaks[index]));
        }

        return value;
    }

    private static double WindowMean(WaveformData waveform, double start, double end)
    {
        var (first, last) = WindowRange(waveform, start, end);
        var sum = 0.0;
        for (var index = first; index < last; index++)
        {
            sum += Math.Max(0, waveform.LowPeaks[index]);
        }

        return last > first ? sum / (last - first) : 0;
    }

    private static (int First, int Last) WindowRange(WaveformData waveform, double start, double end)
    {
        var rate = waveform.LowPeaks.Length / waveform.DurationSeconds.Value;
        var first = Math.Clamp((int)Math.Floor(start * rate), 0, waveform.LowPeaks.Length);
        var last = Math.Clamp((int)Math.Ceiling(end * rate), first, waveform.LowPeaks.Length);
        return (first, last);
    }

    internal record Result(double Seconds, int BeatIndex, string Source);
}
