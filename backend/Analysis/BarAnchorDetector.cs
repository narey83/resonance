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
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌ ╌
//   │ SPDX-FileCopyrightText: John Narey
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ── ──┈  ┈
// </copyright>

namespace resonance.Analysis;

using System;
using System.Collections.Generic;
using System.Linq;

/// <summary>
/// Estimates Basic bar and phrase phase from repeated, sustained changes across
/// the full cached waveform. An uncertain phase produces no corresponding marker.
/// </summary>
internal static class BarAnchorDetector
{
    private const int ShortBeatContext = 8;
    private const int LongBeatContext = 16;
    private const double MinChange = 0.4;
    private const double MinBarPhaseMargin = 0.25;
    private const double MinPhrasePhaseMargin = 0.15;

    public static Result Analyze(float[]? savedBeats, WaveformData? waveform)
    {
        if (savedBeats is not { Length: >= 8 } || waveform?.DurationSeconds is not > 0
            || !double.IsFinite(waveform.DurationSeconds.Value)
            || waveform.NumBars <= 0 || waveform.OverallPeaks is not { Length: > 0 }
            || waveform.LowPeaks is not { Length: > 0 } || waveform.MidPeaks is not { Length: > 0 }
            || waveform.HighPeaks is not { Length: > 0 } || !ValidBeats(savedBeats, waveform.DurationSeconds.Value))
        {
            return Result.Unavailable;
        }

        var period = Period(savedBeats);
        if (!period.HasValue)
        {
            return Result.Unavailable with { BasicGridBeats = savedBeats, BasicGridSource = "saved-beats" };
        }

        var shift = DisplayShift(savedBeats, waveform);
        var beats = RecoverOpening(savedBeats, waveform, period.Value, shift);
        var shiftedBeats = shift.HasValue
            ? beats.Select(value => (float)(value + shift.Value)).ToArray()
            : beats;
        var displayBeats = shiftedBeats.Where(value => value >= 0 && value < waveform.DurationSeconds.Value).ToArray();
        var gridSource = beats.Length > savedBeats.Length ? "saved-plus-measured-opening" : "saved-beats";
        var shiftSource = shift.HasValue ? "measured-waveform-onset" : "unresolved";
        if (!TryOrdinals(beats, period.Value, out var ordinals, out var missing))
        {
            return Result.Unavailable with
            {
                BasicGridBeats = displayBeats,
                BasicGridSource = gridSource,
                DisplayShiftSeconds = shift,
                DisplayShiftSource = shiftSource,
                BarPhaseSource = "unresolved",
                BarPhaseStatus = "unresolved",
                SixteenBarPhaseStatus = "unresolved",
                ThirtyTwoBarPhaseStatus = "unresolved",
                RecoveredOpeningBeats = beats.Length - savedBeats.Length,
            };
        }

        var features = Features(beats, ordinals, waveform, period.Value);
        var novelty = Novelty(features);
        var events = Events(novelty);
        var structuralVote = Vote(events, 4, 16, 2, MinBarPhaseMargin);
        var accentVote = AccentVote(beats, ordinals, waveform);
        var barPhase = structuralVote.Phase;
        var barSource = "multi-band-structure";
        var barEvidence = structuralVote.Margin;
        var barSupported = structuralVote.Supported;
        var leadIns = LeadInCount(events, features, structuralVote.Phase);
        if (structuralVote.Supported && leadIns >= 2)
        {
            if (accentVote.Supported && accentVote.Phase == (structuralVote.Phase + 1) % 4)
            {
                // A sustained change may begin on the last beat of the old
                // bar. Repeated accents and a continuing change at the next
                // beat identify that next beat as the new bar's downbeat.
                barPhase = accentVote.Phase;
                barEvidence = accentVote.Margin;
                barSource = "repeated-accent-and-structural-lead-in";
            }
            else
            {
                barSupported = false;
            }
        }
        else if (structuralVote.Supported && accentVote.Supported)
        {
            if (accentVote.Phase == structuralVote.Phase)
            {
                barEvidence = Math.Min(structuralVote.Margin!.Value, accentVote.Margin!.Value);
                barSource = "structure-and-repeated-accent";
            }
            else
            {
                barSupported = false;
            }
        }

        if (!barSupported)
        {
            return new Result(displayBeats, gridSource, shift, shiftSource,
                null, "unresolved", "unresolved", barEvidence, "unresolved", null, "unresolved", null,
                Array.Empty<BarMarker>(), beats.Length - savedBeats.Length, missing);
        }

        var barEvents = events
            .Where(e => e.Ordinal % 4 == barPhase
                || ((e.Ordinal + 1) % 4 == barPhase && IsLeadIn(e.Ordinal, features)))
            .Select(e =>
            {
                var ordinal = e.Ordinal % 4 == barPhase ? e.Ordinal : e.Ordinal + 1;
                var weight = IsRising(ordinal, features) ? 1.0 : 0.5;
                return new Event((ordinal - barPhase) / 4, e.Score * weight);
            }).ToArray();
        var sixteenVote = Vote(barEvents, 16, 16, 2, MinPhrasePhaseMargin);
        var thirtyTwoVote = Vote(barEvents, 32, 32, 2, MinPhrasePhaseMargin);
        if (thirtyTwoVote.Supported && sixteenVote.Supported
            && thirtyTwoVote.Phase % 16 != sixteenVote.Phase)
        {
            thirtyTwoVote = thirtyTwoVote with { Supported = false };
        }
        else if (thirtyTwoVote.Supported && !sixteenVote.Supported)
        {
            // A supported 32-bar residue also determines its 16-bar residue.
            sixteenVote = new VoteResult(thirtyTwoVote.Phase % 16,
                thirtyTwoVote.Margin, true);
        }

        var markers = new List<BarMarker>();
        double? firstBar = null;
        for (var index = 0; index < beats.Length; index++)
        {
            if (ordinals[index] % 4 != barPhase)
            {
                continue;
            }

            var displayTime = shiftedBeats[index];
            if (displayTime < 0 || displayTime >= waveform.DurationSeconds.Value)
            {
                continue;
            }

            firstBar ??= displayTime;
            var bar = (ordinals[index] - barPhase) / 4;
            if (thirtyTwoVote.Supported && Mod(bar - thirtyTwoVote.Phase, 32) == 0)
            {
                markers.Add(new BarMarker(displayTime, 2));
            }
            else if (sixteenVote.Supported && Mod(bar - sixteenVote.Phase, 16) == 0)
            {
                markers.Add(new BarMarker(displayTime, 1));
            }
        }

        return new Result(displayBeats, gridSource, shift, shiftSource,
            firstBar, barSource, "supported", barEvidence,
            sixteenVote.Supported ? "supported" : "unresolved", sixteenVote.Margin,
            thirtyTwoVote.Supported ? "supported" : "unresolved", thirtyTwoVote.Margin,
            markers.ToArray(), beats.Length - savedBeats.Length, missing);
    }

