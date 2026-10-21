namespace Resonance.Tests.Database;

using global::resonance;
using global::resonance.Authentication;
using global::resonance.Core.Settings;
using global::resonance.Core.LogStore;
using global::resonance.Mixtapes;
using global::resonance.MusicLibrary;
using global::resonance.MusicLibrary.Activity;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Dapper;

public class ProviderTests
{
    [Fact]
    public void DefaultIsPersistentSqliteRelativeToApplicationDirectory()
    {
        var root = Path.GetFullPath(Path.Combine(Path.GetTempPath(), "resonance-provider-config"));
        var database = RuntimeDatabase.Resolve(new Options.DatabaseOptions(),root);
        Assert.False(database.UsePostgres);
        Assert.Equal(Path.Combine(root,"data","resonance.db"),new SqliteConnectionStringBuilder(database.ConnectionString).DataSource);
        var explicitPath = RuntimeDatabase.Resolve(new Options.DatabaseOptions {Provider="Sqlite",ConnectionString="Data Source=./custom/music.db"},root);
        Assert.Equal(Path.Combine(root,"custom","music.db"),new SqliteConnectionStringBuilder(explicitPath.ConnectionString).DataSource);
    }

    [Theory]
    [InlineData("MySql","Host=localhost;Database=test")]
    [InlineData("PostgreSql","Username=secret;Password=do-not-print")]
    [InlineData("Sqlite","Host=localhost;Password=do-not-print")]
    public void InvalidConfigurationsFailWithoutExposingCredentials(string provider,string connectionString)
    {
        var error=Assert.Throws<ArgumentException>(()=>RuntimeDatabase.Resolve(new Options.DatabaseOptions{Provider=provider,ConnectionString=connectionString},Path.GetTempPath()));
        Assert.DoesNotContain("do-not-print",error.Message);
    }

    [Fact]
    public void LegacyPostgresConnectionIsNeverSilentlyMigrated()
    {
        var database=RuntimeDatabase.Resolve(new Options.DatabaseOptions{ConnectionString="Host=localhost;Database=existing"},Path.GetTempPath());
        Assert.True(database.UsePostgres);
    }

    [Fact]
    public async Task SqliteInitializationCrudAuthenticationPlaylistsHistoryAndLogging()
    {
        var root=Path.Combine(Path.GetTempPath(),"resonance-provider-"+Guid.NewGuid().ToString("N"));
        var database=RuntimeDatabase.Resolve(new Options.DatabaseOptions(),root);
        SqliteApplicationSchema.Initialize(database);
        SqliteApplicationSchema.Initialize(database); // Existing schema initialization is idempotent.
        await Exercise(database);
        await using var connection=database.CreateConnection();
        Assert.Equal("ok",await connection.ExecuteScalarAsync<string>("PRAGMA integrity_check"));
        Assert.Empty(await connection.QueryAsync("PRAGMA foreign_key_check"));
    }

    [PostgresFact]
    public async Task PostgresEquivalentBehavior()
    {
        var database=RuntimeDatabase.Resolve(new Options.DatabaseOptions { Provider="PostgreSql",ConnectionString=Environment.GetEnvironmentVariable("RESONANCE_TEST_POSTGRES")!},Path.GetTempPath());
        Assert.Contains("resonance_provider_test",new Npgsql.NpgsqlConnectionStringBuilder(database.ConnectionString).Database);
        // Mirror Program's startup prerequisite before creating trigram-backed log indexes.
        await using (var bootstrap = database.CreateConnection())
        {
            await bootstrap.ExecuteAsync("CREATE EXTENSION IF NOT EXISTS pg_trgm");
        }

        foreach(var type in new[]{typeof(UsersDbContext),typeof(LibraryActivityDbContext)})
        {
            var builder=(DbContextOptionsBuilder)Activator.CreateInstance(typeof(DbContextOptionsBuilder<>).MakeGenericType(type))!;
            database.Configure(builder);
            using var ctx=(DbContext)Activator.CreateInstance(type,builder.Options)!;
            await ctx.Database.ExecuteSqlRawAsync(ctx.Database.GenerateCreateScript());
        }
        LogsSchemaInitializer.Initialize(database.ConnectionString);
        new MusicRepository(database.ConnectionString,true).Initialize();
        new MixtapeRepository(database.ConnectionString,true).Initialize();
        _=new global::resonance.Analysis.AnalysisStore(database.ConnectionString,true);
        await Exercise(database);
    }

