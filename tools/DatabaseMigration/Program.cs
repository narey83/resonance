using resonance;
using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Npgsql;
using Dapper;

// Connection strings are read from the environment, never command-line arguments or reports.
if (args.Length != 1 || string.IsNullOrEmpty(Environment.GetEnvironmentVariable("RESONANCE_MIGRATION_SOURCE")))
    throw new ArgumentException("Usage: DatabaseMigration <new-sqlite-file>; set RESONANCE_MIGRATION_SOURCE to the PostgreSQL connection string.");
var destination = Path.GetFullPath(args[0]);
if (File.Exists(destination) || File.Exists(destination + ".partial"))
    throw new IOException("Destination or partial file exists; choose a new destination. Existing data is never overwritten.");
var partial = destination + ".partial";
var database = RuntimeDatabase.Resolve(new resonance.Options.DatabaseOptions { Provider = "Sqlite", ConnectionString = $"Data Source={partial}" }, AppContext.BaseDirectory);
var report = new List<object>();
SqliteApplicationSchema.Initialize(database);
await using var target = (SqliteConnection)database.CreateConnection();
await target.OpenAsync();
await target.ExecuteAsync("PRAGMA foreign_keys=OFF");
await using var source = new NpgsqlConnection(Environment.GetEnvironmentVariable("RESONANCE_MIGRATION_SOURCE"));
await source.OpenAsync();
await using var snapshot = await source.BeginTransactionAsync(IsolationLevel.RepeatableRead);
await source.ExecuteAsync("SET TRANSACTION READ ONLY", transaction: snapshot);
var tables = (await source.QueryAsync<(string Schema, string Name)>("""
    SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind IN ('r','p') AND NOT c.relispartition AND n.nspname NOT IN ('pg_catalog','information_schema')
      AND n.nspname NOT LIKE 'pg_toast%' ORDER BY n.nspname,c.relname
    """, transaction: snapshot)).ToList();
