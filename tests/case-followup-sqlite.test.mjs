import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {ensureClarificationSchema,requestHelp} from '../server/clarifications.mjs';
import {WORKER_LANGUAGE_CODES} from '../server/languages.mjs';
import {queueCaseFollowup,processOneCaseFollowup,followupReceipt,getFollowupAudio} from '../server/case-followups.mjs';
import {listCaseMessages} from '../server/case-messages.mjs';

const owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
const worker={principal_type:'worker',principal_id:'worker-14',org_id:'cedar',site_id:'beirut'};
const passed={faithful:true,complete:true,languageCorrect:true,terminologyApplied:true,reasons:[]};
const adapter=(translate)=>({capabilities:{textLanguages:WORKER_LANGUAGE_CODES},translate,async checkTranslation(){return passed;}});
function wav(samples) {
  const bytes=Buffer.alloc(44+samples*2);
  bytes.write('RIFF',0);bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVE',8);bytes.write('fmt ',12);
  bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(16000,24);
  bytes.writeUInt32LE(32000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);
  bytes.writeUInt32LE(samples*2,40);bytes.writeInt16LE(1000,44);return bytes;
}

function openCase(language='ar') {
  const db=openDatabase(':memory:');seed(db);ensureClarificationSchema(db);
  const workerId=language==='ar'?'worker-14':`worker-${language}`;
  const assignmentId=language==='ar'?'assignment-14':`assignment-${language}`;
  if(language!=='ar') {
    const now=new Date().toISOString();
    db.prepare('INSERT INTO publications VALUES (?,?,?,?,?,?,?,?)').run(`pub-${language}`,'cedar','beirut','shelf',language==='hi'?4:5,JSON.stringify({title:'Synthetic',languages:{[language]:{title:'Synthetic'}}}),now,'published');
    db.prepare('INSERT INTO workers (id,org_id,site_id,code,name,language,active) VALUES (?,?,?,?,?,?,?)').run(workerId,'cedar','beirut',`Worker ${language}`,'Synthetic',language,1);
    db.prepare('INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,due_at,created_at,language) VALUES (?,?,?,?,?,?,?,?)').run(assignmentId,'cedar','beirut',`pub-${language}`,workerId,null,now,language);
  }
  const id=randomUUID();
  requestHelp(db,{...worker,principal_id:workerId},assignmentId,{requestId:id,text:'Synthetic help request'});
  return {db,id,close:()=>db.close()};
}

test('sqlite follow-up stores the checked translation and refuses an unchanged English copy',async()=>{
  const hindi=openCase('hi');
  const copied=openCase('fil');
  let spoken;
  try {
    const input={requestId:randomUUID(),text:'Stop the line.'};
    assert.equal(queueCaseFollowup(hindi.db,owner,hindi.id,input,adapter(async()=>({title:'फ़ॉलो-अप',text:'लाइन रोकें।',question:'अपने शब्दों में उत्तर दें।'}))).status,'queued');
    assert.equal(await processOneCaseFollowup(hindi.db,adapter(async()=>({title:'फ़ॉलो-अप',text:'लाइन रोकें।',question:'अपने शब्दों में उत्तर दें।'}))),true);
    assert.equal(hindi.db.prepare('SELECT text FROM case_messages WHERE id=?').get(input.requestId).text,'लाइन रोकें।');
    assert.equal(followupReceipt(hindi.db,owner,hindi.id,input.requestId).status,'delivered');
    assert.equal(hindi.db.prepare('SELECT text FROM case_messages WHERE id=?').get(input.requestId).text.includes('Stop'),false);
    const copy={requestId:randomUUID(),text:'Stop the line.'};
    queueCaseFollowup(copied.db,owner,copied.id,copy,adapter(async content=>({title:'Follow-up',text:content.text,question:'Please reply.'})));
    assert.equal(await processOneCaseFollowup(copied.db,adapter(async content=>({title:'Follow-up',text:content.text,question:'Please reply.'}))),true);
    assert.equal(copied.db.prepare('SELECT count(*) n FROM case_messages').get().n,0);
    assert.equal(followupReceipt(copied.db,owner,copied.id,copy.requestId).errorCode,'invalid_translation');
    assert.throws(()=>queueCaseFollowup(hindi.db,worker,hindi.id,{requestId:randomUUID(),text:'No'},adapter(async()=>({}))),/Forbidden/);
    assert.throws(()=>queueCaseFollowup(hindi.db,owner,hindi.id,{requestId:randomUUID(),text:'No'},null),/Follow-up generation unavailable/);
    spoken=openCase('hi');
    const voice=wav(4000),speaking=adapter(async()=>({title:'फ़ॉलो-अप',text:'लाइन रोकें।',question:'अपने शब्दों में उत्तर दें।'}));
    speaking.capabilities={textLanguages:WORKER_LANGUAGE_CODES,speechLanguages:['hi']};
    speaking.speech=async(text,language)=>{assert.equal(text,'लाइन रोकें।');assert.equal(language,'hi');return voice;};
    const heard={requestId:randomUUID(),text:'Stop the line.'};
    queueCaseFollowup(spoken.db,owner,spoken.id,heard,speaking);
    assert.equal(await processOneCaseFollowup(spoken.db,speaking),true);
    assert.equal(Buffer.compare(getFollowupAudio(spoken.db,owner,spoken.id,heard.requestId),voice),0);
    assert.equal(listCaseMessages(spoken.db,owner,spoken.id).items.find(item=>item.id===heard.requestId).audioUrl,`/api/clarifications/${spoken.id}/messages/${heard.requestId}/audio`);
    const silent=adapter(async()=>({title:'फ़ॉलो-अप',text:'लाइन रोकें।',question:'अपने शब्दों में उत्तर दें।'}));
    silent.capabilities={textLanguages:WORKER_LANGUAGE_CODES,speechLanguages:['hi']};silent.speech=async()=>wav(1);
    const missed={requestId:randomUUID(),text:'Stop the line.'};
    queueCaseFollowup(spoken.db,owner,spoken.id,missed,silent);
    assert.equal(await processOneCaseFollowup(spoken.db,silent),true);
    assert.equal(followupReceipt(spoken.db,owner,spoken.id,missed.requestId).errorCode,'invalid_audio');
    assert.equal(spoken.db.prepare('SELECT count(*) n FROM case_messages WHERE id=?').get(missed.requestId).n,0);
  } finally {hindi.close();copied.close();spoken?.close();}
});
