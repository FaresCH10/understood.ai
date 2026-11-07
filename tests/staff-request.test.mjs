import test from 'node:test';
import assert from 'node:assert/strict';
import {createStaffRequest,completeStaffRequest,retainStaffRequest,StaffRequestError} from '../src/staff-request.ts';
import {savePendingStaff,readPendingStaff,clearPendingStaff} from '../src/staff-recovery.ts';
import {randomUUID} from 'node:crypto';

const time=Date.parse('2026-10-13T10:00:00.000Z'),now=()=>time;
const session={authenticated:true,role:'staff',staffRole:'owner',staffScope:JSON.stringify(['org','site','owner']),siteState:'active',mode:'synthetic-credential',clientContext:'a'.repeat(64),expiresAt:'2026-10-13T11:00:00.000Z'};
const ok=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});

test('raw CSV uploads retain the captured context and exact bytes only at the bounded import preview endpoint',async()=>{
  const id=randomUUID(),path=`/api/people/imports/preview?requestId=${id}&filename=crew.csv`,bytes=new Blob(['worker_id,language\nSynthetic 031,ar\n']),calls=[];
  const request=createStaffRequest(session,()=>true,async(path,options)=>{calls.push({path,options});return ok({id});},now);
  assert.deepEqual(await request(path,bytes,undefined,'POST','csv'),{id});
  assert.equal(calls[0].options.body,bytes);assert.equal(calls[0].options.headers['content-type'],'text/csv');
  assert.equal(calls[0].options.headers['x-client-session-context'],session.clientContext);
  assert.equal(calls[0].options.cache,'no-store');assert.equal(calls[0].options.redirect,'error');assert.ok(calls[0].options.signal);
  for(const [destination,body,method,format] of [
    ['/api/settings/staff',bytes,'POST','csv'],[path,bytes,'PATCH','csv'],[path,bytes,'GET','csv'],[path,'not bytes','POST','csv'],
    [path,new Blob([]),'POST','csv'],[path,new Blob([new Uint8Array(256*1024+1)]),'POST','csv'],
    [path+'&requestId='+id,bytes,'POST','csv'],[path+'&site=foreign',bytes,'POST','csv'],[path,bytes,'POST','unknown'],
  ])await assert.rejects(request(destination,body,undefined,method,format),/Invalid staff request/);
  assert.equal(calls.length,1);
});

test('CSV transport fences held/changed authority and retains unknown upload outcomes',async()=>{
  const path=`/api/people/imports/preview?requestId=${randomUUID()}&filename=crew.csv`,body=new Blob(['worker_id,language\nSynthetic 031,en\n']);
  let calls=0;
  await assert.rejects(createStaffRequest(session,()=>true,async()=>{calls++;return ok({});},now,()=>false)(path,body,undefined,'POST','csv'),error=>error.fenced && !error.uncertain);
  assert.equal(calls,0);
  let current=true;
  await assert.rejects(createStaffRequest(session,()=>current,async()=>{current=false;return ok({accepted:true});},now)(path,body,undefined,'POST','csv'),error=>error.fenced && error.uncertain);
  await assert.rejects(createStaffRequest(session,()=>true,async()=>{throw Error('lost acknowledgement');},now)(path,body,undefined,'POST','csv'),error=>error.uncertain && !error.fenced);
});

test('staff transport captures exact immutable context, uses bounded private reads and never adopts a later session',async()=>{
  const mutable={...session},calls=[];
  const request=createStaffRequest(mutable,()=>true,async(path,options)=>{calls.push({path,options});return ok({ready:true});},now);
  mutable.clientContext='b'.repeat(64);mutable.staffScope=JSON.stringify(['other','site','owner']);
  assert.deepEqual(await request('/api/settings/staff'),{ready:true});
  assert.equal(calls[0].options.headers['x-client-session-context'],session.clientContext);
  assert.equal(calls[0].options.credentials,'include');assert.equal(calls[0].options.cache,'no-store');assert.equal(calls[0].options.redirect,'error');assert.ok(calls[0].options.signal);
  assert.equal(calls[0].options.method,'GET');assert.equal(calls[0].options.body,undefined);
  await request('/api/settings/staff/member/revoke',{confirmed:true});
  assert.equal(calls[1].options.method,'POST');assert.equal(calls[1].options.body,'{"confirmed":true}');
  for(const path of ['https://foreign.example.test/api/settings/staff','//foreign/api/settings/staff','/other','/api/../auth','/api/staff#token'])await assert.rejects(request(path),/Invalid staff request/);
  assert.equal(calls.length,2);
});

