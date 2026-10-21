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
                });
            Assert.Equal(new[] { "absolute" }, repository.FindMaskedFilenames(new[] { "scanned.mp3" }));
            Assert.Equal(new[] { "relative" }, repository.FindMaskedFilenames(new[] { Path.Combine(directory, "migrated.mp3") }));
        }
        finally
        {
            MusicPath.Configure(previousRoot);
        }
    }
}
