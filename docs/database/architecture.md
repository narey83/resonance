# Database architecture and migration

Updated **21 October 2026**. This documents the implemented providers, defaults and
migration tooling. Configuration and schema behaviour can change; review this guide
alongside the source before an upgrade or migration.

## Decision

SQLite is the zero-configuration default. PostgreSQL remains supported and an existing PostgreSQL installation is not automatically migrated. No other provider is implemented. EF Core and the existing Dapper/ADO.NET repositories remain the data-access frameworks.

`RuntimeDatabase` validates bootstrap configuration, resolves paths, selects connections and configures EF. `ConnectionStringDictionary` carries the selected provider to existing repositories. Genuinely different SQL belongs in the repository/data layer. Controllers and application workers do not choose engines. Transfer network information storage has been moved out of the application/transfer workers into `TransferNetworkInfoStore`.

### Repository inspection

The previous startup hardwired PostgreSQL. SQLite connection branches had been removed from repositories which still had SQLite SQL. Shares had lost their SQLite implementation; settings, analysis and artwork were PostgreSQL-only. The viewer read JSONL files only when the optional plain-text disk logger was enabled, leaving it empty with the defaults. PostgreSQL logging uses monthly range partitions, trigram indexes and partition-based retention. EF contexts previously relied on EnsureCreated plus PostgreSQL schema checks.

The implementation restores the existing SQLite share repository and connection paths, adds SQLite implementations for settings/analysis/artwork, isolates provider-specific schema setup, adds provider-neutral logging selection, and preserves PostgreSQL SQL, schemas, partitions and existing configuration.

## Configuration and fresh installation

No database configuration is needed. A fresh installation creates `data/resonance.db` under Resonance's application directory (`RESONANCE_APP_DIR`). The directory is created and checked for write access. Relative SQLite connection paths always resolve against that application directory, never the process working directory. SQLite uses WAL, foreign keys, private connection caches and a 30-second busy timeout. Store the application directory in persistent storage when using a container.

For explicit configuration, copy one of `examples/database/*.json` to `<application-directory>/database.json` and edit it locally. Do not commit real credentials. Bootstrap database configuration is deliberately independent of the database-backed application settings it is needed to open.

Environment variables override file values:

```
RESONANCE_DATABASE_PROVIDER=Sqlite
RESONANCE_DATABASE_CONNECTION_STRING=Data Source=./data/resonance.db
```

For PostgreSQL use `RESONANCE_DATABASE_PROVIDER=PostgreSql` and a valid PostgreSQL connection string. Standard `Database__Provider` and `Database__ConnectionString` environment names are also accepted through the JSON bootstrap configuration.

The legacy `RESONANCE_DATABASE_TYPE=postgresql` remains supported. For upgrade safety, a legacy PostgreSQL connection string containing `Host=` with no explicit provider also continues using PostgreSQL. This compatibility rule prevents the new SQLite default from silently selecting an empty library for existing installations. A fresh installation with neither setting selects SQLite. Provider and connection-string syntax are validated before database retry loops; errors do not print credentials. In-memory SQLite is rejected for application storage.

Explicit PostgreSQL installations retain their existing database, tables and files. They do not need the migration utility.

## Schemas and migrations

SQLite and PostgreSQL schemas are separate; PostgreSQL migration SQL is never run against SQLite. This project uses EF schema generation and hand-maintained repository DDL rather than EF migration assemblies. Introducing migration assemblies would duplicate the existing framework without addressing the raw repositories.

`SqliteSchema` applies a SQLite-model baseline transactionally and records each EF context's version in `__ResonanceSchema`. It handles multiple contexts sharing the same file and can be run repeatedly. Future schema versions must be added as explicit SQLite upgrade steps, with upgrade tests; changing an EF model alone does not upgrade existing tables. Repositories retain their own idempotent table/column initialization. PostgreSQL retains its established schema/index initialization and native log partition maintenance.

SQLite's shared namespace requires distinct names for yt-dlp's tables (`YtDlpJobs`, `YtDlpTracks`, `YtDlpSubscriptions`, `YtDlpEvents`), which would otherwise collide with music and event tables. SQLite share caches remain separate `shares.<host>.db` files beside the primary database, reusing the established WAL/private-cache implementation. They are rebuildable but included in migration and backup guidance.

Use TEXT for JSON with SQLite JSON functions where querying is required; PostgreSQL can retain JSONB. Use parameterized queries, provider-aware EF types/converters for dates/identifiers, and existing batched upserts. PostgreSQL's lock-skipping maintenance remains PostgreSQL-specific; SQLite uses serialized writes. SQLite log IDs use an integer identity; PostgreSQL retains its partition-compatible composite key and global identity sequence.

