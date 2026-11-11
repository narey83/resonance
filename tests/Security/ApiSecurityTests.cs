namespace Resonance.Tests.Security;

using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using global::resonance;
using global::resonance.Authentication;
using global::resonance.Common;
using global::resonance.Core.API;
using global::resonance.Core.Http;
using global::resonance.Mixtapes.API;

public class ApiSecurityTests
{
    [Fact]
    public async Task Capture_Redacts_Query_Header_And_Referrer_Credentials()
    {
        var context = new DefaultHttpContext();
        context.Request.Path = "/hub/application";
        context.Request.QueryString = new QueryString("?access_token=synthetic-jwt&sig=synthetic-signature&path=music");
        context.Request.Headers.Authorization = "Bearer synthetic-header";
        context.Request.Headers["X-Resonance-Link-Token"] = "synthetic-helper";
        context.Request.Headers.Referer = "https://example.test/?access%5Ftoken=synthetic-referrer";
        await new RequestCaptureMiddleware(_ => Task.CompletedTask).InvokeAsync(context);
        var entry = global::resonance.Program.HttpCaptureBuffer.Last(e => e.Url.Contains("path=music"));
        Assert.DoesNotContain("synthetic", entry.FullUrl);
        Assert.All(entry.RequestHeaders, h => Assert.DoesNotContain("synthetic", h.Value));
        Assert.Contains("path=music", entry.Url);
    }

    [Fact]
    public void Library_Containment_Rejects_Traversal_And_Parent_Symlinks_But_Allows_Configured_Link_Roots()
    {
        var temporary = Path.Combine(Path.GetTempPath(), "resonance-security-" + Guid.NewGuid());
        var root = Path.Combine(temporary, "library");
        var outside = Path.Combine(temporary, "outside");
        Directory.CreateDirectory(root); Directory.CreateDirectory(outside);
        try
        {
            var valid = Path.Combine(root, "track.mp3"); File.WriteAllText(valid, "audio");
            var secret = Path.Combine(outside, "private.txt"); File.WriteAllText(secret, "synthetic");
            var link = Path.Combine(root, "linked"); Directory.CreateSymbolicLink(link, outside);
            Assert.True(LibraryPathSecurity.Contains(root, valid));
            Assert.False(LibraryPathSecurity.Contains(root, Path.Combine(link, "private.txt")));
            Assert.False(LibraryPathSecurity.Contains(root, Path.Combine(root, "..", "outside", "private.txt")));
            Assert.True(LibraryPathSecurity.Contains(link, Path.Combine(link, "private.txt")));
            if (!OperatingSystem.IsWindows() && !OperatingSystem.IsMacOS())
                Assert.False(LibraryPathSecurity.Contains(root, valid.Replace("library", "LIBRARY")));
        }
        finally { Directory.Delete(temporary, true); }
    }

    [Fact]
    public void Revocation_Survives_Service_Restart_And_Refresh_Grace_Cannot_Revive_It()
    {
        using var connection = new SqliteConnection("Data Source=:memory:"); connection.Open();
        var factory = new UserFactory(connection);
        using (var db = factory.CreateDbContext()) { db.Database.EnsureCreated(); db.Users.Add(new AppUser { Username = "test", PasswordHash = "unused", Role = Role.Administrator }); db.SaveChanges(); }
        using var first = new SessionService(factory, new OptionsAtStartup());
        var (token, id) = first.CreateSession("test");
        var (_, rotated, _) = first.RotateRefreshToken(token);
        Assert.False(first.IsJwtRevoked(id, "test", "Administrator"));
        Assert.Equal(id, first.RevokeByToken(token));
        Assert.Throws<RefreshTokenRejectedException>(() => first.RotateRefreshToken(token));
        using var restarted = new SessionService(factory, new OptionsAtStartup());
        Assert.True(restarted.IsJwtRevoked(id));
        Assert.True(restarted.IsJwtRevoked(Guid.NewGuid()));
        Assert.Throws<RefreshTokenRejectedException>(() => restarted.RotateRefreshToken(rotated));
    }

