// <copyright file="FfmpegService.cs" company="John Narey">
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

namespace resonance.Common.Ffmpeg;

using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Json;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Options;
using Serilog;

public sealed class FfmpegService : IFfmpegService, IDisposable
{
    private static readonly ILogger Log = Serilog.Log.ForContext("SourceContext", resonance.Logs.Music.Ffmpeg);
    private static readonly bool IsWindows = RuntimeInformation.IsOSPlatform(OSPlatform.Windows);

    private readonly IOptionsMonitor<resonance.Options> options;
    private readonly IHttpClientFactory httpClientFactory;
    private readonly SemaphoreSlim gate = new(1, 1);
    private readonly CancellationTokenSource cts = new();

    // The canonical self-managed location. Updates always (re)install here.
    private readonly string managedDir;

    private string? ffmpegPath;
    private string? ffprobePath;
    private int disposed;

    public FfmpegService(IOptionsMonitor<resonance.Options> options, IHttpClientFactory httpClientFactory)
    {
        this.options = options;
        this.httpClientFactory = httpClientFactory;
        managedDir = Path.Combine(resonance.Program.DataDirectory, "bin");
    }

    public string? FfmpegPath => ffmpegPath;

    public string? FfprobePath => ffprobePath;

    private static string FfmpegExe => IsWindows ? "ffmpeg.exe" : "ffmpeg";

    private static string FfprobeExe => IsWindows ? "ffprobe.exe" : "ffprobe";

    private string ReleaseTagFile => Path.Combine(managedDir, "ffmpeg-release.txt");

    // ── IHostedService ──────────────────────────────────────────────────────
    public Task StartAsync(CancellationToken cancellationToken)
    {
        // Resolve/provision in the background and then keep it updated; never block app startup.
        _ = Task.Run(() => EnsureThenAutoUpdateLoopAsync(cts.Token), CancellationToken.None);
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        cts.Cancel();
        return Task.CompletedTask;
    }

    // ── Public API ──────────────────────────────────────────────────────────
    public async Task<string> GetFfmpegPathAsync(CancellationToken cancellationToken = default)
    {
        await EnsureAsync(cancellationToken);
        return ffmpegPath ?? FfmpegExe;
    }

    public async Task<string> GetFfprobePathAsync(CancellationToken cancellationToken = default)
    {
        await EnsureAsync(cancellationToken);
        return ffprobePath ?? FfprobeExe;
    }

    public async Task<string?> GetVersionAsync(CancellationToken cancellationToken = default)
    {
        var exe = await GetFfmpegPathAsync(cancellationToken);
        return await RunVersionAsync(exe, "-version", cancellationToken);
    }

