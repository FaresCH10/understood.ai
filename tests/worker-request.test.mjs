import test from 'node:test';
import assert from 'node:assert/strict';
import {workerRequestId,WorkerRequestError,workerRequestText,checkedWorkerReceipt,readWorkerRequestReceipt,workerReceiptCheckText} from '../src/worker-request.ts';
import {assertWorkerDictionary} from './helpers/worker-locales.mjs';
const now=()=>Date.parse('2026-10-07T12:00:00.000Z');
const session={authenticated:true,role:'worker',workerId:'qa-one',language:'en',mode:'synthetic-demo',clientContext:'a'.repeat(64),expiresAt:'2026-10-07T20:00:00.000Z'};
const key='understood:worker-requests:v1';
function storage(){const map=new Map();return {map,getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)};}
test('same answer under a deliberate repeat has its own stable request ID without retaining its content',async()=>{
  const store=storage(),repeat=crypto.randomUUID(),text='Same answer';
  const original=await workerRequestId(store,session,'one','answer',text,now),next=await workerRequestId(store,session,'one','answer',text,now,repeat);
  assert.notEqual(original,next);assert.equal(await workerRequestId(store,session,'one','answer',text,now,repeat),next);
  assert.equal(store.map.get(key).includes(text),false);assert.equal(store.map.get(key).includes(repeat),false);
});
const error=code=>value=>value instanceof WorkerRequestError && value.code===code;

