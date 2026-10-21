# Screenshots

The images in this directory are the ones [the root README](../../README.md) embeds.
They are produced by [`frontend/scripts/capture-screenshots.mjs`](../../frontend/scripts/capture-screenshots.mjs),
which drives a running instance with Playwright so every shot shares one viewport,
one theme and one set of filenames.

Documentation reviewed **21 October 2026**. The current `manifest.json` records a
7 September 2026 capture, before the current DJ workspace. These images are historical
illustrations until recaptured; do not use them to establish current layout, colour
or feature behaviour.

## Capturing

Start Resonance, then from `frontend/`:

```bash
npm run screenshots -- --url http://localhost:3000 \
  --username admin --password 'your-password'
```

Credentials can come from the environment instead:

```bash
export RESONANCE_USERNAME=admin
export RESONANCE_PASSWORD='your-password'
npm run screenshots -- --url http://localhost:3000
```

Omit both if the instance does not require authentication.

Useful flags — `npm run screenshots -- --help` lists them all:

| Flag | Purpose |
| --- | --- |
| `--only overview,library` | Re-shoot just a couple of pages |
| `--include chat,map` | Add the opt-in pages below |
| `--all` | Every page |
| `--theme current` | Keep the current theme; the script also accepts `light` and `amoled` |
| `--width` / `--height` / `--scale` | Change the frame; defaults are 1440×900 at 2× |
| `--settle 4000` | Wait longer before shooting, for pages that load slowly |
| `--headed` | Watch the browser work |

## What the README uses

Only six of the captured pages are embedded in the root README:
`overview`, `library`, `track-analysis`, `search`, `duplicates`, `converter`.
The rest are captured for convenience but depend on instance state — a page with
no active transfers, no untagged files or no browsed peers shoots as an empty
panel, which is worse than no screenshot at all. Check anything new before
wiring it into the README.

## The shot list

| Route | File | Shows |
| --- | --- | --- |
| `overview` | `overview.png` | Overview dashboard |
| `searches` | `search.png` | Soulseek search |
| `library` | `library.png` | Music library |
| `trackanalysis` | `track-analysis.png` | Track analysis |
| `downloads` | `downloads.png` | Downloads |
| `uploads` | `uploads.png` | Uploads |
| `history` | `history.png` | Transfer history |
| `browse` | `browse.png` | Browsing a peer's shares |
| `tags` | `tags.png` | Tag editor |
| `duplicates` | `duplicates.png` | Duplicate detection |
| `converter` | `converter.png` | Audio converter |
| `ytdlp` | `ytdlp.png` | yt-dlp ingest |

Opt-in, via `--include` or `--all`:

| Route | File | Shows |
| --- | --- | --- |
| `chat` | `chat.png` | Private chat |
| `rooms` | `rooms.png` | Chat rooms |
| `users` | `users.png` | Users |
| `map` | `map.png` | Peer map |
| `system` | `system.png` | System |

These five are held back from the default run because they put private messages,
connected peers, peer geography and your own configuration on screen.

## Before you commit

Every shot captures a live instance. Soulseek usernames, local file paths, library
contents, peer addresses and chat history are legible at 2×. Review each PNG before
committing it, using an isolated instance with data suitable for publication.

The transfer and peer pages need particular attention: `uploads`, `users` and the
Overview's Users tab list other people's IP addresses and cities. That third-party
personal data does not belong in a public repository. Only the instance's own IP is
redacted automatically.

The product has additional themes beyond the script's named `light`/`amoled` options.
For Midnight, Ultraviolet or Ember, select the theme in the instance and use
`--theme current`. Review the resulting images rather than assuming an older theme
selector can choose every current palette.

Capturing does not modify the instance. Switching a theme or a tab normally
calls `prefs.set`, which PATCHes `/preferences` and rewrites the account's saved
settings; the script blocks that request for the duration of the run, so those
changes stay local to the throwaway browser profile.

The instance's own public IP is hidden from the status bar in every shot (the
strip item is matched on its globe icon). `--no-redact` leaves it visible.

For the same reason the Overview shot is pinned to its **Analytics** tab. The
page otherwise opens on whichever tab the account last used, and the Users tab is
a table of real peers with IP addresses and cities — not something to land in a
README by accident.

`manifest.json` records the viewport, scale and capture time of the last run. It
is written next to the images so a later run can be matched to the current set.
