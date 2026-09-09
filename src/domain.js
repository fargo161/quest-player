const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

async function transaction(pool, fn) {
  const db = await pool.connect();
  try { await db.query('BEGIN'); const result = await fn(db); await db.query('COMMIT'); return result; }
  catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}

async function staffAction(pool, action, args, fn) {
  if (!uuid(args.requestId) || !uuid(args.playerId) || (args.questId && !uuid(args.questId)) || (args.rewardId && !uuid(args.rewardId))) fail(400, 'Invalid action reference.');
  const operator = String(args.operator || '').trim();
  if (!operator || operator.length > 80) fail(400, 'Enter your operator name or initials.');
  const payload = { action, ...args, operator };
  return transaction(pool, async db => {
    const inserted = await db.query('INSERT INTO action_requests(id,payload) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id', [args.requestId, payload]);
    if (!inserted.rowCount) {
      const { rows: [prior] } = await db.query('SELECT result, payload = $2::jsonb AS same FROM action_requests WHERE id=$1', [args.requestId, payload]);
      if (!prior.same) fail(409, 'This request reference was already used for a different action. Refresh the page.');
      return prior.result;
    }
    const result = await fn(db, { ...args, operator });
    await db.query('UPDATE action_requests SET result=$2 WHERE id=$1', [args.requestId, result]);
    return result;
  });
}

async function participation(db, playerId, questId) {
  const { rows: [row] } = await db.query('SELECT * FROM player_quests WHERE player_id=$1 AND quest_id=$2 FOR UPDATE', [playerId, questId]);
  if (!row) fail(404, 'This player has not entered that quest.');
  return row;
}

