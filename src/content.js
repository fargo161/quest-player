import {httpError,uuid} from './security.js';
export const STATES=Object.freeze(['NONE','ACTIVE','COMPLETED','ELIGIBLE','SELECTED','FULFILLED']);
const kindFor=state=>['NONE','ACTIVE','COMPLETED'].includes(state)?'PARTICIPATION':'REWARD';
const stateValue=state=>{if(!STATES.includes(state))throw httpError(400,'Unknown content state.');return state;};
function text(value,name,max,required=false){
  if(typeof value!=='string')throw httpError(400,`${name} must be text.`);
  const result=value.trim();
  if(result.length>max||(required&&!result)||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(result))throw httpError(400,`${name} must be ${required?'1':'0'} to ${max} characters.`);
  return result;
}
function media(value){
  if(value===null||value==='')return null;
  const raw=text(value,'Media URL',2048);if(!raw)return null;
  let url;try{url=new URL(raw);}catch{throw httpError(400,'Use a full HTTPS media URL.');}
  if(url.protocol!=='https:'||url.username||url.password)throw httpError(400,'Media must use HTTPS without embedded credentials.');
  return url.href;
}
export async function getContent(pool,questId,state){
  uuid(questId);stateValue(state);
  const row=(await pool.query('SELECT * FROM quest_content WHERE quest_id=$1 AND state=$2',[questId,state])).rows[0];
  if(row)return row;
  const quest=(await pool.query('SELECT * FROM quests WHERE id=$1',[questId])).rows[0];
  if(!quest)throw httpError(404,'Quest not found.');
  return {quest_id:questId,state,kind:kindFor(state),title:state==='ACTIVE'?'Before you begin':'',body:state==='ACTIVE'?quest.intro_text:'',image_url:null,image_alt:'',video_url:state==='ACTIVE'?quest.intro_video_url:null,version:0,updated_at:null};
}
export async function listContent(pool,slug){
  const quest=(await pool.query('SELECT * FROM quests WHERE slug=$1',[slug])).rows[0];
  if(!quest)throw httpError(404,'Quest not found.');
  const contents=await Promise.all(STATES.map(state=>getContent(pool,quest.id,state)));
  const revisions=(await pool.query('SELECT * FROM content_revisions WHERE quest_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100',[quest.id])).rows;
  return {quest,contents,revisions};
}
export async function saveContent(pool,args){
  const questId=uuid(args.questId),requestId=uuid(args.requestId),state=stateValue(args.state);
  const version=Number(args.version);
  if(args.version===''||args.version===undefined||args.version===null||!Number.isSafeInteger(version)||version<0)throw httpError(400,'Invalid content version. Reload the editor.');
  const values={title:text(args.title,'Title',120),body:text(args.body,'Text',6000),image_url:media(args.image_url),image_alt:text(args.image_alt,'Image description',300),video_url:media(args.video_url)};
  if(values.image_url&&!values.image_alt)throw httpError(400,'Describe the image for players who cannot see it.');
  const operator=text(args.operator,'Operator',60,true),reason=text(args.reason,'Reason',1000,true);
  const payload={action:'EDIT_CONTENT',questId,state,version,...values,operator,reason};
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const inserted=await client.query('INSERT INTO action_requests(id,payload) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id',[requestId,payload]);
    if(!inserted.rowCount){
      const prior=(await client.query('SELECT result,payload=$2::jsonb AS same FROM action_requests WHERE id=$1',[requestId,payload])).rows[0];
      if(!prior.same)throw httpError(409,'This request was already used for different content. Reload the editor.');
      await client.query('COMMIT');return prior.result;
    }
    // The quest lock also serializes first edits for future quests with no slot yet.
    const quest=await client.query('SELECT id FROM quests WHERE id=$1 FOR UPDATE',[questId]);
    if(!quest.rowCount)throw httpError(404,'Quest not found.');
    const previous=(await client.query('SELECT * FROM quest_content WHERE quest_id=$1 AND state=$2 FOR UPDATE',[questId,state])).rows[0];
    if((previous?.version||0)!==version)throw httpError(409,'Another operator updated this content. Reload the editor before saving.');
    const row=(await client.query(`INSERT INTO quest_content(quest_id,state,kind,title,body,image_url,image_alt,video_url,version)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT(quest_id,state) DO UPDATE SET title=EXCLUDED.title,body=EXCLUDED.body,image_url=EXCLUDED.image_url,image_alt=EXCLUDED.image_alt,video_url=EXCLUDED.video_url,version=EXCLUDED.version,updated_at=now() RETURNING *`,
      [questId,state,kindFor(state),values.title,values.body,values.image_url,values.image_alt,values.video_url,version+1])).rows[0];
    await client.query('INSERT INTO content_revisions(quest_id,state,version,previous,content,operator,reason,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[questId,state,row.version,previous||null,row,operator,reason,requestId]);
    await client.query('UPDATE action_requests SET result=$2 WHERE id=$1',[requestId,row]);
    await client.query('COMMIT');return row;
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