    private static async Task Exercise(RuntimeDatabase database)
    {
        var analysis = new global::resonance.Analysis.AnalysisStore(database.ConnectionString, database.UsePostgres);
        Assert.Null(analysis.GetWaveform("missing-provider-test.mp3"));
        var artwork = new ArtworkStore(database.ConnectionString, database.UsePostgres);
        artwork.Set("provider-artwork.mp3", 64, 123, new byte[] { 1, 2, 3 }, "image/png");
        var cachedArtwork = artwork.Get("provider-artwork.mp3", 64, 123);
        Assert.NotNull(cachedArtwork);
        Assert.Equal(new byte[] { 1, 2, 3 }, cachedArtwork.Value.Bytes);
        var settings=new SettingsService(database.ConnectionString,database.UsePostgres);
        settings.SetMany(new Dictionary<string,string>{{"test:key","value"}});
        Assert.Equal("value",settings.GetAll()["test:key"]);
        settings.SetMany(new Dictionary<string,string>{{"test:key",null!}});
        Assert.DoesNotContain("test:key",settings.GetAll().Keys);
        var userOptions=new DbContextOptionsBuilder<UsersDbContext>();database.Configure(userOptions);
        var users=new AppUserService(new Factory<UsersDbContext>(userOptions.Options));
        users.Create("provider-user","test-only-password");
        Assert.NotNull(users.Authenticate("provider-user","test-only-password"));
        Assert.Null(users.Authenticate("provider-user","wrong-password"));
        var library=new MusicRepository(database.ConnectionString,database.UsePostgres);
        var track=new MusicTrack("provider-test.mp3","provider-test.mp3","","mp3",100,1,1,120,"Provider test","Artist",null!,"Album",2026,1,1,"Electronic",128,"Am",null!,false,"ID3",320,44100,16);
        library.Upsert(track);
        Assert.Single(library.GetAllFingerprints());
        library.Upsert(track with {Title="Updated"});
        Assert.Single(library.GetAllFingerprints());
        var playlists=new MixtapeRepository(database.ConnectionString,database.UsePostgres);
        playlists.InsertMixtape(new Mixtape("provider-mix","Test",null,false,null,1,1));
        playlists.InsertTrack(new MixtapeTrack("provider-entry","provider-mix",track.Path,track.Title,track.Artist,track.Album,track.Duration,0));
        Assert.Single(playlists.GetTracks("provider-mix"));
        playlists.DeleteTrack("provider-entry");Assert.Empty(playlists.GetTracks("provider-mix"));
        playlists.DeleteMixtape("provider-mix");Assert.Null(playlists.GetById("provider-mix"));
        var activityOptions=new DbContextOptionsBuilder<LibraryActivityDbContext>();database.Configure(activityOptions);
        await using(var activity=new LibraryActivityDbContext(activityOptions.Options))
        {
            activity.PlayHistory.Add(new PlayRecord {Id=Guid.NewGuid().ToString(),Path=track.Path,Username="provider-user",PlayedAt=123,Title="Test",Artist="Artist",Folder="",Source="library"});
            await activity.SaveChangesAsync();Assert.Single(await activity.PlayHistory.ToListAsync());
        }
        var logOptions=new DbContextOptionsBuilder<LogsDbContext>();database.Configure(logOptions);
        await using(var logs=new LogsDbContext(logOptions.Options))
        {
            logs.Entries.Add(new LogEntry{Timestamp=DateTime.UtcNow,Level="Information",Message="Provider logging works",SourceContext="Database test"});
            await logs.SaveChangesAsync();
            var result=await LogQueryService.QueryAsync(logs,null,null!,null!,"Provider logging",null,null,0,100);
            Assert.Single(result.Items);
        }
        library.DeletePaths(new[]{track.Path});Assert.Empty(library.GetAllFingerprints());
    }
    private sealed class Factory<T>(DbContextOptions<T> options):IDbContextFactory<T> where T:DbContext
    {
        public T CreateDbContext()=>(T)Activator.CreateInstance(typeof(T),options)!;
    }
}
public sealed class PostgresFactAttribute:FactAttribute
{
    public PostgresFactAttribute(){if(string.IsNullOrEmpty(Environment.GetEnvironmentVariable("RESONANCE_TEST_POSTGRES")))Skip="RESONANCE_TEST_POSTGRES is not configured; PostgreSQL integration test not executed.";}
}