## Logging

Database logging is the default and uses the selected provider, including SQLite. Console logging remains independent. No PostgreSQL server is required for SQLite diagnostics.

Set `logger.storage` in application settings, or `RESONANCE_LOG_STORAGE`, to:

- `Database`: database only (default).
- `Disk`: rolling plain-text and structured JSONL files under the application logs directory.
- `Both`: both stores; the viewer reads the database copy.

System → Options → Logging offers the same selector. Restart after changing storage mode. The viewer follows the active startup mode until restart. Existing `logger.disk`, `logger.database`, and `logger.postgres` flags remain compatibility aliases when no explicit storage mode is set; the explicit mode wins. `RESONANCE_DATABASE_LOGGER` is a compatibility option, and `RESONANCE_POSTGRES_LOGGER` continues working for existing configurations.

Retention uses `retention.logs` days for disk files and SQLite entries. PostgreSQL retains monthly partition creation and whole-partition expiry; its precision is a partition boundary rather than exactly one row-age cutoff. Console logging remains available if persistence fails. Logs are not guaranteed durable during a database outage in database-only mode; choose Both if an independent disk copy is required.

## Voluntary PostgreSQL → SQLite migration

Build `tools/DatabaseMigration/DatabaseMigration.csproj` with the same .NET SDK as Resonance. Set `RESONANCE_MIGRATION_SOURCE` to the source PostgreSQL connection string and run:

```
dotnet run --project tools/DatabaseMigration -- /absolute/new-directory/resonance.db
```

Use a new destination directory. The utility refuses to overwrite existing destination or partial files. It initializes the current SQLite schema, takes a repeatable-read PostgreSQL snapshot with `SET TRANSACTION READ ONLY`, copies application rows and additional saved analysis tables, converts provider-specific values, preserves primary/unique keys for additional tables, and generates native SQLite share caches from the PostgreSQL share data. Generated PostgreSQL search vectors are reconstructed as SQLite FTS indexes rather than copied as executable SQL.

Every table is checked using row counts and SHA-256 hashes over canonical row contents. SQLite foreign-key and integrity checks must pass before the primary `.partial` file is published. A `.migration.json` validation report contains counts and checksums, never credentials. On failure the unpublished partial artifacts remain for inspection; choose a new directory for a retry. No source UPDATE, INSERT, DELETE, DDL or cutover is performed. Use a read-only PostgreSQL role where practical.

The utility copies database data and share caches. Also copy external application assets (profile/mixtape artwork, optional candidate-analysis output directories) and keep the audio library available at the configured music root. Music paths stored relative to that root can be used with a copied library. Database migration does not copy audio files. The 15-track test uses independent audio copies so test scans cannot alter the source files' tags.

Analysis tag writing is a separate application setting: `analysis.write_to_tags` is
currently enabled by default. Set it to `false` in a destination instance if test
analysis must preserve its audio tags. See [automatic preparation](../auto-analysis.md).

After validation, start a separate instance against SQLite and compare authentication, the library, cached analysis, playlists, history, playback and logging. Explicitly update the production provider only after reviewing the result. Keep the PostgreSQL original and backup until hardware and application checks are complete.

## Backup and restore

SQLite: stop Resonance and copy `resonance.db`, its WAL/SHM companions if present, and share-cache files together with external application assets. For a live backup use SQLite's backup API (`sqlite3 source.db '.backup backup.db'`); copying only a live main file can omit WAL transactions. Check `PRAGMA integrity_check` on the backup. Restore with Resonance stopped into a new location, configure that path and verify before replacing a working installation.

PostgreSQL: use `pg_dump --format=custom` with credentials supplied securely, plus a separate backup of application files/audio. Restore with `pg_restore` into a new database, verify counts/constraints and configure the restored database explicitly. Do not use SQLite file-copy instructions for PostgreSQL or drop the original during validation.

## Testing and extension points

`tests/Database/ProviderTests.cs` covers default selection, stable paths, invalid configuration, legacy PostgreSQL compatibility, repeatable SQLite schema setup, CRUD, authentication, playlists, playback history and logging. The PostgreSQL equivalent uses a dedicated test database whose name contains `resonance_provider_test`, with `pg_trgm` installed. Set `RESONANCE_TEST_POSTGRES` to run it; otherwise it is explicitly reported skipped. Never point it at production. Existing transfer, logging and library tests are retained.

To add a provider later: extend centralized selection/configuration, implement its schema upgrades and the SQL differences in data stores, and run the same behavior tests. Do not add controller/worker provider checks or reuse another provider's DDL. MySQL/MariaDB and SQL Server are not currently supported.
