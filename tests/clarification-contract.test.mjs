import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {canonicalClarificationAction,clarificationActionHash,readClarificationAction,retainClarificationAction,clearClarificationAction} from '../src/clarification-action-recovery.ts';
import {checkedClarificationPage,checkedClarificationDetail,checkedClarificationActionReceipt} from '../src/clarification-contract.ts';
import {clarificationActionCommand} from '../server/clarification-action-input.mjs';
import {staffClarificationContextRequired} from '../server/session-context.mjs';

const session=()=>({authenticated:true,role:'staff',staffRole:'owner',staffScope:'["cedar","beirut","maya"]',siteState:'active',mode:'credential',clientContext:'a'.repeat(64),expiresAt:new Date(Date.now()+60000).toISOString()});
const store=()=>{const values=new Map();return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};};
const summary=()=>({id:'case-14',worker:'Worker 014',language:'en',title:'Synthetic shelf',reason:'Help requested',status:'open',created_at:'2026-10-19T12:00:00.000Z',due_at:null,case_due_at:null,escalated_at:null,owner_name:null,owner_staff_id:null,assignment_id:'assignment-14',publication_id:'publication-3',version:3,current_version:4,attempt_id:null});
const detail=()=>({...summary(),notes:'',clientContext:'a'.repeat(64),snapshot:{source:'Synthetic source',question:'Where?',facts:['Blue shelf'],askedFacts:['Blue shelf']},answer_text:null,outcome:null,recording_id:null,assessmentReasons:[],assessmentEvidence:[],attempts:[],owners:[{id:'maya',name:'Maya'}],helpRequest:{text:'Synthetic help',createdAt:'2026-10-19T12:00:00.000Z'},canRequestRepeat:true,canReview:true,contentExpired:false});

test('staff clarification recovery retains metadata only and matches exact server-normalized intent',async()=>{
  const storage=store(),scope=session(),content={kind:'resolve',notes:'  Synthetic private notes  '};
  const first=await retainClarificationAction(storage,scope,'case-14',content,()=>true);
  assert.deepEqual(first,await retainClarificationAction(storage,scope,'case-14',{...content,notes:content.notes.trim()},()=>true));
  assert.equal(first.hash,clarificationActionCommand('resolve',{requestId:first.id,notes:content.notes}).hash);
  assert.equal(JSON.stringify([...storage.values]).includes('Synthetic private notes'),false);
  assert.deepEqual(readClarificationAction(storage,scope,'case-14'),first);
  assert.equal(readClarificationAction(storage,{...scope,clientContext:'b'.repeat(64)},'case-14'),null);
  await assert.rejects(retainClarificationAction(storage,scope,'case-14',{...content,notes:'Different private draft'},()=>true),error=>error.code==='conflict');
  assert.throws(()=>clearClarificationAction(storage,scope,'case-14',{...first,id:randomUUID()}),error=>error.code==='conflict');
  clearClarificationAction(storage,scope,'case-14',first);assert.equal(storage.values.size,0);
  const assign={kind:'assign',ownerId:'maya',expectedOwnerId:null},next=await retainClarificationAction(storage,scope,'case-14',assign,()=>true);
  assert.equal(next.hash,clarificationActionCommand('assign',{requestId:next.id,ownerId:'maya',expectedOwnerId:null}).hash);
  assert.notEqual(await clarificationActionHash(assign),await clarificationActionHash({...assign,expectedOwnerId:'other'}));
  for(const invalid of [{kind:'resolve',notes:'bad'},{kind:'resolve',notes:'Valid notes',extra:true},{kind:'assign',ownerId:'maya'},{kind:'assign',ownerId:'foreign\nid',expectedOwnerId:null}])assert.throws(()=>canonicalClarificationAction(invalid));
});

test('staff action hashing cannot write recovery after session, scope or selection changes',async()=>{
  for(const change of ['current','context','scope','expiry']){
    const storage=store(),scope=session();let live=true;
    const pending=retainClarificationAction(storage,scope,'case-14',{kind:'resolve',notes:'Synthetic draft'},()=>live);
    if(change==='current')live=false;if(change==='context')scope.clientContext='b'.repeat(64);if(change==='scope')scope.staffScope='["cedar","tripoli","maya"]';if(change==='expiry')scope.expiresAt='2000-01-01T00:00:00.000Z';
    await assert.rejects(pending,error=>error.code==='session');assert.equal(storage.values.size,0);
  }
  const storage=store(),scope=session();
  await assert.rejects(retainClarificationAction({...storage,setItem(){}},scope,'case-14',{kind:'resolve',notes:'Synthetic draft'},()=>true),error=>error.code==='storage');
  storage.setItem(`understood:case-action:${scope.clientContext}:case-14`,'broken');assert.throws(()=>readClarificationAction(storage,scope,'case-14'),error=>error.code==='storage');
});

