import pg from 'pg';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

// Restore verification intentionally leaves the fresh database and dump intact.
// Never point this tool at a role that lacks permission to create a verification DB.
const args = process.argv.slice(2);
function option(name) { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; }
function quote(name) { return `"${name.replaceAll('"', '""')}"`; }
function connectionEnv(url) {
  const env = { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: decodeURIComponent(url.pathname.slice(1)) };
  for (const [query, variable] of [['sslmode', 'PGSSLMODE'], ['sslrootcert', 'PGSSLROOTCERT'], ['sslcert', 'PGSSLCERT'], ['sslkey', 'PGSSLKEY']]) {
    if (url.searchParams.has(query)) env[variable] = url.searchParams.get(query);
  }
  return env;
}
function run(name, commandArgs, url) {
  const binary = process.env.PG_BIN ? path.join(process.env.PG_BIN, name + (process.platform === 'win32' ? '.exe' : '')) : name;
  return new Promise((resolve, reject) => {
    // No connection secrets on process arguments or stdout/stderr.
    const child = spawn(binary, commandArgs, { env: connectionEnv(url), stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    child.stderr.resume();
    child.on('error', () => reject(new Error(`${name} could not start. Check PG_BIN or PATH.`)));
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`${name} failed (exit ${code}). Check database connectivity, privileges, and PostgreSQL client/server compatibility; diagnostics withheld to protect credentials.`)));
  });
}
async function inventory(client) {
  const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")).rows;
  const result = {};
  for (const { tablename } of tables) {
    const { rows } = await client.query(`SELECT count(*)::text AS count, md5(coalesce(string_agg(row_hash, '' ORDER BY row_hash), '')) AS fingerprint FROM (SELECT md5(to_jsonb(t)::text) AS row_hash FROM public.${quote(tablename)} t) s`);
    result[tablename] = rows[0];
  }
  for (const required of ['players', 'player_quests', 'player_rewards', 'quest_events', 'operator_actions']) {
    if (!result[required]) throw new Error(`Required table missing: ${required}`);
  }
  return result;
}

let source;
let target;
try {
  if (!option('--output')) throw new Error('Usage: npm run backup:verify -- --output <private-backup-directory>. DATABASE_URL and optional PG_BIN must be set.');
  const sourceUrl = new URL(process.env.DATABASE_URL || '');
  if (!['postgres:', 'postgresql:'].includes(sourceUrl.protocol)) throw new Error('DATABASE_URL must be a PostgreSQL connection URL.');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dbName = `qp_verify_${Date.now()}_${randomBytes(5).toString('hex')}`;
  const output = path.resolve(option('--output'), `restore-${stamp}`);
  await mkdir(output, { recursive: true, mode: 0o700 });
  const dump = path.join(output, 'quest-player.dump');
  source = new pg.Client({ connectionString: sourceUrl.href });
  await source.connect();
  await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const snapshot = (await source.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot;
  const expected = await inventory(source);
  await run('pg_dump', ['--format=custom', '--no-owner', '--no-acl', `--snapshot=${snapshot}`, `--file=${dump}`], sourceUrl);
  await source.query('COMMIT');
  // createdb fails if this name already exists. No --clean and no DROP anywhere.
  await run('createdb', ['--maintenance-db', decodeURIComponent(sourceUrl.pathname.slice(1)), '--template=template0', dbName], sourceUrl);
  const targetUrl = new URL(sourceUrl.href);
  targetUrl.pathname = `/${dbName}`;
  await run('pg_restore', ['--exit-on-error', '--no-owner', '--no-acl', '--dbname', dbName, dump], targetUrl);
  target = new pg.Client({ connectionString: targetUrl.href });
  await target.connect();
  const actual = await inventory(target);
  const verified = JSON.stringify(expected) === JSON.stringify(actual);
  const report = { verified, performedAt: new Date().toISOString(), verificationDatabase: dbName, sourceSnapshotMatched: verified, tables: actual, expected, note: 'Counts and complete row fingerprints for all public tables were compared against the dump snapshot, including quest and operator audit histories. Restore database and sensitive dump retained for operator inspection and cleanup.' };
  await writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  if (!verified) throw new Error('Restore row verification failed. Review verification.json in the selected output directory.');
  console.log(`Backup, restore, and all public-table row fingerprints verified.\nFresh verification database: ${dbName}\nReport directory: ${output}\nProtect the dump: it includes personal data and authentication records. Remove the verification database deliberately after inspection.`);
} catch (error) {
  // pg errors can include sensitive server/config details; expose only our own messages.
  console.error(error.code ? 'Database operation failed. Check connection, permissions and schema. Credentials and server diagnostics were not logged.' : error.message);
  process.exitCode = 1;
} finally {
  await Promise.allSettled([source?.end(), target?.end()]);
}
