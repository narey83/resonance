namespace Resonance.Tests.MusicLibrary;

using global::resonance.MusicLibrary;

public class StreamUrlSignerTests
{
    private const string Key = "test-signing-key-at-least-32-chars-long!!";
    private const long OneHourMs = 3_600_000;

    [Fact]
    public void Validates_A_Freshly_Signed_Url()
    {
        var signer = new StreamUrlSigner(Key, OneHourMs);
        var path = "/music/artist/album/track.flac";

        var (exp, sig) = signer.Sign(path);

        Assert.True(signer.Validate(path, exp, sig));
    }

    [Fact]
    public void Rejects_A_Tampered_Path()
    {
        var signer = new StreamUrlSigner(Key, OneHourMs);
        var (exp, sig) = signer.Sign("/music/track.flac");

        Assert.False(signer.Validate("/music/other.flac", exp, sig));
        Assert.False(signer.Validate("/etc/passwd", exp, sig));
    }

    [Fact]
    public void Rejects_A_Tampered_Expiry()
    {
        var signer = new StreamUrlSigner(Key, OneHourMs);
        var path = "/music/track.flac";
        var (exp, sig) = signer.Sign(path);

        // Extending the expiry must invalidate the signature.
        Assert.False(signer.Validate(path, exp + 3600, sig));
    }

    [Fact]
    public void Rejects_An_Expired_Signature()
    {
        // Shortest possible TTL (floored to 1s), then wait until just past expiry. A valid
        // signature for a past expiry can only be produced by the signer itself, so we let
        // real time advance rather than forging one.
        var signer = new StreamUrlSigner(Key, ttlMilliseconds: 1000);
        var path = "/music/track.flac";
        var (exp, sig) = signer.Sign(path);

        Assert.True(signer.Validate(path, exp, sig)); // valid now

        while (DateTimeOffset.UtcNow.ToUnixTimeSeconds() <= exp)
        {
            Thread.Sleep(100);
        }

        Assert.False(signer.Validate(path, exp, sig)); // expired
    }

    [Fact]
    public void Rejects_A_Signature_From_A_Different_Key()
    {
        var path = "/music/track.flac";
        var (exp, sig) = new StreamUrlSigner(Key, OneHourMs).Sign(path);

        var other = new StreamUrlSigner("a-completely-different-32-char-key-value!", OneHourMs);
        Assert.False(other.Validate(path, exp, sig));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not-a-real-signature")]
    public void Rejects_Missing_Or_Garbage_Signatures(string sig)
    {
        var signer = new StreamUrlSigner(Key, OneHourMs);
        var futureExp = DateTimeOffset.UtcNow.ToUnixTimeSeconds() + 3600;

        Assert.False(signer.Validate("/music/track.flac", futureExp, sig));
    }
}
