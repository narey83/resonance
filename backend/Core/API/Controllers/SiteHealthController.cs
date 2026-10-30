// <copyright file="SiteHealthController.cs" company="John Narey">
//   Copyright (c) 2026 John Narey.
//   SPDX-License-Identifier: AGPL-3.0-only
// </copyright>

namespace resonance.Core.API;

using Asp.Versioning;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Hosting;

/// <summary>Readiness for Caddy; the existing /health endpoint remains a liveness check.</summary>
[ApiController]
[ApiVersionNeutral]
[AllowAnonymous]
[Route("health/ready")]
public sealed class SiteHealthController(IHostApplicationLifetime lifetime) : ControllerBase
{
    [HttpGet]
    [HttpHead]
    public IActionResult Get()
    {
        var result = SiteReadiness.Evaluate(StartupProgress.Snapshot(), lifetime.ApplicationStopping.IsCancellationRequested);
        Response.Headers.CacheControl = "no-store";
        Response.Headers["X-Resonance-Site-State"] = result.State;
        if (!result.Ready)
        {
            Response.Headers.RetryAfter = "5";
        }

        return StatusCode(result.Ready ? 200 : 503, result);
    }
}
