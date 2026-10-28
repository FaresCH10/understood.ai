import test from 'node:test';
import assert from 'node:assert/strict';
import {bindOfflineSession,BootstrapSessionError,clearOfflineBriefings,fetchBootstrapSession,fetchOfflineBriefing,offlineAudioBytes,offlineLimits,OfflineError,readBoundOfflineBundle,readOfflineBundle,saveOfflineBriefing} from '../src/worker-offline.ts';
import {encodeWav} from '../src/audio.ts';

const time=Date.parse('2026-10-10T12:00:00.000Z'),now=()=>time;
const session={authenticated:true,role:'worker',workerId:'private-worker',language:'en',mode:'synthetic-credential',clientContext:'a'.repeat(64),expiresAt:'2026-10-12T12:00:00.000Z'};
const scope={assignmentId:'private-assignment',publicationId:'private-publication',version:3,language:'en'};
const notice={revision:1,configured:true,language:'en',notice:'Private site notice before recording.'};
function wav(seconds=1){const samples=Float32Array.from({length:16000*seconds},(_,i)=>Math.sin(i/10)*.5);return encodeWav({duration:seconds,sampleRate:16000,numberOfChannels:1,getChannelData:()=>samples});}
const encoded=seconds=>Buffer.from(wav(seconds)).toString('base64');
function item(overrides={}){return {scope:{...scope},title:'Private title',text:'Private instructions, not a rubric.',question:'Private question?',savedAt:new Date(time).toISOString(),expiresAt:new Date(time+86400000).toISOString(),answerUntil:new Date(time+3600000).toISOString(),canRecord:true,notice:{...notice},audio:{body:encoded(1),question:null},...overrides};}
function memory(){let value=null;return {get value(){return value;},set value(next){value=next;},async read(){return structuredClone(value);},async replace(revision,next,allowed){if(!allowed() || (value?.revision ?? null)!==revision)return false;value=structuredClone(next);return true;},async clear(){value=null;}};}
const fails=code=>error=>error instanceof OfflineError && error.code===code;

