namespace Resonance.Tests.Logs;

using System.Globalization;
using global::resonance;
using global::resonance.Core.Http;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.Routing.Patterns;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Serilog;
using Serilog.Core;
using Serilog.Events;

public class DiagnosticLoggingTests
{
    [Theory]
    [InlineData(null, null, false)]
    [InlineData("Production", "Development", false)]
    [InlineData("Development", "Production", true)]
    [InlineData(null, "Development", true)]
    [InlineData(null, "Production", false)]
    [InlineData("Staging", null, false)]
    [InlineData("development", null, true)]
    [InlineData("", "Development", false)]
    public void OnlyAnExplicitDevelopmentEnvironmentEnablesDiagnostics(string? dotnet, string? aspnet, bool expected)
        => Assert.Equal(expected, DiagnosticLogging.IsDevelopment(dotnet!, aspnet!));

    [Theory]
    [InlineData(true, LogEventLevel.Debug)]
    [InlineData(false, LogEventLevel.Information)]
    public void ApplicationDefaultsKeepDevelopmentDetailOutOfProduction(bool development, LogEventLevel expected)
        => Assert.Equal(expected, DiagnosticLogging.ApplicationLevel(development));

    [Theory]
    [InlineData(true, "Debug", true)]
    [InlineData(true, "Information", true)]
    [InlineData(false, "Debug", false)]
    [InlineData(false, "Information", false)]
    [InlineData(false, "Warning", true)]
    [InlineData(false, "Error", true)]
    public void ProductionRemoteLoggingRetainsFailuresWithoutClientChatter(bool development, string level, bool expected)
        => Assert.Equal(expected, DiagnosticLogging.AcceptRemoteLevel(development, level));

    [Theory]
    [InlineData(true, true)]
    [InlineData(true, false)]
    [InlineData(false, true)]
    [InlineData(false, false)]
    public void DatabaseDiagnosticsNeverEnableSensitiveParameterLogging(bool development, bool sql)
    {
        var builder = new DbContextOptionsBuilder().UseSqlite("Data Source=:memory:").EnableSensitiveDataLogging();
        DiagnosticLogging.ConfigureDatabase(builder, development, sql);
        var options = builder.Options.FindExtension<CoreOptionsExtension>()!;
        Assert.False(options.IsSensitiveDataLoggingEnabled);
        Assert.Equal(development, options.DetailedErrorsEnabled);
    }

    [Fact]
    public async Task RequestDiagnosticsContainTimingsAndCorrelationButNoRawSecrets()
    {
        var sink = new Sink();
        using var logger = new LoggerConfiguration().MinimumLevel.Debug().Enrich.FromLogContext().WriteTo.Sink(sink).CreateLogger();
        var context = Context();
        var middleware = new DevelopmentRequestLoggingMiddleware(next =>
        {
            next.Response.StatusCode = 204;
            return Task.CompletedTask;
        }, logger);
        await middleware.InvokeAsync(context);
        var entry = Assert.Single(sink.Events);
        Assert.Equal(LogEventLevel.Debug, entry.Level);
        Assert.Equal(204, ((ScalarValue)entry.Properties["StatusCode"]).Value);
        Assert.Equal("server-generated-request-id", ((ScalarValue)entry.Properties["RequestId"]).Value);
        Assert.Equal("api/v0/track/{id}", ((ScalarValue)entry.Properties["Route"]).Value);
        Assert.True(Convert.ToDouble(((ScalarValue)entry.Properties["ElapsedMilliseconds"]).Value, CultureInfo.InvariantCulture) >= 0);
        var text = entry.RenderMessage() + string.Join(" ", entry.Properties.Select(pair => pair.Value.ToString()));
        Assert.DoesNotContain("super-secret", text);
        Assert.DoesNotContain("private-file", text);
    }

    [Fact]
    public async Task RequestDiagnosticsReportFailuresWithoutSwallowingExceptionsOrLoggingTheirContents()
    {
        var sink = new Sink();
        using var logger = new LoggerConfiguration().MinimumLevel.Debug().WriteTo.Sink(sink).CreateLogger();
        var failure = new IOException("super-secret in exception contents");
        var middleware = new DevelopmentRequestLoggingMiddleware(_ => throw failure, logger);
        Assert.Same(failure, await Assert.ThrowsAsync<IOException>(() => middleware.InvokeAsync(Context())));
        var entry = Assert.Single(sink.Events);
        Assert.Equal(500, ((ScalarValue)entry.Properties["StatusCode"]).Value);
        Assert.Equal("IOException", ((ScalarValue)entry.Properties["ErrorType"]).Value);
        Assert.Null(entry.Exception);
        Assert.DoesNotContain("super-secret", entry.RenderMessage());
    }

    [Fact]
    public async Task RequestDiagnosticsDistinguishClientCancellationFromServerFailure()
    {
        var sink = new Sink();
        using var logger = new LoggerConfiguration().MinimumLevel.Debug().WriteTo.Sink(sink).CreateLogger();
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        var context = Context();context.RequestAborted = cancellation.Token;
        var middleware = new DevelopmentRequestLoggingMiddleware(_ => throw new OperationCanceledException(cancellation.Token), logger);
        await Assert.ThrowsAsync<OperationCanceledException>(() => middleware.InvokeAsync(context));
        Assert.Equal(499, ((ScalarValue)Assert.Single(sink.Events).Properties["StatusCode"]).Value);
    }

    private static DefaultHttpContext Context()
    {
        var context = new DefaultHttpContext { TraceIdentifier = "server-generated-request-id" };
        context.Request.Method = "GET";
        context.Request.Path = "/api/v0/track/private-file";
        context.Request.QueryString = new QueryString("?access_token=super-secret");
        context.Request.Headers.Authorization = "Bearer super-secret";
        context.Request.Body = new MemoryStream(System.Text.Encoding.UTF8.GetBytes("password=super-secret"));
        context.SetEndpoint(new RouteEndpoint(_ => Task.CompletedTask, RoutePatternFactory.Parse("api/v0/track/{id}"), 0, null, "Track"));
        return context;
    }

    private sealed class Sink : ILogEventSink
    {
        public List<LogEvent> Events { get; } = [];
        public void Emit(LogEvent logEvent) => Events.Add(logEvent);
    }
}