    private static bool ValidBeats(float[] beats, double duration)
    {
        for (var index = 0; index < beats.Length; index++)
        {
            if (!float.IsFinite(beats[index]) || beats[index] < 0 || beats[index] >= duration
                || (index > 0 && beats[index] <= beats[index - 1]))
            {
                return false;
            }
        }

        return true;
    }

    private static double? Period(float[] beats)
    {
        // A few detector skips must not turn the inferred tempo into double time.
        var differences = beats.Zip(beats.Skip(1), (a, b) => (double)b - a).OrderBy(value => value).ToArray();
        var shorter = differences.Take(Math.Max(4, differences.Length * 3 / 4)).ToArray();
        var period = Median(shorter);
        return period is >= 0.25 and <= 1.5 ? period : null;
    }

    private static float[] RecoverOpening(float[] saved, WaveformData waveform, double period, double? onsetLag)
    {
        // Only the opening can be recovered from a stable measured interval and
        // a transient at every preceding slot. The saved detector phase is kept:
        // its timestamps can precede the acoustic kick by several milliseconds.
        var opening = saved.Take(Math.Min(saved.Length, 17)).ToArray();
        var differences = opening.Zip(opening.Skip(1), (a, b) => (double)b - a).ToArray();
        var openingPeriod = Median(differences);
        if (differences.Length < 8 || differences.Count(d => Math.Abs(d - openingPeriod) <= openingPeriod * 0.12)
            < differences.Length * 0.8 || Math.Abs(openingPeriod - period) > period * 0.08)
        {
            return saved;
        }

        var lagStart = onsetLag.HasValue ? onsetLag.Value - 0.02 : 0;
        var lagEnd = onsetLag.HasValue ? onsetLag.Value + 0.02 : 0.04;
        var referenceOverall = Median(saved.Take(8)
            .Select(t => WindowMax(waveform.OverallPeaks, waveform, t + lagStart, t + lagEnd)));
        var referenceRise = Median(saved.Take(8)
            .Select(t => Rise(waveform.OverallPeaks, waveform, t, lagStart, lagEnd)));
        var referenceBands = Median(saved.Take(8)
            .Select(t => BandRise(waveform, t, lagStart, lagEnd)));
        var added = new List<float>();
        for (var step = 1; step <= 4; step++)
        {
            var candidate = saved[0] - (step * openingPeriod);
            if (candidate < 0)
            {
                break;
            }

            var overall = WindowMax(waveform.OverallPeaks, waveform,
                candidate + lagStart, candidate + lagEnd);
            var rise = Rise(waveform.OverallPeaks, waveform, candidate, lagStart, lagEnd);
            var bandRise = BandRise(waveform, candidate, lagStart, lagEnd);
            if (overall < Math.Max(0.02, referenceOverall * 0.2)
                || rise < Math.Max(0.015, referenceRise * 0.25)
                || bandRise < Math.Max(0.01, referenceBands * 0.25))
            {
                break;
            }

            added.Add((float)candidate);
        }

        if (added.Count == 0)
        {
            return saved;
        }

        added.Reverse();
        added.AddRange(saved);
        return added.ToArray();
    }

