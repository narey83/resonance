namespace Resonance.Tests.Database;

using Dapper;
using Microsoft.Data.Sqlite;
using global::resonance.Common;
using global::resonance.Shares;

[Collection("Music path configuration")]
public class SqliteSharePathTests
{
    [Fact]
    public void RelativeLookupFindsAbsoluteScannedPathAndRelativeMigratedPath()
    {
        var directory = Path.Combine(Path.GetTempPath(), "resonance-share-path-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var previousRoot = MusicPath.Root;
        try
        {
            MusicPath.Configure(directory);
            var connectionString = "Data Source=" + Path.Combine(directory, "shares.db");
            using var repository = new SqliteShareRepository(connectionString);
            repository.Create();
            using var connection = new SqliteConnection(connectionString);
            connection.Execute("INSERT INTO files(maskedFilename,originalFilename,size,touchedAt,attributeJson,timestamp) VALUES(@masked,@original,1,@date,'[]',1)",
                new[] {
                    new { masked = "absolute", original = Path.Combine(directory, "scanned.mp3"), date = DateTime.UtcNow.ToString("O") },
                    new { masked = "relative", original = "migrated.mp3", date = DateTime.UtcNow.ToString("O") },
                    new { masked = @"share\album\song.mp3", original = Path.Combine(directory, "album", "song.mp3"), date = DateTime.UtcNow.ToString("O") },
                    new { masked = @"share\Album\Song.mp3", original = Path.Combine(directory, "Album", "Song.mp3"), date = DateTime.UtcNow.ToString("O") },
                });
            Assert.Equal(new[] { "absolute" }, repository.FindMaskedFilenames(new[] { "scanned.mp3" }));
            Assert.Equal(Path.Combine(directory, "scanned.mp3"), Assert.Single(repository.FindFiles(new[] { "absolute" })).OriginalFilename);
            Assert.Equal(new[] { "relative" }, repository.FindMaskedFilenames(new[] { Path.Combine(directory, "migrated.mp3") }));
            Assert.Equal(new[] { @"share\Album\Song.mp3" }, repository.FindMaskedFilenames(new[] { "Album/Song.mp3" }).Distinct(StringComparer.OrdinalIgnoreCase));
        }
        finally
        {
            MusicPath.Configure(previousRoot);
        }
    }
}
