// Render the same CSS timeline used by the browser logos for the native image.
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { chromium } = require('playwright');
const output = process.argv[2];
if (!output) throw new Error('Pass a directory for the rendered frames');
await mkdir(output, { recursive: true });

const size = 144;
const duration = 3600;
const step = 40;
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const svg = await readFile(new URL('../../branding/impact.svg', import.meta.url), 'utf8');
  await page.setContent(`<style>body{margin:0} svg{display:block;width:100%;height:100%}</style>${svg}`);
  await page.evaluate(() => document.getAnimations().forEach((animation) => animation.pause()));
  for (let time = 0; time < duration; time += step) {
    await page.evaluate((time) => {
      document.getAnimations().forEach((animation) => { animation.currentTime = time; });
    }, time);
    await page.screenshot({ path: join(output, String(time).padStart(4, '0') + '.png'), omitBackground: true });
  }
} finally {
  await browser.close();
}
