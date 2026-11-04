// <copyright file="ManagedBgutil.cs" company="John Narey">
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

// Copyright (c) 2026 John Narey. SPDX-License-Identifier: AGPL-3.0-only
namespace resonance.Common;

using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

/// <summary>Installs a matching bgutil script and yt-dlp plugin for native backends.</summary>
internal sealed class ManagedBgutil(IHttpClientFactory clients)
{
    internal const string Repository = "Brainicism/bgutil-ytdlp-pot-provider";
    private const string Package = "bgutil-ytdlp-pot-provider";
    private static readonly SemaphoreSlim UpdateLock = new(1, 1);

    internal static bool IsBundled => !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("RESONANCE_BGUTIL_ROOT"));

    internal static bool CanUpdate => !IsBundled && !OperatingSystem.IsWindows() &&
        Node != null && ManagedToolInstaller.FindExecutable("npm") != null && ManagedToolInstaller.FindExecutable("git") != null;

    private static string Root => Path.GetFullPath(Path.Combine(Program.DataDirectory, "bin", "bgutil"));
    private static string? Node => ManagedToolInstaller.FindExecutable("node");

    internal static string? ActiveDirectory()
    {
        if (Program.DataDirectory == null || IsBundled)
        {
            return null;
        }

        var pointer = Path.Combine(Root, "active");
        if (!File.Exists(pointer) || !Guid.TryParseExact(File.ReadAllText(pointer), "N", out var id))
        {
            return null;
        }

        return Path.Combine(Root, id.ToString("N"));
    }

    internal static string? InstalledVersion(string? directory) =>
        directory == null ? null : File.ReadAllText(Path.Combine(directory, Package + "-release.txt"));

    internal static string[]? Arguments()
    {
        var directory = ActiveDirectory();
        var node = Node;
        return directory == null || node == null ? null :
            ["--plugin-dirs", Path.Combine(directory, "yt-dlp-plugins"), "--js-runtimes", $"node:{node}",
             "--extractor-args", $"youtubepot-bgutilscript:server_home={Path.Combine(directory, "source", "server")}"];
    }

    internal async Task<string> UpdateAsync(CancellationToken token)
    {
        await UpdateLock.WaitAsync(token);
        try
        {
            var node = Node;
            var npm = ManagedToolInstaller.FindExecutable("npm");
            var git = ManagedToolInstaller.FindExecutable("git");
            if (!CanUpdate || node == null || npm == null || git == null)
            {
                throw new InvalidOperationException("Native bgutil updates require Node.js 22 or newer, npm and git.");
            }

            var nodeVersion = await RunAsync(node, Program.DataDirectory, token, "--version");
            if (!Version.TryParse(nodeVersion.Trim().TrimStart('v'), out var runtime) || runtime.Major < 22)
            {
                throw new InvalidOperationException("Native bgutil updates require Node.js 22 or newer.");
            }

            var id = Guid.NewGuid().ToString("N");
            var directory = Path.Combine(Root, id);
            var plugins = Path.Combine(directory, "yt-dlp-plugins");
            var source = Path.Combine(directory, "source");
            var server = Path.Combine(source, "server");
            var pointer = Path.Combine(Root, id + ".tmp");
            var activated = false;
            try
            {
                var tag = await new ManagedToolInstaller(clients).InstallAsync(Repository, plugins,
                    [new(Package + ".zip", Package + ".zip")], token);
                if (!Version.TryParse(tag.TrimStart('v'), out var release))
                {
                    throw new InvalidOperationException("Unexpected bgutil release version.");
                }

                var current = InstalledVersion(ActiveDirectory());
                if (Version.TryParse(current?.TrimStart('v'), out var installed) && installed >= release)
                {
                    return current!;
                }

                await RunAsync(git, directory, token, "clone", "--depth", "1", "--branch", tag, "--", $"https://github.com/{Repository}.git", source);
                using var package = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(server, "package.json"), token));
                if (package.RootElement.GetProperty("version").GetString() != release.ToString())
                {
                    throw new InvalidOperationException("The bgutil script and plugin releases do not match.");
                }

                // Patch audited dependencies within upstream's declared ranges before running install scripts.
                await RunAsync(npm, server, token, "audit", "fix", "--package-lock-only", "--ignore-scripts", "--omit=dev", "--audit-level=high", "--no-fund");
                await RunAsync(npm, server, token, "ci", "--no-audit", "--no-fund");
                await RunAsync(node, server, token, "node_modules/typescript/bin/tsc");
                var actual = await RunAsync(node, server, token, "build/generate_once.js", "--version");
                if (actual.Trim() != release.ToString())
                {
                    throw new InvalidOperationException("The new bgutil script did not report the expected version.");
                }

                File.Move(Path.Combine(plugins, Package + "-release.txt"), Path.Combine(directory, Package + "-release.txt"));

                // Keep previous releases for yt-dlp invocations that still reference them.
                await File.WriteAllTextAsync(pointer, id, token);
                token.ThrowIfCancellationRequested();
                File.Move(pointer, Path.Combine(Root, "active"), overwrite: true);
                activated = true;
                return tag;
            }
            finally
            {
                File.Delete(pointer);
                if (!activated && Directory.Exists(directory))
                {
                    Directory.Delete(directory, recursive: true);
                }
            }
        }
        finally
        {
            UpdateLock.Release();
        }
    }

    private static async Task<string> RunAsync(string executable, string directory, CancellationToken token, params string[] arguments)
    {
        var info = new ProcessStartInfo(executable)
        {
            WorkingDirectory = directory,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        foreach (var argument in arguments)
        {
            info.ArgumentList.Add(argument);
        }

        info.Environment["GIT_TERMINAL_PROMPT"] = "0";
        using var process = Process.Start(info) ?? throw new InvalidOperationException("Could not start the bgutil installer.");
        try
        {
            var stdout = process.StandardOutput.ReadToEndAsync(token);
            var stderr = process.StandardError.ReadToEndAsync(token);
            await process.WaitForExitAsync(token);
            await stderr;
            if (process.ExitCode != 0)
            {
                throw new InvalidOperationException($"The bgutil install step {Path.GetFileName(executable)} failed (exit {process.ExitCode}).");
            }

            return await stdout;
        }
        finally
        {
            if (!process.HasExited)
            {
                process.Kill(entireProcessTree: true);
                await process.WaitForExitAsync(CancellationToken.None);
            }
        }
    }
}
