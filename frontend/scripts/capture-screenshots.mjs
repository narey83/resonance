// <copyright file="capture-screenshots.mjs" company="John Narey">
//    ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮
//   ─╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰  resonance
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) 2026 John Narey.
//   │ Part of Resonance, a Soulseek client based on slskd.
//   │
//   │ This program is free software: you can redistribute it and/or modify
//   │ it under the terms of the GNU Affero General Public License as published
//   │ by the Free Software Foundation, version 3.
//   │
//   │ This program is distributed in the hope that it will be useful,
//   │ but WITHOUT ANY WARRANTY; without even the implied warranty of
//   │ MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
//   │ GNU Affero General Public License for more details.
//   │
//   │ You should have received a copy of the GNU Affero General Public License
//   │ along with this program.  If not, see https://www.gnu.org/licenses/.
//   │
//   │ This program is distributed with Additional Terms pursuant to Section 7
//   │ of the AGPLv3.  See the LICENSE file in the root directory of this
//   │ project for the complete terms and conditions.
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: John Narey
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

// Drives a running Resonance instance with Playwright and writes one PNG per page
// into docs/screenshots/, using the filenames the root README already references.
//
//   npm run screenshots -- --url http://localhost:3000 --username admin --password secret
//
// See docs/screenshots/README.md for the shot list and the privacy note.

import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

// A stable id keeps repeat runs attached to one session rather than registering a
// new device on the account every time.
const DEVICE_ID = 'f0c8b1de-5f2a-4f0e-9a6b-5c4d3e2a1b09';
const DEVICE_NAME = 'Screenshot capture';

const librarySection = async (page, title) => {
  // Hover the visible rail before clicking: labels extend beyond its collapsed width.
  await page.locator('.jb-nav-rail').hover({ position: { x: 16, y: 16 } });
  await page.locator(`.jb-nav-item[title="${title}"]`).click({
    position: { x: 18, y: 16 },
  });
  await page.mouse.move(1_000, 75);
};

const preparePlayer = async (page, config) => {
  await librarySection(page, 'Tracks');
  const rows = page.locator('.jb-track-row');
  await rows.first().waitFor();
  const row = config.track
    ? rows.filter({ has: page.getByTitle(config.track, { exact: true }) })
    : rows.first();
  await row.hover();
  const play = row.locator('.jb-track-play-btn');
  if ((await play.count()) > 0) {
    await play.click();
    const initialPause = page.getByTitle('Pause', { exact: true });
    await initialPause.waitFor();
    await initialPause.click();
  }

  const waveform = page.getByRole('button', { name: 'Waveform', exact: true });
  if ((await waveform.getAttribute('aria-pressed')) !== 'true')
    await waveform.click();
  await page.getByRole('combobox', { name: 'Waveform zoom' }).selectOption('1');
  await page
    .getByRole('combobox', { name: 'Waveform phrase labels' })
    .selectOption('dj');
  await page.locator('.mp-waveform-toolbar').waitFor();
  const scrubber = page.locator('.media-player-scrubber');
  const bounds = await scrubber.boundingBox();
  if (bounds)
    await scrubber.click({ position: { x: bounds.width * 0.36, y: 2 } });
  const pause = page.getByTitle('Pause', { exact: true });
  if (await pause.isVisible()) await pause.click();
  const closeInspector = page.getByRole('button', {
    name: 'Close track inspector',
  });
  if (await closeInspector.isVisible()) await closeInspector.click();
};

const prepareSet = async (page, config) => {
  await librarySection(page, 'Set Planner');
  const select = page.getByRole('combobox', { name: 'Saved sets' });
  await select.waitFor();
  await page.waitForFunction(() =>
    [...document.querySelector('[aria-label="Saved sets"]').options].some(
      (option) => option.value && /[1-9]\d* tracks$/u.test(option.text),
    ),
  );
  const options = await select
    .locator('option')
    .evaluateAll((items) =>
      items.map((option) => ({ value: option.value, text: option.text })),
    );
  const selected = options.find((option) =>
    config.setName
      ? option.text.startsWith(`${config.setName} ·`)
      : option.value && /[1-9]\d* tracks$/u.test(option.text),
  );
  if (!selected)
    throw new Error('A populated saved set is required for this shot');
  await select.selectOption(selected.value);
  await page.getByRole('list', { name: 'Set running order' }).waitFor();
};

