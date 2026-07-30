// <copyright file="TransferErrorNotificationService.cs" company="John Narey">
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
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: John Narey
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

namespace resonance.Transfers;

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.Extensions.Options;
using resonance.Messaging;
using Serilog;

public interface ITransferErrorNotificationService
{
    IEnumerable<TransferErrorNotification> GetHistory();
    Task NotifyUploadErrorAsync(string username, string filename, string exception);
    Task NotifyUploadRejectedAsync(string username, string filename, string reason);
    Task NotifyDownloadErrorAsync(string username, string filename, string exception);
}

public record TransferErrorNotification(
    DateTime SentAt,
    string Username,
    string Filename,
    string Type,
    string Message);

public class TransferErrorNotificationService : ITransferErrorNotificationService
{
    public TransferErrorNotificationService(IConversationService conversations, IOptionsMonitor<resonance.Options> optionsMonitor)
    {
        Conversations = conversations;
        OptionsMonitor = optionsMonitor;
    }

    private IConversationService Conversations { get; }
    private IOptionsMonitor<resonance.Options> OptionsMonitor { get; }
    private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", resonance.Logs.Transfers.Notifications);
    private ConcurrentFixedSizeQueue<TransferErrorNotification> History { get; } = new(size: 50);
    private ConcurrentDictionary<string, DateTime> LastNotified { get; } = new(StringComparer.OrdinalIgnoreCase);

    public IEnumerable<TransferErrorNotification> GetHistory() => History.Reverse();

    public Task NotifyUploadErrorAsync(string username, string filename, string exception)
    {
        var opts = OptionsMonitor.CurrentValue.TransferErrorNotifications;
        if (!opts.Enabled)
        {
            return Task.CompletedTask;
        }

        var message = opts.UploadErrorTemplate
            .Replace("{filename}", filename)
            .Replace("{exception}", exception);

        return TrySendAsync(username, filename, "UploadError", message);
    }

    public Task NotifyUploadRejectedAsync(string username, string filename, string reason)
    {
        var opts = OptionsMonitor.CurrentValue.TransferErrorNotifications;
        if (!opts.Enabled)
        {
            return Task.CompletedTask;
        }

        var message = opts.UploadRejectedTemplate
            .Replace("{filename}", filename)
            .Replace("{reason}", reason);

        return TrySendAsync(username, filename, "UploadRejected", message);
    }

    public Task NotifyDownloadErrorAsync(string username, string filename, string exception)
    {
        var opts = OptionsMonitor.CurrentValue.TransferErrorNotifications;
        if (!opts.Enabled)
        {
            return Task.CompletedTask;
        }

        var message = opts.DownloadErrorTemplate
            .Replace("{filename}", filename)
            .Replace("{exception}", exception);

        return TrySendAsync(username, filename, "DownloadError", message);
    }

    private async Task TrySendAsync(string username, string filename, string type, string message)
    {
        var cooldown = OptionsMonitor.CurrentValue.TransferErrorNotifications.CooldownMins;
        if (cooldown > 0 && LastNotified.TryGetValue(username, out var last) &&
            (DateTime.UtcNow - last).TotalMinutes < cooldown)
        {
            Log.Debug("Skipping transfer error notification to {Username} (cooldown active)", username);
            return;
        }

        try
        {
            await Conversations.SendMessageAsync(username, message);
            LastNotified[username] = DateTime.UtcNow;
            History.Enqueue(new TransferErrorNotification(DateTime.UtcNow, username, filename, type, message));
            Log.Information("Sent transfer error notification to {Username}", username);
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "Failed to send transfer error notification to {Username}", username);
        }
    }
}
