# Screenshots

This directory holds the [README gallery](../../README.md#screenshots) and supporting captures.
Desktop screenshots are produced by [`frontend/scripts/capture-screenshots.mjs`](../../frontend/scripts/capture-screenshots.mjs),
which drives a running instance with Playwright. Stable filenames keep the gallery
links usable when the screens are recaptured.

The README gallery was captured on **21 October 2026** from the isolated, analysed
15-track library. It uses a 1600×1000 desktop viewport at 1.5× pixel density, with
Midnight and Daylight themes. Larger workspace views use 80% interface scale; the
library and player use 100%. Each image's settings and capture date are recorded in
`manifest.json`. Screens and features can change after that date.

The [Android and iOS gallery](../../mobile/README.md#screenshots) uses separate native
development builds. See the [mobile capture guide](mobile/README.md) and
[`mobile/manifest.json`](mobile/manifest.json) for devices, dates and scope; these
images are not produced by the desktop Playwright script.

## Capturing

Start an isolated Resonance instance with test music and configured workers, then
from `frontend/` install the capture browser once:

```bash
npx playwright install chromium --only-shell
```

Supply credentials through the environment, then choose the views to capture:

```bash
export RESONANCE_USERNAME=admin
export RESONANCE_PASSWORD='your-password'
npm run screenshots -- --url http://localhost:3000 \
  --only library,player,preparation,smart-crates,export,networklink,converter \
  --theme midnight --width 1600 --height 1000 --scale 1.5
```

Omit both if the instance does not require authentication.

For set and mix captures, prepare a populated saved set and choose real track titles
from the test library. For example, replace these names with your own:

```bash
npm run screenshots -- --url http://localhost:3000 \
  --only set-planner,set-rehearsal,mix-preview \
  --set 'My saved set' --mix-from 'Outgoing track' --mix-with 'Incoming track' \
  --theme midnight --width 1600 --height 1000 --scale 1.5 --ui-scale 80
```

The script selects an existing set; it does not create one. Library/player captures
load the first displayed track unless `--track 'Track title'` is supplied. Playback
is muted in the capture browser. Export captures select tracks without starting an
export, writing a drive or launching a conversion.

Useful flags — `npm run screenshots -- --help` lists them all:

| Flag | Purpose |
| --- | --- |
| `--only library,player` | Capture the named views only |
| `--include chat,map` | Add the opt-in pages below |
| `--all` | Every page |
| `--theme midnight` | `light` (Daylight), `amoled`, `midnight`, `violet`, `ember` or `current` |
| `--track`, `--mix-from`, `--mix-with` | Choose real library tracks for player and comparison views |
| `--set` | Select an existing populated set by name |
| `--width` / `--height` / `--scale` | Change the frame; defaults are 1440×900 at 2× |
| `--ui-scale 80` | Set compact interface scale, from 50 to 100; default 100 |
| `--out` | Write to a review directory before copying approved images into the repository |
| `--settle 4000` | Wait longer before shooting, for pages that load slowly |
| `--headed` | Watch the browser work |

## What the README uses

The main image is the analysed track library with its docked player. The expandable
gallery includes albums, the separate player window, set planning, full-set rehearsal,
mix compatibility, automatic preparation, smart crates, conversion, USB export and
Network Link. It uses the actual UI and saved analysis, not fabricated result data.

Overview and Track Analysis are also refreshed in this directory. Older images of
search/duplicates may remain for reference but are not part of the current README
gallery or this capture manifest. Do not describe them as freshly captured.

## The shot list

Capture IDs can differ from URL paths when a view lives inside the library.

| Capture ID | Path | File | Shows |
| --- | --- | --- | --- |
| `library` | `/library` | `library.png` | Analysed tracks and docked waveform/player |
| `albums` | `/library` | `albums.png` | Album artwork browser |
| `player` | `/library`, then player window | `player.png` | Separate player window |
| `preparation` | `/library` | `preparation.png` | Analysis queue and status |
| `smart-crates` | `/library` | `smart-crates.png` | Saved rules and current counts |
| `set-planner` | `/library` | `set-planner.png` | Saved running order and fixed tempo |
| `set-rehearsal` | `/library` | `set-rehearsal.png` | Handover navigation and crossfader |
| `mix-preview` | `/library` | `mix-preview.png` | Outgoing/incoming track comparison |
| `export` | `/export` | `export.png` | Folder-aware export selection |
| `networklink` | `/networklink` | `network-link.png` | Whole-library helper setup |
| `converter` | `/converter` | `converter.png` | Conversion source and output controls |
| `trackanalysis` | `/trackanalysis` | `track-analysis.png` | Cached basic analysis and Camelot keys |
| `overview` | `/overview` | `overview.png` | Analytics dashboard |

Transfer, search, browse, tags, duplicates and yt-dlp captures remain available through
the script. Use `npm run screenshots -- --list` for the complete list.

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

Named theme choices are applied to the capture session and verified before shooting.
Review the resulting colours in both the docked and separate player windows.

Theme and display preferences are isolated to a throwaway browser profile. The script
intercepts preference reads for the chosen theme and prevents preference writes, so
your saved theme/layout is retained. Loading/playing test tracks uses normal application
behaviour and can affect play history; use a test instance. Player views retain their
waveform; other captures close it to give the workspace room.

The instance's own public IP is hidden from the status bar in every shot (the
strip item is matched on its globe icon). `--no-redact` leaves it visible.

For the same reason the Overview shot is pinned to its **Analytics** tab. The
page otherwise opens on whichever tab the account last used, and the Users tab is
a table of real peers with IP addresses and cities — not something to land in a
README by accident.

`manifest.json` records per-image capture dates, themes, interface scale, viewport,
pixel density and source revision. Partial runs merge by filename without changing
other images' recorded dates. Review screenshots before copying them from `--out`
into this directory and committing them. Keep headings and captions plain, without
decorative emoji or icon prefixes.