    [Fact]
    public void RejectedRefreshIdentifiesOnlySessionsThatTheServerCanMatch()
    {
        using var connection = new SqliteConnection("Data Source=:memory:"); connection.Open();
        var factory = new UserFactory(connection);
        using (var db = factory.CreateDbContext()) { db.Database.EnsureCreated(); }
        using var service = new SessionService(factory, new OptionsAtStartup());

        var unknown = Assert.Throws<RefreshTokenRejectedException>(() => service.RotateRefreshToken("unknown-token"));
        Assert.Equal("Invalid refresh token", unknown.Message);
        Assert.Null(unknown.Username);
        Assert.Null(unknown.SessionId);
        Assert.Null(unknown.DeviceName);

        var (token, sessionId) = service.CreateSession("alice", "Alice's tablet");
        Assert.Equal(sessionId, service.RevokeByToken(token));
        var revoked = Assert.Throws<RefreshTokenRejectedException>(() => service.RotateRefreshToken(token));
        Assert.Equal("alice", revoked.Username);
        Assert.Equal(sessionId, revoked.SessionId);
        Assert.Equal("Alice's tablet", revoked.DeviceName);
        Assert.DoesNotContain(token, revoked.Message);
    }

    [Fact]
    public void RefreshClientLogValueIsBoundedSingleLineAndRedacted()
    {
        var client = RefreshLogValues.Safe("Resonance\r\nBearer secret-token", 160);
        Assert.Equal("Resonance  Bearer [redacted]", client);
        Assert.Equal("unknown", RefreshLogValues.Safe("\r\n", 160));
        Assert.Equal(160, RefreshLogValues.Safe(new string('x', 300), 160).Length);
    }

    [Fact]
    public void UnknownRefreshWarningIsSummarisedWithoutBlockingAuthentication()
    {
        var aggregator = new RefreshWarningAggregator();
        var now = new DateTime(2026, 11, 11, 12, 0, 0, DateTimeKind.Utc);
        Assert.Equal((true, 0, false), aggregator.Record("192.0.2.1", now));
        Assert.Equal((false, 0, false), aggregator.Record("192.0.2.1", now.AddSeconds(2)));
        Assert.Equal((true, 0, false), aggregator.Record("192.0.2.2", now.AddSeconds(2)));
        Assert.Equal((true, 1, false), aggregator.Record("192.0.2.1", now.AddMinutes(1)));
    }

    [Fact]
    public void UnknownRefreshWarningCacheBoundsDistinctClientIps()
    {
        var aggregator = new RefreshWarningAggregator();
        var now = new DateTime(2026, 11, 11, 12, 0, 0, DateTimeKind.Utc);
        for (var i = 0; i < 4096; i++)
        {
            Assert.Equal((true, 0, false), aggregator.Record($"client-{i}", now));
        }

        Assert.Equal((true, 0, true), aggregator.Record("extra-client", now));
        Assert.Equal((false, 0, true), aggregator.Record("another-client", now.AddSeconds(2)));
        Assert.Equal((true, 1, true), aggregator.Record("third-client", now.AddMinutes(1)));
    }

    [Fact]
    public void Role_Changes_And_Deleted_Users_Invalidate_Existing_Jwt_Sessions()
    {
        using var connection = new SqliteConnection("Data Source=:memory:"); connection.Open();
        var factory = new UserFactory(connection);
        using (var db = factory.CreateDbContext()) { db.Database.EnsureCreated(); db.Users.Add(new AppUser { Username = "test", PasswordHash = "unused", Role = Role.Administrator }); db.SaveChanges(); }
        using var service = new SessionService(factory, new OptionsAtStartup());
        var (_, id) = service.CreateSession("test");
        using (var db = factory.CreateDbContext()) { db.Users.Single().Role = Role.ReadWrite; db.SaveChanges(); }
        Assert.True(service.IsJwtRevoked(id, "test", "Administrator"));
        Assert.False(service.IsJwtRevoked(id, "test", "ReadWrite"));
        using (var db = factory.CreateDbContext()) { db.Users.Remove(db.Users.Single()); db.SaveChanges(); }
        Assert.True(service.IsJwtRevoked(id));
    }

