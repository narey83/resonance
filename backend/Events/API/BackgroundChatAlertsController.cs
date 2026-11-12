// <copyright file="BackgroundChatAlertsController.cs" company="John Narey">
//   SPDX-FileCopyrightText: John Narey
//   SPDX-License-Identifier: AGPL-3.0-only
//   Part of Resonance, a Soulseek client based on slskd.
// </copyright>

namespace resonance.Events.API;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Asp.Versioning;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using resonance.Authentication;

/// <summary>Small read-only feed for the Android foreground chat service.</summary>
[Route("api/v{version:apiVersion}/background-chat-alerts")]
[ApiVersion("0")]
[ApiController]
[Produces("application/json")]
public sealed class BackgroundChatAlertsController(
    SessionService sessions,
    PermissionService permissions,
    IDbContextFactory<EventsDbContext> contextFactory) : ControllerBase
{
    /// <summary>Returns newly received PMs and room mentions for a signed-in device session.</summary>
    /// <returns>A bounded page of chat alerts and the next polling cursor.</returns>
    [HttpGet]
    [AllowAnonymous]
    [ProducesResponseType(typeof(ChatAlertPage), 200)]
    [ProducesResponseType(401)]
    [ProducesResponseType(403)]
    public IActionResult Poll([FromQuery] long after = 0)
    {
        const string bearer = "Bearer ";
        var authorization = Request.Headers.Authorization.ToString();
        if (!authorization.StartsWith(bearer, StringComparison.OrdinalIgnoreCase))
        {
            return Unauthorized();
        }

        var role = sessions.GetCurrentRefreshTokenRole(authorization[bearer.Length..].Trim());
        if (role is null)
        {
            return Unauthorized();
        }

        if (role != Role.Administrator.ToString() && !permissions.IsAllowed(role, Feature.Messaging))
        {
            return Forbid();
        }

        var cutoff = DateTime.UtcNow;
        if (after == 0)
        {
            // Start at the present rather than showing old history as new notifications.
            return Ok(new ChatAlertPage(cutoff.Ticks, []));
        }

        if (after < DateTime.UnixEpoch.Ticks || after > cutoff.Ticks)
        {
            return BadRequest();
        }

        var from = new DateTime(after, DateTimeKind.Utc);
        using var db = contextFactory.CreateDbContext();
        var records = db.Events.AsNoTracking()
            .Where(e => e.Timestamp > from && e.Timestamp <= cutoff &&
                (e.Type == EventType.PrivateMessageReceived || e.Type == EventType.RoomMention))
            .OrderBy(e => e.Timestamp).ThenBy(e => e.Id)
            .Take(100).ToList();

        var alerts = records.Select(Map).OfType<ChatAlert>().ToArray();
        var next = records.Count == 100 ? records[^1].Timestamp.Ticks : cutoff.Ticks;
        return Ok(new ChatAlertPage(next, alerts));
    }

    private static ChatAlert? Map(EventRecord record)
    {
        try
        {
            using var json = JsonDocument.Parse(record.Data);
            var root = json.RootElement;
            if (record.Type == EventType.PrivateMessageReceived)
            {
                var message = root.GetProperty("message");
                var username = message.GetProperty("username").GetString();
                var body = message.GetProperty("message").GetString();
                return !string.IsNullOrWhiteSpace(username) && !string.IsNullOrWhiteSpace(body)
                    ? new ChatAlert(record.Id, "pm", username, Limit($"Message from {username}", 80), Limit(body, 300))
                    : null;
            }

            var room = root.GetProperty("roomName").GetString();
            var sender = root.GetProperty("username").GetString();
            var text = root.GetProperty("message").GetString();
            return !string.IsNullOrWhiteSpace(room) && !string.IsNullOrWhiteSpace(sender) && !string.IsNullOrWhiteSpace(text)
                ? new ChatAlert(record.Id, "room", room, Limit($"Mentioned in {room}", 80), Limit($"{sender}: {text}", 300))
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
        catch (KeyNotFoundException)
        {
            return null;
        }
        catch (InvalidOperationException)
        {
            return null;
        }
    }

    private static string Limit(string value, int length) => value.Length <= length ? value : value[..length];
}

public sealed record ChatAlert(Guid Id, string Kind, string Thread, string Title, string Body);
public sealed record ChatAlertPage(long Next, ChatAlert[] Alerts);
