// <copyright file="UsbExportService.Merge.cs" company="John Narey">
// Copyright (c) 2026 John Narey.
// SPDX-License-Identifier: AGPL-3.0-only
// </copyright>
namespace resonance.Analysis.UsbExport;

using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

/// <summary>Merges new USB sets into copies of existing player databases.</summary>
public sealed partial class UsbExportService
{
    private const long MaxPlayerDatabaseBytes = 128L << 20;

    // Receives only the two small player databases. Audio never travels back to
    // Resonance or into Bridge's Mac cache during a USB add operation.
    public async Task<string> MergePlayerDatabases(string id, Stream classic, long classicBytes, Stream oneLibrary, long oneBytes, CancellationToken cancellationToken)
    {
        var manifest = TransferManifest(id);
        using var document = JsonDocument.Parse(await File.ReadAllTextAsync(manifest, cancellationToken));
        var metadata = document.RootElement;
        if (metadata.GetProperty("profile").GetString() != "dual" || !metadata.TryGetProperty("jobId", out var jobId) || jobId.GetString() != id)
        {
            throw new InvalidOperationException("Prepare a new dual-library export before adding to an existing USB library.");
        }

        if (classicBytes is < 1024 or > MaxPlayerDatabaseBytes || oneBytes is < 1024 or > MaxPlayerDatabaseBytes)
        {
            throw new ArgumentException("Player database size is outside the supported range.");
        }

        var script = Path.Combine(Path.GetDirectoryName(worker), "merge_existing.py");
        if (!File.Exists(script))
        {
            throw new InvalidOperationException("USB library merge worker is unavailable.");
        }

        var work = Path.Combine(Path.GetDirectoryName(Path.GetDirectoryName(manifest)), "merge-" + Guid.NewGuid().ToString("N"));
        var inputs = Path.Combine(work, "input");
        var merged = Path.Combine(work, "merged");
        Directory.CreateDirectory(inputs);
        try
        {
            await CopyDatabase(classic, classicBytes, Path.Combine(inputs, "export.pdb"), cancellationToken);
            await CopyDatabase(oneLibrary, oneBytes, Path.Combine(inputs, "exportLibrary.db"), cancellationToken);
            var start = new ProcessStartInfo(python) { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true };
            foreach (var argument in new[] { script, "--existing", inputs, "--prepared", Path.Combine(Path.GetDirectoryName(manifest), "PIONEER", "rekordbox"), "--destination", merged, "--playlist-name", metadata.GetProperty("playlistName").GetString() })
            {
                start.ArgumentList.Add(argument);
            }

            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromMinutes(5));
            using var process = Process.Start(start) ?? throw new IOException("Could not start USB library merge worker.");
            using var registration = timeout.Token.Register(() =>
            {
                try
                {
                    if (!process.HasExited)
                    {
                        process.Kill(true);
                    }
                }
                catch (InvalidOperationException)
                {
                }
            });
            var stdout = process.StandardOutput.ReadToEndAsync(timeout.Token);
            var stderr = process.StandardError.ReadToEndAsync(timeout.Token);
            await process.WaitForExitAsync(timeout.Token);
            await stdout;
            var diagnostics = await stderr;
            if (process.ExitCode != 0)
            {
                throw new InvalidOperationException("Existing USB library could not be safely merged: " + diagnostics[..Math.Min(diagnostics.Length, 500)]);
            }

            var archive = Path.Combine(work, "databases.zip");
            using (var zip = ZipFile.Open(archive, ZipArchiveMode.Create))
            {
                zip.CreateEntryFromFile(Path.Combine(merged, "export.pdb"), "export.pdb", CompressionLevel.Fastest);
                zip.CreateEntryFromFile(Path.Combine(merged, "exportLibrary.db"), "exportLibrary.db", CompressionLevel.Fastest);
            }

            return archive;
        }
        catch
        {
            if (Directory.Exists(work))
            {
                Directory.Delete(work, true);
            }

            throw;
        }
    }

    private static async Task CopyDatabase(Stream source, long expectedBytes, string destination, CancellationToken cancellationToken)
    {
        await using var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        await source.CopyToAsync(output, cancellationToken);
        await output.FlushAsync(cancellationToken);
        if (output.Length != expectedBytes || output.Length > MaxPlayerDatabaseBytes)
        {
            throw new ArgumentException("Player database upload was incomplete or oversized.");
        }
    }
}
