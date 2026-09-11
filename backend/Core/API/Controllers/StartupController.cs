// <copyright file="StartupController.cs" company="John Narey">
//   Copyright (c) 2026 John Narey.
//   SPDX-License-Identifier: AGPL-3.0-only
// </copyright>

namespace resonance.Core.API;

using System.Linq;
using Asp.Versioning;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

/// <summary>
///     Reports background service initialization without requiring a login session.
/// </summary>
[Route("api/v{version:apiVersion}/startup")]
[ApiVersion("0")]
[ApiController]
[AllowAnonymous]
[Produces("application/json")]
public sealed class StartupController : ControllerBase
{
    [HttpGet]
    public IActionResult Get()
    {
        var services = StartupProgress.Snapshot();
        return Ok(new
        {
            Ready = services.All(service => service.State != "starting"),
            Services = services,
        });
    }
}