async function audit(db, args, action, questId, details = {}) {
  await db.query('INSERT INTO operator_actions(player_id,quest_id,reward_id,operator,action,reason,details,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [args.playerId, questId, args.rewardId || null, args.operator, action, args.reason || null, details, args.requestId]);
  await db.query('INSERT INTO quest_events(player_id,quest_id,event_type,details) VALUES($1,$2,$3,$4)',
    [args.playerId, questId, action, { ...details, operator: args.operator, reason: args.reason || null, requestId: args.requestId, rewardId: args.rewardId || null }]);
}

export async function enroll(pool, playerId, slug) {
  return transaction(pool, async db => {
    const { rows: [quest] } = await db.query('SELECT * FROM quests WHERE slug=$1', [slug]);
    if (!quest) fail(404, 'Quest not found.');
    const inserted = await db.query('INSERT INTO player_quests(player_id,quest_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id', [playerId, quest.id]);
    if (inserted.rowCount) await db.query("INSERT INTO quest_events(player_id,quest_id,event_type) VALUES($1,$2,'ENROLLED')", [playerId, quest.id]);
    return quest;
  });
}

export async function profile(pool, playerId) {
  if (!uuid(playerId)) fail(404, 'Player not found.');
  return transaction(pool, async db => {
    // One consistent snapshot keeps quest and reward state aligned during staff updates.
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const { rows: [player] } = await db.query('SELECT * FROM players WHERE id=$1', [playerId]);
    if (!player) fail(404, 'Player not found.');
    const { rows: participations } = await db.query('SELECT pq.*, q.name AS quest_name,q.slug AS quest_slug,q.intro_text,q.intro_video_url FROM player_quests pq JOIN quests q ON q.id=pq.quest_id WHERE player_id=$1 ORDER BY started_at', [playerId]);
    const { rows: rewards } = await db.query('SELECT pr.*,r.name,r.quest_id FROM player_rewards pr JOIN rewards r ON r.id=pr.reward_id WHERE player_id=$1 ORDER BY eligible_at', [playerId]);
    const { rows: audit } = await db.query('SELECT * FROM operator_actions WHERE player_id=$1 ORDER BY created_at DESC,id', [playerId]);
    const { rows: events } = await db.query('SELECT * FROM quest_events WHERE player_id=$1 ORDER BY created_at DESC,id', [playerId]);
    return { player, participations, rewards, audit, events };
  });
}
export const playerDetail = profile;
export async function findPlayers(pool, query) {
  const search = String(query || '').trim().slice(0, 100);
  if (!search) return [];
  const { rows } = await pool.query("SELECT id,public_id,display_name FROM players WHERE public_id ILIKE $1 OR position(lower($2) in lower(display_name)) > 0 ORDER BY public_id LIMIT 50", [search, search]);
  return rows;
}

export async function completeQuest(pool, args) {
  return staffAction(pool, 'COMPLETE_QUEST', args, async (db, a) => {
    const row = await participation(db, a.playerId, a.questId);
    if (row.status === 'COMPLETED') return { changed: false, status: 'COMPLETED' };
    await db.query("UPDATE player_quests SET status='COMPLETED',completed_at=now() WHERE id=$1", [row.id]);
    await db.query("INSERT INTO player_rewards(player_id,reward_id) SELECT $1,id FROM rewards WHERE quest_id=$2 ON CONFLICT(player_id,reward_id) DO UPDATE SET status='ELIGIBLE',suspended=false,selected_at=NULL WHERE player_rewards.suspended AND player_rewards.status <> 'FULFILLED'", [a.playerId, a.questId]);
    await audit(db, a, 'QUEST_COMPLETED', a.questId, { from: 'ACTIVE', to: 'COMPLETED' });
    return { changed: true, status: 'COMPLETED' };
  });
}

async function lockedReward(db, a) {
  const { rows: [reward] } = await db.query('SELECT * FROM rewards WHERE id=$1', [a.rewardId]);
  if (!reward) fail(404, 'Reward not found.');
  const quest = await participation(db, a.playerId, reward.quest_id);
  const { rows: [row] } = await db.query('SELECT * FROM player_rewards WHERE player_id=$1 AND reward_id=$2 FOR UPDATE', [a.playerId, a.rewardId]);
  if (!row) fail(404, 'This player has no eligibility for that reward.');
  return { row, quest, questId: reward.quest_id };
}

export async function transitionReward(pool, args) {
  if (!['SELECTED', 'FULFILLED'].includes(args.target)) fail(400, 'Invalid reward transition.');
  return staffAction(pool, 'TRANSITION_REWARD', args, async (db, a) => {
    const { row, quest, questId } = await lockedReward(db, a);
    if (row.status === a.target) return { changed: false, status: row.status };
    if (row.suspended || quest.status !== 'COMPLETED') fail(409, 'Reward is suspended until quest completion is confirmed.');
    if ((a.target === 'SELECTED' && row.status !== 'ELIGIBLE') || (a.target === 'FULFILLED' && row.status !== 'SELECTED')) fail(409, 'Reward must progress from eligible to selected to fulfilled.');
    const column = a.target === 'SELECTED' ? 'selected_at' : 'fulfilled_at';
    await db.query(`UPDATE player_rewards SET status=$2,${column}=now() WHERE id=$1`, [row.id, a.target]);
    await audit(db, a, `REWARD_${a.target}`, questId, { from: row.status, to: a.target });
    return { changed: true, status: a.target };
  });
}

function correctionReason(args) {
  if (typeof args.reason !== 'string' || !args.reason.trim() || args.reason.trim().length > 1000) fail(400, 'Enter a correction reason of 1 to 1000 characters.');
}
export async function correctQuest(pool, args) {
  correctionReason(args);
  return staffAction(pool, 'CORRECT_QUEST', args, async (db, a) => {
    const row = await participation(db, a.playerId, a.questId);
    if (row.status !== 'COMPLETED') fail(409, 'Only a completed quest can be corrected.');
    await db.query("UPDATE player_quests SET status='ACTIVE',completed_at=NULL WHERE id=$1", [row.id]);
    const { rows: suspended } = await db.query("UPDATE player_rewards pr SET suspended=true FROM rewards r WHERE r.id=pr.reward_id AND r.quest_id=$2 AND pr.player_id=$1 AND pr.status <> 'FULFILLED' RETURNING pr.reward_id,pr.status", [a.playerId, a.questId]);
    const { rows: fulfilled } = await db.query("SELECT pr.reward_id FROM player_rewards pr JOIN rewards r ON r.id=pr.reward_id WHERE player_id=$1 AND r.quest_id=$2 AND status='FULFILLED'", [a.playerId, a.questId]);
    await audit(db, a, 'QUEST_COMPLETION_CORRECTED', a.questId, { from: 'COMPLETED', to: 'ACTIVE', suspended, fulfilledExceptions: fulfilled });
    return { changed: true, status: 'ACTIVE', fulfilledExceptions: fulfilled.length };
  });
}
export async function correctReward(pool, args) {
  correctionReason(args);
  if (!['ELIGIBLE', 'EXCEPTION'].includes(args.target)) fail(400, 'Invalid reward correction.');
  return staffAction(pool, 'CORRECT_REWARD', args, async (db, a) => {
    const { row, questId } = await lockedReward(db, a);
    if (row.status === 'FULFILLED') {
      if (a.target !== 'EXCEPTION') fail(409, 'Fulfilled glass cannot be reversed. Record an exception.');
      await audit(db, a, 'FULFILLMENT_EXCEPTION', questId, { status: 'FULFILLED', physicallyReversed: false });
      return { changed: false, exceptionRecorded: true, status: 'FULFILLED' };
    }
    if (a.target !== 'ELIGIBLE' || row.status !== 'SELECTED') fail(409, 'Only selection can be corrected back to eligible.');
    await db.query("UPDATE player_rewards SET status='ELIGIBLE',selected_at=NULL WHERE id=$1", [row.id]);
    await audit(db, a, 'REWARD_SELECTION_CORRECTED', questId, { from: 'SELECTED', to: 'ELIGIBLE', suspended: row.suspended });
    return { changed: true, status: 'ELIGIBLE' };
  });
}
