namespace Resonance.Tests.Networking;

using System.Reflection;
using System.Runtime.CompilerServices;
using global::resonance;
using Soulseek;

[CollectionDefinition("Application shutdown", DisableParallelization = true)]
public sealed class ApplicationShutdownCollection { }

[Collection("Application shutdown")]
public sealed class SearchShutdownTests
{
    [Fact]
    public async Task ShutdownSkipsSearchBeforeAccessingDisposedDependencies()
    {
        // An uninitialized application represents dependencies that are no longer available.
        var application = (Application)RuntimeHelpers.GetUninitializedObject(typeof(Application));
        var shutdown = typeof(Application).GetProperty("ShuttingDown", BindingFlags.NonPublic | BindingFlags.Static)!;
        var resolver = typeof(Application).GetMethod("SearchResponseResolver", BindingFlags.NonPublic | BindingFlags.Instance)!;
        var previous = shutdown.GetValue(null);
        try
        {
            shutdown.SetValue(null, true);
            var result = (Task<SearchResponse>)resolver.Invoke(application, new object[] { "peer", 1, new SearchQuery("music") })!;
            Assert.Null(await result.WaitAsync(TimeSpan.FromSeconds(5)));
        }
        finally
        {
            shutdown.SetValue(null, previous);
        }
    }
}
