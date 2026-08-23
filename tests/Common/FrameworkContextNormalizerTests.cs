namespace Resonance.Tests.Common;

using global::resonance;
using Serilog.Core;
using Serilog.Events;
using Serilog.Parsing;

public class FrameworkContextNormalizerTests
{
    // A minimal, real ILogEventPropertyFactory -- avoids pulling in a whole Serilog pipeline (and
    // a new package dependency) just to exercise one enricher directly.
    private sealed class TestPropertyFactory : ILogEventPropertyFactory
    {
        public LogEventProperty CreateProperty(string name, object? value, bool destructureObjects = false) =>
            new(name, new ScalarValue(value));
    }

    private static LogEvent NewEvent(string? sourceContext, string? subContext = null)
    {
        var properties = new List<LogEventProperty>();

        if (sourceContext is not null)
        {
            properties.Add(new LogEventProperty("SourceContext", new ScalarValue(sourceContext)));
        }

        if (subContext is not null)
        {
            properties.Add(new LogEventProperty("SubContext", new ScalarValue(subContext)));
        }

        return new LogEvent(
            DateTimeOffset.UtcNow,
            LogEventLevel.Information,
            exception: null,
            new MessageTemplateParser().Parse("test"),
            properties);
    }

    private static string? Normalize(string sourceContext)
    {
        var logEvent = NewEvent(sourceContext);

        new FrameworkContextNormalizer().Enrich(logEvent, new TestPropertyFactory());

        return logEvent.Properties.TryGetValue("SourceContext", out var value) && value is ScalarValue { Value: string s }
            ? s
            : null;
    }

    private static string? NormalizeSubContext(string subContext)
    {
        var logEvent = NewEvent(sourceContext: null, subContext: subContext);

        new FrameworkContextNormalizer().Enrich(logEvent, new TestPropertyFactory());

        return logEvent.Properties.TryGetValue("SubContext", out var value) && value is ScalarValue { Value: string s }
            ? s
            : null;
    }

    [Theory]
    [InlineData("Microsoft.EntityFrameworkCore.Database.Command", "EF Core / Command")]
    [InlineData("Microsoft.EntityFrameworkCore.Update", "EF Core / Update")]
    [InlineData("Microsoft.EntityFrameworkCore", "EF Core")]
    [InlineData("Microsoft.AspNetCore.Diagnostics.ExceptionHandlerMiddleware", "ASP.NET Core / ExceptionHandlerMiddleware")]
    [InlineData("Microsoft.AspNetCore.Routing.EndpointMiddleware", "ASP.NET Core / EndpointMiddleware")]
    [InlineData("Microsoft.Extensions.Hosting.Internal.Host", ".NET / Host")]
    [InlineData("System.Net.Http.HttpClient.Default.LogicalHandler", "HTTP Client / LogicalHandler")]
    [InlineData("Npgsql.Connection", "Postgres / Connection")]
    public void Normalizes_KnownFrameworkPrefixes_ToGroupSlashLeaf(string raw, string expected)
    {
        Assert.Equal(expected, Normalize(raw));
    }

    [Theory]
    [InlineData("Application")]
    [InlineData("Transfers / Uploads")]
    [InlineData("Music / Library")]
    [InlineData("Integrations / yt-dlp")]
    public void LeavesAppOwnedContexts_CompletelyUnchanged(string appContext)
    {
        Assert.Equal(appContext, Normalize(appContext));
    }

    [Fact]
    public void DoesNotFalselyMatchASimilarButDistinctPrefix()
    {
        // "Microsoft.AspNetCoreSomethingElse" must not be treated as under the
        // "Microsoft.AspNetCore" group just because it starts with the same characters.
        Assert.Equal(
            "Microsoft.AspNetCoreSomethingElse.Foo",
            Normalize("Microsoft.AspNetCoreSomethingElse.Foo"));
    }

    [Fact]
    public void LeavesEventsWithNoSourceContext_Unaffected()
    {
        var logEvent = NewEvent(null);

        new FrameworkContextNormalizer().Enrich(logEvent, new TestPropertyFactory());

        Assert.False(logEvent.Properties.ContainsKey("SourceContext"));
    }

    [Theory]
    [InlineData("Soulseek.Messaging.Handlers.PeerMessageHandler", "PeerMessageHandler")]
    [InlineData("Soulseek.Client", "Client")]
    [InlineData("Soulseek.Diagnostics.DiagnosticFactory", "DiagnosticFactory")]
    public void NormalizesSubContext_ForKnownLibraryPrefixes_ToLeafOnly(string raw, string expected)
    {
        Assert.Equal(expected, NormalizeSubContext(raw));
    }

    [Theory]
    [InlineData("device-123")]
    [InlineData("some-username")]
    [InlineData("SoulseekLikeButNotIt")]
    public void LeavesNonNamespaceSubContextValues_CompletelyUnchanged(string raw)
    {
        Assert.Equal(raw, NormalizeSubContext(raw));
    }

    [Fact]
    public void LeavesEventsWithNoSubContext_Unaffected()
    {
        var logEvent = NewEvent(sourceContext: null);

        new FrameworkContextNormalizer().Enrich(logEvent, new TestPropertyFactory());

        Assert.False(logEvent.Properties.ContainsKey("SubContext"));
    }

    [Fact]
    public void NormalizesSourceContextAndSubContext_Together_InOneEvent()
    {
        var logEvent = NewEvent("Soulseek", "Soulseek.Messaging.Handlers.PeerMessageHandler");

        new FrameworkContextNormalizer().Enrich(logEvent, new TestPropertyFactory());

        // "Soulseek" alone isn't a known SourceContext prefix (it's an app-set group name, not a
        // framework namespace), so it passes through; SubContext is shortened to its leaf.
        Assert.Equal("Soulseek", ((ScalarValue)logEvent.Properties["SourceContext"]).Value);
        Assert.Equal("PeerMessageHandler", ((ScalarValue)logEvent.Properties["SubContext"]).Value);
    }
}
