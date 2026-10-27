namespace Resonance.Tests.Database;

using Dapper;
using Microsoft.Data.Sqlite;
using global::resonance.Shares;

public class SqliteShareCountTests
{
    [Fact]
    public void PrefixCountsEscapeWildcardCharactersAndUseIndexes()
    {
        var directory = Path.Combine(Path.GetTempPath(), "resonance-counts-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var cs = "Data Source=" + Path.Combine(directory, "shares.db") + ";Pooling=False";
        using var repo = new SqliteShareRepository(cs);
        repo.Create();
        using var c = new SqliteConnection(cs);
        foreach (var path in new[] { "Music_100%\\one", "Music_100%\\two", "MusicX100Y\\other" })
        {
            c.Execute("INSERT INTO directories(name,timestamp) VALUES(@path,1)", new { path });
            c.Execute("INSERT INTO files(maskedFilename,originalFilename,size,touchedAt,attributeJson,timestamp) VALUES(@path,@path,1,'2026-01-01','[]',1)", new { path });
        }
        Assert.Equal(2, repo.CountDirectories("music_100%\\"));
        Assert.Equal(2, repo.CountFiles("music_100%\\"));
        Assert.Equal(3, repo.CountFiles());
        var plan = c.Query("EXPLAIN QUERY PLAN " + SqliteShareRepository.CountFilesPrefixSql, new { prefix = "Music%" });
        Assert.Contains(plan, row => ((string)row.detail).Contains("SEARCH", StringComparison.OrdinalIgnoreCase));
    }
}