test('acknowledgment-only instructions save offline without a question, consent fetch or answer recording',async()=>{
  const calls=[],send=async path=>{
    calls.push(path);if(path==='/api/session')return Response.json(session);
    assert.equal(path,`/api/worker/briefings/${scope.assignmentId}`);
    return Response.json({id:scope.assignmentId,publicationId:scope.publicationId,version:scope.version,language:scope.language,state:'published',responseMode:'acknowledge',content:{title:'Notice',text:'Keep the walkway clear.'}});
  };
  const value=await fetchOfflineBriefing(send,session,scope,()=>true,now);
  assert.equal(value.question,null);assert.equal(value.canRecord,false);assert.equal(value.responseMode,'acknowledge');
  assert.ok(!calls.some(path=>path.includes('recording-notice')));
  const store=memory();await saveOfflineBriefing(session,value,true,()=>true,store,now);
  assert.deepEqual((await readOfflineBundle(store,()=>true,now)).briefings,[value]);
  for(const patch of [{question:'A question?'},{canRecord:true},{audio:{body:null,question:encoded(1)}}])await assert.rejects(saveOfflineBriefing(session,{...value,...patch},true,()=>true,memory(),now),fails('invalid'));
});
test('private briefing storage is opt-in, nonextractable and strictly whitelisted with exact text/audio readback',async()=>{
  const store=memory(),value=item();await assert.rejects(saveOfflineBriefing(session,value,false,()=>true,store,now),fails('invalid'));assert.equal(store.value,null);
  await saveOfflineBriefing(session,value,true,()=>true,store,now);assert.equal(store.value.key.extractable,false);await assert.rejects(crypto.subtle.exportKey('raw',store.value.key));
  assert.deepEqual(Object.keys(store.value).sort(),['ciphertext','context','iv','key','revision']);
  const raw=new TextDecoder().decode(store.value.ciphertext);for(const text of [session.workerId,scope.assignmentId,scope.publicationId,value.title,value.text,value.question])assert.equal(raw.includes(text),false);
  const read=await readOfflineBundle(store,()=>true,now);assert.deepEqual(read,{session,briefings:[value]});assert.deepEqual(offlineAudioBytes(read.briefings[0].audio.body),wav());
  read.briefings[0].text='changed';assert.equal((await readOfflineBundle(store,()=>true,now)).briefings[0].text,value.text);
  for(const changed of [{...value,rubric:'secret'},{...value,scope:{...scope,language:'ar'}},{...value,expiresAt:session.expiresAt},{...value,title:''}])await assert.rejects(saveOfflineBriefing(session,changed,true,()=>true,memory(),now),fails('invalid'));
});
test('count and byte limits reject without eviction; explicit refresh preserves independent entries',async()=>{
  const store=memory();for(let i=0;i<offlineLimits.briefings;i++)await saveOfflineBriefing(session,item({scope:{...scope,assignmentId:`assignment-${i}`}}),true,()=>true,store,now);
  const before=store.value;await assert.rejects(saveOfflineBriefing(session,item(),true,()=>true,store,now),fails('limit'));assert.deepEqual(store.value,before);
  await saveOfflineBriefing(session,item({scope:{...scope,assignmentId:'assignment-0'},text:'Explicitly refreshed same assignment'}),true,()=>true,store,now);
  assert.equal((await readOfflineBundle(store,()=>true,now)).briefings.length,5);
  const large=memory(),audio={body:encoded(90),question:null};for(let i=0;i<2;i++)await saveOfflineBriefing(session,item({scope:{...scope,assignmentId:`large-${i}`},audio}),true,()=>true,large,now);
  const preserved=large.value;await assert.rejects(saveOfflineBriefing(session,item({scope:{...scope,assignmentId:'large-2'},audio}),true,()=>true,large,now),fails('limit'));assert.deepEqual(large.value,preserved);
});
test('expiry prunes without disclosing expired data and rejects stale/changed session writes',async()=>{
  const store=memory();await saveOfflineBriefing(session,item({expiresAt:new Date(time+1000).toISOString()}),true,()=>true,store,now);
  await saveOfflineBriefing(session,item({scope:{...scope,assignmentId:'second'}}),true,()=>true,store,now);
  assert.deepEqual((await readOfflineBundle(store,()=>true,()=>time+1000)).briefings.map(value=>value.scope.assignmentId),['second']);
  assert.equal(await readOfflineBundle(store,()=>true,()=>time+86400000),null);assert.equal(store.value,null);
  await saveOfflineBriefing(session,item(),true,()=>true,store,now);
  for(const changed of [{...session,clientContext:'b'.repeat(64)},{...session,language:'ar'},{...session,workerId:'other'},{...session,expiresAt:new Date(time+99999999).toISOString()}])await assert.rejects(saveOfflineBriefing(changed,item(),true,()=>true,store,now),error=>error instanceof OfflineError);
  await assert.rejects(readOfflineBundle(store,()=>false,now),fails('session'));
  let live=true;const slow={...store,async read(){const result=await store.read();live=false;return result;}};await assert.rejects(readOfflineBundle(slow,()=>live,now),fails('session'));
});
test('tampering, failed writes and deletion cannot claim durable success',async()=>{
  for(const mutate of [value=>{new Uint8Array(value.ciphertext)[0]^=1;},value=>{value.iv[0]^=1;},value=>{value.context='b'.repeat(64);},value=>{value.revision=crypto.randomUUID();},value=>{value.extra=true;}]){
    const store=memory();await saveOfflineBriefing(session,item(),true,()=>true,store,now);mutate(store.value);await assert.rejects(readOfflineBundle(store,()=>true,now),fails('invalid'));
  }
  const store=memory();await assert.rejects(saveOfflineBriefing(session,item(),true,()=>true,{...store,replace:async()=>true},now),fails('storage'));
  await saveOfflineBriefing(session,item(),true,()=>true,store,now);await clearOfflineBriefings('b'.repeat(64),store);assert.ok(store.value);
  await assert.rejects(clearOfflineBriefings(undefined,{...store,replace:async()=>true}),fails('storage'));
  await clearOfflineBriefings(session.clientContext,store);assert.equal(store.value,null);
  for(const audio of ['bad',encoded(1).slice(1),'='.repeat(9),Buffer.alloc(50).toString('base64')])assert.throws(()=>offlineAudioBytes(audio));
});
test('a cached session is not authentication: same-tab lease required, changed/ended lease never discloses',async()=>{
  const store=memory(),values=new Map(),storage={getItem:key=>values.get(key) ?? null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  await saveOfflineBriefing(session,item(),true,()=>true,store,now);assert.equal(await readBoundOfflineBundle(store,storage,()=>true,now),null);
  bindOfflineSession(session,storage,now);assert.ok(await readBoundOfflineBundle(store,storage,()=>true,now));
  bindOfflineSession({...session,clientContext:'b'.repeat(64)},storage,now);assert.equal(await readBoundOfflineBundle(store,storage,()=>true,now),null);
  bindOfflineSession({authenticated:false},storage);assert.equal(values.size,0);
  assert.throws(()=>bindOfflineSession(session,{...storage,setItem:()=>{}},now),fails('storage'));
  bindOfflineSession(session,storage,now);bindOfflineSession(session,storage,()=>Date.parse(session.expiresAt));assert.equal(values.size,0);
});
function network(change){
  const calls=[],value={id:scope.assignmentId,publicationId:scope.publicationId,version:scope.version,language:'en',state:'published',dueAt:new Date(time+3600000).toISOString(),content:{title:'Title',text:'Instructions',question:'Question'},speechUrls:{body:`/api/worker/briefings/${scope.assignmentId}/speech/body`,question:`/api/worker/briefings/${scope.assignmentId}/speech/question`}};
  let details=0;const send=async(path,options)=>{calls.push({path,options});assert.equal(options.credentials,'include');assert.equal(options.cache,'no-store');assert.equal(options.headers['x-client-session-context'],session.clientContext);assert.equal(options.method,undefined);
    let data=path==='/api/session'?session:path==='/api/privacy/recording-notice?language=en'?notice:structuredClone(value);if(path.endsWith('/speech/body') || path.endsWith('/speech/question'))return new Response(wav(),{headers:{'content-type':'audio/wav'}});
    if(path.includes('/briefings/'))details++;data=change?.(path,data,details) ?? data;return data instanceof Response?data:Response.json(data);
  };return {send,calls};
}
test('online snapshot captures only its exact authorized version/notice/audio and rechecks identity before local commit',async()=>{
  const {send,calls}=network();const result=await fetchOfflineBriefing(send,session,scope,()=>true,now);assert.equal(result.title,'Title');assert.deepEqual(result.notice,notice);assert.equal(result.canRecord,true);assert.equal(result.expiresAt,new Date(time+86400000).toISOString());
  assert.deepEqual(offlineAudioBytes(result.audio.body),wav());assert.deepEqual(calls.map(value=>value.path),['/api/session',`/api/worker/briefings/${scope.assignmentId}`,`/api/worker/briefings/${scope.assignmentId}/speech/body`,`/api/worker/briefings/${scope.assignmentId}/speech/question`,'/api/privacy/recording-notice?language=en',`/api/worker/briefings/${scope.assignmentId}`,'/api/session']);
  for(const change of [
    (path,data)=>path==='/api/session'?{...data,workerId:'other'}:data,
    (path,data,n)=>n===2?{...data,state:'withdrawn'}:data,
    (path,data,n)=>n===2?{...data,content:{...data.content,text:'changed'}}:data,
    (path,data)=>path.startsWith('/api/privacy/recording-notice')?{...data,language:'ar'}:data,
    (path,data)=>path===`/api/worker/briefings/${scope.assignmentId}`?{...data,speechUrls:{body:'https://outside.invalid/audio'}}:data,
  ])await assert.rejects(fetchOfflineBriefing(network(change).send,session,scope,()=>true,now),error=>error instanceof OfflineError);
});

test('offline snapshot explicitly requests the frozen notice language independently of profile language',async()=>{
  const frozen={...scope,language:'ur'},calls=[];
  const send=async(path,options)=>{
    calls.push(path);assert.equal(options.headers['x-client-session-context'],session.clientContext);
    if(path==='/api/session')return Response.json(session);
    if(path==='/api/privacy/recording-notice?language=ur')return Response.json({...notice,language:'ur'});
    assert.equal(path,`/api/worker/briefings/${scope.assignmentId}`);
    return Response.json({id:scope.assignmentId,publicationId:scope.publicationId,version:scope.version,language:'ur',state:'published',content:{title:'Title',text:'Instructions',question:'Question'}});
  };
  const result=await fetchOfflineBriefing(send,session,frozen,()=>true,now);
  assert.equal(result.notice.language,'ur');assert.equal(result.scope.language,'ur');assert.equal(session.language,'en');assert.ok(calls.includes('/api/privacy/recording-notice?language=ur'));
  const store=memory();await saveOfflineBriefing(session,result,true,()=>true,store,now);
  assert.equal((await readOfflineBundle(store,()=>true,now)).briefings[0].scope.language,'ur');
  await assert.rejects(saveOfflineBriefing(session,{...result,notice:{...result.notice,language:'en'}},true,()=>true,store,now),fails('invalid'));
  await assert.rejects(saveOfflineBriefing({...session,language:'ur'},result,true,()=>true,store,now),fails('session'));
});
test('offline fallback is allowed only for transport/5xx, never denied authority or invalid successful session JSON',async()=>{
  const signal=new AbortController().signal;
  assert.deepEqual(await fetchBootstrapSession(async()=>Response.json(session),signal),session);
  for(const status of [401,403,404,409,410,429,500,503])await assert.rejects(fetchBootstrapSession(async()=>new Response('',{status}),signal),error=>error instanceof BootstrapSessionError && error.offline===(status>=500));
  await assert.rejects(fetchBootstrapSession(async()=>{throw new TypeError('Network unavailable');},signal),error=>error instanceof BootstrapSessionError && error.offline);
  await assert.rejects(fetchBootstrapSession(async()=>new Response('not JSON'),signal),error=>error instanceof BootstrapSessionError && !error.offline);
  await assert.rejects(fetchBootstrapSession(async()=>{throw new DOMException('Cancelled','AbortError');},signal),error=>error instanceof BootstrapSessionError && !error.offline);
});
