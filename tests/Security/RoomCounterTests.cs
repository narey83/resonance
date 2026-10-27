namespace Resonance.Tests.Security;

using System.Reflection;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using global::resonance;
using global::resonance.Messaging;
using global::resonance.Messaging.API;

public class RoomCounterTests
{
    [Fact]
    public void Counters_Exceed_The_Retained_Window_Exclude_Self_And_Contain_No_Message_Text()
    {
        using var connection = new SqliteConnection("Data Source=:memory:"); connection.Open();
        var factory = new Factory(connection);
        using (var db = factory.CreateDbContext())
        {
            db.Database.EnsureCreated();
            for (var i = 0; i < 40; i++) db.InsertRoomMessage(new RoomMessage { RoomName = "music", Username = "peer", Message = "synthetic private text" });
            db.InsertRoomMessage(new RoomMessage { RoomName = "music", Username = "self", Message = "own text" });
            db.InsertRoomMessage(new RoomMessage { RoomName = "not-joined", Username = "peer", Message = "other room" });
        }
        var monitor = DispatchProxy.Create<IStateMonitor<State>, MonitorProxy>();
        var tracker = new RoomTracker(); tracker.TryAdd("music", new Room()); tracker.TryAdd("empty", new Room());
        var controller = new RoomsController(null!, null!, monitor, null!, tracker, factory);
        var result = Assert.IsType<OkObjectResult>(controller.GetMessageCounts());
        var json = JsonSerializer.Serialize(result.Value);
        Assert.DoesNotContain("text", json); Assert.DoesNotContain("not-joined", json);
        using var document = JsonDocument.Parse(json);
        Assert.Equal(40, document.RootElement[0].GetProperty("room").GetString() == "music"
            ? document.RootElement[0].GetProperty("count").GetInt32()
            : document.RootElement[1].GetProperty("count").GetInt32());
        Assert.Equal(2, document.RootElement.GetArrayLength());
    }
    public class MonitorProxy : DispatchProxy
    {
        protected override object? Invoke(MethodInfo? method, object?[]? args) => new State { User = new UserState { Username = "self" } };
    }
    private sealed class Factory(SqliteConnection connection) : IDbContextFactory<MessagingDbContext>
    {
        public MessagingDbContext CreateDbContext() => new(new DbContextOptionsBuilder<MessagingDbContext>().UseSqlite(connection).Options);
    }
}
