namespace Resonance.Tests.Events;

using System.Text.Json;
using global::resonance.Events;
using global::resonance.Events.API;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

public class NotificationHistoryTests
{
    [Theory]
    [InlineData("ActionSuccess")]
    [InlineData("ActionInfo")]
    [InlineData("ActionWarning")]
    [InlineData("ActionError")]
    [InlineData("ServerStatus")]
    public void SavedNoticesAreReturnedFromDatabaseHistory(string type)
    {
        using var connection = new SqliteConnection("Data Source=:memory:");
        connection.Open();
        var options = new DbContextOptionsBuilder<EventsDbContext>().UseSqlite(connection).Options;
        using (var context = new EventsDbContext(options))
        {
            context.Database.EnsureCreated();
        }

        var service = new EventService(new ContextFactory(options));
        var controller = new EventsController(service, new EventBus(service));
        var message = type == "ActionInfo" ? new string('x', 4096) : "Saved <action>";
        var response = Assert.IsType<ObjectResult>(controller.SaveNotification(new NotificationRequest(type, message)));
        Assert.Equal(201, response.StatusCode);
        var created = Assert.IsType<EventRecord>(response.Value);

        // EventService opens a fresh context: this verifies the stored row, not tracked state.
        var saved = Assert.Single(service.Get());
        Assert.Equal(created.Id, saved.Id);
        Assert.Equal(type, saved.Type.ToString());
        Assert.Equal(created.Timestamp, saved.Timestamp);
        using var data = JsonDocument.Parse(saved.Data);
        Assert.Equal(message, data.RootElement.GetProperty("message").GetString());
    }

    [Theory]
    [InlineData("DownloadFileComplete", "text")]
    [InlineData("None", "text")]
    [InlineData("100", "text")]
    [InlineData("FutureType", "text")]
    [InlineData("ActionError", "")]
    [InlineData("ActionInfo", "  ")]
    public void InvalidNoticesAreRejectedBeforeStorage(string type, string message)
    {
        var controller = new EventsController(null!, null!);
        Assert.IsType<BadRequestObjectResult>(controller.SaveNotification(new NotificationRequest(type, message)));
    }

    [Fact]
    public void NoticeLengthIsBoundedAndEndpointRequiresAuthentication()
    {
        var controller = new EventsController(null!, null!);
        Assert.IsType<BadRequestObjectResult>(controller.SaveNotification(new NotificationRequest("ActionError", new string('x', 4097))));
        var method = typeof(EventsController).GetMethod(nameof(EventsController.SaveNotification))!;
        Assert.NotEmpty(method.GetCustomAttributes(typeof(AuthorizeAttribute), false));
    }

    private sealed class ContextFactory(DbContextOptions<EventsDbContext> options) : IDbContextFactory<EventsDbContext>
    {
        public EventsDbContext CreateDbContext() => new(options);
    }
}
