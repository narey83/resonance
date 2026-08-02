namespace Resonance.Tests.Common;

using global::resonance;

public class CommonExtensionsTests
{
    [Theory]
    [InlineData(@"Some User\Artist - Album (2020) [FLAC]\01 track.mp3", "Artist - Album (2020) [FLAC]")]
    [InlineData("Some User/Artist - Album/01 track.mp3", "Artist - Album")]
    [InlineData("track.mp3", "")]
    public void ParentFolderName_Returns_Immediate_Parent(string path, string expected)
    {
        Assert.Equal(expected, path.ParentFolderName());
    }

    [Theory]
    [InlineData("Artist - Album (2020) [FLAC]", "artistalbum2020flac")]
    [InlineData("", "")]
    [InlineData(null, "")]
    public void ToFuzzyMatchKey_Strips_Punctuation_And_Lowercases(string? text, string expected)
    {
        Assert.Equal(expected, text.ToFuzzyMatchKey());
    }

    [Fact]
    public void ToFuzzyMatchKey_Allows_Substring_Match_Against_Remote_Folder()
    {
        var folder = @"Some User\Artist Name - Great Album (2020) [FLAC]\01 track.mp3".ParentFolderName().ToFuzzyMatchKey();

        Assert.Contains("artistname".ToFuzzyMatchKey(), folder);
        Assert.Contains("greatalbum".ToFuzzyMatchKey(), folder);
    }
}
