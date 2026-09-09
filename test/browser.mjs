import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createPool, migrate } from '../src/db.js';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
assert.ok(databaseUrl, 'Set TEST_DATABASE_URL to a disposable PostgreSQL service with CREATEDB privilege.');
const admin = createPool(databaseUrl);
const database = `qp_browser_${Date.now()}_${randomUUID().slice(0, 8)}`;
let pool, server, browser;
const screenshots = new URL('../docs/screenshots/', import.meta.url);
const evidence = { database, viewport: { width: 390, height: 844 }, checks: [], errors: [], expectedMediaFailures: [], screenshots: [] };
const unexpected = [];
let created = false;
async function capture(page, name) {
  await page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, screenshots)), fullPage: true });
  evidence.screenshots.push(`${name}.png`);
  const sizing = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth }));
  assert.ok(sizing.width <= sizing.viewport, `${name}: no horizontal overflow (${sizing.width}/${sizing.viewport})`);
  evidence.checks.push(`${name}: no horizontal overflow`);
}
function observe(page) {

  page.on('pageerror', error => unexpected.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') {
      const location = message.location().url || '';
      if (location.includes('missing-intro-video.mp4')) evidence.expectedMediaFailures.push(message.text());
      else unexpected.push(`console: ${message.text()} ${location}`);
    }
  });
  page.on('requestfailed', request => {
    if (request.url().includes('missing-intro-video.mp4')) evidence.expectedMediaFailures.push(request.failure()?.errorText || 'media failed');
    else unexpected.push(`request failed: ${request.url()} ${request.failure()?.errorText}`);
  });
}
async function clickAndWait(page, roleName, url) {
  await Promise.all([page.waitForURL(url), page.getByRole('button', { name: roleName, exact: true }).click()]);
}
try {
  await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
  created = true;
  const url = new URL(databaseUrl); url.pathname = `/${database}`;
  pool = createPool(url.href);
  await migrate(pool);
  const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url.href, PUBLIC_BASE_URL: 'http://127.0.0.1:3000', SESSION_SECRET: 'browser-test-secret-'.repeat(3), MISSION_CONTROL_PASSPHRASE: 'browser-staff-passphrase' });
  const app = createApp({ pool, config, mailer: { async sendMail() {} } });
  server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  config.baseUrl = `http://127.0.0.1:${server.address().port}`;
  await pool.query('UPDATE quests SET intro_video_url=$1', [`${config.baseUrl}/missing-intro-video.mp4`]);
  await mkdir(screenshots, { recursive: true });
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : undefined), headless: true });
  const playerContext = await browser.newContext({ viewport: evidence.viewport, isMobile: true, deviceScaleFactor: 1, hasTouch: true });
  await playerContext.route('**/missing-intro-video.mp4', route => route.abort('failed'));
  await playerContext.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
  const player = await playerContext.newPage(); observe(player);
  await player.goto(`${config.baseUrl}/start/as-above-so-below`);
  assert.equal(await player.locator('link[rel="stylesheet"]').getAttribute('href'), '/assets/styles.css');
  assert.equal(await player.locator('body').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
  assert.equal(await player.locator('html').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(9, 20, 36)');
  await capture(player, '01-mobile-start');
  await player.getByLabel('Nickname', { exact: true }).fill('Mobile Demo Player');
  await clickAndWait(player, 'Create profile & enter quest', '**/intro/as-above-so-below');
  await player.getByRole('heading', { name: 'Before you begin' }).waitFor();
  await player.locator('video').evaluate(video => { video.load(); });
  await player.waitForFunction(() => document.querySelector('video').networkState === 3, null, { timeout: 10000 });
  await capture(player, '02-mobile-intro-media-failure');
  await clickAndWait(player, 'Continue to my profile', '**/me');
  await player.getByText('ACTIVE', { exact: true }).waitFor();
  await player.getByText('Without a verified email, losing this browser session may mean losing access to this account.', { exact: true }).waitFor();
  const publicId = (await player.locator('.identity .player-id').textContent()).trim();
  assert.match(publicId, /^QP-[A-Z0-9]{5}$/);
  await capture(player, '03-mobile-active-profile');
  evidence.checks.push('Player signup, durable profile, stable Player ID, failed video fallback and Continue');

  const staffContext = await browser.newContext({ viewport: evidence.viewport, isMobile: true, deviceScaleFactor: 1, hasTouch: true });
  await staffContext.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
  const staff = await staffContext.newPage(); observe(staff);
  await staff.goto(`${config.baseUrl}/admin/login`);
  await staff.getByLabel('Your name or initials').fill('DEMO');
  await staff.getByLabel('Shared staff passphrase').fill(config.adminPassphrase);
  await clickAndWait(staff, 'Sign in to Mission Control', '**/admin');
  await staff.getByLabel('Find a player by nickname or Player ID').fill(publicId);
  await clickAndWait(staff, 'Search players', /\/admin\?q=/);
  await staff.locator('a.result').click();
  await staff.getByRole('heading', { name: 'Player record', exact: true }).waitFor();
  await staff.getByRole('button', { name: 'Mark quest completed', exact: true }).click();
  await staff.getByText('ELIGIBLE', { exact: true }).waitFor();
  await staff.getByRole('button', { name: 'Record selection for glass', exact: true }).click();
  await staff.getByRole('heading', { name: 'Confirm physical handoff' }).waitFor();
  const checkbox = staff.getByRole('checkbox');
  assert.equal(await checkbox.isChecked(), false);
  await staff.getByRole('button', { name: 'Record glass as handed over', exact: true }).click();
  assert.equal(await staff.locator('input[name="confirm"]').evaluate(el => el.validity.valueMissing), true);
  await capture(staff, '04-mobile-staff-handoff');
  await checkbox.check();
  await staff.getByRole('button', { name: 'Record glass as handed over', exact: true }).click();
  await staff.getByText('FULFILLED', { exact: true }).waitFor();
  await player.reload();
  await player.getByText('COMPLETED', { exact: true }).waitFor();
  await player.getByText('FULFILLED', { exact: true }).waitFor();
  assert.equal((await player.locator('.identity .player-id').textContent()).trim(), publicId);
  await capture(player, '05-mobile-fulfilled-profile');
  evidence.checks.push('Separate staff session, Player ID lookup, completion, selection, required physical handoff confirmation, fulfillment visible in original player session');

  // State and audit are also exercised independently by the PostgreSQL integration suite.
  evidence.operatorAuditRows = (await pool.query('SELECT count(*) FROM operator_actions')).rows[0].count;
  assert.equal(evidence.operatorAuditRows, '3');
  evidence.checks.push('Three staff operations produce three operator audit records');
  evidence.errors = unexpected;
  assert.deepEqual(unexpected, [], 'No unexpected browser errors');
  assert.ok(evidence.expectedMediaFailures.length, 'Deliberate video failure was observed');
  evidence.result = 'PASS';
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  evidence.result = 'FAIL'; evidence.failure = error.stack; evidence.errors = unexpected;
  throw error;
} finally {
  await mkdir(screenshots, { recursive: true });
  await writeFile(new URL('browser-results.json', screenshots), JSON.stringify(evidence, null, 2));
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
  if (pool) await pool.end();
  if (created) console.log(`Synthetic browser database retained: ${database}`);
  await admin.end();
}