await using var tx = (SqliteTransaction)await target.BeginTransactionAsync();
var destinations = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
foreach (var (schema, name) in tables)
{
    var dest = schema switch {
        "blocked" => "Blocked" + (name == "Users" ? "Users" : name == "Options" ? "UserOptions" : name),
        "browse" => "BrowseHistory", "ytdlp" => "YtDlp" + name,
        "shares" => "shares_" + name, _ => name,
    };
    if (!destinations.Add(dest)) throw new InvalidOperationException("Source tables collide after SQLite mapping: " + schema + "." + name);
    var columns = (await source.QueryAsync<(string Name,string Type)>("""
        SELECT column_name,udt_name FROM information_schema.columns
        WHERE table_schema=@schema AND table_name=@name AND is_generated='NEVER' ORDER BY ordinal_position
        """, new { schema, name }, snapshot)).ToList();
    var fields = string.Join(",", columns.Select(c => Quote(c.Name)));
    var existing = (await target.QueryAsync<(long Cid,string Name,string Type)>($"PRAGMA table_info({Quote(dest)})", transaction:tx)).Select(c=>c.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
    if (existing.Count == 0)
    {
        var definitions = (await source.QueryAsync<(string Name,string Nullable,string Default)>("""
            SELECT column_name,is_nullable,column_default FROM information_schema.columns
            WHERE table_schema=@schema AND table_name=@name AND is_generated='NEVER' ORDER BY ordinal_position
            """,new {schema,name},snapshot)).ToDictionary(c=>c.Name);
        var keys = (await source.QueryAsync<(string Kind,string[] Fields)>("""
            SELECT tc.constraint_type,array_agg(k.column_name ORDER BY k.ordinal_position)
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage k ON k.constraint_schema=tc.constraint_schema AND k.constraint_name=tc.constraint_name
            WHERE tc.table_schema=@schema AND tc.table_name=@name AND tc.constraint_type IN ('PRIMARY KEY','UNIQUE')
            GROUP BY tc.constraint_name,tc.constraint_type
            """,new {schema,name},snapshot)).ToList();
        var ddl = columns.Select(c=>Quote(c.Name)+" "+Affinity(c.Type)+(definitions[c.Name].Nullable=="NO"?" NOT NULL":"")+DefaultClause(definitions[c.Name].Default)).ToList();
        ddl.AddRange(keys.Select(k=>(k.Kind=="PRIMARY KEY"?"PRIMARY KEY":"UNIQUE")+" ("+string.Join(",",k.Fields.Select(Quote))+")"));
        await target.ExecuteAsync($"CREATE TABLE {Quote(dest)} ({string.Join(",",ddl)})",transaction:tx);
    }
    else
        foreach (var col in columns.Where(c=>!existing.Contains(c.Name)))
            await target.ExecuteAsync($"ALTER TABLE {Quote(dest)} ADD COLUMN {Quote(col.Name)} {Affinity(col.Type)}",transaction:tx);
    var empty = await target.ExecuteScalarAsync<long>($"SELECT COUNT(*) FROM {Quote(dest)}",transaction:tx);
    if (empty != 0) throw new InvalidOperationException("Destination schema contains rows in " + dest);
    var hashes = new List<string>();
    await using (var command = new NpgsqlCommand($"SELECT {fields} FROM {Quote(schema)}.{Quote(name)}",source,snapshot))
    await using (var reader = await command.ExecuteReaderAsync())
    {
        using var insert = target.CreateCommand(); insert.Transaction=tx;
        insert.CommandText=$"INSERT INTO {Quote(dest)} ({fields}) VALUES ({string.Join(",",columns.Select((_,i)=>"@p"+i))})";
        for(var i=0;i<columns.Count;i++) insert.Parameters.Add(new SqliteParameter("@p"+i,DBNull.Value));
        while(await reader.ReadAsync())
        {
            var values=new object[columns.Count]; reader.GetValues(values);
            for(var i=0;i<values.Length;i++) insert.Parameters[i].Value=Portable(values[i]);
            await insert.ExecuteNonQueryAsync();
            hashes.Add(Hash(values,columns.Select(c=>c.Type).ToArray()));
        }
    }
    var copied = new List<string>();
    using(var command=target.CreateCommand())
    {
        command.Transaction=tx;command.CommandText=$"SELECT {fields} FROM {Quote(dest)}";
        await using var reader=await command.ExecuteReaderAsync();
        while(await reader.ReadAsync()) {var values=new object[columns.Count];reader.GetValues(values);copied.Add(Hash(values,columns.Select(c=>c.Type).ToArray()));}
    }
    hashes.Sort(StringComparer.Ordinal);copied.Sort(StringComparer.Ordinal);
    if(!hashes.SequenceEqual(copied)) throw new InvalidOperationException("Content validation failed for "+schema+"."+name);
    report.Add(new { source=schema+"."+name,destination=dest,rows=hashes.Count,sha256=Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(string.Join("",hashes)))) });
}
var fk = (await target.QueryAsync("PRAGMA foreign_key_check",transaction:tx)).ToList();
if(fk.Count!=0) throw new InvalidOperationException("Foreign key validation failed.");
if(await target.ExecuteScalarAsync<string>("PRAGMA integrity_check",transaction:tx)!="ok") throw new InvalidOperationException("SQLite integrity check failed.");
await tx.CommitAsync();
await target.ExecuteAsync("PRAGMA wal_checkpoint(TRUNCATE)");
await ExportShares(target, Path.GetDirectoryName(destination)!);
await target.CloseAsync(); SqliteConnection.ClearAllPools();
await snapshot.RollbackAsync(); // Source transaction was read-only, no source mutations possible.
File.Move(partial,destination);
await File.WriteAllTextAsync(destination+".migration.json",JsonSerializer.Serialize(new {validated=true,tables=report},new JsonSerializerOptions{WriteIndented=true}));
Console.WriteLine($"Validated {report.Count} tables; created {destination}. Source was read-only.");

static string Quote(string name)=>"\""+name.Replace("\"","\"\"")+"\"";
static string Affinity(string type)=> type switch {"bytea"=>"BLOB","int2" or "int4" or "int8" or "bool"=>"INTEGER","float4" or "float8" or "numeric"=>"REAL",_=>"TEXT"};
static object Portable(object value)=>value switch {DateTimeOffset date=>date.UtcDateTime,JsonDocument json=>json.RootElement.GetRawText(),Array array when value is not byte[]=>JsonSerializer.Serialize(array),_=>value};
static string Hash(object[] values,string[] types)
{
    var canonical=values.Select((v,i)=>v is DBNull?null:types[i] switch {
        "bytea"=>Convert.ToBase64String((byte[])v),
        "uuid"=>Guid.Parse(v.ToString()!).ToString("D"),
        "timestamptz" or "timestamp"=>(v is DateTime time ? DateTime.SpecifyKind(time,DateTimeKind.Utc) : DateTime.Parse(v.ToString()!,CultureInfo.InvariantCulture,DateTimeStyles.AssumeUniversal|DateTimeStyles.AdjustToUniversal)).ToString("O"),
        "bool"=>v is bool boolean?(boolean?"1":"0"):Convert.ToInt64(v).ToString(),
        "float4" or "float8" or "numeric"=>Convert.ToDouble(v).ToString("R",CultureInfo.InvariantCulture),
        _=>Convert.ToString(v,CultureInfo.InvariantCulture),
    }).ToArray();
    return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(canonical))));
}

