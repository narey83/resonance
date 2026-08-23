// <copyright file="FrameworkContextNormalizer.cs" company="John Narey">
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

namespace resonance
{
    using System;
    using Serilog.Core;
    using Serilog.Events;

    /// <summary>
    ///     Rewrites SourceContext for framework/library loggers into the same short "Group / Leaf"
    ///     shape every context this app sets itself already uses (see <see cref="Logs"/>). Framework
    ///     code logs under its fully-qualified .NET type (e.g.
    ///     "Microsoft.EntityFrameworkCore.Database.Command"), which only ever reaches a sink because
    ///     FrameworkLevelSwitch defaults to Error -- rare enough that when it does happen, the raw
    ///     name stands out as inconsistent with everything else in the log. Runs as an enricher,
    ///     ahead of every sink, so JSONL, the live SignalR push, and the Postgres store all see the
    ///     same normalized value -- not just whichever one happened to get individually patched.
    ///     Anything not matching a known prefix (i.e. every context this app sets itself) passes
    ///     through completely untouched.
    /// </summary>
    public class FrameworkContextNormalizer : ILogEventEnricher
    {
        private static readonly (string Prefix, string Group)[] KnownPrefixes =
        {
            ("Microsoft.AspNetCore", "ASP.NET Core"),
            ("Microsoft.EntityFrameworkCore", "EF Core"),
            ("Microsoft.Extensions", ".NET"),
            ("Microsoft.Data", ".NET"),
            ("System.Net.Http", "HTTP Client"),
            ("Npgsql", "Postgres"),
        };

        public void Enrich(LogEvent logEvent, ILogEventPropertyFactory propertyFactory)
        {
            if (!logEvent.Properties.TryGetValue("SourceContext", out var value)
                || value is not ScalarValue { Value: string raw })
            {
                return;
            }

            var normalized = Normalize(raw);

            if (ReferenceEquals(normalized, raw))
            {
                return;
            }

            logEvent.AddOrUpdateProperty(propertyFactory.CreateProperty("SourceContext", normalized));
        }

        private static string Normalize(string raw)
        {
            foreach (var (prefix, group) in KnownPrefixes)
            {
                if (raw.Length < prefix.Length || !raw.StartsWith(prefix, StringComparison.Ordinal))
                {
                    continue;
                }

                // "Microsoft.AspNetCoreSomethingElse" must not match the "Microsoft.AspNetCore" prefix
                if (raw.Length > prefix.Length && raw[prefix.Length] != '.')
                {
                    continue;
                }

                if (raw.Length == prefix.Length)
                {
                    return group;
                }

                var leaf = raw[(prefix.Length + 1)..];
                var lastSegment = leaf[(leaf.LastIndexOf('.') + 1)..];

                return lastSegment.Length == 0 ? group : $"{group} / {lastSegment}";
            }

            return raw;
        }
    }
}
