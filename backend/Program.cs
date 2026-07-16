// <copyright file="Program.cs" company="JP Dillingham">
//           ▄▄▄▄     ▄▄▄▄     ▄▄▄▄
//     ▄▄▄▄▄▄█  █▄▄▄▄▄█  █▄▄▄▄▄█  █
//     █__ --█  █__ --█    ◄█  -  █
//     █▄▄▄▄▄█▄▄█▄▄▄▄▄█▄▄█▄▄█▄▄▄▄▄█
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) JP Dillingham.
//   │ Copyright (c) 2026 John Narey.
//   │ Modified as part of Resonance, a modified version of slskd;
//   │ see the project repository for the nature of the changes.
//   │
//   │ This program is free software: you can redistribute it and/or modify
//   │ it under the terms of the GNU Affero General Public License as published
//   │ by the Free Software Foundation, version 3.
//   │
//   │ This program is distributed in the hope that it will be useful,
//   │ but WITHOUT ANY WARRANTY; without even the implied warranty of
//   │ MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
//   │ GNU Affero General Public License for more details.
//   │
//   │ You should have received a copy of the GNU Affero General Public License
//   │ along with this program.  If not, see https://www.gnu.org/licenses/.
//   │
//   │ This program is distributed with Additional Terms pursuant to Section 7
//   │ of the AGPLv3.  See the LICENSE file in the root directory of this
//   │ project for the complete terms and conditions.
//   │
//   │ https://slskd.org
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: JP Dillingham
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

using Microsoft.Extensions.Logging;

namespace resonance
{
    using System;
    using System.Collections.Generic;
    using System.ComponentModel;
    using System.ComponentModel.DataAnnotations;
    using System.IO;
    using System.Linq;
    using System.Net;
    using System.Net.Http;
    using System.Reflection;
    using System.Security.Cryptography.X509Certificates;
    using System.Text;
    using System.Text.Json.Serialization;
    using System.Threading;
    using System.Threading.Tasks;
    using Asp.Versioning.ApiExplorer;
    using Microsoft.AspNetCore.Authentication.JwtBearer;
    using Microsoft.AspNetCore.Builder;
    using Microsoft.AspNetCore.DataProtection;
    using Microsoft.AspNetCore.Diagnostics;
    using Microsoft.AspNetCore.Hosting;
    using Microsoft.AspNetCore.Http;
    using Microsoft.AspNetCore.Server.Kestrel.Core;
    using Microsoft.EntityFrameworkCore;
    using Microsoft.Extensions.Configuration;
    using Microsoft.Extensions.DependencyInjection;
    using Microsoft.Extensions.FileProviders;
    using Microsoft.Extensions.FileProviders.Physical;
    using Microsoft.IdentityModel.Tokens;
    using Microsoft.OpenApi.Models;
    using Prometheus.DotNetRuntime;
    using Prometheus.SystemMetrics;
    using resonance.Authentication;
    using resonance.Configuration;
    using resonance.Core.API;
    using resonance.Cryptography;
    using resonance.Events;
    using resonance.Files;
    using resonance.Integrations.FTP;
    using resonance.Integrations.Pushbullet;
    using resonance.Integrations.Scripts;
    using resonance.Integrations.Upnp;
    using resonance.Integrations.VPN;
    using resonance.Integrations.Webhooks;
    using resonance.Messaging;
    using resonance.Relay;
    using resonance.Search;
    using resonance.Search.API;
    using resonance.Shares;
    using resonance.Telemetry;
    using resonance.Transfers;
    using resonance.Transfers.Downloads;
    using resonance.Transfers.Uploads;
    using resonance.Users;
    using resonance.Validation;
    using Serilog;
    using Serilog.Events;
    using Serilog.Sinks.Grafana.Loki;
    using Serilog.Sinks.SystemConsole.Themes;
    using Soulseek;
    using Utility.CommandLine;
    using Utility.EnvironmentVariables;
    using IOFile = System.IO.File;

    /// <summary>
    ///     Bootstraps configuration and handles primitive command-line instructions.
    /// </summary>
    public static class Program
    {
        /// <summary>
        ///     The name of the application.
        /// </summary>
        public static readonly string AppName = "resonance";

        /// <summary>
        ///     The DateTime of the 'genesis' of the application (the initial commit).
        /// </summary>
        public static readonly DateTime GenesisDateTime = new(2020, 12, 30, 6, 22, 0, DateTimeKind.Utc);

        /// <summary>
        ///     The name of the local share host.
        /// </summary>
        public static readonly string LocalHostName = "local";

        /// <summary>
        ///     The url to the issues/support site.
        /// </summary>
        public static readonly string IssuesUrl = "https://github.com/narey83/resonance/issues";

        /// <summary>
        ///     The global prefix for environment variables.
        /// </summary>
        public static readonly string EnvironmentVariablePrefix = $"{AppName.ToUpperInvariant()}_";

        /// <summary>
        ///     The default XML documentation filename.
        /// </summary>
        public static readonly string XmlDocumentationFile = Path.Combine(AppContext.BaseDirectory, "etc", $"{AppName}.xml");

