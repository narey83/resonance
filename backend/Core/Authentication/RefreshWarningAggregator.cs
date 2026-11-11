// <copyright file="RefreshWarningAggregator.cs" company="John Narey">
// Copyright (c) 2026 John Narey. SPDX-License-Identifier: AGPL-3.0-only
// </copyright>

namespace resonance.Authentication;

using System;
using System.Collections.Generic;

/// <summary>
///     Summarises repeated unknown refresh tokens from one IP without changing authentication
///     decisions. A bounded overflow bucket prevents untrusted callers from growing this cache.
/// </summary>
public sealed class RefreshWarningAggregator
{
    private const int MaxClientIps = 4096;
    private const string OverflowKey = "<other IPs>";
    private static readonly TimeSpan Window = TimeSpan.FromMinutes(1);
    private readonly Dictionary<string, Entry> entries = new(StringComparer.Ordinal);
    private readonly object gate = new();

    public (bool Emit, int Suppressed, bool MultipleIps) Record(string? ip, DateTime nowUtc)
    {
        var key = ip ?? "unknown";
        lock (gate)
        {
            if (!entries.ContainsKey(key) && entries.Count >= MaxClientIps)
            {
                if (entries.ContainsKey(OverflowKey))
                {
                    key = OverflowKey;
                }
                else
                {
                    foreach (var expired in new List<string>(entries.Keys))
                    {
                        if (entries[expired].StartedAt + Window <= nowUtc)
                        {
                            entries.Remove(expired);
                        }
                    }

                    if (entries.Count >= MaxClientIps)
                    {
                        key = OverflowKey;
                    }
                }
            }

            var multipleIps = key == OverflowKey;
            if (!entries.TryGetValue(key, out var entry))
            {
                entries[key] = new Entry(nowUtc);
                return (true, 0, multipleIps);
            }

            if (entry.StartedAt + Window <= nowUtc)
            {
                var suppressed = entry.Suppressed;
                entries[key] = new Entry(nowUtc);
                return (true, suppressed, multipleIps);
            }

            if (entry.Suppressed < int.MaxValue)
            {
                entry.Suppressed++;
            }

            return (false, 0, multipleIps);
        }
    }

    private sealed class Entry(DateTime startedAt)
    {
        public DateTime StartedAt { get; } = startedAt;

        public int Suppressed { get; set; }
    }
}
