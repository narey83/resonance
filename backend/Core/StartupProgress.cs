// <copyright file="StartupProgress.cs" company="John Narey">
//   Copyright (c) 2026 John Narey.
//   SPDX-License-Identifier: AGPL-3.0-only
// </copyright>

namespace resonance.Core;

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;

/// <summary>
///     Tracks long-running service initialization after the HTTP host has become available.
/// </summary>
public static class StartupProgress
{
    private static readonly ConcurrentDictionary<string, StartupServiceState> Services = new();

    public static void Starting(string id, string name, string message) =>
        Services[id] = new(id, name, "starting", message, DateTime.UtcNow, null);

    public static void Ready(string id, string message) => Update(id, "ready", message);

    public static void Failed(string id, string message) => Update(id, "failed", message);

    public static IReadOnlyList<StartupServiceState> Snapshot() =>
        Services.Values.OrderBy(service => service.Name).ToList();

    private static void Update(string id, string state, string message)
    {
        Services.AddOrUpdate(
            id,
            _ => new(id, id, state, message, DateTime.UtcNow, DateTime.UtcNow),
            (_, existing) => existing with { State = state, Message = message, CompletedAt = DateTime.UtcNow });
    }
}

public sealed record StartupServiceState(
    string Id,
    string Name,
    string State,
    string Message,
    DateTime StartedAt,
    DateTime? CompletedAt);