const prepareMix = async (page, config) => {
  await page.getByRole('button', { name: 'Mix preview', exact: true }).click();
  const back = page.getByRole('button', {
    name: 'Back to comparison',
    exact: true,
  });
  if ((await back.count()) > 0) await back.click();
  for (const [side, title] of [
    ['A', config.mixFrom],
    ['B', config.mixWith],
  ]) {
    await page
      .locator('.mix-deck')
      .nth(side === 'A' ? 0 : 1)
      .getByRole('button', { name: /^(?:Change track|Choose track)$/u })
      .click();
    const picker = page.getByRole('region', { name: `Choose ${side} track` });
    const search = page.getByRole('textbox', {
      name: 'Search mix preview library',
    });
    if (title) await search.fill(title);
    const choice = title
      ? page.getByRole('button', {
          name: `Choose ${title} for ${side}`,
          exact: true,
        })
      : picker.locator('button[aria-label^="Choose "]:enabled').first();
    await choice.click();
  }

  await page.getByRole('dialog', { name: 'Mix compatibility' }).waitFor();
  await page.locator('.mix-deck').first().waitFor();
};

// route: the path under the app's base URL.  file: the name the README expects.
const SHOTS = [
  {
    caption: 'Overview dashboard',
    file: 'overview.png',
    // The Overview remembers its last tab per account, and the Users tab is a
    // table of real peers with IP addresses and cities.  Land on Analytics so a
    // README shot never depends on which tab the account happened to leave open.
    prepare: async (page) => {
      const analytics = page
        .locator('.overview-tab', { hasText: 'Analytics' })
        .first();
      if ((await analytics.count()) > 0) await analytics.click();
    },
    route: 'overview',
  },
  {
    caption: 'Soulseek search',
    file: 'search.png',
    // The page opens on a prompt to pick a search; select the newest saved one so
    // the shot shows actual results and their filters.
    prepare: async (page) => {
      const first = page.locator('.sr-search-item').first();
      if ((await first.count()) > 0) await first.click();
    },
    route: 'searches',
  },
  {
    caption: 'Music library with analysed waveforms and docked player',
    file: 'library.png',
    prepare: preparePlayer,
    route: 'library',
  },
  {
    caption: 'Album browser',
    file: 'albums.png',
    path: 'library',
    prepare: (page) => librarySection(page, 'Albums'),
    route: 'albums',
  },
  {
    caption: 'Automatic library preparation',
    file: 'preparation.png',
    path: 'library',
    prepare: (page) => librarySection(page, 'Preparation'),
    route: 'preparation',
  },
  {
    caption: 'Smart crates and saved library rules',
    file: 'smart-crates.png',
    path: 'library',
    prepare: (page) => librarySection(page, 'Smart crates'),
    route: 'smart-crates',
  },
  {
    caption: 'Set planner with fixed master tempo and transition guidance',
    file: 'set-planner.png',
    path: 'library',
    prepare: prepareSet,
    route: 'set-planner',
  },
  {
    caption: 'Full-set rehearsal',
    file: 'set-rehearsal.png',
    path: 'library',
    prepare: async (page, config) => {
      await prepareSet(page, config);
      await page
        .getByRole('button', { name: 'Rehearse set', exact: true })
        .click();
      await page.getByRole('dialog', { name: 'Full-set rehearsal' }).waitFor();
      await page
        .getByRole('slider', { name: 'Crossfader', exact: true })
        .scrollIntoViewIfNeeded();
    },
    route: 'set-rehearsal',
  },
  {
    caption: 'Ending-to-opening mix compatibility and synced preview',
    file: 'mix-preview.png',
    path: 'library',
    prepare: prepareMix,
    route: 'mix-preview',
  },
  {
    caption: 'Separate player window with phrase-coloured waveform',
    file: 'player.png',
    path: 'library',
    prepare: async (page, config) => {
      await preparePlayer(page, config);
      const opened = page.waitForEvent('popup');
      await page
        .getByRole('button', { name: 'Open player window', exact: true })
        .click();
      const player = await opened;
      await player.setViewportSize({
        height: config.height,
        width: config.width,
      });
      await player.locator('.mp-expanded--popout').waitFor();
      return player;
    },
    route: 'player',
  },
  {
    caption: 'Folder-aware Pioneer USB export wizard',
    file: 'export.png',
    prepare: async (page) => {
      await page
        .getByRole('button', { name: 'Select all', exact: true })
        .click();
    },
    route: 'export',
  },
  {
    caption: 'Whole-library Pioneer Network Link',
    file: 'network-link.png',
    route: 'networklink',
  },
  {
    caption: 'Track analysis',
    file: 'track-analysis.png',
    // Only a fraction of a large library is analysed at any time, so the default
    // listing is mostly empty Key/BPM cells.  Filter to the analysed tracks, then
    // expand, so the columns the page exists for actually carry values.
    prepare: async (page) => {
      const analysed = page
        .getByRole('button', { name: /Fully analysed/u })
        .first();
      if ((await analysed.count()) > 0) {
        await analysed.click();
        await page.waitForTimeout(1_500);
      }

      // Applying the filter re-renders the list and resets the toggle, so click
      // until the button actually flips to "Collapse all".
      for (let attempt = 0; attempt < 3; attempt++) {
        const expand = page
          .getByRole('button', { name: /Expand all/u })
          .first();
        if ((await expand.count()) === 0) break;
        await expand.click();
        await page.waitForTimeout(1_200);
      }
    },
    route: 'trackanalysis',
  },
  { caption: 'Downloads', file: 'downloads.png', route: 'downloads' },
  { caption: 'Uploads', file: 'uploads.png', route: 'uploads' },
  { caption: 'Transfer history', file: 'history.png', route: 'history' },
  { caption: "Browse a peer's shares", file: 'browse.png', route: 'browse' },
  { caption: 'Tag editor', file: 'tags.png', route: 'tags' },
  {
    caption: 'Duplicate detection',
    file: 'duplicates.png',
    // Opening the page kicks off a scan that easily outlasts the settle delay.
    prepare: async (page) => {
      await page
        .waitForFunction(
          () => !/Scanning[.…]/u.test(document.body.textContent ?? ''),
          {
            timeout: 120_000,
          },
        )
        .catch(() => {});
    },
    route: 'duplicates',
  },
  {
    caption: 'Audio converter with individual track selection',
    file: 'converter.png',
    prepare: async (page) => {
      await page.locator('.converter-folder-toggle').first().click();
      const tracks = page.locator('.converter-track input[type="checkbox"]');
      await tracks.first().waitFor();
      for (let index = 0; index < Math.min(3, await tracks.count()); index++)
        await tracks.nth(index).check();
      await page
        .getByRole('group', { name: 'Output format' })
        .getByRole('button', { name: /^FLAC/u })
        .click();
    },
    route: 'converter',
  },
  { caption: 'yt-dlp ingest', file: 'ytdlp.png', route: 'ytdlp' },
];

