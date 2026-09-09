import { createPool } from '../src/db.js';
const pool = createPool(process.env.DATABASE_URL);
try {
  await pool.query('DELETE FROM sessions WHERE expires_at<now()');
  await pool.query("DELETE FROM email_tokens WHERE expires_at<now()-interval '1 day'");
  await pool.query('DELETE FROM rate_limits WHERE resets_at<now()');
  console.log('Expired sessions, email tokens and rate-limit records removed. Audit history retained.');
} finally { await pool.end(); }
