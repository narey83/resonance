// <copyright file="RefreshLogValues.cs" company="John Narey">
// Copyright (c) 2026 John Narey. SPDX-License-Identifier: AGPL-3.0-only
// </copyright>

namespace resonance.Authentication;

using System;
using System.Linq;
using resonance.Core.Http;

internal static class RefreshLogValues
{
    internal static string Safe(string value, int maxLength)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return "unknown";
        }

        // The user agent and request ID can originate outside the application. Keep one
        // short log line even if a client supplies control characters or an oversized value.
        var safe = new string(value.Take(maxLength).Select(c => char.IsControl(c) ? ' ' : c).ToArray());
        return SensitiveData.RedactText(safe.Trim()) is { Length: > 0 } redacted ? redacted : "unknown";
    }
}
