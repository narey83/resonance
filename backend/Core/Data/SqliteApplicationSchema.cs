namespace resonance;

using System;
using System.Linq;
using Microsoft.EntityFrameworkCore;

/// <summary>Initializes the SQLite schema without running application workers or connecting to Soulseek.</summary>
public static class SqliteApplicationSchema
{
    public static void Initialize(RuntimeDatabase database)
    {
        if (database.UsePostgres) throw new ArgumentException("SQLite initialization requires Sqlite provider.");
        database.InitializeDirectory();
        var types = new[] {
            typeof(Search.SearchDbContext), typeof(Transfers.TransfersDbContext),
            typeof(Messaging.MessagingDbContext), typeof(Events.EventsDbContext),
            typeof(Authentication.UsersDbContext), typeof(MusicLibrary.Activity.LibraryActivityDbContext),
            typeof(Resonance.Integrations.YtDlp.Data.YtDlpDbContext), typeof(Core.LogStore.LogsDbContext),
        };
        foreach (var type in types)
        {
            var builder = (DbContextOptionsBuilder)Activator.CreateInstance(typeof(DbContextOptionsBuilder<>).MakeGenericType(type));
            database.Configure(builder);
            using var context = (DbContext)Activator.CreateInstance(type, builder.Options);
            SqliteSchema.Initialize(context);
        }
        _ = new Core.Settings.SettingsService(database.ConnectionString, false);
        new MusicLibrary.MusicRepository(database.ConnectionString, false).Initialize();
        new Mixtapes.MixtapeRepository(database.ConnectionString, false).Initialize();
        _ = new Analysis.AnalysisStore(database.ConnectionString, false);
        _ = new MusicLibrary.ArtworkStore(database.ConnectionString, false);
        var connections = new ConnectionStringDictionary(Database.List.ToDictionary(d => d, _ => (ConnectionString)database.ConnectionString), false);
        _ = new Core.Preferences.PreferencesService(connections);
        new TransferNetworkInfoStore(connections).Initialize();
    }
}
