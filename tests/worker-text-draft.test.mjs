import test from 'node:test';
import assert from 'node:assert/strict';
import {canRestoreTextDraft,TextDraftError,textDraftCopy,textDraftStatus,saveTextDraft,restoreTextDraft,removeTextDraft} from '../src/worker-text-draft.ts';
import {assertWorkerDictionary} from './helpers/worker-locales.mjs';
const time=Date.parse('2026-10-07T12:00:00.000Z');
const session={authenticated:true,role:'worker',workerId:'qa-one',language:'en',mode:'synthetic-demo',clientContext:'a'.repeat(64),expiresAt:'2026-10-07T20:00:00.000Z'};
const scope={assignmentId:'one',publicationId:'published-one',version:3};
const draft={answer:'Finished on blue; unfinished on yellow.',help:'Please explain the second shelf.',receipts:[{kind:'answer',requestId:crypto.randomUUID(),assignmentId:'one',status:'unknown'}]};
const key='understood:worker-text-draft:v1';
function storage(){const map=new Map();return {map,getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)};}
const error=code=>value=>value instanceof TextDraftError && value.code===code;

test('explicit bounded text snapshots recover across reload with exact pending IDs and no network',()=>{
  const store=storage();assert.equal(textDraftStatus(store,session,scope,time),'empty');
  assert.throws(()=>saveTextDraft(store,session,scope,draft,false,time),error('invalid'));assert.equal(store.map.size,0);
  saveTextDraft(store,{...session,name:'Private display name',token:'do not persist'},scope,draft,true,time);
  assert.equal(textDraftStatus(store,session,scope,time),'saved');
  assert.deepEqual(restoreTextDraft(store,session,{version:3,publicationId:'published-one',assignmentId:'one'},time+1),draft);
  assert.equal(store.map.size,1);assert.ok(!store.map.get(key).includes('Private display name'));assert.ok(!store.map.get(key).includes('do not persist'));
  const restored=restoreTextDraft(store,session,scope,time);restored.answer='Edited only in memory';
  assert.equal(restoreTextDraft(store,session,scope,time).answer,draft.answer);
  const later={...draft,answer:'Later explicit snapshot'};saveTextDraft(store,session,scope,later,true,time+1);assert.deepEqual(restoreTextDraft(store,session,scope,time+1),later);
  removeTextDraft(store);assert.equal(restoreTextDraft(store,session,scope,time+1),null);
});

test('another assignment or exact publication version cannot overwrite or restore the saved snapshot',()=>{
  const store=storage();saveTextDraft(store,session,scope,draft,true,time);const raw=store.map.get(key);
  for(const other of [{...scope,assignmentId:'two'},{...scope,publicationId:'published-two'},{...scope,version:4}]){
    assert.equal(textDraftStatus(store,session,other,time),'other');
    assert.throws(()=>restoreTextDraft(store,session,other,time),error('scope'));
    assert.throws(()=>saveTextDraft(store,session,other,{...draft,receipts:[]},true,time),error('scope'));assert.equal(store.map.get(key),raw);
  }
});

test('changed identities and expiry never disclose saved plaintext to another session',()=>{
  for(const change of [{workerId:'two'},{language:'ar'},{mode:'credential'},{clientContext:'b'.repeat(64)},{expiresAt:'2026-10-07T19:00:00.000Z'}]){
    const store=storage();saveTextDraft(store,session,scope,draft,true,time);
    assert.equal(restoreTextDraft(store,{...session,...change},scope,time),null);assert.equal(store.map.size,0);
  }
  const store=storage();saveTextDraft(store,session,scope,draft,true,time);const raw=store.map.get(key);
  for(const current of [{...session,expiresAt:'2026-10-07T12:00:00.000Z'},{...session,role:'staff'},{...session,authenticated:false}]){
    assert.throws(()=>restoreTextDraft(store,current,scope,time),error('expired'));
    assert.throws(()=>saveTextDraft(store,current,scope,draft,true,time),error('expired'));assert.equal(store.map.get(key),raw);
  }
  assert.throws(()=>restoreTextDraft(store,session,scope,Date.parse(session.expiresAt)),error('expired'));
  assert.throws(()=>restoreTextDraft(store,session,scope,time-1),error('invalid'));
});

test('malformed and overbounded snapshots fail closed without silently replacing private work',()=>{
  const store=storage();saveTextDraft(store,session,scope,draft,true,time);const good=store.map.get(key),value=JSON.parse(good);
  for(const raw of ['{','x'.repeat(20001),JSON.stringify({...value,extra:true}),JSON.stringify({...value,session:{...value.session,token:'secret'}}),JSON.stringify({...value,savedAt:'2026-10-07T25:00:00.000Z'}),JSON.stringify({...value,draft:{...draft,answer:'x'.repeat(2001)}}),JSON.stringify({...value,draft:{...draft,receipts:[draft.receipts[0],draft.receipts[0]]}}),JSON.stringify({...value,draft:{...draft,receipts:[{...draft.receipts[0],assignmentId:'two'}]}}),JSON.stringify({...value,draft:{...draft,receipts:[{...draft.receipts[0],requestId:'bad'}]}})]){
    store.map.set(key,raw);assert.throws(()=>restoreTextDraft(store,session,scope,time),error('invalid'));
    assert.throws(()=>saveTextDraft(store,session,scope,draft,true,time),error('invalid'));assert.equal(store.map.get(key),raw);
  }
  store.map.clear();
  for(const invalid of [{...draft,answer:'x'.repeat(2001)},{...draft,help:'x'.repeat(501)},{...draft,extra:true},{...draft,receipts:[{...draft.receipts[0],status:'sent'}]},{answer:' ',help:' ',receipts:[]},{...draft,audio:new Uint8Array([1])}])assert.throws(()=>saveTextDraft(store,session,scope,invalid,true,time),error('invalid'));
  for(const invalid of [{...scope,version:0},{...scope,version:1.5},{...scope,publicationId:''},{...scope,assignmentId:'x'.repeat(101)},{...scope,extra:true}])assert.throws(()=>saveTextDraft(store,session,invalid,draft,true,time),error('invalid'));
  assert.equal(store.map.size,0);
});

test('storage denial, discarded writes and unsuccessful removal never claim a saved or cleared draft',()=>{
  for(const store of [{getItem:()=>{throw Error();},setItem(){},removeItem(){}},{getItem:()=>null,setItem:()=>{throw Error();},removeItem(){}},{getItem:()=>null,setItem(){},removeItem(){}}])assert.throws(()=>saveTextDraft(store,session,scope,draft,true,time),error('storage'));
  const store=storage();saveTextDraft(store,session,scope,draft,true,time);
  store.removeItem=()=>{};assert.throws(()=>removeTextDraft(store),error('storage'));
  assert.throws(()=>restoreTextDraft(store,{...session,workerId:'two'},scope,time),error('storage'));
  store.removeItem=()=>{throw Error();};assert.throws(()=>removeTextDraft(store),error('storage'));
});

test('all tab snapshot controls and limitations have complete copy for every worker UI language',()=>{
  assertWorkerDictionary(textDraftCopy,'textDraftCopy');
});
test('restore cannot replace newer text, request tracking or an unsent recording',()=>{
  const empty={answer:'',help:'',receipts:[]};assert.equal(canRestoreTextDraft(empty,false),true);
  for(const value of [{...empty,answer:'newer'},{...empty,help:'newer'},{...empty,receipts:draft.receipts}])assert.equal(canRestoreTextDraft(value,false),false);
  assert.equal(canRestoreTextDraft(empty,true),false);
});
