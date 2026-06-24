namespace Resonance.Tests.MetadataLookup;

using global::resonance.MetadataLookup;

public class MusicBrainzClientTests
{
    [Fact]
    public void ParseSearchResponse_Projects_Fields_And_Orders_By_Score()
    {
        const string json = """
        {
          "recordings": [
            {
              "id": "rec-low",
              "score": 70,
              "title": "Blue Monday (Remix)",
              "artist-credit": [ { "name": "New Order" } ],
              "releases": []
            },
            {
              "id": "rec-high",
              "score": 100,
              "title": "Blue Monday",
              "artist-credit": [ { "name": "New Order" } ],
              "releases": [
                {
                  "id": "rel-1",
                  "title": "Substance",
                  "date": "1987-08-17",
                  "artist-credit": [ { "name": "New Order" } ],
                  "media": [ { "position": 1, "track": [ { "number": "3", "position": 3 } ] } ]
                }
              ]
            }
          ]
        }
        """;

        var results = MusicBrainzClient.ParseSearchResponse(json, preferredAlbum: null);

        Assert.Equal(2, results.Count);

        // highest score first
        var top = results[0];
        Assert.Equal("rec-high", top.RecordingMbid);
        Assert.Equal(100, top.Score);
        Assert.Equal("Blue Monday", top.Title);
        Assert.Equal("New Order", top.Artist);
        Assert.Equal("Substance", top.Album);
        Assert.Equal(1987u, top.Year);
        Assert.Equal(3u, top.TrackNumber);
        Assert.Equal(1u, top.DiscNumber);

        // no releases → album/year unset
        Assert.Equal(70, results[1].Score);
        Assert.Null(results[1].Album);
        Assert.Equal(0u, results[1].Year);
    }

    [Fact]
    public void ParseSearchResponse_Prefers_Matching_Album()
    {
        const string json = """
        {
          "recordings": [
            {
              "id": "rec-1",
              "score": 95,
              "title": "Song",
              "artist-credit": [ { "name": "Artist" } ],
              "releases": [
                { "title": "Single", "date": "2001-01-01" },
                { "title": "Greatest Hits", "date": "2010-05-05" }
              ]
            }
          ]
        }
        """;

        var results = MusicBrainzClient.ParseSearchResponse(json, preferredAlbum: "Greatest Hits");

        Assert.Equal("Greatest Hits", results[0].Album);
        Assert.Equal(2010u, results[0].Year);
    }

    [Fact]
    public void ParseSearchResponse_Joins_Multi_Artist_Credits_With_Joinphrase()
    {
        const string json = """
        {
          "recordings": [
            {
              "id": "rec-1",
              "score": 100,
              "title": "Collab",
              "artist-credit": [
                { "name": "A", "joinphrase": " & " },
                { "name": "B" }
              ],
              "releases": []
            }
          ]
        }
        """;

        var results = MusicBrainzClient.ParseSearchResponse(json, preferredAlbum: null);

        Assert.Equal("A & B", results[0].Artist);
    }

    [Fact]
    public void ParseGenre_Prefers_Curated_Recording_Genre()
    {
        const string json = """
        { "genres": [ { "name": "synth-pop", "count": 5 }, { "name": "new wave", "count": 3 } ] }
        """;

        Assert.Equal("Synth-pop", MusicBrainzClient.ParseGenre(json));
    }

    [Fact]
    public void ParseGenre_Falls_Back_To_Release_Group_Genre()
    {
        const string json = """
        {
          "genres": [],
          "releases": [
            { "genres": [], "release-group": { "genres": [ { "name": "techno", "count": 2 } ] } }
          ]
        }
        """;

        Assert.Equal("Techno", MusicBrainzClient.ParseGenre(json));
    }

    [Fact]
    public void ParseGenre_Falls_Back_To_Tags_Skipping_Non_Genre_Tags()
    {
        // "seen live" has the highest count but must be skipped as a non-genre tag.
        const string json = """
        {
          "genres": [],
          "tags": [ { "name": "seen live", "count": 10 }, { "name": "electronic", "count": 4 } ]
        }
        """;

        Assert.Equal("Electronic", MusicBrainzClient.ParseGenre(json));
    }

    [Fact]
    public void ParseGenre_Returns_Null_When_Nothing_Found()
    {
        Assert.Null(MusicBrainzClient.ParseGenre("""{ "genres": [], "tags": [] }"""));
    }
}
