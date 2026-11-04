namespace Resonance.Tests.Security;

using System.ComponentModel.DataAnnotations;
using System.Net;
using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using global::resonance;
using Options = global::resonance.Options;
using global::resonance.Authentication;
using global::resonance.Core.API;
using global::resonance.Dlna;
using global::resonance.Files;

public sealed class RemainingSecurityTests
{
    [Fact]
    public async Task FileManagementRejectsSiblingPrefixesSymlinksAndRootDeletion()
    {
        var temporary = Directory.CreateTempSubdirectory("resonance-file-boundary-").FullName;
        try
        {
            var root = Directory.CreateDirectory(Path.Combine(temporary, "downloads")).FullName;
            var outside = Directory.CreateDirectory(Path.Combine(temporary, "downloads-private")).FullName;
            var allowed = Directory.CreateDirectory(Path.Combine(root, "album")).FullName;
            var privateFile = Path.Combine(outside, "private.txt");
            File.WriteAllText(privateFile, "synthetic private data");
            Directory.CreateSymbolicLink(Path.Combine(root, "escape"), outside);
            var options = new Options { Directories = new() { Downloads = root, Incomplete = Path.Combine(temporary, "unavailable") } };
            var files = new FileService(new Monitor(options));

            await files.ListContentsAsync(root, new EnumerationOptions());
            await files.ListContentsAsync(allowed, new EnumerationOptions());
            await Assert.ThrowsAsync<UnauthorizedException>(() => files.ListContentsAsync(outside));
            await Assert.ThrowsAsync<UnauthorizedException>(() => files.ListContentsAsync(Path.Combine(root, "escape")));
            await Assert.ThrowsAsync<UnauthorizedException>(() => files.DeleteFilesAsync(privateFile));
            await Assert.ThrowsAsync<UnauthorizedException>(() => files.DeleteFilesAsync(Path.Combine(root, "escape", "private.txt")));
            await Assert.ThrowsAsync<ArgumentException>(() => files.DeleteDirectoriesAsync(root));
            Assert.True(File.Exists(privateFile));

            var nestedRoot = Directory.CreateDirectory(Path.Combine(root, "incomplete")).FullName;
            var overlapping = new FileService(new Monitor(new Options { Directories = new() { Downloads = root, Incomplete = nestedRoot } }));
            await Assert.ThrowsAsync<UnauthorizedException>(() => overlapping.DeleteDirectoriesAsync(nestedRoot + Path.DirectorySeparatorChar));
            Assert.True(Directory.Exists(nestedRoot));

            var absent = Path.Combine(root, "absent.mp3");
            Assert.True((await files.DeleteFilesAsync(absent))[absent].AsT0);
            await Assert.ThrowsAsync<NotFoundException>(() => files.ListContentsAsync(Path.Combine(root, "missing-directory"), new EnumerationOptions()));
            Assert.NotNull(FileService.ResolveManagedPath([root], absent, allowRoot: false));

            var track = Path.Combine(allowed, "track.mp3");
            File.WriteAllText(track, "synthetic audio");
            Assert.True((await files.DeleteFilesAsync(track))[track].AsT0);
            Assert.True((await files.DeleteDirectoriesAsync(allowed))[allowed].AsT0);
        }
        finally
        {
            Directory.Delete(temporary, true);
        }
    }

    [Fact]
    public void IntegrationCredentialsAreRedactedIncludingHeaderAndScriptValues()
    {
        var metadata = new Options.MetadataLookupOptions
        {
            Discogs = new() { Token = "synthetic-discogs-token" },
            Lastfm = new() { ApiKey = "synthetic-lastfm-key" },
        };
        var integrations = new Options.IntegrationsOptions
        {
            Webhooks = new() { ["test"] = new() { Call = new() { Url = "https://example.invalid/synthetic-token", Headers = [new() { Name = "Authorization", Value = "synthetic-header" }] } } },
            Scripts = new() { ["test"] = new() { Run = new() { Command = "synthetic-command", Args = "synthetic-args", Arglist = ["synthetic-arglist"] } } },
        };

        Redactor.Redact(metadata);
        Redactor.Redact(integrations);

        Assert.Equal("*****", metadata.Discogs.Token);
        Assert.Equal("*****", metadata.Lastfm.ApiKey);
        Assert.Equal("*****", integrations.Webhooks["test"].Call.Url);
        Assert.Equal("*****", integrations.Webhooks["test"].Call.Headers[0].Value);
        Assert.Equal("Authorization", integrations.Webhooks["test"].Call.Headers[0].Name);
        Assert.Equal("*****", integrations.Scripts["test"].Run.Command);
        Assert.Equal("*****", integrations.Scripts["test"].Run.Args);
        Assert.Equal(new[] { "*****" }, integrations.Scripts["test"].Run.Arglist);
    }