test('invalid, expired, inactive or held staff views cannot start a mutation or private read',async()=>{
  let calls=0;const fetcher=async()=>{calls++;return ok({});};
  for(const invalid of [{...session,authenticated:false},{...session,staffRole:'worker'},{...session,expiresAt:new Date(time).toISOString()},{...session,clientContext:'invalid'}]) {
    await assert.rejects(createStaffRequest(invalid,()=>true,fetcher,now)('/api/settings/staff',{}),error=>error instanceof StaffRequestError && error.fenced && !error.uncertain);
  }
  await assert.rejects(createStaffRequest(session,()=>false,fetcher,now)('/api/settings/staff'),error=>error.fenced && !error.uncertain);
  await assert.rejects(createStaffRequest(session,()=>true,fetcher,now,()=>false)('/api/settings/staff',{}),error=>error.fenced && !error.uncertain);
  assert.equal(calls,0);
});

test('a changed view during transport or JSON parsing cannot return data or report a mutation confirmed',async()=>{
  for(const body of [undefined,{}])for(const stage of ['transport','parse']) {
    let current=true;
    const request=createStaffRequest(session,()=>current,async()=>{
      if(stage==='transport'){current=false;return ok({private:'old view'});}
      return {ok:true,status:200,json:async()=>{current=false;return {private:'old view'};}};
    },now);
    await assert.rejects(request('/api/settings/staff',body),error=>error instanceof StaffRequestError && error.fenced && error.uncertain===(body!==undefined));
  }
  for(const stage of ['transport','parse']) {
    let allowed=true;
    const request=createStaffRequest(session,()=>true,async()=>{
      if(stage==='transport'){allowed=false;return ok({accepted:true});}
      return {ok:true,status:200,json:async()=>{allowed=false;return {accepted:true};}};
    },now,()=>allowed);
    await assert.rejects(request('/api/settings/staff',{}),error=>error.fenced && error.uncertain,'A foreground session check holds completion as well as new dispatch');
  }
});

test('context denial invalidates only the current view and distinguishes known denial from unknown transport outcome',async()=>{
  for(const status of [401,409]) {
    let lost=0;
    const request=createStaffRequest(session,()=>true,async()=>new Response(JSON.stringify({error:status===409?'Session context changed':'Sign in required'}),{status}),now,()=>true,()=>lost++);
    await assert.rejects(request('/api/settings/staff',{}),error=>error.fenced && error.status===status && !error.uncertain);assert.equal(lost,1);
  }
  let invalidated=0;
  await assert.rejects(createStaffRequest(session,()=>true,async()=>new Response('',{status:401}),now,()=>true,()=>invalidated++)('/api/settings/staff',{}),error=>error.fenced && error.status===401 && !error.uncertain);
  assert.equal(invalidated,1,'Known sign-in denial does not depend on a readable JSON body');
  for(const status of [403,409,503]) {
    let lost=0;const message=status===409?'Last active site owner':status===403?'Forbidden':'Temporarily unavailable';
    const request=createStaffRequest(session,()=>true,async()=>new Response(JSON.stringify({error:message}),{status}),now,()=>true,()=>lost++);
    await assert.rejects(request('/api/settings/staff',{}),error=>!error.fenced && error.status===status && error.uncertain===(status>=500));assert.equal(lost,0);
  }
  await assert.rejects(createStaffRequest(session,()=>true,async()=>{throw Error('PRIVATE CONNECTION DETAILS');},now)('/api/settings/staff',{}),error=>error.uncertain && !error.message.includes('PRIVATE'));
  await assert.rejects(createStaffRequest(session,()=>true,async()=>new Response('bad JSON'),now)('/api/settings/staff',{}),error=>error.uncertain);
});

