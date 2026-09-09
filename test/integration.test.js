import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import request from 'supertest';
import { SMTPServer } from 'smtp-server';
import { createPool, migrate } from '../src/db.js';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { createMailer } from '../src/mailer.js';
import * as domain from '../src/domain.js';
import { digest } from '../src/security.js';

const csrf = response => { const token = response.text.match(/name="_csrf" value="([\w-]+)"/)?.[1]; assert.ok(token, 'CSRF field exists'); return token; };
const input = (response,name) => response.text.match(new RegExp(`name="${name}" value="([^\"]+)"`))?.[1];
const post = (agent,path,key,body={}) => agent.post(path).type('form').send({_csrf:key,...body});

test('real PostgreSQL and SMTP integration', async t => {
  const baseUrl=process.env.TEST_DATABASE_URL;
  assert.ok(baseUrl, 'Set TEST_DATABASE_URL to a disposable PostgreSQL service with CREATEDB privilege.');
  const adminPool=createPool(baseUrl);
  const dbName=`qp_test_${Date.now()}_${randomUUID().slice(0,8)}`;
  await adminPool.query(`CREATE DATABASE "${dbName}" TEMPLATE template0`);
  const dbUrl=new URL(baseUrl); dbUrl.pathname=`/${dbName}`;
  const pool=createPool(dbUrl.href);
  const messages=[];
  const smtp=new SMTPServer({disabledCommands:['AUTH','STARTTLS'],onData(stream,_session,cb){let data='';stream.on('data',chunk=>data+=chunk);stream.on('end',()=>{messages.push(data.replace(/=\r?\n/g,'').replace(/=3D/g,'='));cb();});}});
  await new Promise(resolve=>smtp.listen(0,'127.0.0.1',resolve));
  const config=loadConfig({NODE_ENV:'test',DATABASE_URL:dbUrl.href,PUBLIC_BASE_URL:'http://localhost:3000',SESSION_SECRET:'integration-secret-'.repeat(4),MISSION_CONTROL_PASSPHRASE:'test-staff-passphrase',SMTP_HOST:'127.0.0.1',SMTP_PORT:String(smtp.server.address().port),MAIL_FROM:'quest@example.test'});
  const mailer=createMailer(config);
  await migrate(pool); await migrate(pool);
  let app=createApp({pool,config,mailer});
  let player=request.agent(app); const staff=request.agent(app); const outsider=request.agent(app);
  let playerId,questId,rewardId,playerCsrf,staffCsrf,playerCookie;
  t.after(async()=>{mailer.close();await new Promise(resolve=>smtp.close(resolve));await pool.end();await adminPool.end();});
  await mkdir('.local/test-evidence',{recursive:true});
  await writeFile('.local/test-evidence/latest-database.txt',dbName);

  await t.test('empty database migrations reproducible and health check works',async()=>{
    assert.equal((await pool.query('SELECT count(*) FROM schema_migrations')).rows[0].count,'3');
    await request(app).get('/healthz').expect(200,{ok:true});
    await request(app).get('/assets/styles.css').expect(200).expect('Content-Type',/css/);
    await request(app).get('/start/unknown').expect(404);
  });
  await t.test('new player, intro fallback, profile and duplicate scan',async()=>{
    const first=await player.get('/start/as-above-so-below').expect(200);
    const entered=await post(player,'/start/as-above-so-below',csrf(first),{display_name:'Test Player'}).expect(303);
    playerCookie=first.headers['set-cookie'][0].split(';')[0];
    assert.match(first.headers['set-cookie'][0],/HttpOnly/);assert.match(first.headers['set-cookie'][0],/SameSite=Lax/);
    const intro=await player.get(entered.headers.location).expect(200);assert.match(intro.text,/Continue to my profile/);
    await post(player,'/intro/as-above-so-below',csrf(intro)).expect(303);
    let me=await player.get('/me').expect(200); assert.match(me.text,/ACTIVE/); assert.match(me.text,/Without a verified email/);playerCsrf=csrf(me);
    const p=(await pool.query("SELECT * FROM players WHERE display_name='Test Player'")).rows[0];playerId=p.id;assert.match(p.public_id,/^QP-[A-Z0-9]{5}$/);
    questId=(await pool.query('SELECT id FROM quests')).rows[0].id;rewardId=(await pool.query('SELECT id FROM rewards')).rows[0].id;
    await post(player,'/start/as-above-so-below',playerCsrf).expect(303);
    me=await player.get('/me');playerCsrf=csrf(me);
    await Promise.all([post(player,'/intro/as-above-so-below',playerCsrf).expect(303),post(player,'/intro/as-above-so-below',playerCsrf).expect(303)]);
    assert.equal((await pool.query('SELECT count(*) FROM player_quests WHERE player_id=$1',[playerId])).rows[0].count,'1');
    assert.equal((await pool.query("SELECT count(*) FROM quest_events WHERE player_id=$1 AND event_type='INTRO_VIEWED'",[playerId])).rows[0].count,'1');
  });
  await t.test('duplicate nickname is a different public reference; hostile content escaped',async()=>{
    const other=request.agent(app);const r=await other.get('/');const start=await other.get('/start/as-above-so-below');
    await post(other,'/start/as-above-so-below',csrf(start),{display_name:'Test Player'}).expect(303);
    const matches=await domain.findPlayers(pool,'Test Player');assert.equal(matches.length,2);assert.notEqual(matches[0].public_id,matches[1].public_id);
    const evil=request.agent(app);const e=await evil.get('/start/as-above-so-below');
    await post(evil,'/start/as-above-so-below',csrf(e),{display_name:'<script>alert(1)</script>'}).expect(303);
    const me=await evil.get('/me');assert.ok(!me.text.includes('<script>alert(1)</script>'));assert.match(me.text,/&lt;script&gt;/);
  });
  await t.test('CSRF, authorization and malformed ids rejected',async()=>{
    await post(player,'/me/email','x'.repeat(43),{email:'player@example.test'}).expect(403);
    await post(player,'/me/email','é'.repeat(43),{email:'player@example.test'}).expect(403);
    await post(player,'/me/email',playerCsrf,{email:'player@example.test'}).set('Origin','https://attacker.test').expect(403);
    const anon=await outsider.get('/recover');
    await post(outsider,`/admin/players/${playerId}/complete`,csrf(anon),{questId,requestId:randomUUID()}).expect(303).expect('Location','/admin/login');
    assert.equal((await domain.profile(pool,playerId)).rewards.length,0);
  });
  await t.test('staff login, search and atomic simultaneous completion',async()=>{
    let login=await staff.get('/admin/login');
    await post(staff,'/admin/login',csrf(login),{operator:'AB',passphrase:'wrong'}).expect(401);
    await post(staff,'/admin/login',csrf(login),{operator:'AB',passphrase:config.adminPassphrase}).expect(303);
    const search=await staff.get('/admin?q=Test%20Player').expect(200);assert.match(search.text,/QP-/);staffCsrf=csrf(search);
    await staff.get('/admin/players/not-a-uuid').expect(400);
    const requestId=randomUUID();
    await Promise.all([post(staff,`/admin/players/${playerId}/complete`,staffCsrf,{questId,requestId}).expect(303),post(staff,`/admin/players/${playerId}/complete`,staffCsrf,{questId,requestId}).expect(303)]);
    await post(staff,`/admin/players/${playerId}/complete`,staffCsrf,{questId,requestId:randomUUID()}).expect(303);
    const p=await domain.profile(pool,playerId);assert.equal(p.participations[0].status,'COMPLETED');assert.equal(p.rewards[0].status,'ELIGIBLE');assert.equal(p.audit.length,1);
    const me=await player.get('/me');assert.match(me.text,/COMPLETED/);assert.match(me.text,/ELIGIBLE/);
  });
  await t.test('reward requires selection and confirmation; only one fulfillment audited',async()=>{
    const route=`/admin/players/${playerId}/reward`;
    await post(staff,route,staffCsrf,{rewardId,target:'FULFILLED',confirm:'yes',requestId:randomUUID()}).expect(409);
    await post(staff,route,staffCsrf,{rewardId,target:'SELECTED',requestId:randomUUID()}).expect(303);
    await post(staff,route,staffCsrf,{rewardId,target:'FULFILLED',requestId:randomUUID()}).expect(400);
    await Promise.all([post(staff,route,staffCsrf,{rewardId,target:'FULFILLED',confirm:'yes',requestId:randomUUID()}).expect(303),post(staff,route,staffCsrf,{rewardId,target:'FULFILLED',confirm:'yes',requestId:randomUUID()}).expect(303)]);
    const data=await domain.profile(pool,playerId);assert.equal(data.rewards[0].status,'FULFILLED');assert.equal(data.audit.filter(a=>a.action==='REWARD_FULFILLED').length,1);
    await assert.rejects(pool.query("UPDATE player_rewards SET status='ELIGIBLE',selected_at=NULL,fulfilled_at=NULL WHERE player_id=$1",[playerId]),/Fulfillment is permanent/);
    await assert.rejects(pool.query('DELETE FROM operator_actions WHERE player_id=$1',[playerId]),/append-only/);
  });
  await t.test('correction preserves fulfilled handoff and immutable exception history',async()=>{
    await post(staff,`/admin/players/${playerId}/correct-quest`,staffCsrf,{questId,reason:'Wrong completion entry',requestId:randomUUID()}).expect(303);
    let data=await domain.profile(pool,playerId);assert.equal(data.participations[0].status,'ACTIVE');assert.equal(data.rewards[0].status,'FULFILLED');
    await post(staff,`/admin/players/${playerId}/correct-reward`,staffCsrf,{rewardId,target:'EXCEPTION',reason:'Physical handoff already occurred',requestId:randomUUID()}).expect(303);
    data=await domain.profile(pool,playerId);assert.ok(data.audit.some(a=>a.action==='FULFILLMENT_EXCEPTION'));
    await post(staff,`/admin/players/${playerId}/complete`,staffCsrf,{questId,requestId:randomUUID()}).expect(303);
  });
  await t.test('selection correction, suspension, recompletion and conflicting retry payload',async()=>{
    const other=(await domain.findPlayers(pool,'Test Player')).find(p=>p.id!==playerId);const a={playerId:other.id,questId,operator:'CD',requestId:randomUUID()};
    await domain.completeQuest(pool,a);
    await assert.rejects(domain.correctQuest(pool,{...a,reason:'conflicting same key'}),e=>e.status===409);
    await domain.transitionReward(pool,{playerId:other.id,rewardId,target:'SELECTED',operator:'CD',requestId:randomUUID()});
    await domain.correctReward(pool,{playerId:other.id,rewardId,target:'ELIGIBLE',reason:'Wrong selection',operator:'CD',requestId:randomUUID()});
    await domain.correctQuest(pool,{...a,requestId:randomUUID(),reason:'Wrong completion'});
    await assert.rejects(domain.transitionReward(pool,{playerId:other.id,rewardId,target:'SELECTED',operator:'CD',requestId:randomUUID()}),e=>e.status===409);
    assert.equal((await domain.profile(pool,other.id)).rewards[0].suspended,true);
    await domain.completeQuest(pool,{...a,requestId:randomUUID()});assert.equal((await domain.profile(pool,other.id)).rewards[0].suspended,false);
  });
  await t.test('email delivered via SMTP, verification single-use and no token plaintext in DB',async()=>{
    playerCsrf=csrf(await player.get('/me'));
    await post(player,'/me/email',playerCsrf,{email:'player@example.test'}).expect(303);assert.equal(messages.length,1);
    const link=messages[0].match(/http:\/\/localhost:3000\/auth\/token\?token=([\w-]{43})&purpose=verify/);assert.ok(link,'SMTP body contains working verification URL');
    const path=link[0].replace(config.baseUrl,'');const page=await player.get(path).expect(200);
    assert.equal((await pool.query('SELECT email_verified_at FROM players WHERE id=$1',[playerId])).rows[0].email_verified_at,null);
    const denied=await outsider.get(path);await post(outsider,'/auth/token',csrf(denied),{token:link[1],purpose:'verify'}).expect(403);
    await post(player,'/auth/token',csrf(page),{token:link[1],purpose:'verify'}).expect(303);
    await post(player,'/auth/token',csrf(page),{token:link[1],purpose:'verify'}).expect(400);
    const stored=(await pool.query('SELECT * FROM email_tokens WHERE player_id=$1',[playerId])).rows[0];assert.notEqual(stored.token_hash,link[1]);assert.ok(stored.used_at);
    assert.match((await player.get('/me')).text,/Recovery email verified/);
  });
  await t.test('new browser recovers same identity; old sessions revoked; unknown email generic',async()=>{
    const browser=request.agent(app);let r=await browser.get('/recover');
    const known=await post(browser,'/recover',csrf(r),{email:'player@example.test'}).expect(200);
    const unknown=await post(browser,'/recover',csrf(known),{email:'unknown@example.test'}).expect(200);
    assert.equal(known.text,unknown.text);assert.equal(messages.length,2);
    const link=messages[1].match(/http:\/\/localhost:3000\/auth\/token\?token=([\w-]{43})&purpose=recover/);assert.ok(link);
    r=await browser.get(link[0].replace(config.baseUrl,''));
    const recovered=await post(browser,'/auth/token',csrf(r),{token:link[1],purpose:'recover'}).expect(303);
    playerCookie=recovered.headers['set-cookie'][0].split(';')[0];
    assert.match((await browser.get('/me')).text,/(FULFILLED)/);
    await player.get('/me').expect(303);player=browser;
    const used=await browser.get(link[0].replace(config.baseUrl,''));await post(browser,'/auth/token',csrf(used),{token:link[1],purpose:'recover'}).expect(400);
  });
  await t.test('session survives application recreation and browser restart cookie reuse',async()=>{
    app=createApp({pool,config,mailer});const me=await request(app).get('/me').set('Cookie',playerCookie).expect(200);assert.match(me.text,/Test Player/);
  });
  await t.test('expired tokens rejected and email address rate limits enforced',async()=>{
    const browser=request.agent(app);let r=await browser.get('/recover');
    await post(browser,'/recover',csrf(r),{email:'player@example.test'}).expect(200);
    const link=messages.at(-1).match(/token=([\w-]{43})&purpose=recover/);
    await pool.query("UPDATE email_tokens SET expires_at=now()-interval '1 minute' WHERE token_hash=$1",[digest(link[1],config.secret)]);
    r=await browser.get(`/auth/token?token=${link[1]}&purpose=recover`);
    await post(browser,'/auth/token',csrf(r),{token:link[1],purpose:'recover'}).expect(400);
    for(let i=0;i<5;i++) await post(browser,'/recover',csrf(r),{email:'rate@example.test'}).expect(200);
    await post(browser,'/recover',csrf(r),{email:'rate@example.test'}).expect(429);
  });
  await t.test('transaction rollback prevents partial completion and audit',async()=>{
    const p=(await pool.query("SELECT id FROM players WHERE display_name LIKE '<script>%' ")).rows[0];
    await pool.query(`CREATE FUNCTION test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$`);
    await pool.query('CREATE TRIGGER test_fail BEFORE INSERT ON operator_actions FOR EACH ROW EXECUTE FUNCTION test_fail_audit()');
    await assert.rejects(domain.completeQuest(pool,{playerId:p.id,questId,operator:'AB',requestId:randomUUID()}),/injected failure/);
    await pool.query('DROP TRIGGER test_fail ON operator_actions');await pool.query('DROP FUNCTION test_fail_audit()');
    const data=await domain.profile(pool,p.id);assert.equal(data.participations[0].status,'ACTIVE');assert.equal(data.rewards.length,0);assert.equal(data.audit.length,0);
  });
  await t.test('second event reuses player without schema change',async()=>{
    const event=(await pool.query("INSERT INTO events(slug,name) VALUES('midwinter-2027','Midwinter Quest 2027') RETURNING id")).rows[0];
    await pool.query("INSERT INTO quests(event_id,slug,name) VALUES($1,'midwinter-2027','Midwinter Quest 2027')",[event.id]);
    assert.equal((await domain.profile(pool,playerId)).participations.length,1);
    await domain.enroll(pool,playerId,'midwinter-2027');assert.equal((await domain.profile(pool,playerId)).participations.length,2);
  });
  await t.test('admin logout invalidates previous admin cookie',async()=>{
    await post(staff,'/admin/logout',staffCsrf).expect(303);await staff.get('/admin').expect(303).expect('Location','/admin/login');
  });
  console.log(`Evidence database retained: ${dbName}`);
});
