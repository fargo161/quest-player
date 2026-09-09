import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { createMailer } from './mailer.js';
import { createApp } from './app.js';
const config = loadConfig();
const pool = createPool(config.databaseUrl);
pool.on('error', () => console.error('Database connection interrupted.'));
const mailer = createMailer(config);
const server = createApp({ pool, config, mailer }).listen(config.port, '0.0.0.0', () => console.log(`Quest Player listening on port ${config.port}`));
async function stop() { server.close(async () => { mailer.close(); await pool.end(); process.exit(0); }); setTimeout(() => process.exit(1), 10000).unref(); }
process.on('SIGTERM', stop); process.on('SIGINT', stop);
