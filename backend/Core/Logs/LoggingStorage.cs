namespace resonance.Core.LogStore;

using System;

/// <summary>One interpretation of logging storage options for startup, sinks and the viewer.</summary>
public static class LoggingStorage
{
    public static bool Database(Options.LoggerOptions options) => options.Storage?.ToLowerInvariant() switch
    {
        "database" => true, "disk" => false, "both" => true,
        null => options.Database || options.Postgres,
        _ => throw new ArgumentException("Logging storage must be Database, Disk, or Both."),
    };
    public static bool Disk(Options.LoggerOptions options) => options.Storage?.ToLowerInvariant() switch
    {
        "database" => false, "disk" => true, "both" => true,
        null => options.Disk,
        _ => throw new ArgumentException("Logging storage must be Database, Disk, or Both."),
    };
}
