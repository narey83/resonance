# Modifications

Resonance is a modified version of [slskd](https://github.com/slskd/slskd).
It is **not** maintained by, endorsed by, or affiliated with the slskd project
or its author(s).

- **Original work:** slskd, Copyright (c) JP Dillingham, licensed under the
  GNU Affero General Public License v3.0 (AGPL-3.0).
- **Modifications:** Copyright (c) 2026 John Narey, 2026–present, also licensed
  under AGPL-3.0.

## Nature of the modifications

This fork adds and alters substantial functionality relative to upstream slskd,
including (non-exhaustively): a music library with metadata, BPM, key, and
waveform analysis; independent enhanced analysis and automatic preparation;
smart crates, set planning, transition previews and fixed-tempo set rehearsal;
a docked player and separate player window; themes and audio processing;
audio conversion, mixtapes and metadata enrichment; casting and DLNA;
experimental Pioneer USB export, Network Link and a shared desktop helper;
a YouTube/yt-dlp integration; SQLite and PostgreSQL storage, explicit migration
and selectable log storage; a reworked authentication, permissions and
preferences system; and an accompanying web frontend and mobile app.

Files derived from slskd retain JP Dillingham's copyright notice and carry a
per-file notice that they were modified. Files original to Resonance carry only
John Narey's copyright.

**For the exact, authoritative record of what changed, when, and by whom, see
the project's git history** (`git log` / `git blame`). This document is a
summary pointer, not a substitute for that history.

## Current development snapshot

Updated **21 October 2026**. Features, defaults, interfaces and compatibility can
change at any time. This is a development summary, not a versioned release announcement.

- Newly indexed music enters a durable preparation queue. Optional independent
  workers provide enhanced analysis; Rekordbox import is retained as a migration
  path rather than a runtime requirement.
- The desktop library includes saved layouts, filters, smart crates, preparation,
  mix compatibility, genre warnings, set planning and consecutive handover rehearsal.
  A set uses one fixed master tempo, defaulting to its first track.
- Playback includes theme-aware waveforms, separate DJ/musical phrase views,
  vocal overlays, a player window and processing bypass with explicitly unlocked
  advanced controls. Interface scale is capped at normal size (100%).
- USB export and Network Link share one helper and action-file handoff. Physical
  Pioneer acceptance, installer signing and native Windows/Linux validation remain
  outstanding; these features are experimental.
- SQLite is the fresh-install default; existing PostgreSQL configuration remains
  supported. PostgreSQL-to-SQLite migration is explicit and validated in a separate
  destination. Logs default to database storage, with Disk and Both modes available.

See the [feature inventory](FEATURES.md), [DJ workspace guide](docs/dj-workspace.md)
and [database guide](docs/database/architecture.md) for operating details and limitations.

## No warranty; limitation of liability

This program is distributed in the hope that it will be useful, but **WITHOUT
ANY WARRANTY**; without even the implied warranty of MERCHANTABILITY or FITNESS
FOR A PARTICULAR PURPOSE. See sections 15 and 16 of the GNU Affero General
Public License (in the `LICENSE` file) for the full disclaimer of warranty and
limitation of liability that govern this software, together with any Additional
Terms applied under section 7 of the AGPLv3.
