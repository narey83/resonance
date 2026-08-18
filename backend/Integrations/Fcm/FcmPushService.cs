// <copyright file="FcmPushService.cs" company="John Narey">
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

namespace resonance.Integrations.Fcm
{
    using System;
    using System.Collections.Generic;
    using System.IdentityModel.Tokens.Jwt;
    using System.IO;
    using System.Linq;
    using System.Net;
    using System.Net.Http;
    using System.Net.Http.Headers;
    using System.Net.Http.Json;
    using System.Security.Claims;
    using System.Security.Cryptography;
    using System.Text.Json;
    using System.Text.Json.Serialization;
    using System.Threading.Tasks;
    using Microsoft.Extensions.Options;
    using Microsoft.IdentityModel.Tokens;
    using resonance.Authentication;
    using static resonance.Options.IntegrationsOptions;

    /// <summary>
    ///     Firebase Cloud Messaging integration service. Talks to the FCM v1 HTTP API directly (no
    ///     vendor SDK), matching the plain-HttpClient style already used for the Pushbullet integration.
    /// </summary>
    public class FcmPushService : IFcmPushService
    {
        private const string TokenScope = "https://www.googleapis.com/auth/firebase.messaging";

        // Refresh this many seconds before the access token's actual expiry, so a send never races
        // an about-to-expire token.
        private const int TokenRefreshSkewSeconds = 300;

        public FcmPushService(
            IHttpClientFactory httpClientFactory,
            IOptionsMonitor<resonance.Options> optionsMonitor,
            PushTokenService pushTokens)
        {
            HttpClientFactory = httpClientFactory;
            OptionsMonitor = optionsMonitor;
            PushTokens = pushTokens;
        }

        private Serilog.ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", resonance.Logs.Integrations.Fcm);
        private IHttpClientFactory HttpClientFactory { get; }
        private IOptionsMonitor<resonance.Options> OptionsMonitor { get; }
        private PushTokenService PushTokens { get; }
        private FcmOptions FcmOptions => OptionsMonitor.CurrentValue.Integrations.Fcm;
        private object AccessTokenLock { get; } = new();
        private string CachedAccessToken { get; set; }
        private DateTime CachedAccessTokenExpiresUtc { get; set; }

        // Credentials are read once and cached for the life of the process; a rotated service account
        // key takes effect on the next restart, matching how every other option here is only re-read
        // from OptionsMonitor for the plain fields, not for anything requiring a file re-parse.
        private ServiceAccountCredentials CachedCredentials { get; set; }

        public async Task SendLibraryUpdatedAsync(int added, int updated, int removed)
        {
            if (!FcmOptions.Enabled)
            {
                return;
            }

            try
            {
                var tokens = PushTokens.GetAll();

                if (tokens.Count == 0)
                {
                    return;
                }

                var accessToken = await GetAccessTokenAsync();
                var uri = $"https://fcm.googleapis.com/v1/projects/{FcmOptions.ProjectId}/messages:send";

                using var http = HttpClientFactory.CreateClient();
                http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

                await Task.WhenAll(tokens.Select(t => SendToTokenAsync(http, uri, t.Token, added, updated, removed)));
            }
            catch (Exception ex)
            {
                // Sent fire-and-forget from the scan loop — never let a push failure surface there.
                Log.Warning(ex, "Failed to send FCM library-updated push: {Message}", ex.Message);
            }
        }

        private static string BuildAssertion(ServiceAccountCredentials credentials)
        {
            using var rsa = RSA.Create();
            rsa.ImportFromPem(credentials.PrivateKey);

            var signingCredentials = new SigningCredentials(new RsaSecurityKey(rsa), SecurityAlgorithms.RsaSha256);
            var issuedUtc = DateTime.UtcNow;

            var token = new JwtSecurityToken(
                issuer: credentials.ClientEmail,
                audience: credentials.TokenUri,
                claims: new[] { new Claim("scope", TokenScope) },
                notBefore: issuedUtc,
                expires: issuedUtc.AddHours(1),
                signingCredentials: signingCredentials);

            return new JwtSecurityTokenHandler().WriteToken(token);
        }

        private async Task SendToTokenAsync(HttpClient http, string uri, string token, int added, int updated, int removed)
        {
            try
            {
                // Data-only: a top-level "notification" key would make Android auto-display a system
                // notification and skip the app's background handler entirely.
                var payload = new
                {
                    message = new
                    {
                        token,
                        data = new Dictionary<string, string>
                        {
                            ["type"] = "library_updated",
                            ["added"] = added.ToString(),
                            ["updated"] = updated.ToString(),
                            ["removed"] = removed.ToString(),
                        },
                        android = new { priority = "high" },
                    },
                };

                using var response = await http.PostAsJsonAsync(uri, payload);

                if (response.IsSuccessStatusCode)
                {
                    return;
                }

                var body = await response.Content.ReadAsStringAsync();

                if (response.StatusCode == HttpStatusCode.NotFound || body.Contains("UNREGISTERED", StringComparison.OrdinalIgnoreCase))
                {
                    Log.Debug("FCM token no longer registered; removing it");
                    PushTokens.DeleteByToken(token);
                }
                else
                {
                    Log.Warning("FCM push failed with status {Status}: {Body}", (int)response.StatusCode, body);
                }
            }
            catch (Exception ex)
            {
                Log.Warning(ex, "Failed to send FCM push to a device: {Message}", ex.Message);
            }
        }

        private async Task<string> GetAccessTokenAsync()
        {
            lock (AccessTokenLock)
            {
                if (CachedAccessToken is not null && DateTime.UtcNow < CachedAccessTokenExpiresUtc)
                {
                    return CachedAccessToken;
                }
            }

            var credentials = GetCredentials();
            var assertion = BuildAssertion(credentials);

            using var http = HttpClientFactory.CreateClient();
            using var form = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["grant_type"] = "urn:ietf:params:oauth:grant-type:jwt-bearer",
                ["assertion"] = assertion,
            });

            using var response = await http.PostAsync(credentials.TokenUri, form);
            response.EnsureSuccessStatusCode();

            var token = await response.Content.ReadFromJsonAsync<TokenResponse>();

            lock (AccessTokenLock)
            {
                CachedAccessToken = token.AccessToken;
                CachedAccessTokenExpiresUtc = DateTime.UtcNow.AddSeconds(token.ExpiresIn - TokenRefreshSkewSeconds);
            }

            return token.AccessToken;
        }

        private ServiceAccountCredentials GetCredentials()
        {
            if (CachedCredentials is not null)
            {
                return CachedCredentials;
            }

            var json = !string.IsNullOrWhiteSpace(FcmOptions.CredentialsFile)
                ? File.ReadAllText(FcmOptions.CredentialsFile)
                : FcmOptions.CredentialsJson;

            CachedCredentials = JsonSerializer.Deserialize<ServiceAccountCredentials>(json)
                ?? throw new InvalidOperationException("Unable to parse FCM service account credentials");

            return CachedCredentials;
        }

        private class ServiceAccountCredentials
        {
            [JsonPropertyName("client_email")]
            public string ClientEmail { get; set; }

            [JsonPropertyName("private_key")]
            public string PrivateKey { get; set; }

            [JsonPropertyName("token_uri")]
            public string TokenUri { get; set; } = "https://oauth2.googleapis.com/token";
        }

        private class TokenResponse
        {
            [JsonPropertyName("access_token")]
            public string AccessToken { get; set; }

            [JsonPropertyName("expires_in")]
            public int ExpiresIn { get; set; }
        }
    }
}
