import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
const valid={DATABASE_URL:'postgresql://localhost/quest',SESSION_SECRET:'a'.repeat(64),MISSION_CONTROL_PASSPHRASE:'b'.repeat(32)};
test('production configuration fails closed and uses TLS',()=>{
  assert.throws(()=>loadConfig({...valid,NODE_ENV:'production'}),/HTTPS/);
  assert.throws(()=>loadConfig({...valid,NODE_ENV:'production',PUBLIC_BASE_URL:'https://quest.example.org'}),/SMTP/);
  assert.throws(()=>loadConfig({...valid,PORT:'not-a-port'}),/PORT/);
  assert.throws(()=>loadConfig({...valid,SMTP_PORT:'NaN'}),/SMTP_PORT/);
  const config=loadConfig({...valid,NODE_ENV:'production',PUBLIC_BASE_URL:'https://quest.example.org',SMTP_HOST:'smtp.example.org',SMTP_PORT:'587',SMTP_USER:'user',SMTP_PASS:'secret',MAIL_FROM:'quest@example.org'});
  assert.equal(config.smtp.requireTLS,true);assert.equal(config.production,true);
  assert.throws(()=>loadConfig({...valid,NODE_ENV:'production',PUBLIC_BASE_URL:'https://quest.example.org',SESSION_SECRET:'replace-with-at-least-32-random-characters'}),/Replace example/);
});
