namespace Resonance.Tests.Messaging;

using System.Collections.Concurrent;
using System.Reflection;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using global::resonance;
using global::resonance.Core.Settings;
using global::resonance.Messaging;
using global::resonance.Messaging.API;
using Soulseek;

public class RoomSubscriptionTests
{
    [Fact]
    public async Task Startup_Autojoin_Does_Not_Overwrite_Previous_Subscriptions()
    {
        using var fixture = new Fixture("saved-a", "saved-b");
        var session = fixture.Start("configured", "saved-a");

        await session.Service.RestoreJoinedRoomsAsync();

        Assert.Equal(new[] { "configured", "saved-a", "saved-b" }, session.Client.Attempts.Order());
        Assert.Equal(new[] { "configured", "saved-a", "saved-b" }, fixture.Saved.Order());
        Assert.Equal(3, Joined(session).Length);

        // A new service/tracker represents a full process restart, not just a reconnect.
        var restarted = fixture.Start();
        await restarted.Service.RestoreJoinedRoomsAsync();
        Assert.Equal(fixture.Saved.Order(), Joined(restarted).Order());
    }

    [Fact]
    public async Task Failed_Rejoin_Remains_Saved_And_Is_Retried_On_The_Next_Login()
    {
        using var fixture = new Fixture("first", "temporarily-unavailable");
        var session = fixture.Start();
        session.Client.FailRoom = "temporarily-unavailable";

        await session.Service.RestoreJoinedRoomsAsync();

        Assert.Equal(new[] { "first", "temporarily-unavailable" }, fixture.Saved.Order());
        Assert.Equal(new[] { "first" }, Joined(session));

        session.Client.FailRoom = null;
        await session.Service.RestoreJoinedRoomsAsync();
        Assert.Equal(fixture.Saved.Order(), Joined(session).Order());
    }

    [Fact]
    public async Task Concurrent_Acknowledgements_Do_Not_Lose_Subscriptions()
    {
        using var fixture = new Fixture("awaiting-rejoin");
        var session = fixture.Start();
        var names = Enumerable.Range(0, 24).Select(i => $"room-{i}").ToArray();

        await Task.WhenAll(names.Select(name => Task.Run(() => session.Client.Joined(name))));

        Assert.Equal(names.Append("awaiting-rejoin").Order(), fixture.Saved.Order());
        Assert.Equal(names.Order(), session.State.CurrentValue.Rooms.Order());
    }

    [Fact]
    public async Task Confirmed_Leave_Removes_Only_That_Subscription_And_Cached_Room()
    {
        using var fixture = new Fixture("keep", "leave", "pending");
        var session = fixture.Start();
        session.Client.FailRoom = "pending";
        await session.Service.RestoreJoinedRoomsAsync();

        await session.Service.LeaveAsync("leave");

        Assert.Equal(new[] { "keep", "pending" }, fixture.Saved.Order());
        Assert.Equal(new[] { "keep" }, Joined(session));
        session.Client.FailRoom = null;
        var restarted = fixture.Start();
        await restarted.Service.RestoreJoinedRoomsAsync();
        Assert.DoesNotContain("leave", restarted.Client.Attempts);
        Assert.Equal(fixture.Saved.Order(), Joined(restarted).Order());
    }

    [Fact]
    public async Task Failed_Leave_And_Other_Users_Events_Do_Not_Change_Our_Subscriptions()
    {
        using var fixture = new Fixture("keep");
        var session = fixture.Start();
        await session.Service.RestoreJoinedRoomsAsync();
        session.Client.FailLeave = true;

        await Assert.ThrowsAsync<TimeoutException>(() => session.Service.LeaveAsync("keep"));
        session.Client.Joined("other-room", "peer");
        session.Client.Left("keep", "peer");

        Assert.Equal(new[] { "keep" }, fixture.Saved);
        Assert.Equal(new[] { "keep" }, Joined(session));
    }

    [Fact]
    public async Task Reconnect_Refreshes_Room_Data_And_Keeps_Messages()
    {
        using var fixture = new Fixture("music");
        var session = fixture.Start();
        await session.Service.RestoreJoinedRoomsAsync();
        var message = new RoomMessage { RoomName = "music", Message = "retained" };
        session.Tracker.AddOrUpdateMessage("music", message);
        session.Client.Peer = "new-peer";

        await session.Service.RestoreJoinedRoomsAsync();

        Assert.Equal("new-peer", Assert.Single(session.Tracker.Rooms["music"].Users).Username);
        Assert.Same(message, Assert.Single(session.Tracker.Rooms["music"].Messages));
    }

