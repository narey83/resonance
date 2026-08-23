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
    ///
    ///     Also shortens SubContext for the same known library prefixes, but to the leaf segment
    ///     only (e.g. "Soulseek.Messaging.Handlers.PeerMessageHandler" -> "PeerMessageHandler") --
    ///     the group already lives in the sibling SourceContext ("Soulseek"), so repeating it there
    ///     would be redundant. Unlike SourceContext, SubContext also carries arbitrary non-namespace
    ///     values (a device id, a username), so only prefixes known to be dotted library type names
    ///     are touched; everything else passes through untouched.
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

        private static readonly string[] KnownSubContextPrefixes =
        {
            "Soulseek",
        };

        public void Enrich(LogEvent logEvent, ILogEventPropertyFactory propertyFactory)
        {
            EnrichSourceContext(logEvent, propertyFactory);
            EnrichSubContext(logEvent, propertyFactory);
        }

        private static void EnrichSourceContext(LogEvent logEvent, ILogEventPropertyFactory propertyFactory)
        {
            if (!logEvent.Properties.TryGetValue("SourceContext", out var value)
                || value is not ScalarValue { Value: string raw })
            {
                return;
            }

            var normalized = NormalizeGroupSlashLeaf(raw);

            if (ReferenceEquals(normalized, raw))
            {
                return;
            }

            logEvent.AddOrUpdateProperty(propertyFactory.CreateProperty("SourceContext", normalized));
        }

        private static void EnrichSubContext(LogEvent logEvent, ILogEventPropertyFactory propertyFactory)
        {
            if (!logEvent.Properties.TryGetValue("SubContext", out var value)
                || value is not ScalarValue { Value: string raw })
            {
                return;
            }

            var leaf = LeafSegmentIfKnownPrefix(raw);

            if (leaf is null || ReferenceEquals(leaf, raw))
            {
                return;
            }

            logEvent.AddOrUpdateProperty(propertyFactory.CreateProperty("SubContext", leaf));
        }

        private static string NormalizeGroupSlashLeaf(string raw)
        {
            foreach (var (prefix, group) in KnownPrefixes)
            {
                if (!MatchesPrefix(raw, prefix))
                {
                    continue;
                }

                if (raw.Length == prefix.Length)
                {
                    return group;
                }

                var lastSegment = LastSegment(raw[(prefix.Length + 1)..]);

                return lastSegment.Length == 0 ? group : $"{group} / {lastSegment}";
            }

            return raw;
        }

        private static string LeafSegmentIfKnownPrefix(string raw)
        {
            foreach (var prefix in KnownSubContextPrefixes)
            {
                if (!MatchesPrefix(raw, prefix) || raw.Length == prefix.Length)
                {
                    continue;
                }

                var lastSegment = LastSegment(raw[(prefix.Length + 1)..]);

                return lastSegment.Length == 0 ? raw : lastSegment;
            }

            return null;
        }

        private static bool MatchesPrefix(string raw, string prefix)
        {
            if (raw.Length < prefix.Length || !raw.StartsWith(prefix, StringComparison.Ordinal))
            {
                return false;
            }

            // "Microsoft.AspNetCoreSomethingElse" must not match the "Microsoft.AspNetCore" prefix
            return raw.Length == prefix.Length || raw[prefix.Length] == '.';
        }

        private static string LastSegment(string dotted) => dotted[(dotted.LastIndexOf('.') + 1)..];
    }
}
