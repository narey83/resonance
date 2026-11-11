// <copyright file="RefreshTokenRejectedException.cs" company="John Narey">
// Copyright (c) 2026 John Narey. SPDX-License-Identifier: AGPL-3.0-only
// </copyright>

namespace resonance.Authentication;

using System;

/// <summary>
///     Carries server-verified session attribution for a rejected refresh token.
///     An unknown token has no associated account or session.
/// </summary>
public sealed class RefreshTokenRejectedException : UnauthorizedException
{
    public RefreshTokenRejectedException(string message, UserSession? session = null)
        : this(message, session?.Username, session?.Id, session?.DeviceName)
    {
    }

    public RefreshTokenRejectedException(string message, string? username, Guid? sessionId, string? deviceName = null)
        : base(message)
    {
        Username = username;
        SessionId = sessionId;
        DeviceName = deviceName;
    }

    public string? Username { get; }

    public Guid? SessionId { get; }

    public string? DeviceName { get; }
}
