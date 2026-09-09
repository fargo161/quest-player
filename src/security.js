import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
export const token = () => randomBytes(32).toString('base64url');
export const digest = (value, secret) => createHmac('sha256', secret).update(value).digest('hex');
export const same = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
export function httpError(status, message) { return Object.assign(new Error(message), { status }); }
export function normalizedEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw httpError(400, 'Enter a valid email address.');
  return email;
}
export const uuid = value => {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw httpError(400, 'Invalid record reference.');
  return value;
};
// The caller owns BEGIN/COMMIT. No browser cookie changes occur until activation.
export async function issueSession(client, config, { oldHash = null, playerId = null, operator = null, revokePlayerSessions = false } = {}) {
  const value = token(); const hash = digest(value, config.secret); const csrf = token();
  const expires = new Date(Date.now() + config.sessionDays * 86400000);
  if (revokePlayerSessions && playerId) await client.query('DELETE FROM sessions WHERE player_id=$1', [playerId]);
  if (oldHash) await client.query('DELETE FROM sessions WHERE token_hash=$1', [oldHash]);
  const result = await client.query('INSERT INTO sessions(token_hash,player_id,operator,admin_expires_at,csrf,expires_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
    [hash, playerId, operator, operator ? new Date(Date.now() + config.adminHours * 3600000) : null, csrf, expires]);
  return { row: result.rows[0], value };
}
export function activateSession(req, res, config, issued) {
  req.session = issued.row;
  res.cookie('qp_session', issued.value, { httpOnly: true, secure: config.production, sameSite: 'lax', path: '/', maxAge: config.sessionDays * 86400000 });
}
export function sessionMiddleware(pool, config) {
  return async (req, res, next) => {
    try {
      const raw = req.headers.cookie?.split(';').map(c => c.trim()).find(c => c.startsWith('qp_session='))?.slice(11);
      req.session = raw && /^[\w-]{43}$/.test(raw)
        ? (await pool.query('SELECT * FROM sessions WHERE token_hash=$1 AND expires_at>now()', [digest(raw, config.secret)])).rows[0] : null;
      req.rotateSession = async (playerId = null, operator = null) => {
        const c = await pool.connect();
        let issued;
        try {
          await c.query('BEGIN');
          issued = await issueSession(c, config, { oldHash: req.session?.token_hash, playerId, operator });
          await c.query('COMMIT');
        } catch(e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
        activateSession(req, res, config, issued);
      };
      if (!req.session) await req.rotateSession();
      next();
    } catch(e) { next(e); }
  };
}
export function csrf(config) {
  return (req, res, next) => {
    if (['GET','HEAD','OPTIONS'].includes(req.method)) return next();
    if ((req.headers.origin && req.headers.origin !== config.baseUrl) || !same(req.body?._csrf, req.session.csrf)) return next(httpError(403, 'This form expired. Reload the page and try again.'));
    next();
  };
}
export function limiter(pool, config, scope, limit, seconds, keyFn = req => req.ip) {
  return async (req, res, next) => {
    try {
      const key = digest(`${scope}:${keyFn(req)}`, config.secret);
      const { rows } = await pool.query(`INSERT INTO rate_limits(key,count,resets_at) VALUES($1,1,now()+$2*interval '1 second')
        ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.resets_at<=now() THEN 1 ELSE rate_limits.count+1 END,
        resets_at=CASE WHEN rate_limits.resets_at<=now() THEN now()+$2*interval '1 second' ELSE rate_limits.resets_at END RETURNING count`, [key, seconds]);
      if (rows[0].count > limit) { res.set('Retry-After', String(seconds)); throw httpError(429, 'Too many attempts. Please wait and try again.'); }
      next();
    } catch(e) { next(e); }
  };
}