    [Theory]
    [InlineData("")]
    [InlineData("resonance")]
    public void AuthenticatedMetricsRequireAnExplicitNondefaultPassword(string password)
    {
        var options = new Options { Metrics = new() { Enabled = true, Authentication = new() { Password = password } } };
        Assert.Contains(options.Validate(new ValidationContext(options)), result => result.ErrorMessage!.Contains("metrics"));
        var configured = new Options { Metrics = new() { Enabled = true, Authentication = new() { Password = "synthetic-nondefault" } } };
        Assert.DoesNotContain(configured.Validate(new ValidationContext(configured)), result => result.ErrorMessage!.Contains("metrics"));
    }

    [Theory]
    [InlineData("<http://192.168.1.30:8000/events>", true)]
    [InlineData("<https://192.168.1.30:8443/events>", true)]
    [InlineData("<http://127.0.0.1:8000/events>", false)]
    [InlineData("<http://192.168.1.31:8000/events>", false)]
    [InlineData("<http://user:password@192.168.1.30/events>", false)]
    [InlineData("<file:///private>", false)]
    [InlineData("invalid", false)]
    public void DlnaCallbackLiteralsMustMatchTheSubscribingPeer(string header, bool allowed)
    {
        Assert.Equal(allowed, DlnaService.ParseCallbackUrl(header, IPAddress.Parse("192.168.1.30")) != null);
        Assert.Null(DlnaService.ParseCallbackUrl(header, IPAddress.Loopback));
    }

    [Fact]
    public async Task ParallelSetupCreatesOneAdministratorAcrossServiceInstances()
    {
        var directory = Directory.CreateTempSubdirectory("resonance-setup-").FullName;
        try
        {
            var factory = new Factory(new DbContextOptionsBuilder<UsersDbContext>().UseSqlite($"Data Source={Path.Combine(directory, "users.db")};Pooling=False").Options);
            var first = new AppUserService(factory);
            var second = new AppUserService(factory);
            var results = await Task.WhenAll(
                Task.Run(() => first.TryCreateInitialAdministrator("one", "synthetic-password")),
                Task.Run(() => second.TryCreateInitialAdministrator("two", "synthetic-password")));
            Assert.Single(results, result => result != null);
            using var db = factory.CreateDbContext();
            Assert.Single(db.Users);
            Assert.Equal(Role.Administrator, db.Users.Single().Role);
            Assert.Null(first.TryCreateInitialAdministrator("three", "synthetic-password"));
        }
        finally
        {
            Directory.Delete(directory, true);
        }
    }

    [Fact]
    public async Task RevokingAnotherUsersSessionDoesNotBroadcastOrChangeIt()
    {
        var directory = Directory.CreateTempSubdirectory("resonance-session-").FullName;
        try
        {
            var factory = new Factory(new DbContextOptionsBuilder<UsersDbContext>().UseSqlite($"Data Source={Path.Combine(directory, "users.db")};Pooling=False").Options);
            var users = new AppUserService(factory);
            using var sessions = new SessionService(factory, new OptionsAtStartup());
            var (_, id) = sessions.CreateSession("victim", "test", null!, "127.0.0.1", null);
            var broadcasts = 0;
            var client = Stub<IClientProxy>((_, _) => { broadcasts++; return Task.CompletedTask; });
            var clients = Stub<IHubClients>((_, _) => client);
            var hub = Stub<IHubContext<ApplicationHub>>((_, _) => clients);
            var controller = new SessionController(null!, users, sessions, null!, null!, null!, hub)
            {
                ControllerContext = new() { HttpContext = new DefaultHttpContext() },
            };
            controller.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Name, "attacker")], "test"));

            await controller.RevokeSession(id);
            Assert.Equal(0, broadcasts);
            Assert.Single(sessions.GetActiveSessions("victim"));
            controller.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Name, "victim")], "test"));
            await controller.RevokeSession(id);
            Assert.Equal(1, broadcasts);
            Assert.Empty(sessions.GetActiveSessions("victim"));
        }
        finally
        {
            Directory.Delete(directory, true);
        }
    }

    private sealed class Factory(DbContextOptions<UsersDbContext> options) : IDbContextFactory<UsersDbContext>
    {
        public UsersDbContext CreateDbContext() => new(options);
    }

    private sealed class Monitor(Options value) : IOptionsMonitor<Options>
    {
        public Options CurrentValue => value;
        public Options Get(string? name) => value;
        public IDisposable? OnChange(Action<Options, string?> listener) => null;
    }

    private static T Stub<T>(Func<MethodInfo, object?[]?, object?> callback) where T : class
    {
        var proxy = DispatchProxy.Create<T, InterfaceProxy>();
        ((InterfaceProxy)(object)proxy).Callback = callback;
        return proxy;
    }

    public class InterfaceProxy : DispatchProxy
    {
        public Func<MethodInfo, object?[]?, object?> Callback { get; set; } = null!;
        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args) => Callback(targetMethod!, args);
    }
}
