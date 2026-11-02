// <copyright file="ManagedToolInstaller.cs" company="John Narey">
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
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

/// <summary>Downloads checksum-verified release assets into an app-owned directory.</summary>
internal sealed class ManagedToolInstaller(IHttpClientFactory clients)
{
    internal static async Task<bool> SeedAsync(string fileName, string directory, string versionArguments, CancellationToken token)
    {
        var bundled = Environment.GetEnvironmentVariable("RESONANCE_BUNDLED_TOOLS");
        if (string.IsNullOrWhiteSpace(bundled))
        {
            return false;
        }

        var source = Path.Combine(bundled, fileName);
        var manifestFile = Path.Combine(bundled, "manifest.json");
        if (!File.Exists(source) || !File.Exists(manifestFile))
        {
            return false;
        }

        using var manifest = JsonDocument.Parse(await File.ReadAllTextAsync(manifestFile, token));
        if (!manifest.RootElement.TryGetProperty(fileName, out var entry))
        {
            return false;
        }

        await using (var input = File.OpenRead(source))
        {
            var digest = Convert.ToHexString(await SHA256.HashDataAsync(input, token));
            if (!digest.Equals(entry.GetProperty("sha256").GetString(), StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException($"Bundled {fileName} failed SHA-256 verification.");
            }
        }

        Directory.CreateDirectory(directory);
        var temp = Path.Combine(directory, $".{fileName}-{Guid.NewGuid():N}.tmp");
        try
        {
            File.Copy(source, temp);
            if (!OperatingSystem.IsWindows())
            {
                File.SetUnixFileMode(temp, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute | UnixFileMode.GroupRead | UnixFileMode.GroupExecute | UnixFileMode.OtherRead | UnixFileMode.OtherExecute);
            }

            if (!await IsUsableAsync(temp, versionArguments, token))
            {
                throw new InvalidOperationException($"Bundled {fileName} cannot run on this platform.");
            }

            File.Move(temp, Path.Combine(directory, fileName), overwrite: true);
            var releaseName = fileName is "ffmpeg" or "ffprobe" ? "ffmpeg" : fileName;
            var releaseFile = Path.Combine(bundled, releaseName + "-release.txt");
            if (File.Exists(releaseFile))
            {
                File.Copy(releaseFile, Path.Combine(directory, releaseName + "-release.txt"), overwrite: true);
            }

            return true;
        }
        finally
        {
            File.Delete(temp);
        }
    }

    internal static string? FindExecutable(string configured)
    {
        if (Path.IsPathRooted(configured) || configured.Contains(Path.DirectorySeparatorChar) || configured.Contains(Path.AltDirectorySeparatorChar))
        {
            return File.Exists(configured) ? Path.GetFullPath(configured) : null;
        }

        var names = OperatingSystem.IsWindows() && !configured.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? new[] { configured + ".exe", configured } : new[] { configured };
        var dirs = (Environment.GetEnvironmentVariable("PATH") ?? string.Empty).Split(Path.PathSeparator).Concat(OperatingSystem.IsMacOS() ? new[] { "/opt/homebrew/bin", "/usr/local/bin" } : Array.Empty<string>());
        return dirs.Where(d => !string.IsNullOrWhiteSpace(d)).SelectMany(d => names.Select(n => Path.Combine(d, n))).FirstOrDefault(File.Exists);
    }

    internal static async Task<bool> IsUsableAsync(string executable, string arguments, CancellationToken token, TimeSpan? probeTimeout = null)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);

