import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";

const require = createRequire(
  new URL("../../../frontend/package.json", import.meta.url),
);
const { chromium } = require("playwright");
const fixture = JSON.parse(process.env.STATUS_BROWSER_FIXTURE);
const screenshots =
  process.env.STATUS_SCREENSHOTS || "/tmp/resonance-status-screenshots";
await mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({ chromiumSandbox: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.url().includes("/__site/assets/") && response.status() >= 400)
      errors.push(response.url());
  });
  for (const state of [
    "unavailable",
    "starting",
    "restarting",
    "maintenance",
    "frontend-unavailable",
  ]) {
    const response = await page.request.get(
      `${fixture.origin}/__site/assets/${state}.html`,
    );
    // Documents are intentionally not publicly accessible as assets.
    assert.equal(response.status(), 404);
  }
  const response = await page.goto(
    `${fixture.origin}/uploads?keep=status-theme`,
  );
  assert.equal(response.status(), 503);
  await page.locator("#motion-toggle:visible").waitFor();
  for (const [name, width, height] of [
    ["desktop", 1440, 1000],
    ["mobile", 390, 844],
    ["small-mobile", 320, 700],
  ]) {
    await page.setViewportSize({ width, height });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    assert.equal(
      await page
        .locator("main")
        .evaluate((el) =>
          getComputedStyle(el).backgroundImage.includes("linear-gradient"),
        ),
      true,
    );
    await page.screenshot({
      path: `${screenshots}/${name}.png`,
      fullPage: true,
    });
  }
  const ribbon = page.locator(".scene-ribbon--front");
  const transform = () =>
    ribbon.evaluate((el) => getComputedStyle(el).transform);
  const initial = await transform();
  await delay(150);
  assert.notEqual(await transform(), initial, "Background moves");
  await page
    .getByRole("button", { name: "Pause background animation" })
    .click();
  const paused = await transform();
  await delay(150);
  assert.equal(await transform(), paused, "Pause freezes ribbons");
  await page.getByRole("button", { name: "Play background animation" }).click();
  await delay(150);
  assert.notEqual(await transform(), paused, "Play resumes ribbons");
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  assert.equal(
    await ribbon.evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  assert.equal(await page.locator("#motion-toggle").isVisible(), false);
  assert.equal(
    await page
      .locator("html")
      .evaluate((el) => getComputedStyle(el).colorScheme),
    "dark",
  );
  assert.equal(
    await page
      .locator(".mark")
      .evaluate((el) => el.currentSrc.endsWith("/mark-static.svg")),
    true,
  );
  await page.screenshot({
    path: `${screenshots}/reduced-motion.png`,
    fullPage: true,
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await Promise.all([
    page.waitForNavigation(),
    page.getByRole("button", { name: "Try again" }).click(),
  ]);
  assert.equal(new URL(page.url()).search, "?keep=status-theme");
  await page.evaluate(() =>
    localStorage.setItem("status-theme-retained", "keep"),
  );
  await writeFile(
    fixture.mode,
    JSON.stringify({ state: "available", status: 200 }),
  );
  await page.waitForFunction(
    () => document.body.textContent.includes("APP_READY"),
    null,
    { timeout: 15000 },
  );
  assert.equal(new URL(page.url()).pathname, "/uploads");
  assert.equal(
    await page.evaluate(() => localStorage.getItem("status-theme-retained")),
    "keep",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: desktop/mobile layout, assets, motion, pause, reduced motion, retry and automatic recovery",
  );
} finally {
  await browser.close();
}
