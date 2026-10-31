// Deadline snapshots (CLAUDE.md "Deadline deliverables"): loads a network file into the app, then saves
// 1920 x 1080 PNGs at 2x pixel density into snapshots/ (gitignored).
//
//   npm run snapshots -- --file <workbook or CSV> --assets <ID>,<ID> [--dark] [--name "Analysis name"] [--out dir]
//
// The two assets are the blast-radius pair; they need completely separate blast radii (the app suggests one).
// Output lines carry counts and PASS/FAIL only, except a suggested partner, which is an asset ID from your file.
import { existsSync, mkdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

function args(argv) {
  const out = { dark: false, out: 'snapshots' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dark') out.dark = true;
    else if (a === '--file' || a === '--assets' || a === '--name' || a === '--out') out[a.slice(2)] = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
    else { console.error(`Unknown argument: ${a}`); process.exit(2); }
  }
  return out;
}

const opt = args(process.argv.slice(2));
const pair = (opt.assets ?? '').split(',').map((s) => s.trim()).filter(Boolean);
if (opt.help || !opt.file || pair.length !== 2) {
  console.log('Usage: npm run snapshots -- --file <workbook or CSV> --assets <ID>,<ID> [--dark] [--name "Analysis name"] [--out dir]');
  process.exit(opt.help ? 0 : 2);
}
const file = resolve(opt.file);
if (!existsSync(file)) { console.error('FAIL: the data file was not found.'); process.exit(2); }
const outDir = resolve(opt.out);
mkdirSync(outDir, { recursive: true });
const theme = opt.dark ? 'dark' : 'light';

const server = await createServer({ logLevel: 'error', server: { port: 5199, strictPort: false } });
await server.listen();
const base = server.resolvedUrls.local[0];

let browser;
try {
  // Edge is already installed on Windows; otherwise Playwright's Chromium (npx playwright install chromium).
  try { browser = await chromium.launch({ channel: 'msedge' }); } catch { browser = await chromium.launch(); }
} catch {
  console.error('FAIL: no browser. Install Microsoft Edge, or run: npx playwright install chromium');
  await server.close();
  process.exit(1);
}

let failed = 0;
const done = [];
try {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, colorScheme: theme });
  const page = await context.newPage();
  page.on('pageerror', () => { failed++; console.error('FAIL: the app hit an error (open the dashboard in a browser to see it).'); });
  await page.goto(`${base}#/upload`);

  // Load the file the same way as Browse files; the parse runs in the browser.
  await page.setInputFiles('#wb-input', file);
  const analyze = page.getByRole('button', { name: 'Analyze', exact: true });
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'Analyze');
    return document.querySelector('[data-level="error"]') || /could not load/.test(document.body.textContent ?? '') || (b && !b.disabled);
  }, null, { timeout: 180_000 });
  const errors = await page.locator('[data-level="error"]').count();
  if (errors) throw new Error(`the file has ${errors} structure ${errors === 1 ? 'problem' : 'problems'}; open it on the upload page to see them.`);
  if (await analyze.isDisabled()) throw new Error('the calculations could not load (Pyodide needs internet access).');
  if (opt.name) await page.fill('#name-input', opt.name);
  await analyze.click();
  await page.waitForURL(/#\/dashboard/, { timeout: 180_000 });

  const snapshot = async (name, hash) => {
    await page.evaluate((h) => { location.hash = h; }, hash);
    await page.waitForSelector('[data-snap-ready="1"]', { timeout: 60_000 });
    const err = await page.getAttribute('[data-snap-ready]', 'data-snap-error');
    if (err) return err;
    // Blast cones morph in and the camera frames them (about 1.2 s); give fonts and tweens time to settle.
    await page.waitForTimeout(2000);
    const target = `${outDir}/${name}.png`;
    await page.screenshot({ path: target });
    const hidden = await page.$$eval('[data-snap-list]', (els) => els.map((e) => Number(e.getAttribute('data-snap-hidden')) || 0));
    done.push(basename(target));
    console.log(`PASS ${name}.png${hidden.some(Boolean) ? ` (lists cut: ${hidden.join(' and ')} assets not shown, marked "+N more")` : ''}`);
    return null;
  };

  const q = (s) => encodeURIComponent(s);
  const blastHash = (dim) => `#/snapshot?kind=blast&dim=${dim}&a=${q(pair[0])}&b=${q(pair[1])}`;
  const pairProblem = async () => {
    const shared = await page.getAttribute('[data-snap-ready]', 'data-snap-shared');
    const sug = await page.getAttribute('[data-snap-ready]', 'data-snap-suggestion');
    return { shared, sug };
  };

  for (const [name, hash] of [
    [`1-1d-top10-${theme}`, '#/snapshot?kind=top10&dim=1d'],
    [`2-1d-blast-radius-${theme}`, blastHash('1d')],
    [`3-2d-top10-${theme}`, '#/snapshot?kind=top10&dim=2d'],
    [`4-2d-blast-radius-${theme}`, blastHash('2d')],
  ]) {
    const err = await snapshot(name, hash);
    if (!err) continue;
    failed++;
    if (err === 'overlap') {
      const { shared, sug } = await pairProblem();
      console.log(`FAIL ${name}.png: the two assets share ${shared} affected assets, so their blast radii can't be shown side by side.`);
      console.log(sug ? `     Suggested second asset for the first one (an ID from your file): ${sug}` : '     No asset has a blast radius separate from the first one at this depth.');
    } else {
      const why = { missing: 'one of the assets is not in this network (use the asset ID or the abbreviation)', same: 'the two assets are the same', empty: 'one of the assets has no affected assets at this depth' }[err] ?? err;
      console.log(`FAIL ${name}.png: ${why}.`);
    }
  }

  // 5. The full dashboard, full page height, as it opens after Analyze.
  await page.evaluate(() => { location.hash = '#/dashboard'; });
  await page.waitForSelector('#rank-list-h');
  await page.getByRole('button', { name: 'Fit to screen' }).click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${outDir}/5-full-dashboard-${theme}.png`, fullPage: true });
  done.push(`5-full-dashboard-${theme}.png`);
  console.log(`PASS 5-full-dashboard-${theme}.png`);
} catch (e) {
  failed++;
  console.error(`FAIL: ${e.message}`);
} finally {
  await browser.close();
  await server.close();
}
console.log(`${done.length} of 5 snapshots saved to ${outDir}`);
process.exit(failed ? 1 : 0);
