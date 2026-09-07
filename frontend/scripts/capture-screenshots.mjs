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
  { caption: 'Music library', file: 'library.png', route: 'library' },
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
  { caption: 'Audio converter', file: 'converter.png', route: 'converter' },
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
  --theme <name>       light | amoled | current         (default current)
  --width <px>         Viewport width                   (default 1440)
  --height <px>        Viewport height                  (default 900)
  --scale <n>          Device pixel ratio               (default 2)
  --settle <ms>        Pause before each shot           (default 2500)
  --full-page          Capture the full scroll height rather than the viewport
  --no-redact          Leave the instance's public IP visible in the status bar
  --headed             Show the browser while it works
  --list               Print the shot list and exit
  --help               This message

Capturing does not change the instance: preference writes (theme, tab choices)
are blocked for the duration of the run, so they stay local to the browser.
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
    outputDir: path.resolve(repoRoot, options.out ?? 'docs/screenshots'),
    password: options.password ?? RESONANCE_PASSWORD,
    scale: Number(options.scale ?? 2),
    settle: Number(options.settle ?? 2_500),
    theme: options.theme ?? 'current',
    username: options.username ?? RESONANCE_USERNAME,
    width: Number(options.width ?? 1_440),
  };

  if (!['amoled', 'current', 'light'].includes(config.theme)) {
    throw new UsageError(
      `--theme must be light, amoled or current (got "${config.theme}")`,
    );
  }

  for (const name of ['width', 'height', 'scale', 'settle']) {
    if (!Number.isFinite(config[name]) || config[name] <= 0) {
      throw new UsageError(`--${name} must be a positive number`);
    }
  }

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

  for (let attempt = 0; attempt < 3; attempt++) {
    const isAmoled = await page.evaluate(() =>
      document.documentElement.classList.contains('amoled'),
    );
    if (isAmoled === (config.theme === 'amoled')) return;

    const button = page
      .locator('.app-nav-item-label', { hasText: /^(?:Light|AMOLED)$/u })
      .first();
    if ((await button.count()) === 0) {
      console.warn('⚠ theme button not found — leaving the theme as it is');
      return;
    }

    await button.click();
    await page.waitForTimeout(400);
  }

  console.warn(
    `⚠ could not settle on the "${config.theme}" theme — carrying on regardless`,
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
    .waitForLoadState('networkidle', { timeout: 8_000 })
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
  for (const { caption, file, route } of captured) {
    merged.set(file, { caption, file, route });
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

  const browser = await chromium.launch({ headless: !config.headed });
  const context = await browser.newContext({
    deviceScaleFactor: config.scale,
    reducedMotion: 'reduce',
    viewport: { height: config.height, width: config.width },
  });
  const page = await context.newPage();

  // Switching a tab or a theme calls prefs.set, which PATCHes /preferences and
  // would rewrite the account's saved settings.  Dropping the PATCH keeps those
  // changes local to this browser, so capturing never edits the instance.
  await page.route('**/api/v0/preferences', async (route) => {
    if (route.request().method() === 'PATCH') {
      await route.abort();
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
      try {
        await page.goto(`${config.baseUrl}/${shot.route}`, {
          timeout: 30_000,
          waitUntil: 'domcontentloaded',
        });
        await waitForPage(page, config);

        // Re-asserted per page: each route is a full navigation, so a theme that
        // did not survive the reload would otherwise skew every later shot.
        await applyTheme(page, config);

        if (shot.prepare) {
          await shot.prepare(page);
          await page.waitForTimeout(config.settle);
        }

        if (!config.noRedact) await redact(page);

        await page.screenshot({
          fullPage: config.fullPage,
          path: path.join(config.outputDir, shot.file),
        });
        console.log(`  ✓ ${shot.file.padEnd(20)} ${shot.caption}`);
        captured.push(shot);
      } catch (error) {
        console.warn(
          `  ✗ ${shot.file.padEnd(20)} ${error.message.split('\n')[0]}`,
        );
        failed.push(shot);
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