    public async Task<(string? Current, string? Latest, bool UpdateAvailable)> CheckForUpdateAsync(CancellationToken cancellationToken = default)
    {
        var current = File.Exists(ReleaseTagFile) ? (await File.ReadAllTextAsync(ReleaseTagFile, cancellationToken)).Trim() : null;

        try
        {
            using var http = httpClientFactory.CreateClient();
            http.DefaultRequestHeaders.Add("User-Agent", "resonance");
            var release = await http.GetFromJsonAsync<JsonElement>(
                "https://api.github.com/repos/yt-dlp/FFmpeg-Builds/releases/latest", cancellationToken);

            // yt-dlp/FFmpeg-Builds uses a rolling "latest" tag — published_at is the version identifier.
            var latest = release.GetProperty("published_at").GetString()?.Trim();
            var updateAvailable = !string.IsNullOrEmpty(current) && !string.IsNullOrEmpty(latest) && current != latest;
            return (current, latest, updateAvailable);
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "Ffmpeg: failed to check for updates from GitHub");
            return (current, null, false);
        }
    }

    public async Task<string> UpdateAsync(CancellationToken cancellationToken = default)
    {
        Directory.CreateDirectory(managedDir);

        var (tag, archiveUrl) = await FetchLatestReleaseAsync(cancellationToken);
        if (tag == null)
        {
            throw new InvalidOperationException("Could not determine the latest ffmpeg release.");
        }

        Log.Information("Ffmpeg: updating to {Tag}", tag);
        await DownloadAndExtractAsync(managedDir, archiveUrl, cancellationToken);

        var ffmpegBin = Path.Combine(managedDir, FfmpegExe);
        var ffprobeBin = Path.Combine(managedDir, FfprobeExe);
        if (!File.Exists(ffmpegBin) || !File.Exists(ffprobeBin))
        {
            throw new InvalidOperationException("ffmpeg update failed: binaries not found after extraction.");
        }

        MakeExecutable(ffmpegBin, ffprobeBin);
        await File.WriteAllTextAsync(ReleaseTagFile, tag, cancellationToken);

        ffmpegPath = ffmpegBin;
        ffprobePath = ffprobeBin;
        Log.Information("Ffmpeg: updated to {Tag} at {Dir}", tag, managedDir);
        return tag;
    }

    public void Dispose()
    {
        // registered as both IFfmpegService and (via the same instance) IHostedService, so the DI
        // container tracks it as a disposable under two descriptors and disposes it twice on shutdown
        if (Interlocked.Exchange(ref disposed, 1) != 0)
        {
            return;
        }

        cts.Cancel();
        cts.Dispose();
        gate.Dispose();
    }

    private static string? ResolveConfigured(string configuredPath)
    {
        if (Path.IsPathRooted(configuredPath) && File.Exists(configuredPath))
        {
            return configuredPath;
        }

        var adjacent = Path.Combine(AppContext.BaseDirectory, configuredPath);
        return File.Exists(adjacent) ? adjacent : null;
    }

    private static async Task<string?> ResolveFromPathAsync(CancellationToken cancellationToken)
    {
        var whichCmd = IsWindows ? "where" : "which";
        try
        {
            using var p = new Process
            {
                StartInfo = new ProcessStartInfo(whichCmd, "ffmpeg ffprobe")
                {
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                },
            };
            p.Start();
            var firstLine = (await p.StandardOutput.ReadLineAsync(cancellationToken))?.Trim();
            await p.WaitForExitAsync(cancellationToken);
            if (p.ExitCode == 0 && !string.IsNullOrWhiteSpace(firstLine))
            {
                return Path.GetDirectoryName(firstLine);
            }
        }
        catch
        {
            // fall through to download
        }

        return null;
    }

    private static void MakeExecutable(string ffmpegBin, string ffprobeBin)
    {
        if (IsWindows)
        {
            return;
        }

        var mode = UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute
            | UnixFileMode.GroupRead | UnixFileMode.GroupExecute
            | UnixFileMode.OtherRead | UnixFileMode.OtherExecute;
        File.SetUnixFileMode(ffmpegBin, mode);
        File.SetUnixFileMode(ffprobeBin, mode);
    }

    private static async Task<string?> RunVersionAsync(string executable, string args, CancellationToken cancellationToken)
    {
        try
        {
            using var process = new Process
            {
                StartInfo = new ProcessStartInfo(executable)
                {
                    Arguments = args,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                },
            };
            process.Start();
            var output = await process.StandardOutput.ReadToEndAsync(cancellationToken);
            await process.WaitForExitAsync(cancellationToken);
            return output.Split('\n').FirstOrDefault()?.Trim();
        }
        catch (Exception ex)
        {
            return $"Error: {ex.Message}";
        }
    }

    // ── Resolution / provisioning ─────────────────────────────────────────────
    private async Task EnsureThenAutoUpdateLoopAsync(CancellationToken cancellationToken)
    {
        try
        {
            await EnsureAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "Ffmpeg: initial provisioning failed: {Message}", ex.Message);
        }

        while (!cancellationToken.IsCancellationRequested)
        {
            var opts = options.CurrentValue.Ffmpeg;
            try
            {
                await Task.Delay(TimeSpan.FromDays(Math.Max(1, opts.UpdateIntervalDays)), cancellationToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }

            // Only auto-update the self-managed copy; never touch a system/PATH or explicitly-configured binary.
            if (!options.CurrentValue.Ffmpeg.AutoUpdate || !IsUsingManagedCopy())
            {
                continue;
            }

            try
            {
                var (_, _, updateAvailable) = await CheckForUpdateAsync(cancellationToken);
                if (updateAvailable)
                {
                    await UpdateAsync(cancellationToken);
                }
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (Exception ex)
            {
                Log.Warning(ex, "Ffmpeg: background update check failed: {Message}", ex.Message);
            }
        }
    }

    private bool IsUsingManagedCopy()
        => ffmpegPath != null
            && string.Equals(Path.GetDirectoryName(ffmpegPath), managedDir, StringComparison.OrdinalIgnoreCase);

    private async Task EnsureAsync(CancellationToken cancellationToken)
    {
        if (ffmpegPath != null && ffprobePath != null && File.Exists(ffmpegPath) && File.Exists(ffprobePath))
        {
            return;
        }

        await gate.WaitAsync(cancellationToken);
        try
        {
            if (ffmpegPath != null && ffprobePath != null && File.Exists(ffmpegPath) && File.Exists(ffprobePath))
            {
                return;
            }

            // 1) explicit configured path wins (ffprobe resolved alongside it)
            var configured = options.CurrentValue.Ffmpeg.Path;
            if (!string.IsNullOrWhiteSpace(configured))
            {
                var resolved = ResolveConfigured(configured);
                if (resolved != null && TryDir(Path.GetDirectoryName(resolved)!))
                {
                    Log.Information("Ffmpeg: using configured binary at {Path}", ffmpegPath);
                    return;
                }

                Log.Warning("Ffmpeg: configured path {Path} not usable (need ffmpeg+ffprobe) — falling back", configured);
            }

            // 2) self-managed dir, then 3) the legacy yt-dlp tools dir (reuse an existing download)
            var candidateDirs = new[]
            {
                managedDir,
                Path.Combine(resonance.Program.AppDirectory, "tools"),
            };

            foreach (var dir in candidateDirs)
            {
                if (TryDir(dir))
                {
                    Log.Information("Ffmpeg: found ffmpeg+ffprobe at {Dir}", dir);
                    return;
                }
            }

            // 4) system PATH (both required)
            var pathDir = await ResolveFromPathAsync(cancellationToken);
            if (pathDir != null && TryDir(pathDir))
            {
                Log.Information("Ffmpeg: using ffmpeg+ffprobe from PATH at {Dir}", pathDir);
                return;
            }

            // 5) download a static build into the managed dir
            Log.Information("Ffmpeg: not found — downloading a static build to {Dir}", managedDir);
            await UpdateAsync(cancellationToken);
        }
        finally
        {
            gate.Release();
        }
    }

    // Sets the cached paths if both binaries exist in dir; returns whether it succeeded.
    private bool TryDir(string dir)
    {
        var ff = Path.Combine(dir, FfmpegExe);
        var fp = Path.Combine(dir, FfprobeExe);
        if (File.Exists(ff) && File.Exists(fp))
        {
            ffmpegPath = ff;
            ffprobePath = fp;
            return true;
        }

        return false;
    }

    // ── Download / extract ────────────────────────────────────────────────────
    private async Task<(string? PublishedAt, string ArchiveUrl)> FetchLatestReleaseAsync(CancellationToken cancellationToken)
    {
        string archiveName;
        if (IsWindows)
        {
            archiveName = "ffmpeg-master-latest-win64-gpl.zip";
        }
        else if (RuntimeInformation.ProcessArchitecture == Architecture.Arm64)
        {
            archiveName = "ffmpeg-master-latest-linuxarm64-gpl.tar.xz";
        }
        else
        {
            archiveName = "ffmpeg-master-latest-linux64-gpl.tar.xz";
        }

        var downloadUrl = $"https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download/{archiveName}";
        try
        {
            using var http = httpClientFactory.CreateClient();
            http.DefaultRequestHeaders.Add("User-Agent", "resonance");
            var release = await http.GetFromJsonAsync<JsonElement>(
                "https://api.github.com/repos/yt-dlp/FFmpeg-Builds/releases/latest", cancellationToken);
            var publishedAt = release.GetProperty("published_at").GetString()?.Trim();
            return (publishedAt, downloadUrl);
        }
        catch
        {
            return (null, downloadUrl);
        }
    }

    private async Task DownloadAndExtractAsync(string toolsDir, string archiveUrl, CancellationToken cancellationToken)
    {
        var isZip = archiveUrl.EndsWith(".zip", StringComparison.OrdinalIgnoreCase);
        var archivePath = Path.Combine(toolsDir, isZip ? "ffmpeg-download.zip" : "ffmpeg-download.tar.xz");
        try
        {
            using var client = httpClientFactory.CreateClient();
            client.Timeout = TimeSpan.FromMinutes(10);
            using var response = await client.GetAsync(archiveUrl, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            response.EnsureSuccessStatusCode();

            await using (var fs = File.Create(archivePath))
            {
                await response.Content.CopyToAsync(fs, cancellationToken);
            }

            // Extract just the two binaries, flattening the archive's */bin/ prefix.
            using var tar = new Process
            {
                StartInfo = new ProcessStartInfo("tar",
                    $"-xf \"{archivePath}\" -C \"{toolsDir}\" --strip-components=2 --wildcards \"*/bin/ffmpeg*\" \"*/bin/ffprobe*\"")
                {
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardError = true,
                },
            };
            tar.Start();
            await tar.WaitForExitAsync(cancellationToken);
        }
        finally
        {
            try
            {
                File.Delete(archivePath);
            }
            catch
            {
                // best-effort cleanup
            }
        }
    }
}
