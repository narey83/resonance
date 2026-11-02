namespace Resonance.Tests.Analysis;

using System.Text.Json;
using Serilog;
using Serilog.Core;
using Serilog.Events;
using global::resonance.Analysis.Candidates;

public class MeasurementFailurePolicyTests
{
    [Fact]
    public void FailureLogIdentifiesTrackMeasurementReasonAndJob()
    {
        using var document = JsonDocument.Parse("""
            {"featureAvailability":{"beats":"available","energy":"failed"},"features":{"energy":{"reason":"Model execution failed"}}}
            """);
        var sink = new Capture();
        using var logger = new LoggerConfiguration().WriteTo.Sink(sink).CreateLogger();
        CandidateAnalysisService.LogMeasurementFailures(document.RootElement, "/music/track.mp3", "test-job", logger);
        var entry = Assert.Single(sink.Events);
        Assert.Equal(LogEventLevel.Warning, entry.Level);
        Assert.Equal("/music/track.mp3", ((ScalarValue)entry.Properties["Path"]).Value);
        Assert.Equal("energy", ((ScalarValue)entry.Properties["Measurement"]).Value);
        Assert.Equal("Model execution failed", ((ScalarValue)entry.Properties["Reason"]).Value);
        Assert.Equal("test-job", ((ScalarValue)entry.Properties["JobId"]).Value);
    }

    private sealed class Capture : ILogEventSink
    {
        public List<LogEvent> Events { get; } = new();
        public void Emit(LogEvent logEvent) => Events.Add(logEvent);
    }

    [Theory]
    [InlineData("failed")]
    [InlineData("unavailable")]
    public void AnyMeasurementFailureRejectsOtherwiseCompleteEnhancedTrack(string status)
    {
        using var document = JsonDocument.Parse("""
            {"scope":{"fullTrack":true},"featureAvailability":{"beats":"available","semanticPhrases":"available","vocalPresence":"available","genre":"available","energy":"STATUS"},"features":{"energy":{"reason":"Model execution failed"}}}
            """.Replace("STATUS", status));
        Assert.False(CandidateAnalysisService.HasEnhanced(document.RootElement));
        Assert.Equal(new[] { "energy" }, CandidateAnalysisService.FailedMeasurements(document.RootElement));
    }

    [Theory]
    [InlineData("Disabledinexplicitconfiguration")]
    [InlineData("Disabled in explicit configuration")]
    public void UnrequestedMeasurementsDoNotFailTheTrack(string reason)
    {
        using var document = JsonDocument.Parse("""
            {"scope":{"fullTrack":true},"featureAvailability":{"beats":"available","semanticPhrases":"available","vocalPresence":"available","genre":"available","energy":"unavailable","loops":"skipped"},"features":{"energy":{"reason":"REASON"}}}
            """.Replace("REASON", reason));
        Assert.True(CandidateAnalysisService.HasEnhanced(document.RootElement));
        Assert.Empty(CandidateAnalysisService.FailedMeasurements(document.RootElement));
    }
}