// Held back from the default run: these show private messages, connected peers,
// peer geography and your own configuration.  Opt in with --include.
const OPTIONAL_SHOTS = [
  { caption: 'Private chat', file: 'chat.png', route: 'chat' },
  { caption: 'Chat rooms', file: 'rooms.png', route: 'rooms' },
  { caption: 'Users', file: 'users.png', route: 'users' },
  { caption: 'Peer map', file: 'map.png', route: 'map' },
  { caption: 'System', file: 'system.png', route: 'system' },
];

const usage = `
Capture Resonance web app screenshots for the README.

  npm run screenshots -- [options]

Options
  --url <url>          Base URL of a running instance   (default http://localhost:3000)
  --username <name>    Account to log in as             (env RESONANCE_USERNAME)
  --password <pass>    Password                         (env RESONANCE_PASSWORD)
  --out <dir>          Output directory                 (default docs/screenshots)
  --only <a,b>         Capture just these routes
  --include <a,b>      Add opt-in routes: ${OPTIONAL_SHOTS.map((s) => s.route).join(', ')}
  --all                Every route, opt-in ones included
  --theme <name>       light | amoled | midnight | violet | ember | current
  --track <title>      Track to load for library/player captures (default first displayed)
  --mix-from <title>   Outgoing track for the mix-preview capture
  --mix-with <title>   Incoming track for the mix-preview capture
  --set <name>         Existing populated set for planner/rehearsal captures
  --width <px>         Viewport width                   (default 1440)
  --height <px>        Viewport height                  (default 900)
  --scale <n>          Device pixel ratio               (default 2)
  --ui-scale <n>       Interface scale from 50 to 100    (default 100)
  --settle <ms>        Pause before each shot           (default 2500)
  --full-page          Capture the full scroll height rather than the viewport
  --no-redact          Leave the instance's public IP visible in the status bar
  --headed             Show the browser while it works
  --list               Print the shot list and exit
  --help               This message

Display preference writes are isolated to the capture browser. Loading or playing
tracks can update play history; use an isolated instance with test music.
`;

