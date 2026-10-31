namespace Resonance.Tests;

using global::resonance.Mixtapes;
using global::resonance.MusicLibrary;

public sealed class MixtapeStartupTests
{
    [Fact]
    public void UnavailableDownloadStorageDoesNotPreventConstructionOrReadingPlaylists()
    {
        var root = Path.Combine(Path.GetTempPath(), "resonance-playlist-start-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            // A file in place of the storage directory makes any attempt to create
            // its child fail deterministically, without relying on network timing.
            var downloads = Path.Combine(root, "downloads");
            File.WriteAllText(downloads, "unavailable storage");
            var connection = $"Data Source={Path.Combine(root, "library.db")};Pooling=False";
            var repository = new MixtapeRepository(connection);
            var music = new MusicRepository(connection, false);
            music.Initialize();
            var service = new MixtapeService(repository, music, downloads, Path.Combine(root, "artwork"), null!);
            Assert.Empty(service.GetAll());
            Assert.Equal("unavailable storage", File.ReadAllText(downloads));
        }
        finally
        {
            Directory.Delete(root, true);
        }
    }
}