    [Fact]
    public async Task Empty_Store_Does_Not_Invent_Subscriptions()
    {
        using var fixture = new Fixture();
        var session = fixture.Start();
        await session.Service.RestoreJoinedRoomsAsync();
        Assert.Empty(session.Client.Attempts);
        Assert.Empty(Joined(session));
    }

    [Fact]
    public async Task Failed_New_Join_Does_Not_Create_A_Subscription_Or_Joined_Room()
    {
        using var fixture = new Fixture("existing");
        var session = fixture.Start();
        session.Client.FailRoom = "rejected";

        await Assert.ThrowsAsync<TimeoutException>(() => session.Service.JoinAsync("rejected"));

        Assert.Equal(new[] { "existing" }, fixture.Saved);
        Assert.Empty(Joined(session));
        Assert.Empty(session.State.CurrentValue.Rooms);
    }

    private static string[] Joined(Session session)
    {
        var controller = new RoomsController(null!, session.Service, session.State, null!, session.Tracker, null!);
        return Assert.IsAssignableFrom<IEnumerable<string>>(Assert.IsType<OkObjectResult>(controller.GetAll()).Value).ToArray();
    }

    private sealed class Fixture : IDisposable
    {
        private const string Key = "resonance:messaging:rooms";
        private readonly string path = Path.Combine(Path.GetTempPath(), $"resonance-rooms-{Guid.NewGuid():N}.db");

        public Fixture(params string[] saved)
        {
            Settings = new SettingsService($"Data Source={path};Pooling=False", false);
            Settings.SetMany(new Dictionary<string, string> { [Key] = JsonSerializer.Serialize(saved) });
        }

        public SettingsService Settings { get; }
        public string[] Saved => JsonSerializer.Deserialize<string[]>(Settings.GetAll()[Key])!;

        public Session Start(params string[] configured)
        {
            var client = DispatchProxy.Create<ISoulseekClient, ClientProxy>();
            var proxy = (ClientProxy)(object)client;
            var options = DispatchProxy.Create<IOptionsMonitor<global::resonance.Options>, OptionsProxy>();
            ((OptionsProxy)(object)options).Value = new global::resonance.Options { Rooms = configured };
            var state = new ManagedState<State>();
            var tracker = new RoomTracker();
            var service = new RoomService(client, options, state, tracker, null!, null!, null!, null!, null!, Settings);
            return new Session(service, proxy, state, tracker);
        }

        public void Dispose() => System.IO.File.Delete(path);
    }

    private sealed record Session(RoomService Service, ClientProxy Client, ManagedState<State> State, RoomTracker Tracker);

    public class OptionsProxy : DispatchProxy
    {
        public global::resonance.Options Value { get; set; } = null!;
        protected override object? Invoke(MethodInfo? method, object?[]? args) => Value;
    }

    public class ClientProxy : DispatchProxy
    {
        private EventHandler<RoomJoinedEventArgs>? joined;
        private EventHandler<RoomLeftEventArgs>? left;
        public ConcurrentBag<string> Attempts { get; } = new();
        public string? FailRoom { get; set; }
        public bool FailLeave { get; set; }
        public string Peer { get; set; } = "old-peer";

        public void Joined(string room, string username = "self") => joined?.Invoke(this, new RoomJoinedEventArgs(room, username, new UserData(username, UserPresence.Online, 0, 0, 0, 0, "GB", null)));
        public void Left(string room, string username = "self") => left?.Invoke(this, new RoomLeftEventArgs(room, username));

        protected override object? Invoke(MethodInfo? method, object?[]? args)
        {
            switch (method!.Name)
            {
                case "get_Username": return "self";
                case "add_RoomJoined": joined += (EventHandler<RoomJoinedEventArgs>)args![0]!; return null;
                case "add_RoomLeft": left += (EventHandler<RoomLeftEventArgs>)args![0]!; return null;
                case "JoinRoomAsync":
                    var name = (string)args![0]!;
                    Attempts.Add(name);
                    if (name == FailRoom) return Task.FromException<RoomData>(new TimeoutException());
                    Joined(name);
                    return Task.FromResult(new RoomData(name, new[] { new UserData(Peer, UserPresence.Online, 0, 0, 0, 0, "GB", null) }));
                case "LeaveRoomAsync":
                    if (FailLeave) return Task.FromException(new TimeoutException());
                    Left((string)args![0]!);
                    return Task.CompletedTask;
                default: return null;
            }
        }
    }
}
