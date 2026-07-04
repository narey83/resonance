namespace Resonance.Tests.Integrations;

using Resonance.Integrations.YtDlp;

public class YtDlpMetadataParserTests
{
    [Theory]
    // Standard spaced dashes (existing behaviour)
    [InlineData("Artist - Title [LBL001]", "Artist", "Title", "LBL001")]
    [InlineData("Dejan (SE) -- Crvotocina [ILLTAKT8]", "Dejan (SE)", "Crvotocina", "ILLTAKT8")]
    // Dash glued to the artist
    [InlineData("Pfirter- Oppression [RYC008]", "Pfirter", "Oppression", "RYC008")]
    [InlineData("Umwelt- Sidereal Storm [RPTCH09]", "Umwelt", "Sidereal Storm", "RPTCH09")]
    [InlineData("D-IX- Crazy On A Saturday Night [LACK010]", "D-IX", "Crazy On A Saturday Night", "LACK010")]
    [InlineData("Ciuciek & OB1- Louder [HARBORCONCEPTV001]", "Ciuciek & OB1", "Louder", "HARBORCONCEPTV001")]
    // Dash glued to the title
    [InlineData("nthng -There Is A Place For Me [TAR019]", "nthng", "There Is A Place For Me", "TAR019")]
    [InlineData("Adam X -The Evacuation [BITE009]", "Adam X", "The Evacuation", "BITE009")]
    [InlineData("Komfortrauschen -KR#01 (Smilla Remix) [SFF038]", "Komfortrauschen", "KR#01 (Smilla Remix)", "SFF038")]
    [InlineData("Milton Bradley presents Doomsday Device -The X-Planet [CROSSING011]", "Milton Bradley presents Doomsday Device", "The X-Planet", "CROSSING011")]
    // Colon separator
    [InlineData("DJ Disrespect: Transition (Athletic Mix) [FA010]", "DJ Disrespect", "Transition (Athletic Mix)", "FA010")]
    public void Splits_Artist_And_Title(string rawTitle, string artist, string title, string album)
    {
        var parsed = YtDlpMetadataParser.Parse(rawTitle, uploader: "uploader");

        Assert.Equal(artist, parsed.Artist);
        Assert.Equal(title, parsed.Title);
        Assert.Equal(album, parsed.Album);
    }

    [Fact]
    public void Falls_Back_To_Uploader_When_No_Separator()
    {
        var parsed = YtDlpMetadataParser.Parse("Julian Muller Eternal Lights [ARTSCOLLECTIVE029]", uploader: "SomeChannel");

        Assert.Equal("SomeChannel", parsed.Artist);
    }

    [Theory]
    // Bare dash splits when nothing else matched
    [InlineData("Artist-Title [LBL001]", "Artist", "Title")]
    [InlineData("Hi-Tech Song", "Hi", "Tech Song")]
    public void Bare_Dash_Is_A_Last_Resort_Separator(string rawTitle, string artist, string title)
    {
        var parsed = YtDlpMetadataParser.Parse(rawTitle, uploader: "uploader");

        Assert.Equal(artist, parsed.Artist);
        Assert.Equal(title, parsed.Title);
    }

    [Fact]
    public void Dash_Inside_Brackets_Is_Not_A_Separator()
    {
        var parsed = YtDlpMetadataParser.Parse(
            "The Maersk Project Spadder (Orlando Voorn Remix) [TECH-UM003]", uploader: "SomeChannel");

        Assert.Equal("SomeChannel", parsed.Artist);
    }
}
