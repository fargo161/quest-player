import express from 'express';
import helmet from 'helmet';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as domain from './domain.js';
import * as views from './views.js';
import {getContent,listContent,saveContent} from './content.js';
import { token, digest, same, httpError, normalizedEmail, uuid, sessionMiddleware, csrf, limiter, issueSession, activateSession } from './security.js';

export function createApp({ pool, config, mailer }) {
  const app = express();
  app.disable('x-powered-by');
  if (config.production) app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"],
    mediaSrc: ["'self'", 'https:'], imgSrc: ["'self'", 'data:', 'https:'],
    formAction: ["'self'"], frameAncestors: ["'none'"],
    upgradeInsecureRequests: config.production ? [] : null,
  } }, referrerPolicy: { policy: 'strict-origin' }, strictTransportSecurity: config.production }));
  app.get('/healthz', async (_req, res) => {
    try { await pool.query({ text: 'SELECT 1', query_timeout: 2000 }); res.json({ ok: true }); }
    catch { res.status(503).json({ ok: false }); }
  });
  app.use('/assets', express.static(fileURLToPath(new URL('../public/', import.meta.url)), { maxAge: '1h' }));
  app.use(express.urlencoded({ extended: false, limit: '128kb', parameterLimit: 50 }));
  app.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use(limiter(pool, config, 'all', 6000, 60));
  app.use(sessionMiddleware(pool, config));
  app.use(csrf(config));
  const playerOnly = (req, res, next) => req.session.player_id ? next() : res.redirect(303, '/start/as-above-so-below');
  const adminOnly = (req, res, next) => req.session.operator && new Date(req.session.admin_expires_at) > new Date() ? next() : res.redirect(303, '/admin/login');
  const currentPlayer = async req => req.session.player_id ? (await pool.query('SELECT * FROM players WHERE id=$1', [req.session.player_id])).rows[0] : null;
  const questBySlug = async slug => {
    if (!/^[a-z0-9-]{1,100}$/.test(slug)) throw httpError(404, 'Quest not found.');
    const quest = (await pool.query('SELECT * FROM quests WHERE slug=$1', [slug])).rows[0];
    if (!quest) throw httpError(404, 'Quest not found.');
    return quest;
  };
  app.get('/', (_req, res) => res.redirect('/start/as-above-so-below'));
  const participationContent = async (quest, playerId) => {
    const state = playerId ? (await pool.query('SELECT status FROM player_quests WHERE player_id=$1 AND quest_id=$2', [playerId, quest.id])).rows[0]?.status || 'NONE' : 'NONE';
    return getContent(pool, quest.id, state);
  };
  app.get('/start/:slug', async (req, res) => {
    const quest = await questBySlug(req.params.slug);
    res.send(views.startPage({ quest, player: await currentPlayer(req), content: await participationContent(quest, req.session.player_id), csrf: req.session.csrf }));
  });
  app.post('/start/:slug', limiter(pool, config, 'signup-ip', 3000, 3600), limiter(pool, config, 'signup-session', 10, 3600, req => req.session.token_hash), async (req, res) => {
    await questBySlug(req.params.slug);
    const client = await pool.connect();
    let playerId;
    try {
      await client.query('BEGIN');
      const session = (await client.query('SELECT * FROM sessions WHERE token_hash=$1 FOR UPDATE', [req.session.token_hash])).rows[0];
      if (!session) throw httpError(409, 'Your session changed. Reload to continue.');
      playerId = session.player_id;
      if (!playerId) {
        const name = typeof req.body.display_name === 'string' ? req.body.display_name.trim() : '';
        if (!name || name.length > 80 || /[\x00-\x1f]/.test(name)) throw httpError(400, 'Enter a nickname of 1 to 80 characters.');
        for (let attempt = 0; attempt < 10 && !playerId; attempt++) {
          const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
          const bytes = randomBytes(5);
          const publicId = 'QP-' + [...bytes].map(b => alphabet[b % alphabet.length]).join('');
          const result = await client.query('INSERT INTO players(id,public_id,display_name) VALUES($1,$2,$3) ON CONFLICT(public_id) DO NOTHING RETURNING id', [randomUUID(), publicId, name]);
          playerId = result.rows[0]?.id;
        }
        if (!playerId) throw httpError(503, 'Please try creating your account again.');
        await client.query('UPDATE sessions SET player_id=$1 WHERE token_hash=$2', [playerId, session.token_hash]);
      }
      await client.query('COMMIT');
    } catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    await domain.enroll(pool, playerId, req.params.slug);
    // This is a new identity bound to an already random, HttpOnly browser session.
    // Retain that cookie so a lost signup response can safely resume the same player.
    req.session.player_id = playerId;
    await pool.query('UPDATE players SET last_seen_at=now() WHERE id=$1', [playerId]);
    res.redirect(303, `/intro/${req.params.slug}`);
  });
  app.get('/intro/:slug', playerOnly, async (req, res) => {
    const quest = await questBySlug(req.params.slug);
    const participation = await pool.query('SELECT 1 FROM player_quests WHERE player_id=$1 AND quest_id=$2', [req.session.player_id, quest.id]);
    if (!participation.rowCount) return res.redirect(303, `/start/${quest.slug}`);
    res.send(views.introPage({ quest, content: await participationContent(quest, req.session.player_id), csrf: req.session.csrf }));
  });
  app.post('/intro/:slug', playerOnly, async (req, res) => {
    const quest = await questBySlug(req.params.slug);
    await pool.query(`INSERT INTO quest_events(player_id,quest_id,event_type,details)
      SELECT player_id,quest_id,'INTRO_VIEWED','{}'::jsonb FROM player_quests WHERE player_id=$1 AND quest_id=$2
      ON CONFLICT DO NOTHING`, [req.session.player_id, quest.id]);
    res.redirect(303, '/me');
  });
  app.get('/me', playerOnly, async (req, res) => {
    const data = await domain.profile(pool, req.session.player_id);
    for (const participation of data.participations) participation.content = await getContent(pool, participation.quest_id, participation.status);
    for (const reward of data.rewards) if (!reward.suspended) reward.content = await getContent(pool, reward.quest_id, reward.status);
    res.send(views.profilePage({ data, csrf: req.session.csrf, message: req.query.sent === '1' ? 'Check your email for a verification link. Your email is not verified until you confirm it.' : req.query.verified === '1' ? 'Your recovery email is verified.' : undefined }));
  });
  app.post('/logout', async (req, res) => { await req.rotateSession(); res.redirect(303, '/'); });
  const emailLimit = limiter(pool, config, 'email-address', 5, 3600, req => String(req.body.email || '').trim().toLowerCase());
  async function sendLink(player, email, purpose) {
    const raw = token(); const hash = digest(raw, config.secret);
    await pool.query("INSERT INTO email_tokens(token_hash,player_id,email,purpose,expires_at) VALUES($1,$2,$3,$4,now()+interval '20 minutes')", [hash, player.id, email, purpose]);
    const url = `${config.baseUrl}/auth/token?token=${raw}&purpose=${purpose}`;
    try {
      await mailer.sendMail({ to: email, subject: purpose === 'verify' ? 'Verify your Quest Player recovery email' : 'Recover your Quest Player account',
        text: `Player ${player.public_id}\n\n${purpose === 'verify' ? 'Confirm this email on the browser where you entered the quest' : 'Recover your account'}:\n${url}\n\nThis link expires in 20 minutes and can be used once. If you did not request it, ignore this email.` });
    } catch(e) { await pool.query('DELETE FROM email_tokens WHERE token_hash=$1', [hash]); throw e; }
  }
  app.post('/me/email', playerOnly, limiter(pool, config, 'verify-ip', 3000, 3600), emailLimit, async (req, res) => {
    const email = normalizedEmail(req.body.email); const player = await currentPlayer(req);
    if (player.email_verified_at) throw httpError(409, 'Your recovery email is already verified. Email changes are not available in this version.');
    try { await sendLink(player, email, 'verify'); } catch { throw httpError(503, 'Email could not be sent. Please try again shortly.'); }
    res.redirect(303, '/me?sent=1');
  });
  app.get('/recover', (req, res) => res.send(views.recoveryPage({ csrf: req.session.csrf })));
  app.post('/recover', limiter(pool, config, 'recover-ip', 3000, 3600), emailLimit, async (req, res) => {
    const email = normalizedEmail(req.body.email);
    const player = (await pool.query('SELECT * FROM players WHERE lower(email)=$1 AND email_verified_at IS NOT NULL', [email])).rows[0];
    if (player) { try { await sendLink(player, email, 'recover'); } catch { console.error('Recovery mail delivery failed.'); } }
    res.send(views.recoveryPage({ csrf: req.session.csrf, message: 'If a verified account matches, a recovery link will arrive shortly. Check spam as well. If it does not arrive, try again later.' }));
  });
  app.get('/auth/token', (req, res) => {
    if (typeof req.query.token !== 'string' || !/^[\w-]{43}$/.test(req.query.token) || !['verify','recover'].includes(req.query.purpose)) throw httpError(400, 'Invalid email link.');
    res.send(views.tokenPage({ token: req.query.token, purpose: req.query.purpose, csrf: req.session.csrf }));
  });
  app.post('/auth/token', limiter(pool, config, 'token-ip', 3000, 3600), limiter(pool, config, 'token-session', 20, 3600, req => req.session.token_hash), async (req, res) => {
    if (typeof req.body.token !== 'string' || !/^[\w-]{43}$/.test(req.body.token) || !['verify','recover'].includes(req.body.purpose)) throw httpError(400, 'Invalid email link.');
    const client = await pool.connect(); let issued;
    try {
      await client.query('BEGIN');
      const tokenHash = digest(req.body.token, config.secret);
      const candidate = (await client.query('SELECT player_id FROM email_tokens WHERE token_hash=$1 AND purpose=$2', [tokenHash, req.body.purpose])).rows[0];
      if (!candidate) throw httpError(400, 'This link has expired or was already used. Request a new email.');
      // Serialize different links for the same player before locking token rows.
      await client.query('SELECT id FROM players WHERE id=$1 FOR UPDATE', [candidate.player_id]);
      const item = (await client.query('SELECT * FROM email_tokens WHERE token_hash=$1 AND purpose=$2 AND used_at IS NULL AND expires_at>now() FOR UPDATE', [tokenHash, req.body.purpose])).rows[0];
      if (!item) throw httpError(400, 'This link has expired or was already used. Request a new email.');
      const playerId = item.player_id;
      if (item.purpose === 'verify') {
        if (req.session.player_id !== playerId) throw httpError(403, 'Open this verification link in the browser where you entered the quest.');
        await client.query('UPDATE players SET email=$1,email_verified_at=now(),updated_at=now() WHERE id=$2 AND email_verified_at IS NULL', [item.email, playerId]);
      } else {
        const valid = await client.query('SELECT 1 FROM players WHERE id=$1 AND email=$2 AND email_verified_at IS NOT NULL', [playerId, item.email]);
        if (!valid.rowCount) throw httpError(400, 'This recovery link is no longer valid.');
      }
      await client.query('UPDATE email_tokens SET used_at=now() WHERE player_id=$1 AND purpose=$2 AND used_at IS NULL', [playerId, item.purpose]);
      if (item.purpose === 'recover') issued = await issueSession(client, config, { oldHash: req.session.token_hash, playerId, operator: null, revokePlayerSessions: true });
      await client.query('COMMIT');
    } catch(e) { await client.query('ROLLBACK'); if(e.code === '23505') throw httpError(409, 'This email cannot be linked. Use account recovery if you already have an account.'); throw e; }
    finally { client.release(); }
    if (issued) activateSession(req, res, config, issued);
    res.redirect(303, '/me?verified=1');
  });
  app.get('/admin/login', (req, res) => res.send(views.adminLoginPage({ csrf: req.session.csrf })));
  app.post('/admin/login', limiter(pool, config, 'admin-login', 10, 900), async (req, res) => {
    const operator = typeof req.body.operator === 'string' ? req.body.operator.trim() : '';
    if (!same(digest(String(req.body.passphrase || ''), config.secret), digest(config.adminPassphrase, config.secret))) throw httpError(401, 'Incorrect Mission Control passphrase.');
    if (!operator || operator.length > 60 || /[\x00-\x1f]/.test(operator)) throw httpError(400, 'Enter your staff name or initials (up to 60 characters).');
    await req.rotateSession(req.session.player_id, operator); res.redirect(303, '/admin');
  });
  app.post('/admin/logout', async (req, res) => { await req.rotateSession(req.session.player_id); res.redirect(303, '/admin/login'); });
  app.get('/admin', adminOnly, async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.slice(0,100) : '';
    res.send(views.adminSearchPage({ players: await domain.findPlayers(pool, query), query, csrf: req.session.csrf, operator: req.session.operator }));
  });
  app.get('/admin/content', adminOnly, async (req, res) => {
    const quests = (await pool.query('SELECT id,slug,name FROM quests ORDER BY name')).rows;
    res.send(views.contentIndexPage({ quests, csrf: req.session.csrf, operator: req.session.operator }));
  });
  app.get('/admin/content/:slug/:state', adminOnly, async (req, res) => {
    const data = await listContent(pool, req.params.slug);
    const content = await getContent(pool, data.quest.id, req.params.state);
    res.send(views.contentEditorPage({ ...data, content, csrf: req.session.csrf, operator: req.session.operator, message: req.query.saved === '1' ? 'Content saved. Players see it when they next open or refresh the page.' : undefined }));
  });
  app.post('/admin/content/:slug/:state', adminOnly, async (req, res) => {
    const quest = await questBySlug(req.params.slug);
    await saveContent(pool, { questId: quest.id, state: req.params.state, title: req.body.title, body: req.body.body, image_url: req.body.image_url, image_alt: req.body.image_alt, video_url: req.body.video_url, version: req.body.version, operator: req.session.operator, requestId: req.body.requestId, reason: req.body.reason });
    res.redirect(303, '/admin/content/' + quest.slug + '/' + req.params.state + '?saved=1');
  });
  app.get('/admin/players/:id', adminOnly, async (req, res) => res.send(views.adminDetailPage({ data: await domain.playerDetail(pool, uuid(req.params.id)), csrf: req.session.csrf, operator: req.session.operator, message: req.query.saved === '1' ? 'Action recorded. Review the current state below.' : undefined })));
  const action = fn => async (req, res) => {
    await fn(req, { playerId: uuid(req.params.id), operator: req.session.operator, requestId: uuid(req.body.requestId) });
    res.redirect(303, `/admin/players/${req.params.id}?saved=1`);
  };
  app.post('/admin/players/:id/complete', adminOnly, action((req, data) => domain.completeQuest(pool, { ...data, questId: uuid(req.body.questId) })));
  app.post('/admin/players/:id/reward', adminOnly, action((req, data) => {
    if (!['SELECTED','FULFILLED'].includes(req.body.target)) throw httpError(400, 'Invalid reward action.');
    if (req.body.target === 'FULFILLED' && req.body.confirm !== 'yes') throw httpError(400, 'Confirm the nickname, Player ID and selected reward before handoff.');
    return domain.transitionReward(pool, { ...data, rewardId: uuid(req.body.rewardId), target: req.body.target });
  }));
  app.post('/admin/players/:id/correct-quest', adminOnly, action((req, data) => domain.correctQuest(pool, { ...data, questId: uuid(req.body.questId), reason: req.body.reason })));
  app.post('/admin/players/:id/correct-reward', adminOnly, action((req, data) => domain.correctReward(pool, { ...data, rewardId: uuid(req.body.rewardId), target: req.body.target, reason: req.body.reason })));
  app.use((_req, _res, next) => next(httpError(404, 'Page not found.')));
  app.use((error, _req, res, _next) => {
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
    if (status >= 500) console.error('Request failed:', error.code || 'internal');
    res.status(status).send(views.errorPage({ status, message: status >= 500 ? 'The service is temporarily unavailable. Please try again.' : error.message }));
  });
  return app;
}
