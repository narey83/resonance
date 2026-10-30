# Development diagnostics

Verbose diagnostics are selected by the runtime environment, independently of the security-related `--debug` switch. `DOTNET_ENVIRONMENT=Development` enables application Debug events, safe request timings and request correlation. `ASPNETCORE_ENVIRONMENT=Development` is used when `DOTNET_ENVIRONMENT` is unset. Unset, Production, Staging and unknown environments default to normal Information logging. The managed local `bin/dev` backend selects Development and Both log storage; historical remote modes remain separate and must not be used for local development.

Production retains application lifecycle messages, security events, warnings and errors. Browser/mobile informational and debug messages are accepted without being persisted in production; client warnings and errors remain visible. The existing administrator log-level controls can temporarily adjust application/framework levels without changing the environment or enabling the request/SQL diagnostic middleware.

| Area | Control / availability |
| --- | --- |
| Startup, shutdown, services and security | Existing application log contexts; important events retained in production |
| API request duration, route, response and request ID | Automatic Debug events in Development; no bodies, URLs, headers, cookies or tokens are captured by this logger |
| Separate HTTP diagnostic file | `web.logging: true` / `RESONANCE_HTTP_LOGGING=true`, Development only |
| Database query diagnostics | `flags.log_sql: true` / `RESONANCE_LOG_SQL=true`, Development only; parameter values remain disabled |
| Database connection, command and storage failures | Framework warnings/errors retained in every environment |
| Online lookup | `Music / Metadata`: development timing, provider count, confirmed changed-field names and correlated track ID; failures remain warnings in production |
| Tag editing, scanning, analysis, queues, searches, transfers and integrations | Existing contexts under System → Logs; application Debug enables their existing diagnostic events |
| Browser and mobile console forwarding | Development accepts detail; Production retains client warnings/errors |
| Mobile library sync / remote logs | Existing device Settings → Debugging switches; a mobile build is required to change its client-side defaults |
| Soulseek packet/distributed-network diagnostics | Existing `soulseek.diagnostic_level` and distributed-network logging switches; use narrowly during development |
| Recent HTTP capture / HAR | Existing administrator-only bounded in-memory capture remains independent of persisted request diagnostics; secrets are redacted |
| Gateway, SSD and operating-system errors | Caddy and the Linux system journal are separate from application logging |

Choose `logger.storage: Both` / `RESONANCE_LOG_STORAGE=Both` for a disk copy independent of database log persistence. Retention remains controlled by `retention.logs`. Keep critical backups off the server's physical drive: extra logging can reveal SSD media errors but cannot repair the device.

SQL diagnostics no longer call `EnableSensitiveDataLogging`. Detailed database read errors are enabled in Development, while additional query messages still require the SQL switch. Request diagnostics use the route template rather than actual filenames, query strings or public-sharing tokens, and record exception type without copying exception contents into request logs.
