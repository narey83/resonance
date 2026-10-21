# Resonance web application

The React application provides the desktop library and DJ workspace, docked and
separate-window playback, Soulseek tools and administration. It is designed for
larger screens. Interface scale makes the workspace more compact, up to normal size
(100%); waveform detail is a separate player control. The mobile companion lives in
[`../mobile/`](../mobile/).

Updated **21 October 2026**. Features and interface details can change. Use the
[feature inventory](../FEATURES.md) and [DJ workspace guide](../docs/dj-workspace.md)
for current behaviour and configuration requirements.

## Local development

Use Node.js 20 or newer and npm. Start the .NET backend from the repository root:

```sh
dotnet run --project backend/resonance.csproj
```

In another terminal, from this directory:

```sh
npm ci
npm start
```

The development UI uses port 3000. `craco.config.js` proxies `/api`, `/swagger` and
`/hub` to `http://localhost:5030`; adjust that configuration if running a backend on
another address. Use an isolated application directory/database and test audio for
development. Complete first-run setup and configure library roots on a fresh instance.

## Checks

Run from this directory:

```sh
npm run lint
npm run test-unattended -- --runInBand
npm run build
```

Focused regression commands:

| Command | Coverage |
| --- | --- |
| `npm run test:beatgrid` | Saved-timestamp alignment, waveform detail and player-window lifecycle |
| `npm run test:mix-preview` | Compatibility, synchronization, audition and DSP checks |
| `npm run test:set-planner` | Set plans, genre evidence, library preparation and related controls |
| `npm run test:set-rehearsal` | Rehearsal, fixed master tempo, player controls and DSP checks |
| `node scripts/test-mix-dsp.mjs` | Standalone audio-processing/synchronization cases |

The beatgrid matrix uses 15 tracks' saved analysis with synthetic waveform amplitudes;
it measures rendering consistency, not musical correctness. See the
[verification guide](../docs/beatgrid-verification.md). Passing automated tests also
does not replace browser, theme, screen-size or physical-player acceptance checks.

## Themes and player window

The current themes are Daylight, AMOLED, Midnight, Ultraviolet and Ember. Use shared
theme variables for surfaces and text, and refresh canvas rendering when theme or
window state changes. The separate player window shares the main player's audio
and transport; it should not create a second playback stream.

Check the docked and separate player views, menus, overlays and processing controls
when changing theme styles. Keep interface scale, waveform detail and waveform height
independent, and retain the desktop layout across navigation routes.

## Screenshots and documentation

See the [screenshot guide](../docs/screenshots/README.md) before capturing a running
instance. Checked-in screenshots can lag the current UI; the manifest records their
capture date. Product documentation uses plain headings and descriptive links,
without decorative emoji or icon prefixes.
