namespace Resonance.Tests.MetadataLookup;

using global::resonance.MetadataLookup;
using global::resonance.Shares;

public class MetadataMergeTests
{
    private static MetadataMatch Match(
        string title = "New Title",
        string artist = "New Artist",
        string album = "New Album",
        string albumArtist = "New Album Artist",
        uint year = 1999,
        uint track = 7,
        uint disc = 1,
        string genre = "Jazz")
        => new(title, artist, album, albumArtist, year, track, disc, genre, Score: 100, RecordingMbid: "mbid");

    [Fact]
    public void MergeTags_Never_Overwrites_Existing_Values()
    {
        var existing = new FileTags(
            Artist: "Old Artist",
            AlbumArtist: "Old Album Artist",
            Album: "Old Album",
            Title: "Old Title",
            TrackNumber: 5,
            Year: 2000,
            Key: "8A",
            Genre: "Rock",
            Bpm: 120,
            Comment: "keep me",
            DiscNumber: 2);

        // the lookup is fill-only: every field already in the file survives, even
        // when the match supplies a different value
        var result = MetadataLookupService.MergeTags(existing, Match());

        Assert.Equal("Old Title", result.Title);
        Assert.Equal("Old Artist", result.Artist);
        Assert.Equal("Old Album", result.Album);
        Assert.Equal("Old Album Artist", result.AlbumArtist);
        Assert.Equal(2000u, result.Year);
        Assert.Equal(5u, result.TrackNumber);
        Assert.Equal(2u, result.DiscNumber);
        Assert.Equal("Rock", result.Genre);

        // fields the lookup does not provide are preserved
        Assert.Equal("8A", result.Key);
        Assert.Equal(120u, result.Bpm);
        Assert.Equal("keep me", result.Comment);
    }

    [Fact]
    public void MergeTags_Fills_Only_Empty_Fields()
    {
        var existing = new FileTags(
            Artist: "Old Artist",
            AlbumArtist: null,
            Album: null,
            Title: "Old Title",
            TrackNumber: 0,
            Year: 0,
            Genre: null);

        var result = MetadataLookupService.MergeTags(existing, Match());

        // existing values survive…
        Assert.Equal("Old Title", result.Title);
        Assert.Equal("Old Artist", result.Artist);

        // …and only the gaps are filled from the match
        Assert.Equal("New Album", result.Album);
        Assert.Equal("New Album Artist", result.AlbumArtist);
        Assert.Equal(1999u, result.Year);
        Assert.Equal(7u, result.TrackNumber);
        Assert.Equal("Jazz", result.Genre);
    }

    [Fact]
    public void MergeTags_Does_Not_Clobber_With_Missing_Match_Values()
    {
        var existing = new FileTags(
            Artist: "Old Artist",
            AlbumArtist: "Old Album Artist",
            Album: "Old Album",
            Title: "Old Title",
            TrackNumber: 5,
            Year: 2000,
            Genre: "Rock",
            DiscNumber: 2);

        // a match with no year/track/disc/genre must keep the existing values
        var sparse = Match(year: 0, track: 0, disc: 0, genre: null);

        var result = MetadataLookupService.MergeTags(existing, sparse);

        Assert.Equal(2000u, result.Year);
        Assert.Equal(5u, result.TrackNumber);
        Assert.Equal(2u, result.DiscNumber);
        Assert.Equal("Rock", result.Genre);
    }

    [Fact]
    public void MergeTags_Falls_Back_To_Artist_When_AlbumArtist_Missing()
    {
        var result = MetadataLookupService.MergeTags(existing: null, Match(albumArtist: ""));

        Assert.Equal("New Artist", result.AlbumArtist);
    }

    [Fact]
    public void MergeTags_Handles_Null_Existing_Tags()
    {
        var result = MetadataLookupService.MergeTags(existing: null, Match());

        Assert.Equal("New Title", result.Title);
        Assert.Equal("New Artist", result.Artist);
        Assert.Equal(1999u, result.Year);
    }

    [Fact]
    public void MergeTags_Does_Not_Clobber_Title_Artist_With_Empty_Match()
    {
        // Discogs supplies album/year/genre but no track title — existing title/artist must survive
        var existing = new FileTags(
            Artist: "Real Artist",
            AlbumArtist: "Real Album Artist",
            Album: "Old Album",
            Title: "Real Title",
            TrackNumber: 0,
            Year: 0);

        var discogsLike = new MetadataMatch(
            Title: null,
            Artist: null,
            Album: "Discovered Album",
            AlbumArtist: null,
            Year: 1998,
            TrackNumber: 0,
            DiscNumber: 0,
            Genre: "Techno",
            Score: 95,
            RecordingMbid: null,
            Source: "Discogs");

        var result = MetadataLookupService.MergeTags(existing, discogsLike);

        Assert.Equal("Real Title", result.Title);
        Assert.Equal("Real Artist", result.Artist);
        Assert.Equal("Real Album Artist", result.AlbumArtist);

        // fill-only: the album already in the file wins over the discovered one
        Assert.Equal("Old Album", result.Album);
        Assert.Equal(1998u, result.Year);
        Assert.Equal("Techno", result.Genre);
    }
}
