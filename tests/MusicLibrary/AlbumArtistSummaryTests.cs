namespace Resonance.Tests.MusicLibrary;

using global::resonance.MusicLibrary;
using Microsoft.Data.Sqlite;

public class AlbumArtistSummaryTests
{
    [Theory]
    [InlineData("Alice", "Bob", "Album curator", "Various Artists")]
    [InlineData("Alice", "Bob", null, "Various Artists")]
    [InlineData("Alice", " alice ", null, "Alice")]
    [InlineData("Alice", "", null, "Alice")]
    [InlineData("Alice", "Alice", "Album artist", "Album artist")]
    [InlineData("Alice", "Alice", "Various Artists", "Various Artists")]
    public void AlbumListsSummarizeContributors(string first, string second, string? albumArtist, string expected)
    {
        var connectionString = $"Data Source=album-summary-{Guid.NewGuid():N};Mode=Memory;Cache=Shared";
        using var connection = new SqliteConnection(connectionString);
        connection.Open();
        var repository = new MusicRepository(connectionString);
        repository.Initialize();
        foreach (var (artist, index) in new[] { (first, 1), (second, 2) })
        {
            using var command = connection.CreateCommand();
            command.CommandText = "INSERT INTO tracks (path,filename,directory,extension,file_size,file_modified,indexed_at,album,artist,album_artist) VALUES (@path,@path,'album','.mp3',1,1,1,'Release',@artist,@albumArtist)";
            command.Parameters.AddWithValue("@path", $"album/{index}.mp3");
            command.Parameters.AddWithValue("@artist", artist);
            command.Parameters.AddWithValue("@albumArtist", (object?)albumArtist ?? DBNull.Value);
            command.ExecuteNonQuery();
        }

        Assert.Equal(expected, Assert.Single(repository.GetAlbums()).Artist);
        Assert.Equal(expected, Assert.Single(repository.GetRecentlyAdded(10)).Artist);
        Assert.Equal(2, Assert.Single(repository.GetAlbums()).TrackCount);
    }
}
