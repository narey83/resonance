// <copyright file="BridgeController.UsbEdits.cs" company="John Narey">
// Copyright (c) 2026 John Narey.
// SPDX-License-Identifier: AGPL-3.0-only
// </copyright>
namespace resonance.Core.API;

using System;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

/// <summary>Transforms supplied USB metadata copies without reading audio or changing the server library.</summary>
public partial class BridgeController
{
    [AllowAnonymous]
    [HttpPost("sync/edit-usb")]
    [RequestSizeLimit(270000000)]
    [RequestFormLimits(MultipartBodyLengthLimit = 270000000)]
    public async Task<IActionResult> EditUSB([FromForm] IFormFile classic, [FromForm] IFormFile oneLibrary, [FromForm] string kind, [FromForm] uint targetId)
    {
        if (!TryPairing(out var pairingHash))
        {
            return Unauthorized();
        }

        if (classic == null || oneLibrary == null)
        {
            return BadRequest("Both player databases are required.");
        }

        try
        {
            await using var classicStream = classic.OpenReadStream();
            await using var modernStream = oneLibrary.OpenReadStream();
            var archive = await exports.EditPlayerDatabases(classicStream, classic.Length, modernStream, oneLibrary.Length, kind, targetId, HttpContext.RequestAborted);
            RecordPresence(pairingHash);
            Response.OnCompleted(() =>
            {
                try
                {
                    Directory.Delete(Path.GetDirectoryName(archive), true);
                }
                catch (IOException)
                {
                }
                catch (UnauthorizedAccessException)
                {
                }

                return Task.CompletedTask;
            });
            return PhysicalFile(archive, "application/zip");
        }
        catch (ArgumentException exception)
        {
            return BadRequest(exception.Message);
        }
        catch (InvalidOperationException exception)
        {
            return Conflict(exception.Message);
        }
        catch (JsonException)
        {
            return Conflict("USB library edit was invalid.");
        }
    }
}