const parseArgs = (argv) => {
  const flags = new Set([
    'all',
    'full-page',
    'headed',
    'help',
    'list',
    'no-redact',
  ]);
  const parsed = {};

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (!argument.startsWith('--')) continue;

    const body = argument.slice(2);
    const equals = body.indexOf('=');
    const name = equals === -1 ? body : body.slice(0, equals);

    if (flags.has(name)) {
      parsed[name] = true;
    } else {
      parsed[name] = equals === -1 ? argv[++index] : body.slice(equals + 1);
    }
  }

  return parsed;
};

const printList = () => {
  console.log('\nDefault shots:');
  for (const shot of SHOTS)
    console.log(`  ${shot.route.padEnd(14)} → ${shot.file}`);
  console.log('\nOpt-in shots (--include or --all):');
  for (const shot of OPTIONAL_SHOTS)
    console.log(`  ${shot.route.padEnd(14)} → ${shot.file}`);
  console.log();
};

// Anything the user can put right by re-running with different arguments.
class UsageError extends Error {}

const buildConfig = (options) => {
  // eslint-disable-next-line n/no-process-env
  const { RESONANCE_PASSWORD, RESONANCE_USERNAME } = process.env;

  const config = {
    baseUrl: (options.url ?? 'http://localhost:3000').replace(/\/+$/u, ''),
    fullPage: Boolean(options['full-page']),
    headed: Boolean(options.headed),
    height: Number(options.height ?? 900),
    noRedact: Boolean(options['no-redact']),
    mixFrom: options['mix-from'],
    mixWith: options['mix-with'],
    outputDir: path.resolve(repoRoot, options.out ?? 'docs/screenshots'),
    password: options.password ?? RESONANCE_PASSWORD,
    scale: Number(options.scale ?? 2),
    settle: Number(options.settle ?? 2_500),
    setName: options.set,
    theme: options.theme ?? 'current',
    track: options.track,
    username: options.username ?? RESONANCE_USERNAME,
    uiScale: Number(options['ui-scale'] ?? 100),
    width: Number(options.width ?? 1_440),
  };

  if (
    !['amoled', 'current', 'ember', 'light', 'midnight', 'violet'].includes(
      config.theme,
    )
  ) {
    throw new UsageError(
      `Unknown theme "${config.theme}"; see --help for supported themes`,
    );
  }

  for (const name of ['width', 'height', 'scale', 'settle']) {
    if (!Number.isFinite(config[name]) || config[name] <= 0) {
      throw new UsageError(`--${name} must be a positive number`);
    }
  }

  if (
    !Number.isInteger(config.uiScale) ||
    config.uiScale < 50 ||
    config.uiScale > 100
  )
    throw new UsageError('--ui-scale must be an integer from 50 to 100');

  return config;
};

const selectShots = (options) => {
  const everything = [...SHOTS, ...OPTIONAL_SHOTS];

  if (options.only) {
    const wanted = options.only
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    const chosen = [];
    for (const route of wanted) {
      const shot = everything.find((candidate) => candidate.route === route);
      if (shot) {
        chosen.push(shot);
      } else {
        console.warn(
          `⚠ unknown route "${route}" — run with --list to see the shot list`,
        );
      }
    }

    return chosen;
  }

  if (options.all) return everything;

  if (options.include) {
    const wanted = new Set(
      options.include.split(',').map((entry) => entry.trim()),
    );
    return [
      ...SHOTS,
      ...OPTIONAL_SHOTS.filter((shot) => wanted.has(shot.route)),
    ];
  }

  return SHOTS;
};