    private static double BandRise(WaveformData waveform, double time, double lagStart, double lagEnd) =>
        Math.Max(Rise(waveform.LowPeaks, waveform, time, lagStart, lagEnd),
            Math.Max(Rise(waveform.MidPeaks, waveform, time, lagStart, lagEnd),
                Rise(waveform.HighPeaks, waveform, time, lagStart, lagEnd)));

    private static double Rise(float[] peaks, WaveformData waveform, double time, double lagStart, double lagEnd)
    {
        var after = WindowMax(peaks, waveform, time + lagStart, time + lagEnd);
        var before = WindowMean(peaks, waveform, time - 0.12, time - 0.015);
        return Math.Max(0, after - before);
    }

    private static double? DisplayShift(float[] beats, WaveformData waveform)
    {
        // The detector can lead the actual waveform attack by a stable small
        // amount. Measure a positive slope at many beats; a single late bass
        // entrance or a few offbeat fills cannot move the display grid.
        var rate = waveform.LowPeaks.Length / waveform.DurationSeconds!.Value;
        var length = Math.Min(waveform.LowPeaks.Length,
            Math.Min(waveform.MidPeaks.Length, waveform.OverallPeaks.Length));
        if (length < 4)
        {
            return null;
        }

        var candidates = new List<(double Lag, double Strength)>();
        foreach (var beat in beats.Take(64))
        {
            var first = Math.Clamp((int)Math.Floor((beat - 0.02) * rate), 3, length);
            var last = Math.Clamp((int)Math.Ceiling((beat + 0.12) * rate), first, length);
            var strongest = 0.0;
            var lag = 0.0;
            for (var index = first; index < last; index++)
            {
                var rise = (0.5 * (waveform.OverallPeaks[index] - waveform.OverallPeaks[index - 3]))
                    + (0.8 * (waveform.LowPeaks[index] - waveform.LowPeaks[index - 3]))
                    + (0.2 * (waveform.MidPeaks[index] - waveform.MidPeaks[index - 3]));
                if (rise > strongest)
                {
                    strongest = rise;
                    lag = (index / rate) - beat;
                }
            }

            if (strongest > 0)
            {
                candidates.Add((lag, strongest));
            }
        }

        if (candidates.Count < 16)
        {
            return null;
        }

        var reference = Median(candidates.Select(value => value.Strength));
        if (reference < 0.05)
        {
            return null;
        }

        var lags = candidates.Where(value => value.Strength >= Math.Max(0.02, reference * 0.4))
            .Select(value => value.Lag).ToArray();
        if (lags.Length < 16)
        {
            return null;
        }

        var median = Median(lags);
        var inliers = lags.Where(value => Math.Abs(value - median) <= 0.02).ToArray();
        if (inliers.Length < Math.Max(12, (int)Math.Ceiling(lags.Length * 0.7))
            || Median(inliers.Select(value => Math.Abs(value - median))) > 0.012
            || median is < -0.04 or > 0.09)
        {
            return null;
        }

        return Median(inliers);
    }

