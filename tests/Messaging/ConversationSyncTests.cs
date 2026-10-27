namespace Resonance.Tests.Messaging;

using System.Reflection;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using global::resonance.Core.API;
using global::resonance.Events;
using global::resonance.Messaging;
using Soulseek;

public class ConversationSyncTests
{
    [Fact]
    public async Task Incoming_Replayed_Sent_Read_And_Removed_Messages_Invalidate_Other_Clients_After_Commit()
    {
        using var connection = new SqliteConnection("Data Source=:memory:");
        connection.Open();
        var factory = new ContextFactory(connection);
        using (var db = factory.CreateDbContext()) db.Database.EnsureCreated();
        var broadcasts = new List<string>();
        var client = Stub<ISoulseekClient>((_, _) => Task.CompletedTask);
        var proxy = Stub<IClientProxy>((method, args) =>
        {
            Assert.Equal("SendCoreAsync", method.Name);
            Assert.Equal("CONVERSATION_CHANGED", args![0]);
            var payload = ((object[])args[1]!)[0];
            var username = payload.GetType().GetProperty("username")!.GetValue(payload)!.ToString()!;
            // A receiver immediately re-fetching must already see the committed row.
            using var db = factory.CreateDbContext();
            Assert.True(db.Conversations.Any(c => c.Username == username));
            broadcasts.Add(username);
            return Task.CompletedTask;
        });
        var clients = Stub<IHubClients>((method, args) => { Assert.Equal("Group", method.Name); Assert.Equal(ApplicationHubExtensions.MessagingGroup, args![0]); return proxy; });
        var hub = Stub<IHubContext<ApplicationHub>>((method, _) => method.Name == "get_Clients" ? clients : null);
        var service = new ConversationService(client, new QuietBus(), factory, hub);
        var incoming = new PrivateMessage { Username = "peer", Message = "hello", Id = 42,
            Timestamp = DateTime.UtcNow, Direction = MessageDirection.In };
        await service.HandleMessageAsync("peer", incoming);
        using (var db = factory.CreateDbContext()) Assert.Single(db.PrivateMessages);
        Assert.Single(broadcasts);
        await service.HandleMessageAsync("peer", incoming);
        using (var db = factory.CreateDbContext()) Assert.Single(db.PrivateMessages);
        Assert.Equal(2, broadcasts.Count); // Replays change acknowledgement state too.
        await service.AcknowledgeAsync("peer");
        using (var db = factory.CreateDbContext()) Assert.True(db.PrivateMessages.Single().IsAcknowledged);
        await service.SendMessageAsync("peer", "reply");
        using (var db = factory.CreateDbContext()) Assert.Equal(2, db.PrivateMessages.Count());
        await service.RemoveAsync("peer");
        using (var db = factory.CreateDbContext()) Assert.False(db.Conversations.Single().IsActive);
        Assert.True(broadcasts.Count >= 5);
    }

    [Fact]
    public async Task Room_Update_Is_A_Small_Invalidation_Without_Raising_A_Mention()
    {
        var events = new List<(string Name, object[] Payload)>();
        var proxy = Stub<IClientProxy>((_, args) => { events.Add(((string)args![0]!, (object[])args[1]!)); return Task.CompletedTask; });
        var clients = Stub<IHubClients>((method, args) => { Assert.Equal("Group", method.Name); Assert.Equal(ApplicationHubExtensions.MessagingGroup, args![0]); return proxy; });
        var hub = Stub<IHubContext<ApplicationHub>>((method, _) => method.Name == "get_Clients" ? clients : null);
        await hub.BroadcastRoomMessageAsync("music");
        var item = Assert.Single(events);
        Assert.Equal("ROOM_MESSAGE", item.Name);
        var payload = Assert.Single(item.Payload);
        Assert.Equal("music", payload.GetType().GetProperty("roomName")!.GetValue(payload));
        Assert.Single(payload.GetType().GetProperties());
    }

    private static T Stub<T>(Func<MethodInfo, object?[]?, object?> invoke) where T : class
    {
        var instance = DispatchProxy.Create<T, InterfaceProxy>();
        ((InterfaceProxy)(object)instance).Call = invoke;
        return instance;
    }
    public class InterfaceProxy : DispatchProxy
    {
        public Func<MethodInfo, object?[]?, object?> Call { get; set; } = null!;
        protected override object? Invoke(MethodInfo? method, object?[]? args) => Call(method!, args);
    }
    private sealed class ContextFactory(SqliteConnection connection) : IDbContextFactory<MessagingDbContext>
    {
        public MessagingDbContext CreateDbContext() => new(new DbContextOptionsBuilder<MessagingDbContext>().UseSqlite(connection).Options);
    }
    private sealed class QuietBus() : EventBus(null!)
    {
        public override void Raise<T>(T data) { }
    }
}