        // Standalone tools may unpack their runtime before answering --version.
        // A busy host can take over a minute even when the binary is compatible.
        var limit = probeTimeout ?? TimeSpan.FromMinutes(2);
        timeout.CancelAfter(limit);
        using var process = new Process { StartInfo = new ProcessStartInfo(executable, arguments) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true } };
        try
        {
            process.Start();
            var stdout = process.StandardOutput.ReadToEndAsync(timeout.Token);
            var stderr = process.StandardError.ReadToEndAsync(timeout.Token);
            await process.WaitForExitAsync(timeout.Token);
            await Task.WhenAll(stdout, stderr);
            return process.ExitCode == 0;
        }
        catch (OperationCanceledException exception) when (!token.IsCancellationRequested)
        {
            throw new TimeoutException($"The version check for '{executable}' did not finish within {limit.TotalSeconds:0.###} seconds. The tool may be starting slowly; platform compatibility has not been determined.", exception);
        }
        catch (System.ComponentModel.Win32Exception)
        {
            return false;
        }
        finally
        {
            try
            {
                if (!process.HasExited)
                {
                    process.Kill(entireProcessTree: true);
                    await process.WaitForExitAsync(CancellationToken.None);
                }
            }
            catch (InvalidOperationException)
            {
                // The process could not be started or has already exited.
            }
        }
    }

    internal async Task<string> InstallAsync(string repository, string directory, Asset[] requested, CancellationToken token)
    {
        if (repository is not ("yt-dlp/yt-dlp" or "denoland/deno" or ManagedBgutil.Repository))
        {
            throw new ArgumentException("Unsupported dependency repository.", nameof(repository));
        }

        Directory.CreateDirectory(directory);
        var staging = Path.Combine(directory, $".install-{Guid.NewGuid():N}");
        Directory.CreateDirectory(staging);
        try
        {
            using var http = clients.CreateClient();
            http.Timeout = TimeSpan.FromMinutes(10);
            http.DefaultRequestHeaders.UserAgent.ParseAdd("resonance");
            var release = await http.GetFromJsonAsync<JsonElement>($"https://api.github.com/repos/{repository}/releases/latest", token);
            var tag = release.GetProperty("tag_name").GetString() ?? throw new InvalidOperationException("Dependency release has no version.");
            foreach (var item in requested)
            {
                if (Path.GetFileName(item.FileName) != item.FileName || item.FileName is "." or "..")
                {
                    throw new InvalidOperationException("Invalid dependency output filename.");
                }

                var asset = release.GetProperty("assets").EnumerateArray().SingleOrDefault(a => a.GetProperty("name").GetString() == item.Name);
                if (asset.ValueKind == JsonValueKind.Undefined)
                {
                    throw new PlatformNotSupportedException($"The {repository} release does not include {item.Name} for this platform.");
                }

                var digest = asset.TryGetProperty("digest", out var value) ? value.GetString() : null;
                if (digest == null || !digest.StartsWith("sha256:", StringComparison.Ordinal) || digest.Length != 71)
                {
                    throw new InvalidOperationException($"No SHA-256 digest published for {item.Name}; the dependency was not installed.");
                }

                var url = asset.GetProperty("browser_download_url").GetString()!;
                if (!url.StartsWith($"https://github.com/{repository}/releases/download/", StringComparison.Ordinal))
                {
                    throw new InvalidOperationException("Unexpected dependency download source.");
                }

                var archivePath = Path.Combine(staging, "download");
                using (var response = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, token))
                {
                    response.EnsureSuccessStatusCode();
                    await using var output = File.Create(archivePath);
                    await response.Content.CopyToAsync(output, token);
                }

                await using (var input = File.OpenRead(archivePath))
                {
                    var actual = Convert.ToHexString(await SHA256.HashDataAsync(input, token));
                    if (!actual.Equals(digest[7..], StringComparison.OrdinalIgnoreCase))
                    {
                        throw new InvalidOperationException($"SHA-256 verification failed for {item.Name}.");
                    }
                }

                var target = Path.Combine(staging, item.FileName);
                if (item.ZipEntry == null)
                {
                    File.Move(archivePath, target);
                }
                else
                {
                    using var archive = ZipFile.OpenRead(archivePath);
                    var entry = archive.Entries.SingleOrDefault(e => e.FullName == item.ZipEntry)
                        ?? throw new InvalidOperationException($"Dependency archive is missing {item.ZipEntry}.");
                    await using var input = entry.Open();
                    await using var output = File.Create(target);
                    await input.CopyToAsync(output, token);
                }

                if (item.VersionArguments != null)
                {
                    if (!OperatingSystem.IsWindows())
                    {
                        File.SetUnixFileMode(target, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute | UnixFileMode.GroupRead | UnixFileMode.GroupExecute | UnixFileMode.OtherRead | UnixFileMode.OtherExecute);
                    }

                    if (!await IsUsableAsync(target, item.VersionArguments, token))
                    {
                        throw new InvalidOperationException($"Downloaded {item.Name} cannot run on this machine.");
                    }
                }

                File.Delete(archivePath);
            }

            // Every checksum and executable is verified before replacing any working copy.
            foreach (var item in requested)
            {
                File.Move(Path.Combine(staging, item.FileName), Path.Combine(directory, item.FileName), overwrite: true);
            }

            await File.WriteAllTextAsync(Path.Combine(directory, repository.Split('/')[1] + "-release.txt"), tag, token);
            return tag;
        }
        finally
        {
            Directory.Delete(staging, recursive: true);
        }
    }

    internal async Task<string?> LatestVersionAsync(string repository, CancellationToken token)
    {
        using var client = clients.CreateClient();
        client.DefaultRequestHeaders.UserAgent.ParseAdd("resonance");
        var release = await client.GetFromJsonAsync<JsonElement>($"https://api.github.com/repos/{repository}/releases/latest", token);
        return release.GetProperty("tag_name").GetString();
    }

    internal sealed record Asset(string Name, string FileName, string? ZipEntry = null, string? VersionArguments = null);
}