    private static bool TryOrdinals(float[] beats, double period, out int[] ordinals, out int missing)
    {
        ordinals = new int[beats.Length];
        missing = 0;
        for (var index = 1; index < beats.Length; index++)
        {
            var ratio = (beats[index] - beats[index - 1]) / period;
            int step;
            if (ratio is >= 0.65 and <= 1.35)
            {
                step = 1;
            }
            else
            {
                step = (int)Math.Round(ratio);
                if (step is < 2 or > 4 || Math.Abs(ratio - step) > 0.2)
                {
                    // A tempo discontinuity, spurious beat or long silent gap
                    // has no trustworthy bar count on the other side.
                    return false;
                }
            }

            missing += step - 1;
            ordinals[index] = ordinals[index - 1] + step;
        }

        return true;
    }

    private static Feature?[] Features(float[] beats, int[] ordinals, WaveformData waveform, double period)
    {
        var features = new Feature?[ordinals[^1] + 1];
        for (var index = 0; index < beats.Length; index++)
        {
            var next = index + 1 < beats.Length
                ? Math.Min(beats[index + 1], beats[index] + (period * 1.25))
                : beats[index] + period;
            var end = Math.Min(waveform.DurationSeconds!.Value, next);
            if (end <= beats[index])
            {
                continue;
            }

            features[ordinals[index]] = new Feature(
                WindowPower(waveform.LowPeaks, waveform, beats[index], end),
                WindowPower(waveform.MidPeaks, waveform, beats[index], end),
                WindowPower(waveform.HighPeaks, waveform, beats[index], end));
        }

        return features;
    }

    private static double[] Novelty(Feature?[] features)
    {
        var floors = new[]
        {
            Floor(features.Select(value => value?.Low)),
            Floor(features.Select(value => value?.Mid)),
            Floor(features.Select(value => value?.High)),
        };
        var novelty = new double[features.Length];
        for (var index = LongBeatContext; index < features.Length - LongBeatContext; index++)
        {
            var shortChange = Change(features, index, ShortBeatContext, floors);
            var longChange = Change(features, index, LongBeatContext, floors);
            novelty[index] = Math.Min(shortChange, longChange);
        }

        return novelty;
    }

    private static double Change(Feature?[] features, int index, int context, double[] floors)
    {
        var before = WindowFeatures(features, index - context, index);
        var after = WindowFeatures(features, index, index + context);
        if (before == null || after == null)
        {
            return 0;
        }

        var changes = new[]
        {
            LogChange(before.Value.Low, after.Value.Low, floors[0]),
            LogChange(before.Value.Mid, after.Value.Mid, floors[1]),
            LogChange(before.Value.High, after.Value.High, floors[2]),
        };
        Array.Sort(changes);

        // One isolated crash, fill or filter move cannot establish a section.
        return changes[1] >= Math.Log(1.4) ? (changes[1] + changes[2]) / 2 : 0;
    }

    private static Feature? WindowFeatures(Feature?[] features, int start, int end)
    {
        var available = features.Skip(start).Take(end - start).Where(value => value.HasValue)
            .Select(value => value!.Value).ToArray();
        if (available.Length < (end - start) * 0.75)
        {
            return null;
        }

        return new Feature(available.Average(value => value.Low),
            available.Average(value => value.Mid), available.Average(value => value.High));
    }

