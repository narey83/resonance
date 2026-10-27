# Development workspace

The authoritative checkout is `/mnt/data/projects/resonance` on the development server. From this Mac, use the existing SSH alias `resonance-dev` to inspect and edit that checkout. Preserve its uncommitted work. On the server, work directly in that checkout.

The Mac checkout supports native iOS/Android builds and the local Expo Metro process. `bin/dev-remote` manages SSH forwards and mirrors mobile source from the server to the Mac. Do not edit mirrored mobile source on the Mac while that mirror is running. Mac workflow helpers and documentation may be maintained locally and synchronized to the server. Native projects, credentials, dependencies and local application data must remain intact.

The live deployment uses SQLite at `backend/data/resonance.db`. The user approved enabling it on 25 October 2026. PostgreSQL is retained as a frozen rollback source; do not resume writes there while SQLite is live, or remove it without user approval. Other applications still use PostgreSQL and must remain intact. Older SQLite conversion snapshots are stale and must not replace the active database. See `.dev/migration-state.json` for the current conversion report and backup paths.

See `docker/REMOTE_DEVELOPMENT.md` for commands and `.dev/migration/NOTES.md` on the Mac for deployment history. Preserve the database backups and original server checkout. Keep CarPlay and Android Auto work deferred unless the user resumes it.