test('non-JSON gateway responses keep their HTTP status and never trap a definitive send rejection',async()=>{
  for(const [status,uncertain] of [[404,false],[409,false],[502,true],[503,true]]) {
    await assert.rejects(createStaffRequest(session,()=>true,async()=>new Response('<html>gateway</html>',{status}),now)('/api/instructions/send',{}),
      error=>error.status===status && error.uncertain===uncertain && !error.fenced && !error.message.includes('<html>'));
  }
  await assert.rejects(createStaffRequest(session,()=>true,async()=>new Response('not json',{status:404}),now)('/api/instructions/sends/request'),
    error=>error.status===404 && !error.uncertain,'A receipt lookup must expose 404 even when the gateway body is not JSON');
  let lost=0;
  await assert.rejects(createStaffRequest(session,()=>true,async()=>new Response('gateway',{status:401}),now,()=>true,()=>lost++)('/api/instructions/send',{}),
    error=>error.status===401 && error.fenced && !error.uncertain);assert.equal(lost,1);
});

test('aborted or expired completion is fenced and saved staff recovery remains untouched',async()=>{
  const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const scope='synthetic-private-scope',pending={requestId:randomUUID(),id:'member',action:'revoke',body:{revision:1,confirmed:true}};
  savePendingStaff(storage,scope,pending);const before=Array.from(values);
  let current=true;
  const request=createStaffRequest(session,()=>current,async()=>{current=false;return ok({id:'member',revision:2,role:'supervisor',active:false});},now);
  await assert.rejects(async()=>{await request('/api/settings/staff/member/revoke',{...pending.body,requestId:pending.requestId});clearPendingStaff(storage,scope,pending.requestId);},error=>error.fenced && error.uncertain);
  assert.deepEqual(Array.from(values),before);assert.deepEqual(readPendingStaff(storage,scope),pending);
  const controller=new AbortController();controller.abort();let sent=0;
  await assert.rejects(createStaffRequest(session,()=>true,async()=>{sent++;return ok({});},now)('/api/settings/staff',{},controller.signal),error=>error.fenced && !error.uncertain);assert.equal(sent,0);
  let clock=time;
  await assert.rejects(createStaffRequest(session,()=>true,async()=>{clock=Date.parse(session.expiresAt);return ok({});},()=>clock)('/api/settings/staff',{}),error=>error.fenced && error.uncertain);
});

test('explicit source PATCH keeps captured context and cannot disguise a mutation as a GET',async()=>{
  const calls=[],request=createStaffRequest(session,()=>true,async(path,options)=>{calls.push(options);return ok({saved:true});},now);
  assert.deepEqual(await request('/api/briefings/brief',{revision:1},undefined,'PATCH'),{saved:true});
  assert.equal(calls[0].method,'PATCH');assert.equal(calls[0].headers['x-client-session-context'],session.clientContext);
  for(const method of ['GET','DELETE','PUT','HEAD'])await assert.rejects(request('/api/briefings/brief',{},undefined,method),/Invalid staff request/);
  assert.equal(calls.length,1);
});

test('asynchronous receipt validation cannot clear recovery or navigate after an identity change or verification hold',async()=>{
  for(const phase of ['before','validation','held']) {
    let current=phase!=='before',allowed=true,validated=0,completed=0;
    await assert.rejects(completeStaffRequest({id:'exact'},async value=>{validated++;if(phase==='validation')current=false;if(phase==='held')allowed=false;return value.id;},()=>completed++,()=>current,()=>allowed),error=>error.fenced && error.uncertain);
    assert.equal(completed,0);assert.equal(validated,phase==='before'?0:1);
  }
  let completed='';assert.equal(await completeStaffRequest({id:'exact'},value=>value.id,id=>{completed=id;},()=>true),'exact');assert.equal(completed,'exact');
  await assert.rejects(completeStaffRequest({},()=>{throw Error('Invalid receipt');},()=>assert.fail('No cleanup'),()=>true),/Invalid receipt/);
});

test('a known rejection on a later retry never erases an earlier uncertain staff request',()=>{
  const denied={uncertain:false,fenced:false};
  assert.equal(retainStaffRequest(true,true,denied),true);
  assert.equal(retainStaffRequest(true,false,denied),true);
  assert.equal(retainStaffRequest(false,true,denied),false);
  for(const error of [null,{uncertain:true,fenced:false},{uncertain:false,fenced:true}])assert.equal(retainStaffRequest(false,true,error),true);
  assert.equal(retainStaffRequest(false,false,null),false);
});
