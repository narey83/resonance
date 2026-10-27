namespace Resonance.Tests.Common;

using Microsoft.Data.Sqlite;
using global::resonance.Common;
using global::resonance.MusicLibrary;

[Collection("Music path configuration")]
public class ArtworkStoreTests
{
    [Fact]
    public void Migrates_Legacy_Cache_And_Invalidates_Equal_Size_Source_Replacements()
    {
        var previous = MusicPath.Root;
        var root = Path.Combine(Path.GetTempPath(), "resonance-artwork-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            MusicPath.Configure(root);
            var connection = $"Data Source={Path.Combine(root, "cache.db")};Pooling=False";
            using (var db = new SqliteConnection(connection))
            {
                db.Open();
                using var cmd = db.CreateCommand();
                cmd.CommandText = "CREATE TABLE artwork_cache (masked_filename TEXT NOT NULL, size INTEGER NOT NULL, file_size INTEGER NOT NULL, mime TEXT NOT NULL, bytes BLOB NOT NULL, cached_at INTEGER NOT NULL, PRIMARY KEY(masked_filename,size))";
                cmd.ExecuteNonQuery();
            }
            var cache = new ArtworkStore(connection, false);
            var path = Path.Combine(root, "track.mp3");
            cache.Set(path, 192, 1000, [1, 2, 3], "image/jpeg", 100);
            Assert.Equal(new byte[] { 1, 2, 3 }, cache.Get(path, 192, 1000, 100)?.Bytes);
            Assert.Null(cache.Get(path, 192, 1000, 101));
            cache.Set(path, 192, 1000, [4], "image/jpeg", 101);
            var reopened = new ArtworkStore(connection, false);
            Assert.Equal(new byte[] { 4 }, reopened.Get(path, 192, 1000, 101)?.Bytes);
            Assert.Null(reopened.Get(path, 192, 999, 101));
        }
        finally
        {
            MusicPath.Configure(previous);
            Directory.Delete(root, true);
        }
    }
}
