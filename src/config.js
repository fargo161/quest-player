export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const fail = message => { throw new Error(message); };
  const base = new URL(env.PUBLIC_BASE_URL || 'http://localhost:3000');
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/' || base.search || base.hash) fail('PUBLIC_BASE_URL must be an origin without path, credentials or query.');
  if (production && (base.protocol !== 'https:' || /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(base.hostname))) fail('Production PUBLIC_BASE_URL must be a public HTTPS origin.');
  for (const key of ['DATABASE_URL', 'SESSION_SECRET', 'MISSION_CONTROL_PASSPHRASE']) if (!env[key]) fail(`${key} is required.`);
  if (env.SESSION_SECRET.length < 32) fail('SESSION_SECRET must contain at least 32 characters.');
  if (env.MISSION_CONTROL_PASSPHRASE.length < 16) fail('MISSION_CONTROL_PASSPHRASE must contain at least 16 characters.');
  if (production && [env.SESSION_SECRET,env.MISSION_CONTROL_PASSPHRASE].some(value => value.startsWith('replace-with'))) fail('Replace example secrets before production use.');
  const smtpPort=Number(env.SMTP_PORT || 1025);
  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) fail('SMTP_PORT must be between 1 and 65535.');
  if (production && (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS || !env.MAIL_FROM)) fail('Production requires working SMTP_HOST, SMTP_USER, SMTP_PASS and MAIL_FROM.');
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail('PORT must be between 1 and 65535.');
  return {
    production, port, databaseUrl: env.DATABASE_URL,
    secret: env.SESSION_SECRET, adminPassphrase: env.MISSION_CONTROL_PASSPHRASE,
    baseUrl: base.origin, sessionDays: 90, adminHours: 8,
    smtp: { host: env.SMTP_HOST || '127.0.0.1', port: smtpPort,
      secure: env.SMTP_SECURE === 'true', requireTLS: production && env.SMTP_SECURE !== 'true',
      ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } } : {}),
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000 },
    mailFrom: env.MAIL_FROM || 'Quest Player <quest@localhost>',
  };
}
