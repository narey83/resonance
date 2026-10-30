// <copyright file="SiteReadiness.cs" company="John Narey">
//   Copyright (c) 2026 John Narey.
//   SPDX-License-Identifier: AGPL-3.0-only
// </copyright>

namespace resonance.Core;

using System;
using System.Collections.Generic;
using System.Linq;

/// <summary>Public readiness facts for the reverse proxy, without diagnostic details.</summary>
public sealed record SiteReadiness(bool Ready, string State)
{
    public static SiteReadiness Evaluate(IEnumerable<StartupServiceState> services, bool stopping)
    {
        if (stopping)
        {
            return new(false, "restarting");
        }

        var snapshot = services.ToArray();
        var required = snapshot.Where(service => service.Id == "core" || service.Id.StartsWith("database-", StringComparison.Ordinal)).ToArray();
        if (required.Any(service => service.State == "failed"))
        {
            return new(false, "unavailable");
        }

        if (!required.Any(service => service.Id == "core") || !required.Any(service => service.Id.StartsWith("database-", StringComparison.Ordinal))
            || required.Any(service => service.State != "ready"))
        {
            return new(false, "starting");
        }

        return new(true, snapshot.Any(service => service.State == "failed") ? "degraded" : "available");
    }
}
