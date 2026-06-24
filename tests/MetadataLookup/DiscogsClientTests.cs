namespace Resonance.Tests.MetadataLookup;

using global::resonance.MetadataLookup;

public class DiscogsClientTests
{
    [Fact]
    public void ParseSearchResponse_Projects_Album_Year_And_Style_Genre()
    {
        const string json = """
        {
          "results": [
            {
              "id": 12345,
              "title": "Jeff Mills - The Bells",
              "year": "1997",
              "genre": ["Electronic"],
              "style": ["Techno", "Minimal"],
              "label": ["Purpose Maker"]
            }
          ]
        }
        """;

        var top = DiscogsClient.ParseSearchResponse(json, "Jeff Mills", "The Bells", queryAlbum: null)[0];

        Assert.Equal("The Bells", top.Title); // track title preserved from the query
        Assert.Equal("Jeff Mills", top.Artist);
        Assert.Equal("The Bells", top.Album);
        Assert.Equal(1997u, top.Year);
        Assert.Equal("Techno", top.Genre); // Style preferred over the broad Genre
        Assert.Equal("Discogs", top.Source);
    }

    [Fact]
    public void ParseSearchResponse_Ranks_Artist_Match_Highest()
    {
        const string json = """
        {
          "results": [
            { "title": "Various - Secret Weapons", "year": "2026", "style": ["Techno"] },
            { "title": "Berlin Girls - Encantadora", "year": "2025", "style": ["Tech House"] }
          ]
        }
        """;

        var top = DiscogsClient.ParseSearchResponse(json, "Berlin Girls", "Encantadora", queryAlbum: null)[0];

        // the result whose title contains the queried artist scores higher
        Assert.Equal("Berlin Girls", top.Artist);
        Assert.Equal("Tech House", top.Genre);
    }

    [Fact]
    public void ParseSearchResponse_Falls_Back_To_Broad_Genre_When_No_Style()
    {
        const string json = """
        { "results": [ { "title": "Artist - Album", "genre": ["Electronic"] } ] }
        """;

        Assert.Equal("Electronic", DiscogsClient.ParseSearchResponse(json, "Artist", "Track", queryAlbum: null)[0].Genre);
    }

    [Fact]
    public void ParseSearchResponse_Handles_Missing_Year_And_Untitled_Split()
    {
        const string json = """
        { "results": [ { "title": "Single Name Release", "style": ["Acid"] } ] }
        """;

        var top = DiscogsClient.ParseSearchResponse(json, "Whoever", "Track", queryAlbum: null)[0];

        Assert.Equal("Single Name Release", top.Album); // no " - " → whole title is the album
        Assert.Equal(0u, top.Year);
        Assert.Equal("Acid", top.Genre);
    }
}