    [Theory]
    [InlineData(typeof(BridgeController), "Diagnostics", "ReadOnly", true, false)]
    [InlineData(typeof(BridgeController), "Diagnostics", "ReadWrite", true, false)]
    [InlineData(typeof(BridgeController), "Diagnostics", "Administrator", true, true)]
    [InlineData(typeof(BridgeController), "Connection", "ReadOnly", true, false)]
    [InlineData(typeof(BridgeController), "Connection", "ReadWrite", true, true)]
    [InlineData(typeof(BridgeController), "Connection", "ReadWrite", false, false)]
    [InlineData(typeof(BridgeController), "RevokeConnections", "ReadOnly", true, false)]
    [InlineData(typeof(BridgeController), "RevokeConnections", "ReadWrite", true, true)]
    [InlineData(typeof(BridgeController), "RevokeConnections", "ReadWrite", false, false)]
    [InlineData(typeof(BridgeController), "RevokeConnection", "ReadOnly", true, false)]
    [InlineData(typeof(BridgeController), "RevokeConnection", "ReadWrite", true, true)]
    [InlineData(typeof(BridgeController), "RevokeConnection", "ReadWrite", false, false)]
    [InlineData(typeof(HttpCaptureController), "GetHar", "ReadWrite", true, false)]
    [InlineData(typeof(HttpCaptureController), "GetHar", "Administrator", true, true)]
    [InlineData(typeof(MixtapesController), "Delete", "ReadOnly", true, false)]
    [InlineData(typeof(MixtapesController), "Delete", "ReadWrite", false, false)]
    [InlineData(typeof(MixtapesController), "Delete", "ReadWrite", true, true)]
    [InlineData(typeof(MixtapesController), "GetAll", "ReadOnly", true, true)]
    public async Task Real_Controller_Policies_Enforce_Feature_And_Write_Permissions(Type controller, string action, string role, bool library, bool expected)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddAuthorization(options =>
        {
            options.AddPolicy(AuthPolicy.Any, p => p.RequireAuthenticatedUser());
            options.AddPolicy(AuthPolicy.FeatureLibrary, p => p.RequireClaim("library", "true"));
        });
        using var provider = services.BuildServiceProvider();
        var attributes = controller.GetCustomAttributes<AuthorizeAttribute>().Concat(controller.GetMethod(action)!.GetCustomAttributes<AuthorizeAttribute>());
        var policy = await AuthorizationPolicy.CombineAsync(provider.GetRequiredService<IAuthorizationPolicyProvider>(), attributes);
        var claims = new List<Claim> { new(ClaimTypes.Name, "test"), new(ClaimTypes.Role, role) };
        if (library) claims.Add(new("library", "true"));
        var result = await provider.GetRequiredService<IAuthorizationService>().AuthorizeAsync(new ClaimsPrincipal(new ClaimsIdentity(claims, "test")), null, policy!);
        Assert.Equal(expected, result.Succeeded);
    }

    [Fact]
    public void Browser_Hub_Origins_Are_Explicit_And_Native_Clients_Do_Not_Need_An_Origin()
    {
        var context = new DefaultHttpContext();
        context.Request.Scheme = "https"; context.Request.Host = new HostString("music.test");
        Assert.True(BrowserOrigin.IsAllowed(context.Request, Array.Empty<string>()));
        context.Request.Headers.Origin = "https://music.test";
        Assert.True(BrowserOrigin.IsAllowed(context.Request, Array.Empty<string>()));
        context.Request.Headers.Origin = "https://evil.test";
        Assert.False(BrowserOrigin.IsAllowed(context.Request, Array.Empty<string>()));
        Assert.True(BrowserOrigin.IsAllowed(context.Request, new[] { "https://evil.test" }));
        context.Request.Headers.Origin = "null";
        Assert.False(BrowserOrigin.IsAllowed(context.Request, Array.Empty<string>()));
    }

    private sealed class UserFactory(SqliteConnection connection) : IDbContextFactory<UsersDbContext>
    {
        public UsersDbContext CreateDbContext() => new(new DbContextOptionsBuilder<UsersDbContext>().UseSqlite(connection).Options);
    }
}