    private static Event[] Events(double[] novelty)
    {
        var positive = novelty.Where(value => value > 0).ToArray();
        if (positive.Length == 0)
        {
            return Array.Empty<Event>();
        }

        var median = Median(novelty);
        var threshold = Math.Max(MinChange, median + (2 * Median(novelty.Select(value => Math.Abs(value - median)))));
        var selected = new List<Event>();
        foreach (var candidate in novelty.Select((score, ordinal) => new Event(ordinal, score))
                     .Where(value => value.Score >= threshold)
                     .OrderByDescending(value => value.Score).ThenBy(value => value.Ordinal))
        {
            if (selected.All(value => Math.Abs(value.Ordinal - candidate.Ordinal) >= 16))
            {
                selected.Add(candidate);
            }
        }

        return selected.ToArray();
    }

    private static VoteResult AccentVote(float[] beats, int[] ordinals, WaveformData waveform)
    {
        var byOrdinal = new double?[ordinals[^1] + 1];
        for (var index = 0; index < beats.Length; index++)
        {
            byOrdinal[ordinals[index]] =
                WindowMax(waveform.MidPeaks, waveform, beats[index] + 0.01, beats[index] + 0.12)
                + WindowMax(waveform.HighPeaks, waveform, beats[index] + 0.01, beats[index] + 0.12);
        }

        var wins = new int[4];
        var groups = 0;
        for (var ordinal = 0; ordinal + 3 < byOrdinal.Length; ordinal += 4)
        {
            if (!byOrdinal[ordinal].HasValue || !byOrdinal[ordinal + 1].HasValue
                || !byOrdinal[ordinal + 2].HasValue || !byOrdinal[ordinal + 3].HasValue)
            {
                continue;
            }

            var ranked = Enumerable.Range(0, 4)
                .OrderByDescending(phase => byOrdinal[ordinal + phase]!.Value).ToArray();
            var strongest = byOrdinal[ordinal + ranked[0]]!.Value;
            var runner = byOrdinal[ordinal + ranked[1]]!.Value;
            if (strongest < 0.05 || strongest < runner * 1.08)
            {
                continue;
            }

            wins[ranked[0]]++;
            groups++;
        }

        var phases = Enumerable.Range(0, 4).OrderByDescending(phase => wins[phase]).ToArray();
        var winner = phases[0];
        var margin = wins[winner] > 0 ? (double)(wins[winner] - wins[phases[1]]) / wins[winner] : 0;
        var supported = groups >= 32 && wins[winner] >= Math.Max(12, groups * 0.35)
            && margin >= MinBarPhaseMargin;
        return new VoteResult(winner, groups > 0 ? margin : null, supported);
    }

    private static int LeadInCount(Event[] events, Feature?[] features, int phase) =>
        events.Count(value => value.Ordinal % 4 == phase && IsLeadIn(value.Ordinal, features));

    private static bool IsLeadIn(int ordinal, Feature?[] features)
    {
        if (ordinal < 1 || ordinal + 2 >= features.Length
            || !features[ordinal - 1].HasValue || !features[ordinal].HasValue
            || !features[ordinal + 1].HasValue || !features[ordinal + 2].HasValue)
        {
            return false;
        }

        var before = features[ordinal - 1]!.Value.Low;
        var lead = features[ordinal]!.Value.Low;
        var after = features[ordinal + 1]!.Value.Low;
        var later = features[ordinal + 2]!.Value.Low;
        var first = lead - before;
        var second = after - lead;
        var scale = Math.Max(Math.Max(before, after), 0.01);
        return Math.Sign(first) == Math.Sign(second)
            && Math.Abs(first) >= scale * 0.15
            && Math.Abs(second) >= Math.Max(scale * 0.05, Math.Abs(first) * 0.1)
            && Math.Abs(after - later) <= scale * 0.25;
    }

    private static bool IsRising(int ordinal, Feature?[] features)
    {
        var first = Math.Max(0, ordinal - 8);
        var last = Math.Min(features.Length, ordinal + 8);
        var before = features.Skip(first).Take(ordinal - first).Where(value => value.HasValue)
            .Select(value => value!.Value.Low).ToArray();
        var after = features.Skip(ordinal).Take(last - ordinal).Where(value => value.HasValue)
            .Select(value => value!.Value.Low).ToArray();
        return before.Length > 0 && after.Length > 0 && after.Average() >= before.Average();
    }