        /// <summary>
        ///     The default application data directory.
        /// </summary>
        public static readonly string DefaultAppDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData, Environment.SpecialFolderOption.DoNotVerify), AppName);

        /// <summary>
        ///     Gets the unique Id of this application invocation.
        /// </summary>
        public static readonly Guid InvocationId = Guid.NewGuid();

        /// <summary>
        ///     Gets the Id of the current application process.
        /// </summary>
        public static readonly int ProcessId = Environment.ProcessId;

        /// <remarks>
        ///     Inaccurate when running locally.
        /// </remarks>
        private static readonly Version AssemblyVersion = Assembly.GetExecutingAssembly().GetName().Version.Equals(new Version(1, 0, 0, 0)) ? new Version(0, 0, 0, 0) : Assembly.GetExecutingAssembly().GetName().Version;

        /// <remarks>
        ///     Inaccurate when running locally.
        /// </remarks>
        private static readonly string InformationalVersion = Assembly.GetExecutingAssembly().GetCustomAttribute<AssemblyInformationalVersionAttribute>().InformationalVersion == "1.0.0" ? "0.0.0" : Assembly.GetExecutingAssembly().GetCustomAttribute<AssemblyInformationalVersionAttribute>().InformationalVersion;

        /// <summary>
        ///     Occurs when a new log event is emitted.
        /// </summary>
        public static event EventHandler<LogRecord> LogEmitted;

        /// <summary>
        ///     Gets the semantic application version.
        /// </summary>
        public static string SemanticVersion { get; } = InformationalVersion.Split('+').First();

        /// <summary>
        ///     Gets the full application version, including both assembly and informational versions.
        /// </summary>
        public static string FullVersion { get; } = $"{SemanticVersion} ({InformationalVersion})";

        /// <summary>
        ///     Gets the minor version that identifies this client on the Soulseek network.
        /// </summary>
        /// <remarks>
        ///     Must be unique per Soulseek.NET-based client (library LICENSE) and must not
        ///     reuse another client's identifier (slskd Additional Terms 4(d)). Per the
        ///     Soulseek.NET "Reserved Minor Version Ranges" registry, slskd reserves
        ///     760-7699999; Resonance uses the 8000000+ block, above that range.
        /// </remarks>
        public static int NetworkMinorVersion { get; } = 8000000;

        /// <summary>
        ///     Gets a value indicating whether the current version is a Canary build.
        /// </summary>
        public static bool IsCanary { get; } = AssemblyVersion.Revision == 65534;

        /// <summary>
        ///     Gets a value indicating whether the current version is a Development build.
        /// </summary>
        public static bool IsDevelopment { get; } = new Version(0, 0, 0, 0) == AssemblyVersion;

        /// <summary>
        ///     Gets a value indicating whether the application is being run in Relay Agent mode.
        /// </summary>
        public static bool IsRelayAgent { get; private set; }

        /// <summary>
        ///     Gets the application flags.
        /// </summary>
        public static Options.FlagsOptions Flags { get; private set; }

        /// <summary>
        ///     Gets the path where application data is saved.
        /// </summary>
        [Argument('a', "app-dir", "path where application data is saved")]
        [EnvironmentVariable("APP_DIR")]
        public static string AppDirectory { get; private set; } = null;

        /// <summary>
        ///     Gets the fully qualified path to the application configuration file.
        /// </summary>
        [Argument('c', "config", "path to configuration file")]
        [EnvironmentVariable("CONFIG")]
        public static string ConfigurationFile { get; private set; } = null;

        /// <summary>
        ///     Gets the current configuration overlay, if one has been applied.
        /// </summary>
        public static OptionsOverlay ConfigurationOverlay => VolatileOverlayConfigurationSource?.CurrentValue;

        /// <summary>
        ///     Gets the path where persistent data is saved.
        /// </summary>
        public static string DataDirectory { get; private set; } = null;

        /// <summary>
        ///     Gets the path where backups of persistent data saved.
        /// </summary>
        public static string DataBackupDirectory { get; private set; } = null;

        /// <summary>
        ///     Gets the default fully qualified path to the configuration file.
        /// </summary>
        public static string DefaultConfigurationFile { get; private set; }

        /// <summary>
        ///     Gets the default downloads directory.
        /// </summary>
        public static string DefaultDownloadsDirectory { get; private set; }

        /// <summary>
        ///     Gets the default incomplete download directory.
        /// </summary>
        public static string DefaultIncompleteDirectory { get; private set; }

        /// <summary>
        ///     Gets the path where application logs are saved.
        /// </summary>
        public static string LogDirectory { get; private set; } = null;

        /// <summary>
        ///     Gets the path where user-defined scripts are stored.
        /// </summary>
        public static string ScriptDirectory { get; private set; } = null;

        /// <summary>
        ///     Gets a buffer containing the last few log events.
        /// </summary>
        public static ConcurrentFixedSizeQueue<LogRecord> LogBuffer { get; } = new ConcurrentFixedSizeQueue<LogRecord>(size: 100);

        /// <summary>
        ///     Gets a buffer containing the last few HTTP requests, captured for HAR export.
        /// </summary>
        public static ConcurrentFixedSizeQueue<resonance.Core.Http.HttpCaptureEntry> HttpCaptureBuffer { get; } = new ConcurrentFixedSizeQueue<resonance.Core.Http.HttpCaptureEntry>(size: 500);

        /// <summary>
        ///     Gets the master cancellation token source for the program.
        /// </summary>
        /// <remarks>
        ///     The token from this source should be used (or linked) to any long-running asynchronous task, so that when the application
        ///     begins to shut down these tasks also shut down in a timely manner. Actions that control the lifecycle of the program
        ///     (POSIX signals, a restart from the API, etc) should cancel this source.
        /// </remarks>
        public static CancellationTokenSource MasterCancellationTokenSource { get; } = new CancellationTokenSource();

        private static IConfigurationRoot Configuration { get; set; }
        private static OptionsAtStartup OptionsAtStartup { get; } = new OptionsAtStartup();
        private static string StableJwtKey { get; set; }
        private static X509Certificate2 SelfSignedCertificate { get; set; }
        private static ILogger Log { get; set; } = new ConsoleWriteLineLogger();
        private static Mutex Mutex { get; set; }
        private static IDisposable DotNetRuntimeStats { get; set; }
        private static VolatileOverlayConfigurationSource<OptionsOverlay> VolatileOverlayConfigurationSource { get; set; } = new VolatileOverlayConfigurationSource<OptionsOverlay>();

        [Argument('g', "generate-cert", "generate X509 certificate and password for HTTPs")]
        private static bool GenerateCertificate { get; set; }

        [Argument('k', "generate-secret", "generate random secret of the specified length")]
        private static int GenerateSecret { get; set; }

        [Argument('n', "no-logo", "suppress logo on startup")]
        private static bool NoLogo { get; set; }

        [Argument('e', "envars", "display environment variables")]
        private static bool ShowEnvironmentVariables { get; set; }

        [Argument('h', "help", "display command line usage")]
        private static bool ShowHelp { get; set; }

        [Argument('v', "version", "display version information")]
        private static bool ShowVersion { get; set; }

        public static void RaiseLogEmitted(LogRecord record) => LogEmitted?.Invoke(null, record);

        /// <summary>
        ///     Panic.
        /// </summary>
        /// <param name="code">An optional exit code.</param>
        public static void Exit(int code = 1) => Environment.Exit(code);

        /// <summary>
        ///     Apply an instance of <see cref="OptionsOverlay"/> on top of the existing application configuration.
        /// </summary>
        /// <param name="overlay">The overlay containing the property values to be overlaid.</param>
        public static void ApplyConfigurationOverlay(OptionsOverlay overlay) => VolatileOverlayConfigurationSource.Apply(overlay);

        /// <summary>
        ///     Entrypoint.
        /// </summary>
        /// <param name="args">Command line arguments.</param>
        public static void Main(string[] args)
        {
            // populate the properties above so that we can override the default config file if needed, and to
            // check if the application is being run in command mode (run task and quit).
            EnvironmentVariables.Populate(prefix: EnvironmentVariablePrefix);

            try
            {
                Arguments.Populate(clearExistingValues: false);
            }
            catch (Exception ex)
            {
                // this is pretty hacky, but i don't have a good way of trapping errors that bubble up here.
                Log.Error($"Invalid command line input: {ex.Message.Replace(".  See inner exception for details.", string.Empty)}");
                return;
            }

            // if a user has used one of the arguments above, perform the requested task, then quit
            if (ShowVersion)
            {
                Log.Information(FullVersion);
                return;
            }

            if (ShowHelp || ShowEnvironmentVariables)
            {
                if (!NoLogo)
                {
                    PrintLogo(FullVersion);
                }

                if (ShowHelp)
                {
                    PrintCommandLineArguments(typeof(Options));
                }

                if (ShowEnvironmentVariables)
                {
                    PrintEnvironmentVariables(typeof(Options), EnvironmentVariablePrefix);
                }

                return;
            }

            if (GenerateCertificate)
            {
                var (filename, password) = GenerateX509Certificate(password: Cryptography.Random.GetBytes(16).ToBase62(), filename: $"{AppName}.pfx");

                Log.Information($"Certificate exported to {filename}");
                Log.Information($"Password: {password}");
                return;
            }

            if (GenerateSecret > 0)
            {
                if (GenerateSecret < 16 || GenerateSecret > 255)
                {
                    Log.Error("Invalid command line input: secret length must be between 16 and 255, inclusive");
                    return;
                }

                Log.Information(Cryptography.Random.GetBytes(GenerateSecret).ToBase62());
                return;
            }

            // the application isn't being run in command mode. check the mutex to ensure
            // only one long-running instance.
            try
            {
                Mutex = new Mutex(initiallyOwned: true, Compute.Sha256Hash(AppName), out bool created);

                if (!created)
                {
                    Log.Fatal($"An instance of {AppName} is already running");
                    return;
                }
            }
            catch (IOException ex)
            {
                Log.Fatal($"I/O exception attempting to acquire the application singleton mutex; this can happen when running in a restricted environment (such as a read-only filesystem or container). Exception: {ex.Message}");
                return;
            }
            catch (UnauthorizedAccessException ex)
            {
                Log.Fatal($"Unauthorized access attempting to acquire the application singleton mutex; this can happen when running with insuffucent permissions. Exception: {ex.Message}");
                return;
            }
            catch (Exception ex)
            {
                Log.Fatal($"Failed to acquire the application singleton mutex: {ex.Message}");
                return;
            }

            // derive the application directory value and defaults that are dependent upon it
            AppDirectory ??= DefaultAppDirectory;
            DataDirectory = Path.Combine(AppDirectory, "data");
            DataBackupDirectory = Path.Combine(DataDirectory, "backups");
            LogDirectory = Path.Combine(AppDirectory, "logs");
            ScriptDirectory = Path.Combine(AppDirectory, "scripts");

            DefaultConfigurationFile = Path.Combine(AppDirectory, "resonance.yml");
            DefaultDownloadsDirectory = Path.Combine(AppDirectory, "downloads");
            DefaultIncompleteDirectory = Path.Combine(AppDirectory, "incomplete");

            // the location of the configuration file might have been overridden by command line or envar.
            // if not, set it to the default.
            ConfigurationFile ??= DefaultConfigurationFile;

            // verify(create if needed) default application directories. if the downloads or complete
            // directories are overridden in config, those will be validated after the config is loaded.
            try
            {
                VerifyDirectory(AppDirectory, createIfMissing: true, verifyWriteable: true);
                VerifyDirectory(DataDirectory, createIfMissing: true, verifyWriteable: true);
                VerifyDirectory(Path.Combine(DataDirectory, "temp"), createIfMissing: true, verifyWriteable: true);
                VerifyDirectory(DataBackupDirectory, createIfMissing: true, verifyWriteable: true);
                VerifyDirectory(ScriptDirectory, createIfMissing: true, verifyWriteable: false);
                VerifyDirectory(DefaultDownloadsDirectory, createIfMissing: true, verifyWriteable: true);
                VerifyDirectory(DefaultIncompleteDirectory, createIfMissing: true, verifyWriteable: true);
            }
            catch (Exception ex)
            {
                Log.Information($"Filesystem exception: {ex.Message}");
                return;
            }

            // load and validate the configuration
            try
            {
                // reloadOnChange must be true here: this root (not the WebApplication builder's) is
                // what DI binds IOptionsMonitor<Options> to, so with false, edits to the config file
                // on disk are never observed — only API-driven overlay changes were.
                Configuration = new ConfigurationBuilder()
                    .AddConfigurationProviders(EnvironmentVariablePrefix, ConfigurationFile, reloadOnChange: true)
                    .Build();

                Configuration.GetSection(AppName)
                    .Bind(OptionsAtStartup, (o) => { o.BindNonPublicProperties = true; });

                if (OptionsAtStartup.Debug)
                {
                    Log.Information($"Configuration:\n{Configuration.GetDebugView()}");
                }

                if (!OptionsAtStartup.TryValidate(out var result))
                {
                    Log.Information(result.GetResultView());
                    return;
                }
            }
            catch (Exception ex)
            {
                Log.Information($"Invalid configuration: {(!OptionsAtStartup.Debug ? ex : ex.Message)}");
                return;
            }

            IsRelayAgent = OptionsAtStartup.Relay.Enabled && OptionsAtStartup.Relay.Mode.ToEnum<RelayMode>() == RelayMode.Agent;
            Flags = OptionsAtStartup.Flags;

            // Anchor the music-root path mapping so persistence stores paths relative to the music
            // directory rather than absolute. Fixed at startup (Downloads requires a restart to change).
            resonance.Common.MusicPath.Configure(OptionsAtStartup.Directories.Downloads);

            if (OptionsAtStartup.Logger.Disk && !OptionsAtStartup.Flags.NoLogo)
            {
                try
                {
                    var logPath = Path.Combine(LogDirectory, $"{AppName}-{DateTime.Now:yyyyMMdd}.log");
                    IOFile.AppendAllText(logPath, GetLogoText(FullVersion) + Environment.NewLine);
                }
                catch
                {
                    // noop
                }
            }

            ConfigureGlobalLogger();
            Log = Serilog.Log.ForContext("SourceContext", Logs.Application);

            if (!OptionsAtStartup.Flags.NoLogo)
            {
                PrintLogo(FullVersion);
            }

            Log.Information("Version: {Version}", FullVersion);

            if (IsDevelopment)
            {
                Log.Warning("This is a Development build; YMMV");
            }

            if (IsCanary)
            {
                Log.Warning("This is a canary build");
                Log.Warning("Canary builds are considered UNSTABLE and may be completely BROKEN");
                Log.Warning($"Please report any issues here: {IssuesUrl}");
            }

            Log.Information("System: .NET {DotNet}, {OS}, {BitNess} bit, {ProcessorCount} processors", Environment.Version, Environment.OSVersion, Environment.Is64BitOperatingSystem ? 64 : 32, Environment.ProcessorCount);
            Log.Information("Process ID: {ProcessId} ({BitNess} bit)", ProcessId, Environment.Is64BitProcess ? 64 : 32);

            Log.Information("Invocation ID: {InvocationId}", InvocationId);
            Log.Information("Instance Name: {InstanceName}", OptionsAtStartup.InstanceName);

            Log.Information("Configuring application...");

            Log.Information("Using application directory {AppDirectory}", AppDirectory);
            Log.Information("Using configuration file {ConfigurationFile}", ConfigurationFile);

            if (OptionsAtStartup.Flags.NoConfigWatch)
            {
                Log.Warning("Configuration watch DISABLED; all configuration changes will require a restart to take effect");
            }

            Log.Information("Storing application data in {DataDirectory}", DataDirectory);

            if (OptionsAtStartup.Logger.Disk)
            {
                Log.Information("Saving application logs to {LogDirectory}", LogDirectory);
            }

            RecreateConfigurationFileIfMissing(ConfigurationFile);
            StableJwtKey = EnsureJwtKeyPersisted(DataDirectory, OptionsAtStartup.Web.Authentication.Jwt.Key);
            SelfSignedCertificate = EnsureSelfSignedCertificate(DataDirectory);

            if (!string.IsNullOrEmpty(OptionsAtStartup.Logger.Loki))
            {
                Log.Information("Forwarding logs to Grafana Loki instance at {LoggerLokiUrl}", OptionsAtStartup.Logger.Loki);
            }

            // bootstrap the ASP.NET application
            try
            {
                var builder = WebApplication.CreateBuilder(args);

                builder.Configuration
                    .AddConfigurationProviders(EnvironmentVariablePrefix, ConfigurationFile, reloadOnChange: true);

                builder.Host
                    .UseSerilog();

                builder.WebHost
                    .UseUrls()
                    .UseKestrel(options =>
                    {
                        // configure HTTP, either by listening at any IP or by each of the IPs provided in the
                        // config (note: they've already been validated at this point!)
                        if (!OptionsAtStartup.Web.Disabled)
                        {
                            if (string.IsNullOrWhiteSpace(OptionsAtStartup.Web.IpAddress))
                            {
                                Log.Information("Listening for HTTP requests at http://{IP}:{Port}/", IPAddress.IPv6Any, OptionsAtStartup.Web.Port);
                                options.Listen(IPAddress.IPv6Any, OptionsAtStartup.Web.Port); // [::]; any IPv4 or IPv6 address
                            }
                            else
                            {
                                var httpIps = OptionsAtStartup.Web.IpAddress
                                    .Split(',')
                                    .Select(ip => ip.Trim())
                                    .Select(ip => IPAddress.Parse(ip));

                                foreach (var ip in httpIps)
                                {
                                    Log.Information("Listening for HTTP requests at http://{IP}:{Port}/", ip, OptionsAtStartup.Web.Port);
                                    options.Listen(ip, OptionsAtStartup.Web.Port);
                                }
                            }

                            // configure UDS, if supplied
                            if (OptionsAtStartup.Web.Socket != null)
                            {
                                Log.Information($"Listening for HTTP requests on unix domain socket (UDS) {OptionsAtStartup.Web.Socket}");
                                options.ListenUnixSocket(OptionsAtStartup.Web.Socket);
                            }
                        }
                        else
                        {
                            Log.Information("HTTP is disabled");
                        }

                        // configure HTTPS, again listening on any IP or on a list of supplied IPs
                        // use a local function because Microsoft can't get enough of the obtuse builder pattern
                        static void ListenHttps(KestrelServerOptions o, IPAddress ip)
                        {
                            o.Listen(ip, OptionsAtStartup.Web.Https.Port, listenOptions =>
                            {
                                var cert = OptionsAtStartup.Web.Https.Certificate;

                                if (!string.IsNullOrEmpty(cert.Pfx))
                                {
                                    Log.Information($"Using certificate from {cert.Pfx}");
                                    listenOptions.UseHttps(cert.Pfx, cert.Password);
                                }
                                else
                                {
                                    Log.Information($"Using persisted self-signed certificate");
                                    listenOptions.UseHttps(SelfSignedCertificate);
                                }
                            });
                        }

                        if (!OptionsAtStartup.Web.Https.Disabled)
                        {
                            if (string.IsNullOrWhiteSpace(OptionsAtStartup.Web.Https.IpAddress))
                            {
                                Log.Information("Listening for HTTPS requests at https://{IP}:{Port}/", IPAddress.IPv6Any, OptionsAtStartup.Web.Https.Port);
                                ListenHttps(options, IPAddress.IPv6Any);
                            }
                            else
                            {
                                var httpsIps = OptionsAtStartup.Web.Https.IpAddress
                                    .Split(',')
                                    .Select(ip => ip.Trim())
                                    .Select(ip => IPAddress.Parse(ip));

                                foreach (var ip in httpsIps)
                                {
                                    Log.Information("Listening for HTTPS requests at https://{IP}:{Port}/", ip, OptionsAtStartup.Web.Https.Port);
                                    ListenHttps(options, ip);
                                }
                            }
                        }
                    });

                builder.Services
                    .ConfigureAspDotNetServices()
                    .ConfigureDependencyInjectionContainer();

                // Compress JSON responses. The grouped library lists are large (albums alone is
                // ~2.5MB uncompressed) and were shipping raw over the wire on every load; JSON
                // gzips ~7x. Fastest level keeps CPU low — these payloads are big, so a higher
                // level would add real latency for little extra ratio. EnableForHttps because the
                // app talks to Kestrel over TLS (private LAN + token auth → BREACH risk is moot).
                builder.Services.AddResponseCompression(options =>
                {
                    options.EnableForHttps = true;
                    options.Providers.Add<Microsoft.AspNetCore.ResponseCompression.BrotliCompressionProvider>();
                    options.Providers.Add<Microsoft.AspNetCore.ResponseCompression.GzipCompressionProvider>();
                    options.MimeTypes = new[] { "application/json", "text/json", "application/json; charset=utf-8" };
                });
                builder.Services.Configure<Microsoft.AspNetCore.ResponseCompression.BrotliCompressionProviderOptions>(o => o.Level = System.IO.Compression.CompressionLevel.Fastest);
                builder.Services.Configure<Microsoft.AspNetCore.ResponseCompression.GzipCompressionProviderOptions>(o => o.Level = System.IO.Compression.CompressionLevel.Fastest);

                var app = builder.Build();

                // ensure built-in permission roles are always seeded (idempotent)
                app.Services.GetRequiredService<PermissionService>().EnsureBuiltinRoles();

                // clean up expired/revoked refresh token sessions from previous runs
                app.Services.GetRequiredService<SessionService>().CleanupExpiredSessions();

                // hack: services that exist only to subscribe to the event bus are not referenced by anything else
                //       and are thus never instantiated.  force a reference here so they are created.
                _ = app.Services.GetService<ScriptService>();
                _ = app.Services.GetService<WebhookService>();
                _ = app.Services.GetService<VPNService>();

                // begin UPnP discovery/port mapping if enabled; the mapping is removed on shutdown via disposal
                app.Services.GetService<UpnpService>()?.Start();

                app.ConfigureAspDotNetPipeline();

                if (OptionsAtStartup.Flags.NoStart)
                {
                    Log.Information("Quitting because 'no-start' option is enabled");
                    return;
                }

                Log.Information("Configuration complete.  Starting application...");
                app.Run();
            }
            catch (Exception ex)
            {
                Log.Fatal(ex, "Application terminated unexpectedly");
            }
            finally
            {
                try
                {
                    Mutex?.Dispose();
                }
                catch (Exception)
                {
                    // Ignore disposal errors to prevent masking other exceptions
                }

                Serilog.Log.CloseAndFlush();
            }
        }

        private static IServiceCollection ConfigureDependencyInjectionContainer(this IServiceCollection services)
        {
            // add the instance of OptionsAtStartup to DI as they were at startup. use when Options might change, but
            // the values at startup are to be used (generally anything marked RequiresRestart).
            services.AddSingleton(OptionsAtStartup);

            // add IOptionsMonitor and IOptionsSnapshot to DI.
            // use when the current Options are to be used (generally anything not marked RequiresRestart)
            // the monitor should be used for services with Singleton lifetime, snapshots for everything else
            services.AddOptions<Options>()
                .Bind(Configuration.GetSection(AppName), o => { o.BindNonPublicProperties = true; })
                .Validate(options =>
                {
                    if (!options.TryValidate(out var result))
                    {
                        Log.Warning("Options (re)configuration rejected.");
                        Log.Warning(result.GetResultView());
                        return false;
                    }

                    return true;
                });

            // add IManagedState, IStateMutator, IStateMonitor, and IStateSnapshot state to DI.
            // the mutator should be used any time application state needs to be mutated (as the name implies)
            // as with options, the monitor should be used for services with Singleton lifetime, snapshots for everything else
            // IManagedState should be used where state is being mutated and accessed in the same context
            services.AddManagedState<State>();

            // add IHttpClientFactory
            // use through 'using var http = HttpClientFactory.CreateClient()' wherever HTTP calls will be made
            // this is important to prevent memory leaks
            services.AddHttpClient();

            // add a special HttpClientFactory to DI that disables SSL.  access it via:
            // 'using var http = HttpClientFactory.CreateClient(Constants.IgnoreCertificateErrors)'
            // thanks Microsoft, makes total sense and surely won't be easy to fuck up later!
            services.AddHttpClient(Constants.IgnoreCertificateErrors)
                .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
                {
                    ServerCertificateCustomValidationCallback = HttpClientHandler.DangerousAcceptAnyServerCertificateValidator,
                });

            // add a partially configured instance of SoulseekClient. the Application instance will
            // complete configuration at startup.
            services.AddSingleton<ISoulseekClient, SoulseekClient>(_ =>
                new SoulseekClient(
                    minorVersion: NetworkMinorVersion,
                    options: new SoulseekClientOptions(
                        maximumConcurrentUploads: OptionsAtStartup.Transfers.Upload.Slots == 0 ? int.MaxValue : OptionsAtStartup.Transfers.Upload.Slots,
                        maximumConcurrentDownloads: OptionsAtStartup.Transfers.Download.Slots == 0 ? int.MaxValue : OptionsAtStartup.Transfers.Download.Slots,
                        minimumDiagnosticLevel: OptionsAtStartup.Soulseek.DiagnosticLevel.ToEnum<Soulseek.Diagnostics.DiagnosticLevel>(),
                        maximumConcurrentSearches: 2,
                        raiseEventsAsynchronously: true)));

            // add the core application service to DI as well as a hosted service so that other services can
            // access instance methods
            services.AddSingleton<IApplication, Application>();
            services.AddHostedService(p => p.GetRequiredService<IApplication>());

            services.AddSingleton<IWaiter, Waiter>();
            services.AddSingleton<ConnectionWatchdog, ConnectionWatchdog>();

            // actively probes the server connection so a silently stalled ("half-open") connection is detected and
            // reconnected instead of appearing healthy forever; see ServerConnectionMonitor for the full rationale.
            services.AddHostedService<ServerConnectionMonitor>();

            // wire up all of the connection strings we'll use. this is somewhat annoying but necessary because of the
            // intersection of run-time options (volatile, non-volatile) and ORM/mappers in use (EF, Dapper)
            var connectionStringDictionary = new ConnectionStringDictionary(Database.List
                .Select(database => new KeyValuePair<Database, ConnectionString>(database, OptionsAtStartup.Database.ConnectionString))
                .ToDictionary(x => x.Key, x => x.Value));

            // The app is PostgreSQL-only; repositories that still carry a backend flag are always Postgres.
            const bool usePostgres = true;

            services.AddDbContext<SearchDbContext>(connectionStringDictionary[Database.Search]);
            services.AddDbContext<TransfersDbContext>(connectionStringDictionary[Database.Transfers]);

            // TransferNetworkInfo is a custom (non-EF) table; create it after the transfers schema is ready.
            {
                using var pgConn = new Npgsql.NpgsqlConnection(connectionStringDictionary[Database.Transfers]);
                pgConn.Open();
                using var pgCmd = pgConn.CreateCommand();
                pgCmd.CommandText = """
                    CREATE TABLE IF NOT EXISTS transfers."TransferNetworkInfo" (
                        "Username"  TEXT NOT NULL,
                        "IpAddress" TEXT NOT NULL,
                        "Country"   TEXT,
                        "City"      TEXT,
                        "IsVpn"     SMALLINT NOT NULL DEFAULT 0,
                        "Lat"       DOUBLE PRECISION,
                        "Lon"       DOUBLE PRECISION,
                        "LastSeen"  TIMESTAMPTZ NOT NULL,
                        PRIMARY KEY ("Username")
                    )
                    """;
                pgCmd.ExecuteNonQuery();
            }

            services.AddDbContext<MessagingDbContext>(connectionStringDictionary[Database.Messaging]);
            services.AddDbContext<EventsDbContext>(connectionStringDictionary[Database.Events]);
            services.AddDbContext<UsersDbContext>(connectionStringDictionary[Database.Users]);
            services.AddDbContext<resonance.MusicLibrary.Activity.LibraryActivityDbContext>(connectionStringDictionary[Database.LibraryActivity]);
            services.AddDbContext<Resonance.Integrations.YtDlp.Data.YtDlpDbContext>(connectionStringDictionary[Database.YtDlp]);
            services.AddDbContext<resonance.Core.LogStore.LogsDbContext>(connectionStringDictionary[Database.AppLogs]);
            services.AddHostedService<resonance.Core.LogStore.LogPersistenceService>();
            services.AddSingleton<resonance.MusicLibrary.Activity.ILibraryActivityService, resonance.MusicLibrary.Activity.LibraryActivityService>();
            services.AddSingleton<AppUserService>();
            services.AddSingleton<SessionService>();
            services.AddSingleton<LoginRateLimiter>();
            services.AddSingleton<PermissionService>();
            services.AddSingleton<resonance.Core.BrowseRateLimiter>();

            services.AddSingleton<ConnectionStringDictionary>(connectionStringDictionary);

            services.AddSingleton<EventService>();
            services.AddSingleton<EventBus>();
            services.AddSingleton<resonance.Core.Preferences.PreferencesService>();
            services.AddSingleton<resonance.Core.BrowseHistory.BrowseHistoryService>();
            services.AddSingleton<resonance.Users.Blocking.BlockedUsersService>();

            services.AddSingleton<PrometheusService>();
            services.AddSingleton<ReportsService>();
            services.AddSingleton<TelemetryService>();

            services.AddSingleton<VPNService>();
            services.AddSingleton<UpnpService>();
            services.AddSingleton<ScriptService>();
            services.AddSingleton<WebhookService>();

            services.AddSingleton<IBrowseTracker, BrowseTracker>();
            services.AddSingleton<IRoomTracker, RoomTracker>(_ => new RoomTracker(messageLimit: 250));

            services.AddSingleton<IMessagingService, MessagingService>();
            services.AddSingleton<IConversationService, ConversationService>();
            services.AddSingleton<resonance.Transfers.ITransferErrorNotificationService, resonance.Transfers.TransferErrorNotificationService>();

            services.AddSingleton<IShareService, ShareService>();
            services.AddSingleton<resonance.Common.Ffmpeg.IFfmpegService, resonance.Common.Ffmpeg.FfmpegService>();
            services.AddHostedService(sp => sp.GetRequiredService<resonance.Common.Ffmpeg.IFfmpegService>());

            services.AddSingleton<resonance.KeyAnalysis.KeyAnalysisService>();
            services.AddSingleton<resonance.KeyAnalysis.IKeyAnalysisService>(sp => sp.GetRequiredService<resonance.KeyAnalysis.KeyAnalysisService>());
            services.AddHostedService(sp => sp.GetRequiredService<resonance.KeyAnalysis.KeyAnalysisService>());
            services.AddSingleton<resonance.BpmAnalysis.BpmAnalysisService>();
            services.AddSingleton<resonance.BpmAnalysis.IBpmAnalysisService>(sp => sp.GetRequiredService<resonance.BpmAnalysis.BpmAnalysisService>());
            services.AddHostedService(sp => sp.GetRequiredService<resonance.BpmAnalysis.BpmAnalysisService>());
            services.AddSingleton<resonance.MetadataLookup.MusicBrainzClient>();
            services.AddSingleton<resonance.MetadataLookup.DiscogsClient>();
            services.AddSingleton<resonance.MetadataLookup.LastfmClient>();
            services.AddSingleton<resonance.MetadataLookup.DeezerClient>();
            services.AddSingleton<resonance.MetadataLookup.MetadataLookupService>();
            services.AddSingleton<resonance.MetadataLookup.IMetadataLookupService>(sp => sp.GetRequiredService<resonance.MetadataLookup.MetadataLookupService>());
            services.AddHostedService(sp => sp.GetRequiredService<resonance.MetadataLookup.MetadataLookupService>());
            services.AddSingleton<resonance.WaveformAnalysis.WaveformService>(sp =>
                new resonance.WaveformAnalysis.WaveformService(
                    sp.GetRequiredService<IShareService>(),
                    sp.GetRequiredService<resonance.Common.Ffmpeg.IFfmpegService>(),
                    connectionStringDictionary[Database.Waveform],
                    usePostgres));
            services.AddSingleton<resonance.WaveformAnalysis.IWaveformService>(sp => sp.GetRequiredService<resonance.WaveformAnalysis.WaveformService>());
            services.AddHostedService(sp => sp.GetRequiredService<resonance.WaveformAnalysis.WaveformService>());
            services.AddSingleton<resonance.Cast.ICastService, resonance.Cast.CastService>();
            services.AddSingleton<resonance.TagSanitization.ITagSanitizationService, resonance.TagSanitization.TagSanitizationService>();
            services.AddTransient<IShareRepositoryFactory, ShareRepositoryFactory>();

            services.AddSingleton<resonance.MusicLibrary.MusicRepository>(_ =>
            {
                var repo = new resonance.MusicLibrary.MusicRepository(
                    connectionStringDictionary[Database.Music],
                    usePostgres);
                return repo;
            });
            services.AddSingleton<resonance.MusicLibrary.IMusicLibraryService, resonance.MusicLibrary.MusicLibraryService>();
            services.AddHostedService(p => p.GetRequiredService<resonance.MusicLibrary.IMusicLibraryService>());

            services.AddSingleton<resonance.MusicLibrary.Converter.IConverterService, resonance.MusicLibrary.Converter.ConverterService>();

            services.AddSingleton<Resonance.Integrations.YtDlp.IYtDlpService, Resonance.Integrations.YtDlp.YtDlpService>();
            services.AddHostedService(p => p.GetRequiredService<Resonance.Integrations.YtDlp.IYtDlpService>());

            services.AddSingleton<resonance.Mixtapes.MixtapeRepository>(_ =>
            {
                var repo = new resonance.Mixtapes.MixtapeRepository(
                    connectionStringDictionary[Database.Mixtapes],
                    usePostgres);
                return repo;
            });
            services.AddSingleton<resonance.Mixtapes.IMixtapeService>(sp => new resonance.Mixtapes.MixtapeService(
                sp.GetRequiredService<resonance.Mixtapes.MixtapeRepository>(),
                sp.GetRequiredService<resonance.MusicLibrary.MusicRepository>(),
                OptionsAtStartup.Directories.Downloads,
                System.IO.Path.Combine(DataDirectory, "mixtape-artwork"),
                sp.GetRequiredService<resonance.Shares.IShareService>(),
                sp.GetRequiredService<Microsoft.AspNetCore.SignalR.IHubContext<resonance.Mixtapes.API.MixtapesHub>>()));

            // Eagerly construct at startup so the mixtapes managed share is registered
            // immediately rather than on first use of the mixtapes API
            services.AddHostedService(sp => (resonance.Mixtapes.MixtapeService)sp.GetRequiredService<resonance.Mixtapes.IMixtapeService>());

            services.AddSingleton<ISearchService, SearchService>();

            services.AddSingleton<IUserService, UserService>();

            services.AddHostedService<DiscoveryService>();

            services.AddSingleton<IRoomService, RoomService>();

            services.AddSingleton<ITransferService, TransferService>();
            services.AddSingleton<IDownloadService, DownloadService>();
            services.AddSingleton<IUploadService, UploadService>();
            services.AddSingleton<FileService>();

            services.AddSingleton<IRelayService, RelayService>();

            services.AddSingleton<IFTPClientFactory, FTPClientFactory>();
            services.AddSingleton<IFTPService, FTPService>();

            services.AddSingleton<IPushbulletService, PushbulletService>();

            services.AddSingleton<resonance.Dlna.DlnaService>();
            services.AddHostedService(p => p.GetRequiredService<resonance.Dlna.DlnaService>());

            var geoService = new resonance.Network.GeoService();
            geoService.Load(Path.Combine(DataDirectory, "GeoLite2-City.mmdb"));
            services.AddSingleton(geoService);

            return services;
        }

        private static IServiceCollection ConfigureAspDotNetServices(this IServiceCollection services)
        {
            services.AddCors(options => options.AddPolicy("AllowAll", builder => builder
                .SetIsOriginAllowed((host) => true)
                .AllowAnyHeader()
                .AllowAnyMethod()
                .AllowCredentials()
                .WithExposedHeaders("X-URL-Base", "X-Total-Count")));

            // note: don't dispose this (or let it be disposed) or some of the stats, like those related
            // to the thread pool won't work
            DotNetRuntimeStats = DotNetRuntimeStatsBuilder.Default().StartCollecting();
            services.AddSystemMetrics();

            services.AddDataProtection()
                .PersistKeysToFileSystem(new DirectoryInfo(Path.Combine(DataDirectory, "misc", ".DataProtection-Keys")));

            var jwtSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(StableJwtKey ?? OptionsAtStartup.Web.Authentication.Jwt.Key));

            services.AddSingleton(jwtSigningKey);
            services.AddSingleton<SecurityService>();

            // Signs short-lived, path-scoped stream/artwork URLs so clients fetch media without
            // their JWT in the URL. Keyed off the same (stable) JWT secret.
            services.AddSingleton(new resonance.MusicLibrary.StreamUrlSigner(
                StableJwtKey ?? OptionsAtStartup.Web.Authentication.Jwt.Key,
                OptionsAtStartup.Web.Authentication.Jwt.StreamUrlTtl));

            if (!OptionsAtStartup.Web.Authentication.Disabled)
            {
                services.AddAuthorization(options =>
                {
                    options.AddPolicy(AuthPolicy.JwtOnly, policy =>
                    {
                        policy.AuthenticationSchemes.Add(JwtBearerDefaults.AuthenticationScheme);
                        policy.RequireAuthenticatedUser();
                    });

                    options.AddPolicy(AuthPolicy.ApiKeyOnly, policy =>
                    {
                        policy.AuthenticationSchemes.Add(ApiKeyAuthentication.AuthenticationScheme);
                        policy.RequireAuthenticatedUser();
                    });

                    options.AddPolicy(AuthPolicy.Any, policy =>
                    {
                        policy.AuthenticationSchemes.Add(ApiKeyAuthentication.AuthenticationScheme);
                        policy.AuthenticationSchemes.Add(JwtBearerDefaults.AuthenticationScheme);
                        policy.RequireAuthenticatedUser();
                    });

                    foreach (var key in resonance.Authentication.Feature.All)
                    {
                        options.AddPolicy(AuthPolicy.Feature(key), policy =>
                            policy.AddRequirements(new resonance.Authentication.FeatureRequirement(key)));
                    }
                });

                services.AddSingleton<Microsoft.AspNetCore.Authorization.IAuthorizationHandler, resonance.Authentication.FeatureAuthorizationHandler>();

                services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
                    .AddJwtBearer(options =>
                    {
                        options.TokenValidationParameters = new TokenValidationParameters
                        {
                            ClockSkew = TimeSpan.FromMinutes(5),
                            RequireSignedTokens = true,
                            RequireExpirationTime = true,
                            ValidateLifetime = true,
                            ValidIssuer = AppName,
                            ValidateIssuer = true,
                            ValidateAudience = false,
                            IssuerSigningKey = jwtSigningKey,
                            ValidateIssuerSigningKey = true,
                        };

                        options.Events = new JwtBearerEvents
                        {
                            OnMessageReceived = context =>
                            {
                                var isHub = context.Request.Path.StartsWithSegments("/hub");

                                // musiclibrary/stream and musiclibrary/artwork no longer accept the
                                // access_token query param — they authenticate via path-scoped HMAC
                                // signatures (see StreamUrlSigner) so the account JWT never appears in
                                // a media URL.
                                var isStream = context.Request.Path.StartsWithSegments("/api/v0/streams")
                                    || context.Request.Path.StartsWithSegments("/api/v0/files/downloads/stream");

                                // signalr, browser audio elements, and mobile Image components can't set Authorization headers,
                                // so both accept the token via the access_token query parameter
                                if (isHub || isStream)
                                {
                                    // assign the request token from the access_token query parameter if one is present
                                    // this typically means that the calling signalr client is running in a browser. this takes
                                    // precedent over the Authorization header value (if one is present)
                                    // https://docs.microsoft.com/en-us/aspnet/core/signalr/authn-and-authz?view=aspnetcore-5.0
                                    if (context.Request.Query.TryGetValue("access_token", out var accessToken))
                                    {
                                        context.Token = accessToken;
                                    }
                                    else if (isHub
                                        && context.Request.Headers.ContainsKey("Authorization")
                                        && context.Request.Headers.TryGetValue("Authorization", out var authorization)
                                        && authorization.ToString().StartsWith("Bearer ", StringComparison.InvariantCultureIgnoreCase))
                                    {
                                        // extract the bearer token. this value might be an API key, a JWT, or some garbage value
                                        var token = authorization.ToString().Split(' ').LastOrDefault();

                                        try
                                        {
                                            // check to see if the provided value is a valid API key
                                            var service = services.BuildServiceProvider().GetRequiredService<SecurityService>();
                                            var (name, role) = service.AuthenticateWithApiKey(token, callerIpAddress: context.HttpContext.Connection.RemoteIpAddress);

                                            // the API key is valid. create a new, short lived jwt for the key name and role
                                            context.Token = service.GenerateJwt(name, role, ttl: 1000).Serialize();
                                        }
                                        catch
                                        {
                                            // the token either isn't a valid API key. use the provided value and let the
                                            // rest of the auth middleware figure out whether it is valid
                                            context.Token = token;
                                        }
                                    }
                                }

                                return Task.CompletedTask;
                            },
                            OnTokenValidated = context =>
                            {
                                // JWTs issued through the login/refresh flow carry the session ID ('sid');
                                // reject them as soon as the session is revoked rather than waiting for expiry.
                                // tokens without the claim (e.g. short-lived API key JWTs for hubs) are unaffected.
                                var sid = context.Principal?.FindFirst("sid")?.Value;

                                if (sid is not null && Guid.TryParse(sid, out var sessionId))
                                {
                                    var sessions = context.HttpContext.RequestServices.GetRequiredService<SessionService>();

                                    if (sessions.IsJwtRevoked(sessionId))
                                    {
                                        context.Fail("Session has been revoked");
                                    }
                                }

                                return Task.CompletedTask;
                            },
                        };
                    })
                    .AddScheme<ApiKeyAuthenticationOptions, ApiKeyAuthenticationHandler>(ApiKeyAuthentication.AuthenticationScheme, (_) => { });
            }
            else
            {
                Log.Warning("Authentication of web requests is DISABLED");

                services.AddAuthorization(options =>
                {
                    options.AddPolicy(AuthPolicy.Any, policy =>
                    {
                        policy.AuthenticationSchemes.Add(PassthroughAuthentication.AuthenticationScheme);
                        policy.RequireAuthenticatedUser();
                    });

                    options.AddPolicy(AuthPolicy.ApiKeyOnly, policy =>
                    {
                        policy.AuthenticationSchemes.Add(PassthroughAuthentication.AuthenticationScheme);
                        policy.RequireAuthenticatedUser();
                    });

                    options.AddPolicy(AuthPolicy.JwtOnly, policy =>
                    {
                        policy.AuthenticationSchemes.Add(PassthroughAuthentication.AuthenticationScheme);
                        policy.RequireAuthenticatedUser();
                    });
                });

                services.AddAuthentication(PassthroughAuthentication.AuthenticationScheme)
                    .AddScheme<PassthroughAuthenticationOptions, PassthroughAuthenticationHandler>(PassthroughAuthentication.AuthenticationScheme, options =>
                    {
                        options.Username = "Anonymous";
                        options.Role = Role.Administrator;
                    });
            }

            services.AddRouting(options => options.LowercaseUrls = true);
            services.AddControllers(options =>
            {
                options.ModelBinderProviders.Insert(0, new UrlEncodingModelBinderProvider());

                // The backend compiles with <Nullable>annotations</Nullable>, which makes ASP.NET treat every
                // non-nullable reference-type property on a request DTO as implicitly [Required]. That silently
                // rejects requests (400) whenever the client omits an optional field. Rely only on explicit
                // [Required]/[ValidatableObject] validation instead so optional fields can be omitted freely.
                options.SuppressImplicitRequiredAttributeForNonNullableReferenceTypes = true;
            })
                .ConfigureApiBehaviorOptions(options =>
                {
                    options.SuppressInferBindingSourcesForParameters = true; // explicit [FromRoute], etc
                    options.SuppressMapClientErrors = true; // disables automatic ProblemDetails for 4xx
                    options.SuppressModelStateInvalidFilter = true; // disables automatic 400 for model errors
                    options.DisableImplicitFromServicesParameters = true; // explicit [FromServices]
                })
                .AddJsonOptions(options =>
                {
                    options.JsonSerializerOptions.Converters.Add(new IPAddressConverter());
                    options.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter());
                    options.JsonSerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
                });

            services
                .AddSignalR(options =>
                {
                    // https://github.com/SignalR/SignalR/issues/1149#issuecomment-973887222
                    options.MaximumParallelInvocationsPerClient = 2;

                    // default 15s/30s is too aggressive — browser tabs throttle timers
                    options.KeepAliveInterval = TimeSpan.FromSeconds(30);
                    options.ClientTimeoutInterval = TimeSpan.FromSeconds(120);
                })
                .AddJsonProtocol(options =>
                {
                    options.PayloadSerializerOptions.Converters.Add(new IPAddressConverter());
                    options.PayloadSerializerOptions.Converters.Add(new JsonStringEnumConverter());
                });

            services.AddMemoryCache();
            services.AddHealthChecks();

            services.AddApiVersioning(options =>
                {
                    options.ReportApiVersions = true;
                })
                .AddApiExplorer(options =>
                {
                    options.GroupNameFormat = "'v'VVV";
                    options.SubstituteApiVersionInUrl = true;
                });

            if (OptionsAtStartup.Feature.Swagger)
            {
                services.AddSwaggerGen(options =>
                {
                    options.CustomSchemaIds(type => type.FullName.Replace("+", "."));
                    options.DescribeAllParametersInCamelCase();
                    options.SwaggerDoc("v0", new OpenApiInfo
                    {
                        Version = "v0",
                        Title = AppName,
                        Description = "A modern client-server application for the Soulseek file sharing network",
                        Contact = new OpenApiContact
                        {
                            Name = "GitHub",
                            Url = new Uri("https://github.com/narey83/resonance"),
                        },
                        License = new OpenApiLicense
                        {
                            Name = "AGPL-3.0 license",
                            Url = new Uri("https://github.com/narey83/resonance/blob/main/LICENSE"),
                        },
                    });

                    // allow endpoints marked with multiple content types in [Produces] to generate properly
                    options.OperationFilter<ContentNegotiationOperationFilter>();

                    // expose the supported auth schemes so the Swagger UI shows an "Authorize" button for testing.
                    // the OAuth2 password flow lets the Authorize dialog prompt for a username/password directly and
                    // exchange them for a JWT via the bridging token endpoint (SessionController.Token).
                    var oauthBase = OptionsAtStartup.Web.UrlBase;
                    oauthBase = oauthBase.StartsWith("/") ? oauthBase : "/" + oauthBase;
                    var oauthTokenPath = (oauthBase == "/" ? string.Empty : oauthBase.TrimEnd('/')) + "/api/v0/session/token";

                    options.AddSecurityDefinition("OAuth2", new OpenApiSecurityScheme
                    {
                        Type = SecuritySchemeType.OAuth2,
                        Description = "Log in with your Resonance username and password; Swagger exchanges them for a JWT via the password grant.",
                        Flows = new OpenApiOAuthFlows
                        {
                            Password = new OpenApiOAuthFlow
                            {
                                TokenUrl = new Uri(oauthTokenPath, UriKind.Relative),
                                Scopes = new Dictionary<string, string>(),
                            },
                        },
                    });

                    options.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
                    {
                        Name = "Authorization",
                        Type = SecuritySchemeType.Http,
                        Scheme = "bearer",
                        BearerFormat = "JWT",
                        In = ParameterLocation.Header,
                        Description = "JWT obtained from POST /api/v0/session. Enter the raw token; Swagger adds the 'Bearer ' prefix.",
                    });

                    options.AddSecurityDefinition(ApiKeyAuthentication.AuthenticationScheme, new OpenApiSecurityScheme
                    {
                        Name = "X-API-Key",
                        Type = SecuritySchemeType.ApiKey,
                        In = ParameterLocation.Header,
                        Description = "An API key configured under 'web.authentication.api_keys' in resonance.yml.",
                    });

                    options.AddSecurityRequirement(new OpenApiSecurityRequirement
                    {
                        {
                            new OpenApiSecurityScheme
                            {
                                Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "OAuth2" },
                            },
                            Array.Empty<string>()
                        },
                        {
                            new OpenApiSecurityScheme
                            {
                                Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "Bearer" },
                            },
                            Array.Empty<string>()
                        },
                        {
                            new OpenApiSecurityScheme
                            {
                                Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = ApiKeyAuthentication.AuthenticationScheme },
                            },
                            Array.Empty<string>()
                        },
                    });

                    if (IOFile.Exists(XmlDocumentationFile))
                    {
                        options.IncludeXmlComments(XmlDocumentationFile);
                    }
                    else
                    {
                        Log.Warning($"Unable to find XML documentation in {XmlDocumentationFile}, Swagger will not include metadata");
                    }
                });
            }

            return services;
        }

        private static WebApplication ConfigureAspDotNetPipeline(this WebApplication app)
        {
            // stop ASP.NET from sending a full stack trace and ProblemDetails for unhandled exceptions
            app.UseExceptionHandler(a => a.Run(async context =>
            {
                await context.Response.WriteAsJsonAsync(context.Features.Get<IExceptionHandlerPathFeature>().Error.Message);
            }));

            app.UseCors("AllowAll");

            // Before anything writes a response body, so large JSON payloads go out compressed.
            app.UseResponseCompression();

            if (OptionsAtStartup.Web.Https.Force)
            {
                app.UseHttpsRedirection();
                app.UseHsts();

                Log.Information($"Forcing HTTP requests to HTTPS");
            }

            // allow users to specify a custom path base, for use behind a reverse proxy
            var urlBase = OptionsAtStartup.Web.UrlBase;
            urlBase = urlBase.StartsWith("/") ? urlBase : "/" + urlBase;

            app.UsePathBase(urlBase);
            Log.Information("Using base url {UrlBase}", urlBase);

            // Capture every request into an in-memory ring buffer for HAR export, so backend traffic can
            // be compared against the mobile app's network log. Registered here so it wraps auth, routing
            // and endpoint execution, yielding representative server-side processing times.
            app.UseMiddleware<resonance.Core.Http.RequestCaptureMiddleware>();

            if (OptionsAtStartup.Web.Logging)
            {
                var httpLogPath = Path.Combine(LogDirectory, $"{AppName}-http-.log");
                var retainDays = OptionsAtStartup.Retention.Logs;

                var httpLogger = new LoggerConfiguration()
                    .MinimumLevel.Information()
                    .WriteTo.Async(config => config.File(
                        httpLogPath,
                        outputTemplate: "[{Timestamp:yyyy-MM-dd HH:mm:ss}] {Message:lj}{NewLine}",
                        rollingInterval: RollingInterval.Day,
                        retainedFileTimeLimit: retainDays > 0 ? TimeSpan.FromDays(retainDays) : null))
                    .CreateLogger();

                app.UseSerilogRequestLogging(opts => opts.Logger = httpLogger);
            }

            app.UseAuthentication();
            app.UseRouting();
            app.UseAuthorization();

            // starting with .NET 7 the framework *really* wants you to use top level endpoint mapping
            // for whatever reason this breaks everything, and i just can't bring myself to care unless
            // UseEndpoints is going to be deprecated or if there's some material benefit
            // Same-IP auto-blocks happen deep in the network guards; push the alert and the
            // refreshed block lists to every connected client so the user hears about the
            // evasion attempt immediately.
            {
                var blockedUsers = app.Services.GetRequiredService<resonance.Users.Blocking.BlockedUsersService>();
                var applicationHub = app.Services.GetRequiredService<Microsoft.AspNetCore.SignalR.IHubContext<ApplicationHub>>();
                blockedUsers.AutoBlocked += (username, ip) =>
                {
                    _ = applicationHub.BroadcastBlockedUserAlertAsync(username, ip);
                    _ = applicationHub.BroadcastBlockedUsersAsync(blockedUsers);
                };
            }

#pragma warning disable ASP0014 // Suggest using top level route registrations
            app.UseEndpoints(endpoints =>
            {
                endpoints.MapHub<ApplicationHub>("/hub/application");
                endpoints.MapHub<LogsHub>("/hub/logs");
                endpoints.MapHub<SearchHub>("/hub/search");
                endpoints.MapHub<RelayHub>("/hub/relay");
                endpoints.MapHub<resonance.Mixtapes.API.MixtapesHub>("/hub/mixtapes");
                endpoints.MapHub<resonance.Core.API.BrowseHub>("/hub/browse");
                endpoints.MapHub<resonance.MusicLibrary.API.LibraryActivityHub>("/hub/libraryactivity");
                endpoints.MapHub<Resonance.Integrations.YtDlp.API.Hubs.YtDlpHub>("/hub/ytdlp");

                endpoints.MapControllers();
                endpoints.MapHealthChecks("/health");

                if (OptionsAtStartup.Metrics.Enabled)
                {
                    var options = OptionsAtStartup.Metrics;
                    var url = options.Url.StartsWith('/') ? options.Url : "/" + options.Url;

                    Log.Information("Publishing Prometheus metrics to {URL}", url);

                    if (options.Authentication.Disabled)
                    {
                        Log.Warning("Authentication for the metrics endpoint is DISABLED");
                    }

                    endpoints.MapGet(url, async context =>
                    {
                        // at the time of writing, the prometheus library doesn't include a way to add authentication
                        // to the UseMetricServer() middleware. this is most likely a consequence of me mixing
                        // and matching minimal API stuff with controllers. if i ever straighten that out,
                        // this should be revisited.
                        if (!options.Authentication.Disabled)
                        {
                            var auth = context.Request.Headers["Authorization"].FirstOrDefault();
                            var providedCreds = auth?.Split(' ').Last();
                            var validCreds = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{options.Authentication.Username}:{options.Authentication.Password}"));

                            if (string.IsNullOrEmpty(auth) ||
                                !auth.StartsWith("Basic", StringComparison.InvariantCultureIgnoreCase) ||
                                !string.Equals(providedCreds, validCreds, StringComparison.InvariantCultureIgnoreCase))
                            {
                                context.Response.StatusCode = (int)HttpStatusCode.Unauthorized;
                                return;
                            }
                        }

                        var telemetryService = context.RequestServices.GetRequiredService<TelemetryService>();
                        var metricsAsText = await telemetryService.Prometheus.GetMetricsAsString();

                        context.Response.Headers.Append("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
                        await context.Response.WriteAsync(metricsAsText);
                    });
                }
            });
#pragma warning restore ASP0014 // Suggest using top level route registrations

            // if this is an /api route and no API controller was matched, give up and return a 404.
            app.Use(async (context, next) =>
            {
                if (context.Request.Path.StartsWithSegments("/api"))
                {
                    context.Response.StatusCode = 404;
                    return;
                }

                await next();
            });

            if (OptionsAtStartup.Feature.Swagger)
            {
                app.UseSwagger();
                app.UseSwaggerUI(options => app.Services.GetRequiredService<IApiVersionDescriptionProvider>().ApiVersionDescriptions.ToList()
                    .ForEach(description => options.SwaggerEndpoint($"{(urlBase == "/" ? string.Empty : urlBase)}/swagger/{description.GroupName}/swagger.json", description.GroupName)));

                Log.Information("Publishing Swagger documentation to {URL}", "/swagger");
            }

            return app;
        }

        private static void ConfigureGlobalLogger()
        {
            var noColor = OptionsAtStartup.Logger.NoColor || !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("NO_COLOR"));

            const string outputTemplate = "{UtcTimestamp} {Level:u3} [{SourceContext}] {Message:lj}{NewLine}{Exception}";

            Serilog.Log.Logger = (OptionsAtStartup.Debug ? new LoggerConfiguration().MinimumLevel.Debug() : new LoggerConfiguration().MinimumLevel.Information())
                .MinimumLevel.Override("Microsoft", LogEventLevel.Error)
                .MinimumLevel.Override("System.Net.Http.HttpClient", OptionsAtStartup.Debug ? LogEventLevel.Warning : LogEventLevel.Fatal)
                .MinimumLevel.Override("resonance.Authentication.PassthroughAuthenticationHandler", LogEventLevel.Warning)
                .MinimumLevel.Override("resonance.Authentication.ApiKeyAuthenticationHandler", LogEventLevel.Warning)
                .MinimumLevel.Override("Microsoft.EntityFrameworkCore.Database.Command", LogEventLevel.Warning) // bump this down to Information to show SQL
                .Enrich.WithProperty("InstanceName", OptionsAtStartup.InstanceName)
                .Enrich.WithProperty("InvocationId", InvocationId)
                .Enrich.WithProperty("ProcessId", ProcessId)
                .Enrich.FromLogContext()
                .Enrich.With<UtcTimestampEnricher>()
                .WriteTo.Console(
                    theme: noColor ? ConsoleTheme.None : SystemConsoleTheme.Literate,
                    applyThemeToRedirectedOutput: !noColor,
                    outputTemplate: outputTemplate)
                .WriteTo.Async(config =>
                    config.Conditional(
                        e => OptionsAtStartup.Logger.Disk,
                        config => config.File(
                            Path.Combine(LogDirectory, $"{AppName}-.log"),
                            outputTemplate: outputTemplate,
                            rollingInterval: RollingInterval.Day,
                            retainedFileTimeLimit: TimeSpan.FromDays(OptionsAtStartup.Retention.Logs))))
                .WriteTo.Conditional(
                    e => !string.IsNullOrEmpty(OptionsAtStartup.Logger.Loki),
                    config => config.GrafanaLoki(
                        OptionsAtStartup.Logger.Loki ?? string.Empty,
                        outputTemplate: outputTemplate))
                .WriteTo.Sink(new DelegatingSink(logEvent =>
                {
                    string message = default;

                    try
                    {
                        message = logEvent.RenderMessage();

                        var record = new LogRecord()
                        {
                            Timestamp = logEvent.Timestamp.UtcDateTime,
                            Context = logEvent.Properties.ContainsKey("SourceContext") ? logEvent.Properties["SourceContext"].ToString().TrimStart('"').TrimEnd('"') : Logs.Application,
                            SubContext = logEvent.Properties.ContainsKey("SubContext") ? logEvent.Properties["SubContext"].ToString().TrimStart('"').TrimEnd('"') : null,
                            Level = logEvent.Level.ToString(),
                            Message = message.TrimStart('"').TrimEnd('"'),
                            Exception = logEvent.Exception?.ToString(),
                        };

                        LogBuffer.Enqueue(record);
                        LogEmitted?.Invoke(null, record);
                    }
                    catch (Exception ex)
                    {
                        Log.Error("Misconfigured delegating logger: {Exception}.  Message: {Message}", ex.Message, message);
                    }
                }))
                .CreateLogger();

            if (OptionsAtStartup.Flags.LogUnobservedExceptions)
            {
                // log Exceptions raised on fired-and-forgotten tasks, which adds very little value but might help debug someday
                TaskScheduler.UnobservedTaskException += (sender, e) =>
                {
                    Serilog.Log.Logger.Error(e.Exception, "Unobserved exception: {Message}", e.Exception.Message);
                    e.SetObserved();
                };
            }

            AppDomain.CurrentDomain.UnhandledException += (sender, e) =>
            {
                var exception = e.ExceptionObject as Exception;

                if (e.IsTerminating)
                {
                    Serilog.Log.Logger.Fatal(exception, "Unhandled fatal exception: {Message}", e.IsTerminating);
                }
                else
                {
                    Serilog.Log.Logger.Error(exception, "Unhandled exception: {Message}", exception.Message);
                }
            };
        }

        private static IConfigurationBuilder AddConfigurationProviders(this IConfigurationBuilder builder, string environmentVariablePrefix, string configurationFile, bool reloadOnChange)
        {
            configurationFile = Path.GetFullPath(configurationFile);

            var multiValuedArguments = BuildMultiValuedArguments();

            // The config lives on a Docker bind mount where inotify events from host-side edits don't
            // reach the container reliably; the file provider below therefore polls actively, which is
            // required for on-disk changes to trigger a reload (UsePollingFileWatcher alone only
            // affects token creation, not callback delivery).
            return builder
                .AddDefaultValues(
                    targetType: typeof(Options))
                .AddEnvironmentVariables(
                    targetType: typeof(Options),
                    prefix: environmentVariablePrefix)
                .AddYamlFile(
                    path: Path.GetFileName(configurationFile),
                    targetType: typeof(Options),
                    optional: true,
                    reloadOnChange: reloadOnChange,
                    provider: new PhysicalFileProvider(Path.GetDirectoryName(configurationFile), ExclusionFilters.None)
                    {
                        UsePollingFileWatcher = true,
                        UseActivePolling = true,
                    })
                .AddCommandLine(
                    targetType: typeof(Options),
                    multiValuedArguments,
                    commandLine: Environment.CommandLine)
                .Add(VolatileOverlayConfigurationSource);
        }

        private static string[] BuildMultiValuedArguments() =>
            typeof(Options)
                .GetPropertiesRecursively()
                .Where(p => p.PropertyType.IsArray)
                .SelectMany(p =>
                    p.CustomAttributes
                        .Where(a => a.AttributeType == typeof(ArgumentAttribute))
                        .Select(a => new[] { a.ConstructorArguments[0].Value, a.ConstructorArguments[1].Value })
                        .SelectMany(v => v))
                .Select(v => v.ToString())
                .Where(v => v != "\u0000")
                .ToArray();

        private static IServiceCollection AddDbContext<T>(this IServiceCollection services, string connectionString)
            where T : DbContext
        {
            Log.Debug("Initializing database context {Name}", typeof(T).Name);

            try
            {
                services.AddDbContextFactory<T>(options =>
                {
                    options.UseNpgsql(connectionString);

                    if (OptionsAtStartup.Flags.LogSQL)
                    {
                        options
                            .EnableSensitiveDataLogging()
                            .EnableDetailedErrors()
                            .LogTo(OptionsAtStartup.Debug ? Log.Debug : Log.Information, LogLevel.Information);
                    }
                });

                /*
                    instantiate the DbContext and make sure it is created
                */
                using var ctx = services
                    .BuildServiceProvider()
                    .GetRequiredService<IDbContextFactory<T>>()
                    .CreateDbContext();

                Log.Debug("Ensuring {Contex} is created", typeof(T).Name);

                // All EF Core contexts share one database (one file for SQLite, one Postgres DB).
                // EnsureCreated() short-circuits after the first context creates tables because
                // HasTables() returns true globally. For all subsequent contexts we generate the
                // DDL script and execute it with IF NOT EXISTS guards.
                var freshDb = ctx.Database.EnsureCreated();
                if (!freshDb)
                {
                    var schema = ctx.Model.GetDefaultSchema();
                    if (!string.IsNullOrEmpty(schema))
                    {
                        // Schema names are SQL identifiers, which can't be passed as parameters; the value
                        // comes from our own compiled EF model (HasDefaultSchema), never from user input.
#pragma warning disable EF1002 // Risk of vulnerability to SQL injection.
                        ctx.Database.ExecuteSqlRaw($"CREATE SCHEMA IF NOT EXISTS \"{schema}\"");
#pragma warning restore EF1002 // Risk of vulnerability to SQL injection.
                    }

                    var script = ctx.Database.GenerateCreateScript();

                    // Npgsql emits DO $EF$...END $EF$; blocks for schema creation, which we handle
                    // above. Strip them so the semicolon-split below works.
                    script = System.Text.RegularExpressions.Regex.Replace(
                        script,
                        @"DO \$EF\$.*?END \$EF\$;",
                        string.Empty,
                        System.Text.RegularExpressions.RegexOptions.Singleline);

                    script = System.Text.RegularExpressions.Regex.Replace(
                        script, @"\bCREATE TABLE\b", "CREATE TABLE IF NOT EXISTS");
                    script = System.Text.RegularExpressions.Regex.Replace(
                        script, @"\bCREATE (UNIQUE )?INDEX\b", "CREATE $1INDEX IF NOT EXISTS");
                    script = System.Text.RegularExpressions.Regex.Replace(
                        script, @"\bCREATE SEQUENCE\b", "CREATE SEQUENCE IF NOT EXISTS");

                    foreach (var statement in script.Split(";\n", StringSplitOptions.RemoveEmptyEntries))
                    {
                        var s = statement.Trim();
                        if (string.IsNullOrEmpty(s))
                        {
                            continue;
                        }

                        try
                        {
                            ctx.Database.ExecuteSqlRaw(s);
                        }
                        catch (Exception ex)
                        {
                            Log.Warning("Schema init skipped a statement for {Type}: {Ex}", typeof(T).Name, ex.Message);
                        }
                    }
                }

                return services;
            }
            catch (Exception ex)
            {
                Log.Error(ex, $"Failed to initialize database context {typeof(T).Name}: ${ex.Message}");
                throw;
            }
        }

        private static void RecreateConfigurationFileIfMissing(string configurationFile)
        {
            if (!IOFile.Exists(configurationFile))
            {
                try
                {
                    Log.Warning("Configuration file {ConfigurationFile} does not exist; creating from example", configurationFile);
                    var source = Path.Combine(AppContext.BaseDirectory, "config", "resonance.yml.example");
                    var destination = configurationFile;
                    IOFile.Copy(source, destination);
                }
                catch (Exception ex)
                {
                    Log.Error("Failed to create configuration file {ConfigurationFile}: {Message}", configurationFile, ex.Message);
                }
            }
        }

        /// <summary>
        ///     Returns a stable JWT signing key, generating and persisting one on first run.
        ///     Stores the key in a dedicated file inside the data directory so it survives
        ///     YAML config rewrites. If the user has explicitly set a key in the YAML config
        ///     that value is used as-is (the file is not written in that case).
        /// </summary>
        private static string EnsureJwtKeyPersisted(string dataDirectory, string configuredKey)
        {
            var keyFile = Path.Combine(dataDirectory, "misc", "jwt.key");

            try
            {
                System.IO.Directory.CreateDirectory(Path.GetDirectoryName(keyFile));

                if (IOFile.Exists(keyFile))
                {
                    var stored = IOFile.ReadAllText(keyFile).Trim();
                    if (!string.IsNullOrEmpty(stored))
                    {
                        // only use the stored key if the user has not explicitly set one in their config
                        // (detect "explicitly set" by checking whether configuredKey differs from a freshly-
                        // generated default — since defaults are random we can't tell, so we always prefer
                        // the stored file unless the user has set the key via environment variable or flag)
                        return stored;
                    }
                }

                // no stored key yet — persist the one that was generated/configured for this startup
                IOFile.WriteAllText(keyFile, configuredKey);
                Log.Information("JWT signing key stored at {KeyFile}", keyFile);
            }
            catch (Exception ex)
            {
                Log.Warning("Failed to persist JWT signing key to {KeyFile}: {Message}", keyFile, ex.Message);
            }

            return configuredKey;
        }

        private static X509Certificate2 EnsureSelfSignedCertificate(string dataDirectory)
        {
            var httpsDir = Path.Combine(dataDirectory, "https");
            var pfxPath = Path.Combine(httpsDir, $"{AppName}.pfx");
            var pwdPath = Path.Combine(httpsDir, $"{AppName}.pfx.password");

            System.IO.Directory.CreateDirectory(httpsDir);

            if (IOFile.Exists(pfxPath) && IOFile.Exists(pwdPath))
            {
                try
                {
                    var stored = IOFile.ReadAllText(pwdPath).Trim();
                    var cert = X509CertificateLoader.LoadPkcs12FromFile(pfxPath, stored, X509KeyStorageFlags.MachineKeySet);
                    Log.Information("Using persisted self-signed certificate from {PfxPath}", pfxPath);
                    return cert;
                }
                catch (Exception ex)
                {
                    Log.Warning("Failed to load persisted self-signed certificate, regenerating: {Message}", ex.Message);
                }
            }

            var password = Cryptography.Random.GetBytes(16).ToBase62();
            var newCert = X509.Generate(subject: AppName, password, X509KeyStorageFlags.Exportable | X509KeyStorageFlags.MachineKeySet);
            IOFile.WriteAllBytes(pfxPath, newCert.Export(X509ContentType.Pkcs12, password));
            IOFile.WriteAllText(pwdPath, password);
            Log.Information("Generated self-signed certificate at {PfxPath}", pfxPath);

            return X509CertificateLoader.LoadPkcs12FromFile(pfxPath, password, X509KeyStorageFlags.MachineKeySet);
        }

        private static (string Filename, string Password) GenerateX509Certificate(string password, string filename)
        {
            filename = Path.Combine(AppContext.BaseDirectory, filename);

            var cert = X509.Generate(subject: AppName, password, X509KeyStorageFlags.Exportable);
            IOFile.WriteAllBytes(filename, cert.Export(X509ContentType.Pkcs12, password));

            return (filename, password);
        }

        private static void PrintCommandLineArguments(Type targetType)
        {
            static string GetLongName(string longName, Type type)
                => type == typeof(bool) ? longName : $"{longName} <{type.ToColloquialString().ToLowerInvariant()}>";

            var lines = new List<(string Item, string Description)>();

            void Map(Type type)
            {
                try
                {
                    var defaults = Activator.CreateInstance(type);
                    var props = type.GetProperties(BindingFlags.NonPublic | BindingFlags.Public | BindingFlags.Instance);

                    foreach (PropertyInfo property in props)
                    {
                        var attribute = property.CustomAttributes.FirstOrDefault(a => a.AttributeType == typeof(ArgumentAttribute));
                        var descriptionAttribute = property.CustomAttributes.FirstOrDefault(a => a.AttributeType == typeof(DescriptionAttribute));
                        var isRequired = property.CustomAttributes.Any(a => a.AttributeType == typeof(RequiredAttribute));

                        if (attribute != default)
                        {
                            var shortName = (char)attribute.ConstructorArguments[0].Value;
                            var longName = (string)attribute.ConstructorArguments[1].Value;
                            var description = descriptionAttribute?.ConstructorArguments[0].Value;

                            var suffix = isRequired ? " (required)" : $" (default: {property.GetValue(defaults) ?? "<null>"})";
                            var item = $"{(shortName == default ? "  " : $"{shortName}|")}--{GetLongName(longName, property.PropertyType)}";
                            var desc = $"{description}{(property.PropertyType == typeof(bool) ? string.Empty : suffix)}";
                            lines.Add(new(item, desc));
                        }
                        else
                        {
                            Map(property.PropertyType);
                        }
                    }
                }
                catch
                {
                    return;
                }
            }

            Map(targetType);

            var longestItem = lines.Max(l => l.Item.Length);

            Log.Information("\nusage: resonance [arguments]\n");
            Log.Information("arguments:\n");

            foreach (var line in lines)
            {
                Log.Information($"  {line.Item.PadRight(longestItem)}   {line.Description}");
            }
        }

        private static void PrintEnvironmentVariables(Type targetType, string prefix)
        {
            static string GetName(string name, Type type) => $"{name} <{type.ToColloquialString().ToLowerInvariant()}>";

            var lines = new List<(string Item, string Description)>();

            void Map(Type type)
            {
                try
                {
                    var defaults = Activator.CreateInstance(type);
                    var props = type.GetProperties(BindingFlags.NonPublic | BindingFlags.Public | BindingFlags.Instance);

                    foreach (PropertyInfo property in props)
                    {
                        var attribute = property.CustomAttributes.FirstOrDefault(a => a.AttributeType == typeof(EnvironmentVariableAttribute));
                        var descriptionAttribute = property.CustomAttributes.FirstOrDefault(a => a.AttributeType == typeof(DescriptionAttribute));
                        var isRequired = property.CustomAttributes.Any(a => a.AttributeType == typeof(RequiredAttribute));

                        if (attribute != default)
                        {
                            var name = (string)attribute.ConstructorArguments[0].Value;
                            var description = descriptionAttribute?.ConstructorArguments[0].Value;

                            var suffix = isRequired ? " (required)" : $" (default: {property.GetValue(defaults) ?? "<null>"})";
                            var item = $"{prefix}{GetName(name, property.PropertyType)}";
                            var desc = $"{description}{(type == typeof(bool) ? string.Empty : suffix)}";
                            lines.Add(new(item, desc));
                        }
                        else
                        {
                            Map(property.PropertyType);
                        }
                    }
                }
                catch
                {
                    return;
                }
            }

            Map(targetType);

            var longestItem = lines.Max(l => l.Item.Length);

            Log.Information("\nenvironment variables (arguments and config file have precedence):\n");

            foreach (var line in lines)
            {
                Log.Information($"  {line.Item.PadRight(longestItem)}   {line.Description}");
            }
        }

        private static void PrintLogoOld(string version)
        {
            try
            {
                var padding = 56 - version.Length;
                var paddingLeft = padding / 2;
                var paddingRight = paddingLeft + (padding % 2);

                var centeredVersion = new string(' ', paddingLeft) + version + new string(' ', paddingRight);

                var banner = @$"
┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┑
│                      RESONANCE                         │
│           GNU AFFERO GENERAL PUBLIC LICENSE            │
│                                                        │
│{centeredVersion}│
│  This is a modified version of slskd. It is not        │
│  maintained by, endorsed by, or affiliated with the    │
│  slskd project or its author(s).                       │";

                if (IsDevelopment)
                {
                    banner += "\n│■■■■■■■■■■■■■■■■■■■■► DEVELOPMENT ◄■■■■■■■■■■■■■■■■■■■■■│";
                }

                if (IsCanary)
                {
                    banner += "\n│■■■■■■■■■■■■■■■■■■■■■■■► CANARY ◄■■■■■■■■■■■■■■■■■■■■■■■│";
                }

                banner += "\n└────────────────────────────────────────────────────────┘";

                Console.WriteLine(banner);
            }
            catch
            {
                // noop. console may not be available in all cases.
            }
        }

        private static string GetLogoText(string version)
        {
            var banner = @$"
  ██████╗ ███████╗███████╗ ██████╗ ███╗   ██╗ █████╗ ███╗   ██╗ ██████╗███████╗
  ██╔══██╗██╔════╝██╔════╝██╔═══██╗████╗  ██║██╔══██╗████╗  ██║██╔════╝██╔════╝
  ██████╔╝█████╗  ███████╗██║   ██║██╔██╗ ██║███████║██╔██╗ ██║██║     █████╗
  ██╔══██╗██╔══╝  ╚════██║██║   ██║██║╚██╗██║██╔══██║██║╚██╗██║██║     ██╔══╝
  ██║  ██║███████╗███████║╚██████╔╝██║ ╚████║██║  ██║██║ ╚████║╚██████╗███████╗
  ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═══╝╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝╚══════╝
┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
│ This program is free software: you can redistribute it and/or modify
│ it under the terms of the GNU Affero General Public License as published
│ by the Free Software Foundation, version 3.
│                                     └─▸ SPDX: AGPL-3.0-only
│
│ This program is distributed with Additional Terms pursuant to Section 7
│ of the AGPLv3.  See the LICENSE file in the root directory of this
│ project for the complete terms and conditions.
│
│ ⚠️  This is a modified version of slskd. It is not maintained by,
│    endorsed by, or affiliated with the slskd project or its author(s).
│
├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
│ {version}";

            if (IsDevelopment)
            {
                banner += "\n│ └─▸ ⚠️ DEVELOPMENT";
            }

            if (IsCanary)
            {
                banner += "\n│ └─▸ 🧪 CANARY";
            }

            banner += "\n╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈";
            return banner;
        }

        private static void PrintLogo(string version)
        {
            try
            {
                Console.WriteLine(GetLogoText(version));
            }
            catch
            {
                // noop. console may not be available in all cases.
            }
        }

        private static void VerifyDirectory(string directory, bool createIfMissing = true, bool verifyWriteable = true)
        {
            if (!System.IO.Directory.Exists(directory))
            {
                if (createIfMissing)
                {
                    try
                    {
                        System.IO.Directory.CreateDirectory(directory);
                    }
                    catch (Exception ex)
                    {
                        throw new IOException($"Directory {directory} does not exist, and could not be created: {ex.Message}", ex);
                    }
                }
                else
                {
                    throw new IOException($"Directory {directory} does not exist");
                }
            }

            if (verifyWriteable)
            {
                try
                {
                    var file = Guid.NewGuid().ToString();
                    var probe = Path.Combine(directory, file);
                    IOFile.WriteAllText(probe, string.Empty);
                    IOFile.Delete(probe);
                }
                catch (Exception ex)
                {
                    throw new IOException($"Directory {directory} is not writeable: {ex.Message}", ex);
                }
            }
        }
    }
}