static async Task ExportShares(SqliteConnection source, string directory)
{
    if (await source.ExecuteScalarAsync<long>("SELECT COUNT(*) FROM sqlite_master WHERE name='shares_files'") == 0) return;
    var hosts = (await source.QueryAsync<string>("SELECT DISTINCT host FROM shares_files")).ToList();
    foreach (var host in hosts)
    {
        if (host.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 || host.Contains('/') || host.Contains('\\'))
            throw new InvalidOperationException("Share host is not a safe filename.");
        var path = Path.Combine(directory, $"shares.{host}.db");
        if (File.Exists(path)) throw new IOException("Share destination already exists: " + path);
        var repository = new resonance.Shares.SqliteShareRepository($"Data Source={path}");
        repository.Create();
        await using var cache = new SqliteConnection($"Data Source={path}");
        await cache.OpenAsync();
        await using var tx = (SqliteTransaction)await cache.BeginTransactionAsync();
        var rows = (await source.QueryAsync("SELECT masked_filename maskedFilename,original_filename originalFilename,size,touched_at touchedAt,code,extension,attribute_json attributeJson,tags_json tagsJson,timestamp FROM shares_files WHERE host=@host",new {host})).ToList();
        foreach(var row in rows)
            await cache.ExecuteAsync("INSERT INTO files(maskedFilename,originalFilename,size,touchedAt,code,extension,attributeJson,tagsJson,timestamp) VALUES (@maskedFilename,@originalFilename,@size,@touchedAt,@code,@extension,@attributeJson,@tagsJson,@timestamp)",(object)row,tx);
        foreach(var row in await source.QueryAsync("SELECT name,timestamp FROM shares_directories WHERE host=@host",new {host}))
            await cache.ExecuteAsync("INSERT INTO directories(name,timestamp) VALUES (@name,@timestamp)",(object)row,tx);
        foreach(var row in await source.QueryAsync("SELECT timestamp,options,\"end\",suspect FROM shares_scans WHERE host=@host",new {host}))
            await cache.ExecuteAsync("INSERT INTO scans(timestamp,options,\"end\",suspect) VALUES (@timestamp,@options,@end,@suspect)",(object)row,tx);
        foreach(var row in await source.QueryAsync("SELECT a FROM shares_version WHERE host=@host",new {host}))
            await cache.ExecuteAsync("INSERT INTO version(a) VALUES (@a)",(object)row,tx);
        await cache.ExecuteAsync("INSERT INTO filenames(maskedFilename) SELECT maskedFilename FROM files",transaction:tx);
        var count = await cache.ExecuteScalarAsync<long>("SELECT COUNT(*) FROM files",transaction:tx);
        if(count!=rows.Count) throw new InvalidOperationException("Share cache verification failed.");
        await tx.CommitAsync();
        if(await cache.ExecuteScalarAsync<string>("PRAGMA integrity_check")!="ok") throw new InvalidOperationException("Share cache integrity check failed.");
        await cache.ExecuteAsync("PRAGMA wal_checkpoint(TRUNCATE)");
    }
}

static string DefaultClause(string? value)
{
    if(string.IsNullOrEmpty(value))return "";
    if(value is "now()" or "CURRENT_TIMESTAMP")return " DEFAULT CURRENT_TIMESTAMP";
    if(value=="true")return " DEFAULT 1";
    if(value=="false")return " DEFAULT 0";
    var literal=System.Text.RegularExpressions.Regex.Replace(value,@"::[a-zA-Z ]+$", "");
    if(decimal.TryParse(literal,NumberStyles.Float,CultureInfo.InvariantCulture,out _))return " DEFAULT "+literal;
    if(System.Text.RegularExpressions.Regex.IsMatch(literal,@"^'([^']|'')*'$"))return " DEFAULT "+literal;
    return "";
}
