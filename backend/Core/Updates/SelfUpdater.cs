// <copyright file="SelfUpdater.cs" company="John Narey">
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

namespace resonance.Core.Updates
{
    using System;
    using System.Diagnostics;
    using System.IO;
    using System.Net.Http;
    using System.Net.Http.Headers;
    using System.Text;
    using System.Threading;
    using System.Threading.Tasks;
    using Serilog;

    /// <summary>
    ///     Applies a newer release to the checkout this application runs from, then restarts it.
    /// </summary>
    /// <remarks>
    ///     <para>
    ///         This targets the deployment this project actually uses: the source tree is bind-mounted into
    ///         the container and run with `dotnet watch`, so an update is a git checkout of the release tag
    ///         followed by a restart -- exactly what bin/ci-deploy does over SSH, done from the inside.
    ///     </para>
    ///     <para>
    ///         The tag is fetched from GitHub over HTTPS using the update token rather than from whatever
    ///         remote the checkout happens to have, so this works the same on an install whose origin is a
    ///         private mirror (the dev server's origin is Gitea, not GitHub).
    ///     </para>
    ///     <para>
    ///         Guard rails, because this rewrites the tree the process is running from: it refuses when the
    ///         working tree has modifications, so nobody's in-progress work is discarded, and it logs the
    ///         previous HEAD before moving so a failed update can be walked back by hand.
    ///     </para>
    /// </remarks>
    public static class SelfUpdater
    {
        private static readonly ILogger Log = Serilog.Log.ForContext("SourceContext", "Application");

        /// <summary>
        ///     Moves the checkout to <paramref name="tag"/> and restarts the container running it.
        /// </summary>
        /// <param name="tag">The release tag to apply.</param>
        /// <param name="organization">The GitHub organization owning the repository.</param>
        /// <param name="repository">The GitHub repository to fetch from.</param>
        /// <param name="token">The GitHub token used to fetch; required for a private repository.</param>
        /// <param name="container">The container to restart, or null to restart this one.</param>
        /// <param name="cancellationToken">The cancellation token.</param>
        /// <returns>A value indicating whether the update was applied.</returns>
        public static async Task<bool> ApplyAsync(
            string tag,
            string organization,
            string repository,
            string token,
            string container = null,
            CancellationToken cancellationToken = default)
        {
            var checkout = FindCheckout();

            if (checkout is null)
            {
                Log.Warning("Self-update: no git checkout found above {Base}; nothing to update", AppContext.BaseDirectory);
                return false;
            }

            var (dirtyOk, dirt) = await IsTreeCleanAsync(checkout, cancellationToken);

            if (!dirtyOk)
            {
                Log.Warning("Self-update: {Checkout} has uncommitted changes; refusing to move it. {Dirt}", checkout, dirt);
                return false;
            }

            var previous = (await GitAsync(checkout, "rev-parse HEAD", cancellationToken)).Output.Trim();

            // Credentials go on the command line rather than into the checkout's remotes: this must not
            // leave a token behind in .git/config for whoever looks at the tree next.
            var url = string.IsNullOrWhiteSpace(token)
                ? $"https://github.com/{organization}/{repository}.git"
                : $"https://x-access-token:{token}@github.com/{organization}/{repository}.git";

            Log.Information("Self-update: fetching {Tag} from {Organization}/{Repository} (currently at {Previous})", tag, organization, repository, previous[..Math.Min(7, previous.Length)]);

            var fetch = await GitAsync(checkout, $"fetch --no-tags {url} refs/tags/{tag}", cancellationToken);

            if (!fetch.Success)
            {
                // The url carries the token, so the raw git error is not safe to log verbatim.
                Log.Warning("Self-update: could not fetch {Tag}: {Error}", tag, Redact(fetch.Error, token));
                return false;
            }

            var checkoutResult = await GitAsync(checkout, "checkout --force --detach FETCH_HEAD", cancellationToken);

            if (!checkoutResult.Success)
            {
                Log.Error("Self-update: could not check out {Tag}: {Error}", tag, Redact(checkoutResult.Error, token));
                return false;
            }

            Log.Information("Self-update: checkout moved to {Tag}. Restarting; roll back with 'git checkout {Previous}' if this build does not come up", tag, previous[..Math.Min(7, previous.Length)]);

            return await RestartAsync(container, cancellationToken);
        }