test('case page and detail reject malformed scope, private extras, duplicates and incoherent paging',()=>{
  const page={rows:[summary()],total:1,page:1,pageSize:20,ownerOptions:[{id:'maya',name:'Maya'}],clientContext:'a'.repeat(64)};
  assert.equal(checkedClarificationPage(page,1,20,page.clientContext),page);
  for(const invalid of [{...page,rows:[{...summary(),notes:'private'}]},{...page,total:2},{...page,ownerOptions:[...page.ownerOptions,...page.ownerOptions]},{...page,clientContext:'b'.repeat(64)},{...page,rows:[{...summary(),created_at:'yesterday'}]}])assert.throws(()=>checkedClarificationPage(invalid,1,20,page.clientContext));
  const value=detail();assert.equal(checkedClarificationDetail(value,'case-14',page.clientContext),value);
  const staff={...value,helpRequest:null,staffCreation:{actorId:'maya',actorName:'Maya',createdAt:value.created_at}};checkedClarificationDetail(staff,'case-14',page.clientContext);
  for(const changed of [{helpRequest:value.helpRequest},{staffCreation:{...staff.staffCreation,createdAt:'2026-10-20T12:00:00.000Z'}},{staffCreation:{...staff.staffCreation,privateReason:'forbidden'}}])assert.throws(()=>checkedClarificationDetail({...staff,...changed},'case-14',page.clientContext));
  for(const invalid of [{...value,clientContext:'b'.repeat(64)},{...value,id:'other'},{...value,snapshot:{...value.snapshot,rubric:'private'}},{...value,assessmentEvidence:[{factIndex:-1,quote:'bad'}]},{...value,canReview:'true'},{...value,owners:[...value.owners,...value.owners]}])assert.throws(()=>checkedClarificationDetail(invalid,'case-14',page.clientContext));
});

test('action receipt acceptance is exact and never treats rejection as applied',()=>{
  const scope=session(),pending={id:randomUUID(),hash:'c'.repeat(64),kind:'resolve'},receipt={requestId:pending.id,caseId:'case-14',kind:'resolve',requestHash:pending.hash,effect:'rejected',status:'resolved',ownerId:null,reasonCode:'resolution_conflict',createdAt:'2026-10-19T12:00:00.000Z',clientContext:scope.clientContext};
  assert.equal(checkedClarificationActionReceipt(receipt,'case-14',pending,scope.clientContext).effect,'rejected');
  for(const invalid of [{...receipt,effect:'applied'},{...receipt,reasonCode:null},{...receipt,reasonCode:'owner_changed'},{...receipt,requestId:randomUUID()},{...receipt,requestHash:'d'.repeat(64)},{...receipt,clientContext:'e'.repeat(64)},{...receipt,notes:'private'}])assert.throws(()=>checkedClarificationActionReceipt(invalid,'case-14',pending,scope.clientContext));
  assert.equal(checkedClarificationActionReceipt({...receipt,effect:'applied',reasonCode:null},'case-14',pending,scope.clientContext).effect,'applied');
});

test('staff clarification JSON context fence includes roots and exact action receipts, but not media URLs',()=>{
  for(const path of ['/api/clarifications','/api/clarifications/case-14','/api/clarifications/case-14/actions/request-1'])for(const method of ['GET','HEAD'])assert.equal(staffClarificationContextRequired(path,method),true);
  for(const path of ['/api/clarification-creations','/api/clarification-creations/subjects','/api/clarification-creations/subjects/assignment-14','/api/clarification-creations/request-1'])for(const method of ['GET','HEAD','POST'])assert.equal(staffClarificationContextRequired(path,method),true);
  for(const action of ['assign','resolve'])assert.equal(staffClarificationContextRequired('/api/clarifications/case-14/'+action,'POST'),true);
  for(const path of ['/api/clarifications/case-14/messages','/api/recordings/recording-1/audio','/api/clarifications/case-14/messages/message-1/voice'])assert.equal(staffClarificationContextRequired(path,'GET'),false);
});
