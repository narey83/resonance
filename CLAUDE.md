# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Backend (hot-reload dev)
bin/watch                          # dotnet watch run
bin/watch --web                    # frontend dev server (port 3000)

# Production build
bin/build                          # full build (frontend + backend)
bin/build --web-only               # skip dotnet
bin/build --dotnet-only            # skip npm
bin/build --skip-tests

# Process management (systemd user services)
systemctl --user start resonance-backend resonance-frontend
systemctl --user stop resonance-frontend resonance-backend
systemctl --user restart resonance-backend
systemctl --user status resonance-backend resonance-frontend

# Logs
journalctl --user -u resonance-backend -f
tail -f app/logs/frontend.log

# Frontend tests
cd frontend && npm test
```

Backend runs on port 5030, frontend dev server on port 3000. Set `HOST=0.0.0.0` for the frontend dev server to be accessible on the network.

## Architecture

**Backend:** ASP.NET Core / .NET 10, SQLite via EF Core, Serilog, SignalR, JWT + ApiKey + Passthrough auth.  
**Frontend:** React 16 + React Router 5, Semantic UI React, Axios for REST, `@microsoft/signalr` for real-time.

### Backend layout

```
backend/
  Program.cs          — bootstrap, Kestrel config, DI registration, Serilog setup, DB init
  Application.cs      — IHostedService; owns the Soulseek client, all event subscriptions
  Core/               — auth, sessions, options, logs API/hub, app-level controllers
  Transfers/          — download & upload services, retry logic, hubs
  Search/             — search service, SearchHub
  Shares/             — share scanning, file cache, ShareService
  Messaging/          — private messages, rooms
  Users/              — user browsing, IP tracking
  Events/             — event bus + persistent event log (EventsDbContext)
  MusicLibrary/       — BPM, key, waveform analysis
  Telemetry/          — Prometheus metrics, reports
  Relay/              — relay controller/agent mode (distributed operation)
  Integrations/       — FTP, webhooks, scripts, VPN, Pushbullet
  Common/             — shared utilities, middleware, types, ConcurrentFixedSizeQueue
```

Each module typically contains: `*Service.cs`, `API/Controllers/*Controller.cs`, `API/Hubs/*Hub.cs`, optional `*DbContext.cs` + EF migrations.

### Key patterns

**Auth policies** are defined in `AuthPolicy` and applied per-controller via `[Authorize(Policy = AuthPolicy.Any)]`. Three schemes: JWT Bearer, ApiKey header, and Passthrough (for reverse-proxy setups). See `Core/Authentication/`.

**API versioning:** All routes are `api/v{version:apiVersion}/[controller]` with `[ApiVersion("0")]`. Only one version currently exists.

**SignalR hubs:** `LogsHub`, `ApplicationHub`, `SearchHub`, `RelayHub`. The hub pattern uses an extension method (`hub.EmitXyzAsync(...)`) in the same file as the hub class. New connections receive a buffered snapshot via `OnConnectedAsync`.

**Databases:** The app supports SQLite (default) and PostgreSQL. Controlled by `database.type` in config — set to `postgresql` with a `connection_string` to enable Postgres. When using Postgres, the `Migrator` (SQLite schema migrations) is skipped entirely; Postgres schema is managed by EF Core via `ctx.Database.EnsureCreated()` at startup. SQLite schema migrations live in `backend/Core/Data/Migrations/`.

**Switching to Postgres / syncing SQLite data:** The built-in `DatabaseMigrator` handles copying all SQLite data to Postgres. It reads all `.db` files in the data directory and upserts into Postgres (`ON CONFLICT DO NOTHING`), so it is safe to re-run at any time. Run it on the server:
```bash
./backend/bin/Debug/net10.0/resonance \
  --app-dir /home/narey/projects/resonance/backend \
  --migrate-db sqlite-to-postgres
```
Re-run this whenever a new SQLite migration creates a table that has accumulated data, as those rows won't automatically appear in Postgres. The command exits immediately after migrating — it does not start the web server.

**Options:** Config is loaded from `resonance.yml` (YAML) and merged with environment variables and CLI flags. The root type is `Options` in `Core/Options.cs`. Injected as `IOptions<Options>` and `IOptionsMonitor<Options>`. A snapshot at startup is exposed as `Program.OptionsAtStartup`.

**Logging:** Serilog, all classes acquire a logger with `Serilog.Log.ForContext<T>()` assigned to a private property. In-memory buffer of 100 entries (`Program.LogBuffer`) is broadcast via `LogsHub` to the frontend log viewer. Browser console errors are forwarded to the backend via `POST /api/v0/logs`.

**Frontend API client:** `frontend/src/lib/api.js` — an Axios instance with base URL from `config.js`, auto-attaches JWT Bearer header, handles 401s by clearing the token and reloading.

**Frontend module libs:** Each feature area has a `lib/*.js` file (e.g., `lib/transfers.js`) that wraps `api.js` calls for that domain. Components import from these rather than calling `api` directly.