        // Walks up from the running assembly rather than trusting a configured path, so this works the
        // same whether the app runs from /src/backend/bin/... under watch or from a published directory.
        private static string FindCheckout()
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);

            while (dir is not null)
            {
                if (Directory.Exists(Path.Combine(dir.FullName, ".git")))
                {
                    return dir.FullName;
                }

                dir = dir.Parent;
            }

            return null;
        }

        private static async Task<(bool Clean, string Dirt)> IsTreeCleanAsync(string checkout, CancellationToken cancellationToken)
        {
            // Untracked files survive a checkout, so they are not a reason to refuse; modified tracked
            // files would be overwritten, and are.
            var status = await GitAsync(checkout, "status --porcelain --untracked-files=no", cancellationToken);

            if (!status.Success)
            {
                return (false, status.Error);
            }

            var dirt = status.Output.Trim();
            return (string.IsNullOrEmpty(dirt), dirt);
        }

        private static string Redact(string text, string token)
            => string.IsNullOrWhiteSpace(token) || string.IsNullOrEmpty(text) ? text : text.Replace(token, "***");

        private static async Task<(bool Success, string Output, string Error)> GitAsync(string workingDirectory, string arguments, CancellationToken cancellationToken)
        {
            var psi = new ProcessStartInfo("git", arguments)
            {
                WorkingDirectory = workingDirectory,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };

            try
            {
                using var process = Process.Start(psi);
                var stdout = process.StandardOutput.ReadToEndAsync(cancellationToken);
                var stderr = process.StandardError.ReadToEndAsync(cancellationToken);
                await process.WaitForExitAsync(cancellationToken);

                return (process.ExitCode == 0, await stdout, await stderr);
            }
            catch (Exception ex)
            {
                return (false, string.Empty, ex.Message);
            }
        }

        // The Docker API over the mounted socket, rather than a docker CLI that isn't in this image.
        // Restarting the container this process is in means the call is answered and then the answer
        // never arrives, so a failure to read the response is not a failure to restart.
        private static async Task<bool> RestartAsync(string container, CancellationToken cancellationToken)
        {
            const string socket = "/var/run/docker.sock";

            if (!File.Exists(socket))
            {
                Log.Warning("Self-update: {Socket} is not available; the update is staged but this process must be restarted by hand", socket);
                return false;
            }

            // Compose does not set a hostname, so the container's hostname is its own short id.
            var target = string.IsNullOrWhiteSpace(container) ? Environment.MachineName : container;

            var handler = new SocketsHttpHandler
            {
                ConnectCallback = async (_, ct) =>
                {
                    var endpoint = new System.Net.Sockets.UnixDomainSocketEndPoint(socket);
                    var s = new System.Net.Sockets.Socket(System.Net.Sockets.AddressFamily.Unix, System.Net.Sockets.SocketType.Stream, System.Net.Sockets.ProtocolType.Unspecified);
                    await s.ConnectAsync(endpoint, ct);
                    return new System.Net.Sockets.NetworkStream(s, ownsSocket: true);
                },
            };

            using var http = new HttpClient(handler) { BaseAddress = new Uri("http://localhost") };
            http.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

            try
            {
                Log.Information("Self-update: restarting container {Container}", target);
                using var content = new StringContent(string.Empty, Encoding.UTF8, "application/json");
                var response = await http.PostAsync($"/containers/{Uri.EscapeDataString(target)}/restart", content, cancellationToken);

                if (!response.IsSuccessStatusCode)
                {
                    Log.Warning("Self-update: restart of {Container} was refused ({Status}); restart by hand to finish the update", target, (int)response.StatusCode);
                    return false;
                }

                return true;
            }
            catch (Exception ex)
            {
                // The restart killing this process mid-response is the successful path, and looks like this.
                Log.Information("Self-update: restart requested; connection closed ({Message})", ex.Message);
                return true;
            }
        }
    }
}
