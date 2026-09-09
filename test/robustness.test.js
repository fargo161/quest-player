import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createPool, migrate } from '../src/db.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { token, digest } from '../src/security.js';
import * as domain from '../src/domain.js';

const csrf = response => response.text.match(/name="_csrf" value="([\w-]+)"/)?.[1];
test('response loss and recovery concurrency regressions', async t => {
  assert.ok(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL is required.');
  const admin = createPool(process.env.TEST_DATABASE_URL);
  const database = `qp_robust_${Date.now()}_${randomUUID().slice(0,8)}`;
  await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
  const url = new URL(process.env.TEST_DATABASE_URL); url.pathname = `/${database}`;
  const pool = createPool(url.href);
  t.after(async () => { await pool.end(); await admin.end(); });
  await migrate(pool);
  const config = loadConfig({ DATABASE_URL: url.href, SESSION_SECRET: 'regression-secret-'.repeat(4), MISSION_CONTROL_PASSPHRASE: 'regression-staff-passphrase', PUBLIC_BASE_URL: 'http://localhost:3000' });
  // Mail delivery is covered by the SMTP integration suite. These cases exercise token transactions.
  const app = createApp({ pool, config, mailer: { sendMail: async () => {} } });
  let playerId;
  await t.test('lost signup response retains original browser session and identity on retry', async () => {
    const start = await request(app).get('/start/as-above-so-below').expect(200);
    const originalCookie = start.headers['set-cookie'][0].split(';')[0];
    const body = { _csrf: csrf(start), display_name: 'Lost response player' };
    // Deliberately ignore the POST response and continue using only the original GET cookie.
    await request(app).post('/start/as-above-so-below').set('Cookie', originalCookie).type('form').send(body).expect(303);
    await request(app).get('/me').set('Cookie', originalCookie).expect(200);
    await Promise.all([1,2].map(() => request(app).post('/start/as-above-so-below').set('Cookie', originalCookie).type('form').send(body).expect(303)));
    const players = await pool.query('SELECT id FROM players');
    assert.equal(players.rowCount, 1); playerId = players.rows[0].id;
    assert.equal((await pool.query('SELECT count(*) FROM player_quests')).rows[0].count, '1');
    await pool.query("UPDATE players SET email='regression@example.test',email_verified_at=now() WHERE id=$1", [playerId]);
  });
  async function recoveryToken() {
    const raw = token();
    await pool.query("INSERT INTO email_tokens(token_hash,player_id,email,purpose,expires_at) VALUES($1,$2,'regression@example.test','recover',now()+interval '20 minutes')", [digest(raw, config.secret), playerId]);
    return raw;
  }
  await t.test('different recovery tokens serialize without deadlock and only one succeeds', async () => {
    const left = request.agent(app), right = request.agent(app);
    const a = await left.get('/recover'), b = await right.get('/recover');
    const tokens = await Promise.all([recoveryToken(), recoveryToken()]);
    const results = await Promise.all([
      left.post('/auth/token').type('form').send({ _csrf: csrf(a), token: tokens[0], purpose: 'recover' }),
      right.post('/auth/token').type('form').send({ _csrf: csrf(b), token: tokens[1], purpose: 'recover' }),
    ]);
    assert.deepEqual(results.map(r => r.status).sort(), [303,400]);
    assert.equal((await pool.query('SELECT count(*) FROM sessions WHERE player_id=$1', [playerId])).rows[0].count, '1');
    assert.equal((await pool.query('SELECT count(*) FROM email_tokens WHERE used_at IS NULL')).rows[0].count, '0');
  });
  await t.test('failed session insertion rolls back token consumption and session revocation', async () => {
    const browser = request.agent(app); const page = await browser.get('/recover');
    const raw = await recoveryToken();
    const oldSessions = (await pool.query('SELECT token_hash FROM sessions WHERE player_id=$1 ORDER BY token_hash', [playerId])).rows;
    await pool.query("CREATE FUNCTION fail_recovery_session() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected session failure'; END $$");
    await pool.query('CREATE TRIGGER fail_recovery BEFORE INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION fail_recovery_session()');
    try {
      await browser.post('/auth/token').type('form').send({ _csrf: csrf(page), token: raw, purpose: 'recover' }).expect(500);
      assert.equal((await pool.query('SELECT used_at FROM email_tokens WHERE token_hash=$1', [digest(raw,config.secret)])).rows[0].used_at, null);
      assert.deepEqual((await pool.query('SELECT token_hash FROM sessions WHERE player_id=$1 ORDER BY token_hash', [playerId])).rows, oldSessions);
    } finally {
      await pool.query('DROP TRIGGER fail_recovery ON sessions');
      await pool.query('DROP FUNCTION fail_recovery_session()');
    }
    await browser.post('/auth/token').type('form').send({ _csrf: csrf(page), token: raw, purpose: 'recover' }).expect(303);
  });
  await t.test('old completion replay cannot reverse a later correction', async () => {
    const questId = (await pool.query('SELECT id FROM quests')).rows[0].id;
    const original = { playerId, questId, operator: 'QA', requestId: randomUUID() };
    await domain.completeQuest(pool, original);
    await domain.correctQuest(pool, { ...original, requestId: randomUUID(), reason: 'Incorrect completion' });
    const replay = await domain.completeQuest(pool, original);
    assert.equal(replay.status, 'COMPLETED');
    const current = await domain.profile(pool, playerId);
    assert.equal(current.participations[0].status, 'ACTIVE');
    assert.equal(current.rewards[0].suspended, true);
    assert.equal(current.audit.length, 2);
  });
  console.log(`Regression evidence database retained: ${database}`);
});
