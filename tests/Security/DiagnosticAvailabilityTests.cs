namespace Resonance.Tests.Security;

using System.Net;
using System.Reflection;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using resonance;
using resonance.Core.API;
using resonance.Messaging.API;
using resonance.Transfers;
using resonance.Users.API;
using Soulseek;

public class DiagnosticAvailabilityTests
{
    [Fact]
    public async Task DisconnectedUserStatusDoesNotCallTheNetwork()
    {
        var client = DispatchProxy.Create<ISoulseekClient, OfflineClient>();
        var users = DispatchProxy.Create<resonance.Users.IUserService, UserStub>();
        var controller = new UsersController(client, null!, users, null!);
        var result = Assert.IsType<ObjectResult>(await controller.Status("peer"));
        Assert.Equal(503, result.StatusCode);
        Assert.Contains("SOULSEEK_UNAVAILABLE", JsonSerializer.Serialize(result.Value));
    }

    [Fact]
    public async Task DisconnectedRoomListDoesNotCallTheNetwork()
    {
        var client = DispatchProxy.Create<ISoulseekClient, OfflineClient>();
        var controller = new RoomsController(client, null!, null!, null!, null!, null!);
        var result = Assert.IsType<ObjectResult>(await controller.GetRooms());
        Assert.Equal(503, result.StatusCode);
    }

    [Theory]
    [InlineData(false, 504, "PORT_CHECK_TIMEOUT")]
    [InlineData(true, 502, "PORT_CHECK_UNAVAILABLE")]
    public async Task PortCheckReportsUnknownRatherThanClosed(bool networkFailure, int code, string errorCode)
    {
        var controller = CreatePortController(new FailureHandler(networkFailure));
        var result = Assert.IsType<ObjectResult>(await controller.CheckPort(CancellationToken.None));
        Assert.Equal(code, result.StatusCode);
        var json = JsonSerializer.Serialize(result.Value);
        Assert.Contains(errorCode, json);
        Assert.DoesNotContain("private", json);
    }

    [Fact]
    public async Task PortCheckPreservesCallerCancellation()
    {
        using var cancel = new CancellationTokenSource();
        cancel.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => CreatePortController(new FailureHandler(false)).CheckPort(cancel.Token));
    }

    private static ServerController CreatePortController(HttpMessageHandler handler)
    {
        var options = DispatchProxy.Create<IOptionsSnapshot<resonance.Options>, OptionsStub>();
        return new ServerController(null!, null!, options, null!, null!, new HttpFactory(handler));
    }

    public class OfflineClient : DispatchProxy
    {
        protected override object? Invoke(MethodInfo? method, object?[]? args) => method?.Name == "get_State"
            ? SoulseekClientStates.Disconnected
            : throw new InvalidOperationException("Unexpected network call");
    }

    public class UserStub : DispatchProxy
    {
        protected override object? Invoke(MethodInfo? method, object?[]? args) => method?.Name == "IsBlacklisted"
            ? false : throw new InvalidOperationException("Unexpected user lookup");
    }

    public class OptionsStub : DispatchProxy
    {
        protected override object? Invoke(MethodInfo? method, object?[]? args) => new resonance.Options();
    }

    private sealed class HttpFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }

    private sealed class FailureHandler(bool networkFailure) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
            => networkFailure ? Task.FromException<HttpResponseMessage>(new HttpRequestException("private upstream details"))
                : Task.FromException<HttpResponseMessage>(new TaskCanceledException("private timeout"));
    }
}

public class TransferRecoveryTests
{
    [Fact]
    public async Task BusyWritesRetryWithFreshAttempts()
    {
        var calls = 0;
        await TransferRecovery.RetryBusyWriteAsync(() =>
        {
            if (++calls < 3) throw new DbUpdateException("busy", new SqliteException("busy", 5));
        }, CancellationToken.None);
        Assert.Equal(3, calls);
    }

    [Fact]
    public async Task ARealSqliteWriterLockIsRetriedAfterItsOwnerCommits()
    {
        var path = Path.Combine(Path.GetTempPath(), $"recovery-{Guid.NewGuid():N}.db");
        try
        {
            using var owner = new SqliteConnection($"Data Source={path};Pooling=False;Default Timeout=1");
            owner.Open();
            using (var schema = owner.CreateCommand())
            {
                schema.CommandText = "CREATE TABLE recovery (id INTEGER PRIMARY KEY, state TEXT); INSERT INTO recovery VALUES (1, 'interrupted');";
                schema.ExecuteNonQuery();
            }
            using var held = owner.BeginTransaction();
            using (var command = owner.CreateCommand())
            {
                command.Transaction = held;
                command.CommandText = "UPDATE recovery SET state='held' WHERE id=1";
                command.ExecuteNonQuery();
            }
            var firstBusy = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            var release = Task.Run(async () => { await firstBusy.Task; await Task.Delay(350); held.Commit(); });
            var attempts = 0;
            await TransferRecovery.RetryBusyWriteAsync(() =>
            {
                attempts++;
                using var writer = new SqliteConnection($"Data Source={path};Pooling=False;Default Timeout=1");
                writer.Open();
                using var command = writer.CreateCommand();
                command.CommandText = "UPDATE recovery SET state='recovered' WHERE id=1";
                try { command.ExecuteNonQuery(); }
                catch (SqliteException ex) when (ex.SqliteErrorCode == 5) { firstBusy.TrySetResult(true); throw; }
            }, CancellationToken.None);
            await release;
            Assert.InRange(attempts, 2, 4);
            using var check = owner.CreateCommand();
            check.CommandText = "SELECT state FROM recovery WHERE id=1";
            Assert.Equal("recovered", check.ExecuteScalar());
        }
        finally { System.IO.File.Delete(path); }
    }

    [Fact]
    public async Task PermanentErrorsAreNotRetried()
    {
        var calls = 0;
        await Assert.ThrowsAsync<SqliteException>(() => TransferRecovery.RetryBusyWriteAsync(() =>
        {
            calls++;
            throw new SqliteException("disk failure", 10);
        }, CancellationToken.None));
        Assert.Equal(1, calls);
    }

    [Fact]
    public async Task PersistentContentionHasABoundedRetryCount()
    {
        var calls = 0;
        await Assert.ThrowsAsync<SqliteException>(() => TransferRecovery.RetryBusyWriteAsync(() =>
        {
            calls++;
            throw new SqliteException("busy", 5);
        }, CancellationToken.None));
        Assert.Equal(4, calls);
    }

    [Fact]
    public async Task ShutdownStopsRetrying()
    {
        using var cancel = new CancellationTokenSource();
        var calls = 0;
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => TransferRecovery.RetryBusyWriteAsync(() =>
        {
            calls++;
            cancel.Cancel();
            throw new SqliteException("busy", 5);
        }, cancel.Token));
        Assert.Equal(1, calls);
    }
}