test('manual receipt reads never resend, stay unknown on 404 and reject changed page or wrong identity',async()=>{
  const current={...session,expiresAt:'2099-01-01T00:00:00.000Z'},requestId=crypto.randomUUID();
  const receipt={id:crypto.randomUUID(),requestId,assignmentId:'one',clientContext:current.clientContext,outcome:'matched',duplicate:true};
  let requests=[];
  const send=async(path,options)=>{requests.push({path,options});return new Response(JSON.stringify(receipt),{status:200});};
  assert.equal((await readWorkerRequestReceipt(send,current,'one','answer',requestId)).id,receipt.id);
  assert.equal(requests[0].path,`/api/worker/briefings/one/receipts/answer/${requestId}`);
  assert.deepEqual(requests[0].options,{method:'GET',credentials:'include',cache:'no-store',headers:{'x-client-session-context':current.clientContext}});
  assert.equal(await readWorkerRequestReceipt(async()=>new Response(null,{status:404}),current,'one','answer',requestId),null);
  for(const status of [401,403,409,500,503])await assert.rejects(readWorkerRequestReceipt(async()=>new Response(null,{status}),current,'one','answer',requestId),error('receipt'));
  await assert.rejects(readWorkerRequestReceipt(async()=>new Response(JSON.stringify({...receipt,assignmentId:'two'})),current,'one','answer',requestId),error('receipt'));
  await assert.rejects(readWorkerRequestReceipt(async()=>new Response('{'),current,'one','answer',requestId));
  await assert.rejects(readWorkerRequestReceipt(async()=>{throw Error('Network unavailable');},current,'one','answer',requestId));
  const changed={...current};await assert.rejects(readWorkerRequestReceipt(async()=>{changed.clientContext='b'.repeat(64);return new Response(JSON.stringify(receipt));},changed,'one','answer',requestId),error('receipt'));
  let reads=0;await assert.rejects(readWorkerRequestReceipt(send,current,'one','answer',requestId,()=>++reads===1),error('receipt'));
  const prior=requests.length;
  for(const args of [[{...current,expiresAt:'2000-01-01T00:00:00.000Z'},'one','answer',requestId],[current,'','answer',requestId],[current,12,'answer',requestId],[current,'one','bad',requestId],[current,'one','answer','bad'],[current,'one','answer',null]])await assert.rejects(readWorkerRequestReceipt(send,...args),error('receipt'));
  assert.equal(requests.length,prior);
  assertWorkerDictionary(workerReceiptCheckText,'workerReceiptCheckText');
});
test('worker request IDs survive exact trimmed retries without storing names or response text',async()=>{
  const store=storage(),answer='Finished on blue, unfinished on yellow.';
  const first=await workerRequestId(store,session,'assignment-one','answer',answer,now);
  assert.equal(await workerRequestId(store,session,'assignment-one','answer','  '+answer+'  ',now),first);
  assert.notEqual(await workerRequestId(store,session,'assignment-one','help',answer,now),first);
  assert.notEqual(await workerRequestId(store,session,'assignment-two','answer',answer,now),first);
  assert.notEqual(await workerRequestId(store,session,'assignment-one','answer','Different answer',now),first);
  assert.equal(store.map.size,1);const raw=store.map.get(key);
  for(const privateValue of [answer,'qa-one','assignment-one','assignment-two'])assert.ok(!raw.includes(privateValue));
});
test('changed sessions cannot reuse another ledger, and expired sessions never write',async()=>{
  const store=storage(),first=await workerRequestId(store,session,'one','answer','My answer',now);
  const second=await workerRequestId(store,{...session,clientContext:'b'.repeat(64)},'one','answer','My answer',now);assert.notEqual(first,second);
  assert.equal(JSON.parse(store.map.get(key)).entries.length,1);
  const previous=store.map.get(key);
  await assert.rejects(workerRequestId(store,{...session,expiresAt:'2026-10-07T12:00:00.000Z'},'one','answer','My answer',now),error('expired'));
  assert.equal(store.map.get(key),previous);
  let calls=0;await assert.rejects(workerRequestId(store,session,'one','answer','My answer',()=>++calls===1?now():Date.parse(session.expiresAt)),error('expired'));assert.equal(store.map.get(key),previous);
  const changed={...session};const pending=workerRequestId(store,changed,'one','answer','My answer',now);changed.clientContext='c'.repeat(64);await assert.rejects(pending,error('expired'));assert.equal(store.map.get(key),previous);
});
test('blocked, discarded or changed storage acknowledgements fail before producing a request ID',async()=>{
  let overwritten=false;
  for(const store of [{getItem:()=>{throw Error();},setItem:()=>{}},{getItem:()=>null,setItem:()=>{throw Error();}},{getItem:()=>null,setItem:()=>{}},{getItem:()=>overwritten?'different':null,setItem:()=>{overwritten=true;}}])await assert.rejects(workerRequestId(store,session,'one','answer','My answer',now),error('storage'));
});
test('corrupt and overfull ledgers cannot silently forget request identities',async()=>{
  const store=storage();await workerRequestId(store,session,'one','answer','My answer',now);const valid=store.map.get(key),ledger=JSON.parse(valid);
  for(const value of ['{','x'.repeat(20001),JSON.stringify({...ledger,extra:true}),JSON.stringify({...ledger,expiresAt:'bad'}),JSON.stringify({...ledger,entries:[ledger.entries[0],ledger.entries[0]]}),JSON.stringify({...ledger,entries:[{...ledger.entries[0],requestId:'wrong'}]})]){
    store.map.set(key,value);await assert.rejects(workerRequestId(store,session,'one','answer','My answer',now),error('corrupt'));assert.equal(store.map.get(key),value);
  }
  store.map.clear();let first;
  for(let i=0;i<100;i++){const id=await workerRequestId(store,session,'one','answer','Answer '+i,now);if(i===0)first=id;}
  assert.equal(await workerRequestId(store,session,'one','answer','Answer 0',now),first);
  const full=store.map.get(key);await assert.rejects(workerRequestId(store,session,'one','answer','New answer',now),error('full'));assert.equal(store.map.get(key),full);
});
test('invalid inputs and every failure copy remain bounded and localized',async()=>{
  const store=storage();for(const [id,kind,text] of [['','answer','x'],['x'.repeat(101),'answer','x'],['one','other','x'],['one','answer',' '],['one','answer','x'.repeat(2001)],['one','help','xx'],['one','help','x'.repeat(501)]])await assert.rejects(workerRequestId(store,session,id,kind,text,now),error('input'));
  assert.equal(store.map.size,0);
  assertWorkerDictionary(workerRequestText,'workerRequestText');
});
test('worker acknowledgements distinguish complete and pending answers and bind help identity',()=>{
  const id=crypto.randomUUID(),expected={requestId:id,assignmentId:'one',clientContext:'a'.repeat(64)};
  for(const outcome of ['matched','clarification','unassessable'])for(const assessmentStatus of [undefined,'complete'])assert.equal(checkedWorkerReceipt({...expected,id,outcome,assessmentStatus,duplicate:false},'answer',expected).id,id);
  assert.equal(checkedWorkerReceipt({...expected,id,outcome:null,assessmentStatus:'pending',duplicate:true},'answer',expected).outcome,null);
  for(const status of ['open','resolved'])assert.equal(checkedWorkerReceipt({...expected,id,status,duplicate:false},'help',expected).status,status);
  for(const value of [null,[],{}, {id,outcome:'matched'}, {...expected,id,outcome:'wrong',duplicate:false}, {...expected,id,outcome:null,duplicate:false}, {...expected,id,outcome:'matched',assessmentStatus:'pending',duplicate:false}, {...expected,id,outcome:null,assessmentStatus:'complete',duplicate:false},{...expected,id,outcome:'matched',duplicate:false,rubric:'private'}])assert.throws(()=>checkedWorkerReceipt(value,'answer',expected),error('receipt'));
  for(const value of [{...expected,id,status:'unknown',duplicate:false},{...expected,id:crypto.randomUUID(),status:'open',duplicate:false},{...expected,id,status:'open',duplicate:'false'}])assert.throws(()=>checkedWorkerReceipt(value,'help',expected),error('receipt'));
  for(const kind of ['answer','help']){
    const good={...expected,id,duplicate:false,...(kind==='answer'?{outcome:'matched'}:{status:'open'})};
    for(const change of [{requestId:crypto.randomUUID()},{assignmentId:'other'},{clientContext:'b'.repeat(64)},{requestId:undefined},{assignmentId:undefined},{clientContext:undefined}])assert.throws(()=>checkedWorkerReceipt({...good,...change},kind,expected),error('receipt'));
  }
});
test('audio acknowledgements require exact request context and a real receipt time, never an unreceived staging row',()=>{
  const expected={requestId:crypto.randomUUID(),assignmentId:'audio-one',clientContext:'a'.repeat(64)};
  const good={...expected,id:crypto.randomUUID(),duplicate:false,status:'received',receivedAt:'2026-10-07T12:00:00.000Z'};
  for(const status of ['received','processing','blocked','transcribed','failed'])assert.equal(checkedWorkerReceipt({...good,status},'audio',expected).status,status);
  for(const aiStatus of [undefined,'pending','blocked','transcribed','failed'])assert.equal(checkedWorkerReceipt({...good,aiStatus},'audio',expected).id,good.id);
  for(const change of [{requestId:crypto.randomUUID()},{assignmentId:'other'},{clientContext:'b'.repeat(64)},{receivedAt:undefined},{receivedAt:null},{receivedAt:'wrong'},{receivedAt:'2026-02-30T12:00:00.000Z'},{status:'storing'},{status:'ready'},{aiStatus:'matched'},{privateKey:'secret'},{duplicate:undefined}])assert.throws(()=>checkedWorkerReceipt({...good,...change},'audio',expected),error('receipt'));
});
