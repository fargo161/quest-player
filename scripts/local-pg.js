import EmbeddedPostgres from 'embedded-postgres';
import { resolve } from 'node:path';
import { access } from 'node:fs/promises';
// Development helper only. Bind loopback; never use this as a production service.
const databaseDir=resolve(process.env.PG_LOCAL_DATA_DIR || '.local/postgres');
const port=Number(process.env.PG_LOCAL_PORT || 5432);
const user=process.env.PG_LOCAL_USER || 'quest';
const password=process.env.PG_LOCAL_PASSWORD || 'local-development-only';
const database=process.env.PG_LOCAL_DATABASE || 'quest_player';
if(!/^[a-z][a-z0-9_]{0,62}$/.test(database)) throw new Error('Invalid PG_LOCAL_DATABASE.');
const pg=new EmbeddedPostgres({databaseDir,user,password,port,persistent:true,authMethod:'scram-sha-256',postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>console.error('PostgreSQL helper reported an error; check the local data directory and port.')});
let initialized=true;try{await access(resolve(databaseDir,'PG_VERSION'));}catch{initialized=false;}
if(!initialized)await pg.initialise();
await pg.start();
const client=pg.getPgClient();await client.connect();
const exists=await client.query('SELECT 1 FROM pg_database WHERE datname=$1',[database]);
await client.end();if(!exists.rowCount)await pg.createDatabase(database);
console.log(`Development PostgreSQL ready on 127.0.0.1:${port}; database ${database}. Configure DATABASE_URL to match. Ctrl+C stops it; data is retained.`);
let stopping=false;
const stop=async()=>{if(stopping)return;stopping=true;await pg.stop();process.exit(0);};
process.on('SIGTERM',stop);process.on('SIGINT',stop);setInterval(()=>{},60000);
