// <copyright file="UsbExportService.Edit.cs" company="John Narey">
// Copyright (c) 2026 John Narey.
// SPDX-License-Identifier: AGPL-3.0-only
// </copyright>
namespace resonance.Analysis.UsbExport;

using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Threading;
using System.Threading.Tasks;

/// <summary>Edits copies of both USB player databases for a paired Bridge.</summary>
public sealed partial class UsbExportService
{
    /// <summary>Returns a ZIP containing edited databases and the files to remove.</summary>
    /// <returns>The path to a temporary ZIP archive containing both edited databases and the deletion plan.</returns>
    public async Task<string> EditPlayerDatabases(Stream classic, long classicBytes, Stream oneLibrary, long oneBytes, string kind, uint targetId, CancellationToken cancellationToken)
    {
        if (kind is not ("track" or "playlist") || targetId == 0)
        {
            throw new ArgumentException("Select a track or playlist to delete.");
        }

        if (classicBytes is < 1024 or > MaxPlayerDatabaseBytes || oneBytes is < 1024 or > MaxPlayerDatabaseBytes)
        {
            throw new ArgumentException("Player database size is outside the supported range.");
        }

        if (!Enabled)
        {
            throw new InvalidOperationException("USB library editing is unavailable on this server.");
        }

        var script = Path.Combine(Path.GetDirectoryName(worker), "edit_existing.py");
        if (!File.Exists(script))
        {
            throw new InvalidOperationException("USB library editing is unavailable on this server.");
        }

        var work = Path.Combine(root, "bridge-edit-" + Guid.NewGuid().ToString("N"));
        var input = Path.Combine(work, "input");
        var output = Path.Combine(work, "output");
        Directory.CreateDirectory(input);
        try
        {
            await CopyDatabase(classic, classicBytes, Path.Combine(input, "export.pdb"), cancellationToken);
            await CopyDatabase(oneLibrary, oneBytes, Path.Combine(input, "exportLibrary.db"), cancellationToken);
            var start = new ProcessStartInfo(python) { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true };
            foreach (var argument in new[] { script, "--existing", input, "--destination", output, "--kind", kind, "--target-id", targetId.ToString(System.Globalization.CultureInfo.InvariantCulture) })
            {
                start.ArgumentList.Add(argument);
            }

            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromMinutes(5));
            using var process = Process.Start(start) ?? throw new IOException("Could not start USB library edit worker.");
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
                throw new InvalidOperationException("USB library edit was refused: " + diagnostics[..Math.Min(diagnostics.Length, 500)]);
            }

            var archive = Path.Combine(work, "edited-databases.zip");
            using (var zip = ZipFile.Open(archive, ZipArchiveMode.Create))
            {
                foreach (var name in new[] { "export.pdb", "exportLibrary.db", "plan.json" })
                {
                    zip.CreateEntryFromFile(Path.Combine(output, name), name, CompressionLevel.Fastest);
                }
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
}