const logIn = async (page, config) => {
  const response = await page.request.post(`${config.baseUrl}/api/v0/session`, {
    data: {
      deviceId: DEVICE_ID,
      deviceName: DEVICE_NAME,
      password: config.password,
      username: config.username,
    },
  });

  if (!response.ok()) {
    throw new Error(
      `login failed: HTTP ${response.status()} ${response.statusText()}. ` +
        'Check --username/--password, or omit them if the instance does not require auth.',
    );
  }

  const { refreshToken, sessionId, token } = await response.json();

  // Mirrors lib/session.js: the app reads these keys back on boot.
  await page.evaluate(
    ([accessToken, refresh, session]) => {
      localStorage.setItem('resonance-token', accessToken);
      if (refresh) localStorage.setItem('resonance-refresh-token', refresh);
      if (session) localStorage.setItem('resonance-session-id', session);
    },
    [token, refreshToken, sessionId],
  );
};

// The status strip carries the instance's own public IP.  It is matched on the
// globe icon rather than on the text: the address arrives asynchronously and is
// concatenated with the country and ISP ("92.0.2.1GBExample"), so text matching
// both races the render and breaks on the word boundary.  A stylesheet rule also
// survives the strip's constant re-rendering, which an inline style does not.
const redact = async (page) => {
  await page.addStyleTag({
    content:
      '.status-strip-item:has(svg.lucide-globe){visibility:hidden!important}',
  });
};

const applyTheme = async (page, config) => {
  if (config.theme === 'current') return;
  await page.waitForFunction(
    (theme) => {
      const root = document.documentElement;
      return theme === 'light'
        ? !['amoled', 'dark', 'midnight', 'violet', 'ember'].some((name) =>
            root.classList.contains(name),
          )
        : root.classList.contains(theme);
    },
    config.theme,
    { timeout: 10_000 },
  );
};

const waitForPage = async (page, config) => {
  await page
    .locator('.app-content')
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 });

  // SignalR holds a connection open, so networkidle may never arrive.  Give it a
  // moment, then fall back to the settle delay.
  await page
    .waitForLoadState('networkidle', { timeout: 1_500 })
    .catch(() => {});
  await page.waitForTimeout(config.settle);
};