    private static VoteResult Vote(Event[] events, int modulus, int minSpread, int minHits, double minMargin)
    {
        var scores = new double[modulus];
        var members = new List<Event>[modulus];
        for (var index = 0; index < modulus; index++)
        {
            members[index] = new List<Event>();
        }

        foreach (var candidate in events)
        {
            var phase = Mod(candidate.Ordinal, modulus);
            scores[phase] += candidate.Score;
            members[phase].Add(candidate);
        }

        var ranked = Enumerable.Range(0, modulus).OrderByDescending(index => scores[index]).ToArray();
        var winner = ranked[0];
        if (scores[winner] <= 0)
        {
            return new VoteResult(0, null, false);
        }

        var runner = ranked[1];
        var margin = (scores[winner] - scores[runner]) / scores[winner];
        var support = members[winner];
        var spread = support.Count > 0 ? support.Max(value => value.Ordinal) - support.Min(value => value.Ordinal) : 0;
        return new VoteResult(winner, margin,
            support.Count >= minHits && spread >= minSpread && margin >= minMargin);
    }

    private static double Floor(IEnumerable<double?> values)
    {
        var ordered = values.Where(value => value.HasValue).Select(value => value!.Value)
            .OrderBy(value => value).ToArray();
        return 0.001 + (ordered.Length > 0 ? ordered[ordered.Length * 3 / 4] * 0.05 : 0);
    }

    private static double LogChange(double before, double after, double floor) =>
        Math.Min(3, Math.Abs(Math.Log((after + floor) / (before + floor))));

    private static int Mod(int value, int modulus) => ((value % modulus) + modulus) % modulus;

    private static double Median(IEnumerable<double> values)
    {
        var ordered = values.OrderBy(value => value).ToArray();
        return ordered.Length == 0 ? 0 : ordered[ordered.Length / 2];
    }

    private static double WindowMax(float[] peaks, WaveformData waveform, double start, double end)
    {
        var (first, last) = WindowRange(peaks, waveform, start, end);
        var maximum = 0.0;
        for (var index = first; index < last; index++)
        {
            maximum = Math.Max(maximum, Math.Max(0, peaks[index]));
        }

        return maximum;
    }

    private static double WindowMean(float[] peaks, WaveformData waveform, double start, double end)
    {
        var (first, last) = WindowRange(peaks, waveform, start, end);
        var sum = 0.0;
        for (var index = first; index < last; index++)
        {
            sum += Math.Max(0, peaks[index]);
        }

        return last > first ? sum / (last - first) : 0;
    }

    private static double WindowPower(float[] peaks, WaveformData waveform, double start, double end)
    {
        var (first, last) = WindowRange(peaks, waveform, start, end);
        var sum = 0.0;
        for (var index = first; index < last; index++)
        {
            var peak = Math.Max(0, peaks[index]);
            sum += peak * peak;
        }

        return last > first ? sum / (last - first) : 0;
    }

    private static (int First, int Last) WindowRange(float[] peaks, WaveformData waveform, double start, double end)
    {
        var rate = peaks.Length / waveform.DurationSeconds!.Value;
        var first = Math.Clamp((int)Math.Floor(start * rate), 0, peaks.Length);
        var last = Math.Clamp((int)Math.Ceiling(end * rate), first, peaks.Length);
        return (first, last);
    }

    private readonly record struct Feature(double Low, double Mid, double High);

    private readonly record struct Event(int Ordinal, double Score);

    private readonly record struct VoteResult(int Phase, double? Margin, bool Supported);

    internal record Result(
        float[] BasicGridBeats,
        string BasicGridSource,
        double? DisplayShiftSeconds,
        string DisplayShiftSource,
        double? BarAnchorSeconds,
        string BarPhaseSource,
        string BarPhaseStatus,
        double? BarPhaseEvidence,
        string SixteenBarPhaseStatus,
        double? SixteenBarPhaseEvidence,
        string ThirtyTwoBarPhaseStatus,
        double? ThirtyTwoBarPhaseEvidence,
        BarMarker[] Markers,
        int RecoveredOpeningBeats,
        int SkippedInternalBeats)
    {
        public static Result Unavailable => new(null, "unavailable", null, "unavailable", null,
            "unavailable", "unavailable", null, "unavailable", null, "unavailable", null,
            Array.Empty<BarMarker>(), 0, 0);
    }
}
