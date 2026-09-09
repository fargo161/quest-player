import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import request from 'supertest';
import { createPool, migrate } from '../src/db.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { getContent, listContent, saveContent } from '../src/content.js';
import * as domain from '../src/domain.js';

const csrf = response => response.text.match(/name="_csrf" value="([\w-]+)"/)?.[1];
const post = (agent, path, key, data = {}) => agent.post(path).type('form').send({ _csrf: key, ...data });
test('content editor authorization, concurrency and state isolation', async t => {
  assert.ok(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL is required.');
  const admin = createPool(process.env.TEST_DATABASE_URL);
  const database = `qp_content_${Date.now()}_${randomUUID().slice(0,8)}`;
  await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
  const url = new URL(process.env.TEST_DATABASE_URL); url.pathname = `/${database}`;
  const pool = createPool(url.href);
  t.after(async () => { await pool.end(); await admin.end(); });
  await migrate(pool);
  const quest = (await pool.query('SELECT * FROM quests')).rows[0];
  const config = loadConfig({ DATABASE_URL: url.href, SESSION_SECRET: 'content-test-secret-'.repeat(4), MISSION_CONTROL_PASSPHRASE: 'content-test-passphrase', PUBLIC_BASE_URL: 'http://localhost:3000' });
  const app = createApp({ pool, config, mailer: { sendMail: async () => {} } });
  const staff = request.agent(app), player = request.agent(app), outsider = request.agent(app);
  let staffCsrf, playerId;
  const args = async (state, changes = {}) => ({ questId: quest.id, state, title: `Title ${state}`, body: `ONLY_${state}_CONTENT`, image_url: null, image_alt: '', video_url: null, version: (await getContent(pool,quest.id,state)).version, operator: 'Content QA', requestId: randomUUID(), reason: 'Content regression check', ...changes });

  await t.test('content routes require staff and CSRF; six slots exist', async () => {
    const anon = await outsider.get('/recover');
    await outsider.get(`/admin/content/${quest.slug}/NONE`).expect(303);
    await post(outsider, `/admin/content/${quest.slug}/NONE`, csrf(anon), { title: 'unauthorized' }).expect(303).expect('Location','/admin/login');
    const login = await staff.get('/admin/login');
    await post(staff,'/admin/login',csrf(login),{operator:'Content QA',passphrase:config.adminPassphrase}).expect(303);
    const editor = await staff.get(`/admin/content/${quest.slug}/NONE`).expect(200); staffCsrf = csrf(editor);
    await post(staff,`/admin/content/${quest.slug}/NONE`,'invalid',{title:'CSRF attack'}).expect(403);
    const slots = await listContent(pool,quest.slug);
    assert.equal(slots.contents.length,6);
    for (const slot of slots.contents) assert.equal(slot.kind,['NONE','ACTIVE','COMPLETED'].includes(slot.state)?'PARTICIPATION':'REWARD');
    const unicode = await args('NONE',{body:'é'.repeat(6000),image_url:'',video_url:''});
    await post(staff,`/admin/content/${quest.slug}/NONE`,staffCsrf,unicode).expect(303);
    assert.equal((await getContent(pool,quest.id,'NONE')).body.length,6000);
  });
  await t.test('safe media validation and literal text escaping', async () => {
    for (const video_url of ['javascript:alert(1)','data:text/html,test','http://example.test/video.mp4']) await assert.rejects(saveContent(pool,await args('NONE',{video_url})),e=>e.status===400);
    await assert.rejects(saveContent(pool,await args('NONE',{image_url:'https://example.test/a.png',image_alt:''})),e=>e.status===400);
    await assert.rejects(saveContent(pool,await args('NONE',{body:'x'.repeat(6001)})),e=>e.status===400);
    await saveContent(pool,await args('NONE',{body:'<script>alert("unsafe")</script>',image_url:'https://example.test/a.png',image_alt:'A "quoted" picture',video_url:'https://example.test/missing.mp4'}));
    const start = await player.get(`/start/${quest.slug}`).expect(200);
    assert.ok(!start.text.includes('<script>alert(')); assert.match(start.text,/&lt;script&gt;/);
    assert.match(start.text,/https:\/\/example.test\/a.png/);
    assert.match(start.text,/Create profile/);
  });
  await t.test('idempotent saves and stale concurrent versions preserve revisions', async () => {
    const a = await args('NONE'); const first = await saveContent(pool,a), replay = await saveContent(pool,a);
    assert.equal(replay.version,first.version);
    await assert.rejects(saveContent(pool,{...a,title:'different request payload'}),e=>e.status===409);
    const b = await args('NONE'), c = {...b,requestId:randomUUID(),title:'Other editor'};
    const results = await Promise.allSettled([saveContent(pool,b),saveContent(pool,c)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
    assert.equal((await getContent(pool,quest.id,'NONE')).version,first.version+1);
  });
  await t.test('failed revision write rolls back content and audit remains immutable', async () => {
    const before = await getContent(pool,quest.id,'ACTIVE');
    await pool.query("CREATE FUNCTION content_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected content revision failure'; END $$");
    await pool.query('CREATE TRIGGER content_test_fail BEFORE INSERT ON content_revisions FOR EACH ROW EXECUTE FUNCTION content_test_fail()');
    const change = await args('ACTIVE',{body:'Should roll back'});
    try { await assert.rejects(saveContent(pool,change),/injected content revision failure/); }
    finally { await pool.query('DROP TRIGGER content_test_fail ON content_revisions'); await pool.query('DROP FUNCTION content_test_fail()'); }
    assert.deepEqual(await getContent(pool,quest.id,'ACTIVE'),before);
    await saveContent(pool,change);
    await assert.rejects(pool.query('DELETE FROM content_revisions'),/append-only/);
  });
  await t.test('published content follows independent authoritative participation and reward state', async () => {
    for (const state of ['NONE','ACTIVE','COMPLETED','ELIGIBLE','SELECTED','FULFILLED']) await saveContent(pool,await args(state));
    let page = await player.get(`/start/${quest.slug}`); assert.match(page.text,/ONLY_NONE_CONTENT/); assert.ok(!page.text.includes('ONLY_SELECTED_CONTENT'));
    await post(player,`/start/${quest.slug}`,csrf(page),{display_name:'Content Player'}).expect(303);
    playerId=(await pool.query("SELECT id FROM players WHERE display_name='Content Player'")).rows[0].id;
    page=await player.get(`/intro/${quest.slug}`); assert.match(page.text,/ONLY_ACTIVE_CONTENT/); assert.ok(!page.text.includes('ONLY_ELIGIBLE_CONTENT'));
    const before=await domain.profile(pool,playerId);
    await saveContent(pool,await args('SELECTED',{body:'ONLY_SELECTED_CONTENT edit'}));
    const after=await domain.profile(pool,playerId); assert.deepEqual(after.participations,before.participations);assert.deepEqual(after.rewards,before.rewards);
    page=await player.get('/me');assert.match(page.text,/ONLY_ACTIVE_CONTENT/);assert.ok(!page.text.includes('ONLY_SELECTED_CONTENT'));
    await domain.completeQuest(pool,{playerId,questId:quest.id,operator:'QA',requestId:randomUUID()});
    page=await player.get('/me');assert.match(page.text,/ONLY_COMPLETED_CONTENT/);assert.match(page.text,/ONLY_ELIGIBLE_CONTENT/);assert.ok(!page.text.includes('ONLY_SELECTED_CONTENT'));
    const rewardId=(await pool.query('SELECT id FROM rewards')).rows[0].id;
    await domain.transitionReward(pool,{playerId,rewardId,target:'SELECTED',operator:'QA',requestId:randomUUID()});
    page=await player.get('/me');assert.match(page.text,/ONLY_COMPLETED_CONTENT/);assert.match(page.text,/ONLY_SELECTED_CONTENT/);
    await domain.correctQuest(pool,{playerId,questId:quest.id,operator:'QA',reason:'Test correction',requestId:randomUUID()});
    page=await player.get('/me');assert.match(page.text,/ONLY_ACTIVE_CONTENT/);assert.ok(!page.text.includes('ONLY_SELECTED_CONTENT'));assert.match(page.text,/PAUSED/);
  });
  await t.test('migration preserves preexisting introduction content', async () => {
    const legacyName=`qp_legacy_${Date.now()}_${randomUUID().slice(0,8)}`;
    await admin.query(`CREATE DATABASE "${legacyName}" TEMPLATE template0`);
    const legacyUrl=new URL(url);legacyUrl.pathname=`/${legacyName}`;const legacy=createPool(legacyUrl.href);
    try {
      for(const filename of ['001_domain.sql','002_auth.sql','003_intro.sql']) await legacy.query(await readFile(new URL(`../migrations/${filename}`,import.meta.url),'utf8'));
      await legacy.query("UPDATE quests SET intro_text='Existing event introduction',intro_video_url='https://example.test/legacy.mp4'");
      await legacy.query(await readFile(new URL('../migrations/004_content.sql',import.meta.url),'utf8'));
      const existingQuest=(await legacy.query('SELECT id FROM quests')).rows[0];
      const active=await getContent(legacy,existingQuest.id,'ACTIVE');
      assert.equal(active.body,'Existing event introduction');assert.equal(active.video_url,'https://example.test/legacy.mp4');
    } finally { await legacy.end(); }
  });
  console.log(`Content evidence database retained: ${database}`);
});