// Merged with whatever is already on disk: a partial run (--only) must not drop
// the record of shots taken by an earlier one.
const writeManifest = async (config, captured) => {
  const manifestPath = path.join(config.outputDir, 'manifest.json');
  let existing = [];
  try {
    existing = JSON.parse(await readFile(manifestPath, 'utf8')).shots ?? [];
  } catch {
    // No manifest yet, or it is unreadable — start from this run alone.
  }

  const merged = new Map(existing.map((shot) => [shot.file, shot]));
  for (const {
    caption,
    capturedAt,
    file,
    path: routePath,
    route,
    theme,
    uiScale,
  } of captured) {
    merged.set(file, {
      caption,
      capturedAt,
      file,
      path: routePath ?? route,
      route,
      scale: config.scale,
      sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: repoRoot,
        encoding: 'utf8',
      }).trim(),
      theme,
      uiScale,
      viewport: { height: config.height, width: config.width },
    });
  }

  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        scale: config.scale,
        shots: [...merged.values()].sort((a, b) =>
          a.file.localeCompare(b.file),
        ),
        viewport: { height: config.height, width: config.width },
      },
      null,
      2,
    )}\n`,
  );
};

const capture = async (config, shots) => {
  await mkdir(config.outputDir, { recursive: true });

  const where = path.relative(repoRoot, config.outputDir) || config.outputDir;
  console.log(`\n▶ ${config.baseUrl} → ${where}`);
  console.log(
    `  ${config.width}×${config.height} @${config.scale}x · theme: ${config.theme} · ${shots.length} shot(s)\n`,
  );

  const browser = await chromium.launch({
    args: ['--mute-audio'],
    headless: !config.headed,
  });
  const context = await browser.newContext({
    deviceScaleFactor: config.scale,
    reducedMotion: 'reduce',
    screen: { height: config.height, width: config.width },
    viewport: { height: config.height, width: config.width },
  });
  const page = await context.newPage();

  await context.addInitScript(
    ({ theme, uiScale }) => {
      localStorage.setItem('resonance-ui-zoom', String(uiScale));
      localStorage.setItem('resonance-ui-zoom-mode', 'manual');
      if (theme !== 'current') localStorage.setItem('resonance-theme', theme);
    },
    { theme: config.theme, uiScale: config.uiScale },
  );

  // Switching a tab or a theme calls prefs.set, which PATCHes /preferences and
  // would rewrite the account's saved settings.  Dropping the PATCH keeps those
  // changes local to this browser, so capturing never edits the instance.
  await context.route('**/api/v0/preferences', async (route) => {
    if (route.request().method() === 'PATCH') {
      await route.fulfill({ status: 204 });
      return;
    }

    if (route.request().method() === 'GET' && config.theme !== 'current') {
      const response = await route.fetch();
      if (response.ok()) {
        const preferences = await response.json();
        await route.fulfill({
          json: { ...preferences, 'resonance-theme': config.theme },
          response,
        });
      } else await route.fulfill({ response });
      return;
    }

    await route.continue();
  });

  const captured = [];
  const failed = [];

  try {
    await page.goto(config.baseUrl, {
      timeout: 30_000,
      waitUntil: 'domcontentloaded',
    });

    if (config.username && config.password) {
      await logIn(page, config);
      await page.reload({ waitUntil: 'domcontentloaded' });
    } else {
      console.log('  no credentials given — assuming the instance is open\n');
    }

    await waitForPage(page, config);

    for (const shot of shots) {
      let target = page;
      try {
        await page.goto(`${config.baseUrl}/${shot.path ?? shot.route}`, {
          timeout: 30_000,
          waitUntil: 'domcontentloaded',
        });
        await waitForPage(page, config);

        // Re-asserted per page: each route is a full navigation, so a theme that
        // did not survive the reload would otherwise skew every later shot.
        await applyTheme(page, config);

        if (!['library', 'player'].includes(shot.route)) {
          const closePlayer = page.getByRole('button', {
            name: 'Close player',
            exact: true,
          });
          if (await closePlayer.isVisible()) await closePlayer.click();
        }

        if (shot.prepare) {
          target = (await shot.prepare(page, config)) ?? page;
          await target.waitForTimeout(config.settle);
        }

        await target.evaluate(async () => {
          await document.fonts.ready;
          // Offscreen lazy artwork has no pending download to wait for. Even visible
          // images get a bounded wait so one unavailable cover cannot stall a run.
          const visible = [...document.images].filter((image) => {
            const bounds = image.getBoundingClientRect();
            return (
              bounds.width > 0 &&
              bounds.height > 0 &&
              bounds.bottom > 0 &&
              bounds.top < window.innerHeight &&
              bounds.left < window.innerWidth
            );
          });
          await Promise.race([
            Promise.all(visible.map((image) => image.decode().catch(() => {}))),
            new Promise((resolve) => {
              setTimeout(resolve, 2_000);
            }),
          ]);
        });
        await target.mouse.move(2, 2);
        if (!config.noRedact) await redact(target);

        await target.screenshot({
          animations: 'disabled',
          fullPage: config.fullPage,
          path: path.join(config.outputDir, shot.file),
        });
        console.log(`  ✓ ${shot.file.padEnd(20)} ${shot.caption}`);
        const appearance = await target.evaluate(() => ({
          theme:
            ['amoled', 'midnight', 'violet', 'ember'].find((name) =>
              document.documentElement.classList.contains(name),
            ) ?? 'light',
          uiScale: Math.round(
            (Number.parseFloat(document.documentElement.style.zoom) || 1) * 100,
          ),
        }));
        captured.push({
          ...shot,
          ...appearance,
          capturedAt: new Date().toISOString(),
        });
      } catch (error) {
        console.warn(
          `  ✗ ${shot.file.padEnd(20)} ${error.message.split('\n')[0]}`,
        );
        failed.push(shot);
      } finally {
        if (target !== page && !target.isClosed()) await target.close();
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }

  if (captured.length > 0) await writeManifest(config, captured);

  console.log(`\n${captured.length} captured, ${failed.length} failed.`);
  if (captured.length > 0) {
    console.log(
      '\n⚠ These are pictures of your live instance: usernames, file paths, library\n' +
        '  contents and chat may be legible.  Review each one before committing.\n',
    );
  }

  if (failed.length > 0) process.exitCode = 1;
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(usage);
    return;
  }

  if (options.list) {
    printList();
    return;
  }

  const config = buildConfig(options);
  const shots = selectShots(options);

  if (shots.length === 0) throw new UsageError('nothing to capture');

  await capture(config, shots);
};

main().catch((error) => {
  console.error(`\n✗ ${error.message}\n`);
  process.exitCode = 1;
});
