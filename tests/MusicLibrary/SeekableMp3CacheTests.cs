namespace Resonance.Tests.MusicLibrary;

using global::resonance.MusicLibrary;

public class SeekableMp3CacheTests
{
    [Fact]
    public async Task ReusesRemuxUntilSourceChanges()
    {
        var root = Path.Combine(Path.GetTempPath(), $"seekable-mp3-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        try
        {
            var source = Path.Combine(root, "track.mp3");
            await File.WriteAllBytesAsync(source, [1, 2, 3]);
            var calls = 0;
            var cache = new SeekableMp3Cache(Path.Combine(root, "cache"), async (_, target, _, ct) =>
            {
                Interlocked.Increment(ref calls);
                await File.WriteAllBytesAsync(target, [4, 5, 6], ct);
            });

            await using (var first = await cache.OpenAsync(source, "unused", CancellationToken.None))
            {
                Assert.Equal(3, first.Length);
            }
            await using (var second = await cache.OpenAsync(source, "unused", CancellationToken.None))
            {
                Assert.Equal(3, second.Length);
            }
            Assert.Equal(1, calls);

            await File.WriteAllBytesAsync(source, [1, 2, 3, 4]);
            await using (var updated = await cache.OpenAsync(source, "unused", CancellationToken.None))
            {
                Assert.Equal(3, updated.Length);
            }
            Assert.Equal(2, calls);
            Assert.Equal(2, Directory.GetFiles(Path.Combine(root, "cache"), "*.mp4").Length);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task ConcurrentRequestsShareOneRemuxAndFailuresLeaveNoPartialCache()
    {
        var root = Path.Combine(Path.GetTempPath(), $"seekable-mp3-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        try
        {
            var source = Path.Combine(root, "track.mp3");
            await File.WriteAllBytesAsync(source, [1, 2, 3]);
            var calls = 0;
            var cacheDir = Path.Combine(root, "cache");
            var cache = new SeekableMp3Cache(cacheDir, async (_, target, _, ct) =>
            {
                Interlocked.Increment(ref calls);
                await Task.Delay(50, ct);
                await File.WriteAllBytesAsync(target, [4, 5, 6], ct);
            });
            var streams = await Task.WhenAll(Enumerable.Range(0, 5)
                .Select(_ => cache.OpenAsync(source, "unused", CancellationToken.None)));
            foreach (var stream in streams) await stream.DisposeAsync();
            Assert.Equal(1, calls);

            await File.WriteAllBytesAsync(source, [1, 2, 3, 4]);
            var failing = new SeekableMp3Cache(cacheDir, async (_, target, _, ct) =>
            {
                await File.WriteAllBytesAsync(target, [9], ct);
                throw new IOException("remux failed");
            });
            await Assert.ThrowsAsync<IOException>(() => failing.OpenAsync(source, "unused", CancellationToken.None));
            Assert.Empty(Directory.GetFiles(cacheDir, "*.tmp"));
            Assert.Single(Directory.GetFiles(cacheDir, "*.mp4"));
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }
}
