// <copyright file="SensitiveData.cs" company="John Narey">
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

namespace resonance.Core.Http;

using System;
using System.Linq;
using Microsoft.AspNetCore.WebUtilities;

public static class SensitiveData
{
    public static string RedactUrl(string url)
    {
        if (string.IsNullOrEmpty(url))
        {
            return url;
        }

        url = System.Text.RegularExpressions.Regex.Replace(url, @"(?i)(/public/mixtapes/)[^/?#\s]+", "$1[redacted]");
        var queryAt = url.IndexOf('?');
        if (queryAt < 0)
        {
            return url;
        }

        var fragmentAt = url.IndexOf('#', queryAt);
        var query = fragmentAt < 0 ? url[(queryAt + 1)..] : url[(queryAt + 1)..fragmentAt];
        var values = QueryHelpers.ParseQuery(query);
        var safe = values.SelectMany(pair => pair.Value.Select(value =>
            new System.Collections.Generic.KeyValuePair<string, string>(pair.Key,
                IsSecret(pair.Key) ? "[redacted]" : value)));
        return QueryHelpers.AddQueryString(url[..queryAt], safe) + (fragmentAt < 0 ? string.Empty : url[fragmentAt..]);
    }

    public static string RedactText(string text)
    {
        var safe = System.Text.RegularExpressions.Regex.Replace(text ?? string.Empty, @"(?i)([?&](?:access[_-]?token|refresh[_-]?token|token|sig|signature|api[_-]?key|password|code)=)[^&\s#]*", "$1[redacted]");
        return System.Text.RegularExpressions.Regex.Replace(safe, @"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+", "Bearer [redacted]");
    }

    private static bool IsSecret(string key) => key.ToLowerInvariant().Replace("-", string.Empty).Replace("_", string.Empty) is
        "accesstoken" or "refreshtoken" or "token" or "sig" or "signature" or "apikey" or "password" or "code";
}
