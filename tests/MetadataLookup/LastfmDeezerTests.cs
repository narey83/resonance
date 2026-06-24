namespace Resonance.Tests.MetadataLookup;

using global::resonance.MetadataLookup;

public class LastfmDeezerTests
{
    [Fact]
    public void Lastfm_ParseTrackInfo_Extracts_Genre_Album_And_Track_Number()
    {
        const string json = """
        {
          "track": {
            "name": "The Bells",
            "artist": { "name": "Jeff Mills" },
            "album": { "title": "Live At The Liquid Room", "@attr": { "position": "3" } },
            "toptags": { "tag": [ { "name": "seen live" }, { "name": "techno" }, { "name": "detroit techno" } ] }
          }
        }
        """;

        var match = LastfmClient.ParseTrackInfo(json, "Jeff Mills", "The Bells");

        Assert.NotNull(match);
        Assert.Equal("The Bells", match!.Title); // query title preserved
        Assert.Equal("Jeff Mills", match.Artist);
        Assert.Equal("Live At The Liquid Room", match.Album);
        Assert.Equal(3u, match.TrackNumber);
        Assert.Equal("Techno", match.Genre); // "seen live" skipped as a non-genre tag
        Assert.Equal(0u, match.Year); // Last.fm has no year
        Assert.Equal("Last.fm", match.Source);
    }

    [Fact]
    public void Lastfm_ParseTrackInfo_Returns_Null_When_Track_Not_Found()
    {
        const string json = """{ "error": 6, "message": "Track not found" }""";

        Assert.Null(LastfmClient.ParseTrackInfo(json, "Whoever", "Whatever"));
    }

    [Fact]
    public void Deezer_ParseAlbumGenre_Reads_First_Genre()
    {
        const string json = """
        { "title": "Some Album", "release_date": "1997-05-04", "genres": { "data": [ { "name": "Techno", "id": 132 } ] } }
        """;

        Assert.Equal("Techno", DeezerClient.ParseAlbumGenre(json));
    }

    [Fact]
    public void Deezer_ParseAlbumGenre_Returns_Null_When_No_Genres()
    {
        Assert.Null(DeezerClient.ParseAlbumGenre("""{ "genres": { "data": [] } }"""));
    }
}
