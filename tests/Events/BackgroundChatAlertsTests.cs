namespace Resonance.Tests.Events;

using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using resonance;
using resonance.Authentication;
using resonance.Events;
using resonance.Events.API;
using resonance.Messaging;

public class BackgroundChatAlertsTests
{
    [Fact]
    public void FeedReturnsOnlyNewChatEventsAndStopsOnRevocation()
    {
        using var userConnection = new SqliteConnection("Data Source=:memory:");
        using var eventConnection = new SqliteConnection("Data Source=:memory:");
        userConnection.Open();
        eventConnection.Open();
        var users = new Factory<UsersDbContext>(new DbContextOptionsBuilder<UsersDbContext>().UseSqlite(userConnection).Options, o => new UsersDbContext(o));
        var events = new Factory<EventsDbContext>(new DbContextOptionsBuilder<EventsDbContext>().UseSqlite(eventConnection).Options, o => new EventsDbContext(o));
        using (var db = users.CreateDbContext())
        {
            db.Database.EnsureCreated();
            db.Users.Add(new AppUser { Username = "owner", PasswordHash = "unused", Role = Role.Administrator });
            db.SaveChanges();
        }
        using (var db = events.CreateDbContext()) db.Database.EnsureCreated();
        using var sessions = new SessionService(users, new OptionsAtStartup());
        var (token, _) = sessions.CreateSession("owner");
        var controller = new BackgroundChatAlertsController(sessions, null!, events)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };
        controller.Request.Headers.Authorization = "Bearer " + token;

        var baseline = Assert.IsType<ChatAlertPage>(Assert.IsType<OkObjectResult>(controller.Poll()).Value);
        Assert.Empty(baseline.Alerts);
        using (var db = events.CreateDbContext())
        {
            db.Events.Add(EventRecord.From<PrivateMessageReceivedEvent>(new PrivateMessageReceivedEvent
            {
                Message = new PrivateMessage { Username = "alice", Message = "hello" },
            }));
            db.Events.Add(EventRecord.From<RoomMentionEvent>(new RoomMentionEvent
            {
                RoomName = "room",
                Username = "bob",
                Message = "@owner hello",
            }));
            db.Events.Add(EventRecord.From<NoopEvent>(new NoopEvent()));
            db.SaveChanges();
        }

        var page = Assert.IsType<ChatAlertPage>(Assert.IsType<OkObjectResult>(controller.Poll(baseline.Next)).Value);
        Assert.Equal(2, page.Alerts.Length);
        Assert.Contains(page.Alerts, alert => alert.Kind == "pm" && alert.Thread == "alice");
        Assert.Contains(page.Alerts, alert => alert.Kind == "room" && alert.Thread == "room");
        Assert.Empty(Assert.IsType<ChatAlertPage>(Assert.IsType<OkObjectResult>(controller.Poll(page.Next)).Value).Alerts);

        DateTime expiresAt;
        using (var db = users.CreateDbContext())
        {
            var session = db.Sessions.Single();
            expiresAt = session.ExpiresAt;
            session.LastUsedAt = DateTime.UtcNow.AddMinutes(-10);
            db.SaveChanges();
        }
        Assert.IsType<OkObjectResult>(controller.Poll(page.Next));
        using (var db = users.CreateDbContext())
        {
            var session = db.Sessions.Single();
            Assert.True(session.LastUsedAt > DateTime.UtcNow.AddMinutes(-1));
            Assert.Equal(expiresAt, session.ExpiresAt);
        }

        sessions.RevokeByToken(token);
        Assert.IsType<UnauthorizedResult>(controller.Poll(page.Next));
    }

    [Fact]
    public void FeedRejectsUnknownCredentialsAndInvalidCursors()
    {
        using var userConnection = new SqliteConnection("Data Source=:memory:");
        userConnection.Open();
        var users = new Factory<UsersDbContext>(new DbContextOptionsBuilder<UsersDbContext>().UseSqlite(userConnection).Options, o => new UsersDbContext(o));
        using (var db = users.CreateDbContext())
        {
            db.Database.EnsureCreated();
            db.Users.Add(new AppUser { Username = "owner", PasswordHash = "unused", Role = Role.Administrator });
            db.SaveChanges();
        }
        using var sessions = new SessionService(users, new OptionsAtStartup());
        var (token, _) = sessions.CreateSession("owner");
        var controller = new BackgroundChatAlertsController(sessions, null!, null!)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };

        Assert.IsType<UnauthorizedResult>(controller.Poll());
        controller.Request.Headers.Authorization = "Bearer invalid";
        Assert.IsType<UnauthorizedResult>(controller.Poll());
        controller.Request.Headers.Authorization = "Bearer " + token;
        Assert.IsType<BadRequestResult>(controller.Poll(-1));
    }

    private sealed class Factory<T>(DbContextOptions<T> options, Func<DbContextOptions<T>, T> create) : IDbContextFactory<T>
        where T : DbContext
    {
        public T CreateDbContext() => create(options);
    }
}
