import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkedWorkerPresentationArtifact,checkedWorkerPresentationList,checkedWorkerPresentationRequest,
  checkedWorkerPresentationResult,readWorkerPresentations,requestWorkerPresentation,WorkerPresentationError,
} from '../src/worker-presentations.ts';
import {workerPresentationText} from '../src/worker-presentation-text.ts';
import {assertWorkerDictionary} from './helpers/worker-locales.mjs';

const context='a'.repeat(64),now=new Date(Date.now()+86400000*365).toISOString();
const session=()=>({authenticated:true,role:'worker',workerId:'qa-one',language:'ar',mode:'synthetic-credential',clientContext:context,expiresAt:now});
const artifact=overrides=>({
  id:crypto.randomUUID(),sourceKind:'instruction',sourceId:'',publicationId:'publication-one',publicationVersion:3,
  originalLanguage:'en',targetLanguage:'ar',status:'ready',content:{title:'عنوان',text:'نص',question:null},
  provider:'publication-snapshot-v1',live:false,errorCode:null,sourceHash:'a'.repeat(64),
  createdAt:'2026-10-07T12:00:00.000Z',readyAt:'2026-10-07T12:01:00.000Z',...overrides,
});
const answerArtifact=overrides=>artifact({sourceKind:'answer',sourceId:'submission-0001',content:{text:'جواب'},...overrides});
const result=overrides=>({
  status:'ready',presentation:artifact(),reason:null,originalLanguage:'en',targetLanguage:'ar',
  sourceKind:'instruction',sourceId:'',clientContext:context,...overrides,
});
const list=overrides=>({assignmentId:'assignment-one',originalLanguage:'en',approvedLanguage:'ar',items:[artifact()],clientContext:context,...overrides});
const expected={clientContext:context,sourceKind:'instruction',sourceId:'',targetLanguage:'ar'};
const invalid=error=>error instanceof WorkerPresentationError && error.code==='invalid';
const sessionError=error=>error instanceof WorkerPresentationError && error.code==='session';
const conflictError=error=>error instanceof WorkerPresentationError && error.code==='conflict';
const unavailableError=error=>error instanceof WorkerPresentationError && error.code==='unavailable';
const uuid=()=>crypto.randomUUID();

test('translated-view copy covers every worker locale without implying translated audio exists',()=>{
  assertWorkerDictionary(workerPresentationText,'workerPresentationText');
  assert.deepEqual(Object.keys(workerPresentationText.en).sort(),['answer','answerNote','boundNote','check','conflict','deferred','failed',
    'hide','live','loading','notRequired','pending','prepared','providerLabel','question','ready','title','unavailable','unknown','view']);
  assert.match(workerPresentationText.en.ready,/original briefing remains the record/);
  assert.match(workerPresentationText.en.notRequired,/already in your approved language/);
  assert.match(workerPresentationText.en.answerNote,/audio above is your original recording/);
  assert.match(workerPresentationText.en.conflict,/original is still available/);
  assert.doesNotMatch(workerPresentationText.en.answerNote,/translated (audio|recording)/i);
  for(const copy of Object.values(workerPresentationText))for(const value of Object.values(copy))assert.ok(value.trim().length>3);
});

test('ready instruction and answer artifacts require exact content, provenance and language identity',()=>{
  const ready=artifact();
  assert.deepEqual(checkedWorkerPresentationArtifact(ready),ready);
  assert.equal(checkedWorkerPresentationArtifact(ready).content.question,null);
  assert.deepEqual(checkedWorkerPresentationArtifact(answerArtifact()).content,{text:'جواب'});
  assert.equal(checkedWorkerPresentationArtifact(artifact({content:{title:'T',text:'B',question:'Q'},targetLanguage:'ur'})).targetLanguage,'ur');
  assert.equal(checkedWorkerPresentationArtifact(artifact({originalLanguage:'pa-Guru',targetLanguage:'pa-Arab'})).sourceKind,'instruction');
  for(const value of [
    null,{},[],artifact({id:'bad'}),artifact({id:uuid().toUpperCase()}),artifact({sourceKind:'audio'}),
    artifact({sourceId:'submission-0001'}),answerArtifact({sourceId:''}),answerArtifact({sourceId:'short'}),
    answerArtifact({sourceId:'has space in it'}),artifact({publicationId:'has space'}),artifact({publicationId:''}),
    artifact({publicationVersion:0}),artifact({publicationVersion:1.5}),artifact({publicationVersion:'3'}),
    artifact({originalLanguage:'fr'}),artifact({targetLanguage:'pa'}),artifact({status:'deferred'}),
    artifact({sourceHash:'a'.repeat(63)}),artifact({sourceHash:'A'.repeat(64)}),artifact({createdAt:'not-a-date'}),
    artifact({provider:null}),artifact({provider:'Bad Provider'}),artifact({live:'no'}),artifact({errorCode:'translation_failed'}),
    artifact({readyAt:null}),artifact({content:null}),artifact({content:{title:'T',text:'B'}}),
    artifact({content:{title:'T',text:'B',question:null,extra:'x'}}),artifact({content:{title:' ',text:'B',question:null}}),
    artifact({content:{title:'T',text:'B',question:'Q'.repeat(501)}}),artifact({content:{title:'T',text:'B'.repeat(5001),question:null}}),
    artifact({content:{title:'T\u0000',text:'B',question:null}}),answerArtifact({content:{text:''}}),
    answerArtifact({content:{text:'T'.repeat(5001)}}),answerArtifact({content:{title:'T',text:'B',question:null}}),
    artifact({status:'pending',content:null,provider:null,live:false,errorCode:null,readyAt:null}),
    artifact({status:'pending',content:null,provider:null,live:null,errorCode:'translation_failed',readyAt:'2026-10-07T12:01:00.000Z'}),
    artifact({status:'pending',content:{title:'T',text:'B',question:null},provider:null,live:null,errorCode:null,readyAt:null}),
    artifact({status:'failed',content:null,provider:'publication-snapshot-v1',live:null,errorCode:null,readyAt:null}),
    artifact({status:'failed',content:null,provider:null,live:null,errorCode:'bad\u0000code',readyAt:null}),
  ])assert.throws(()=>checkedWorkerPresentationArtifact(value),invalid);
  assert.deepEqual(checkedWorkerPresentationArtifact(artifact({status:'pending',content:null,provider:null,live:null,errorCode:null,readyAt:null})).content,null);
  assert.deepEqual(checkedWorkerPresentationArtifact(artifact({status:'failed',content:null,provider:null,live:null,errorCode:'translation_invalid',readyAt:null})).errorCode,'translation_invalid');
});

test('presentation results bind the wrapper languages and source to the artifact or carry no artifact at all',()=>{
  assert.equal(checkedWorkerPresentationResult(result(),expected).status,'ready');
  assert.equal(checkedWorkerPresentationResult(result({status:'pending',presentation:artifact({status:'pending',content:null,provider:null,live:null,errorCode:null,readyAt:null})}),expected).status,'pending');
  const failed=artifact({status:'failed',content:null,provider:null,live:null,errorCode:'translation_failed',readyAt:null});
  assert.equal(checkedWorkerPresentationResult(result({status:'failed',presentation:failed}),expected).presentation.errorCode,'translation_failed');
  for(const status of ['not_required','unavailable','deferred']){
    assert.equal(checkedWorkerPresentationResult(result({status,presentation:null,reason:null}),expected).status,status);
    assert.equal(checkedWorkerPresentationResult(result({status,presentation:null,reason:'generation_paused'}),expected).reason,'generation_paused');
  }
  const answer=result({presentation:answerArtifact(),sourceKind:'answer',sourceId:'submission-0001'});
  assert.equal(checkedWorkerPresentationResult(answer,{...expected,sourceKind:'answer',sourceId:'submission-0001'}).presentation.sourceKind,'answer');
  assert.throws(()=>checkedWorkerPresentationResult(result({clientContext:'b'.repeat(64)}),expected),sessionError);
  for(const value of [
    null,{},[],result({status:'unknown'}),{...result(),extra:'x'},
    result({sourceKind:'answer'}),result({sourceId:'submission-0001'}),result({targetLanguage:'en'}),
    result({originalLanguage:'fr'}),result({presentation:null}),result({presentation:artifact({status:'pending',content:null,provider:null,live:null,errorCode:null,readyAt:null})}),
    result({presentation:answerArtifact()}),result({presentation:artifact({sourceId:'submission-0001'})}),
    result({presentation:artifact({targetLanguage:'ur'})}),result({presentation:artifact({originalLanguage:'ur'})}),
    result({status:'not_required',presentation:artifact()}),result({status:'deferred',presentation:answerArtifact(),sourceKind:'answer',sourceId:'submission-0001'}),
    result({status:'unavailable',presentation:null,reason:'bad\u0000reason'}),result({status:'unavailable',presentation:null,reason:false}),
    result({reason:42}),
  ])assert.throws(()=>checkedWorkerPresentationResult(value,expected),invalid);
});

test('presentation lists are assignment-, context- and approved-language bound with unique artifacts',()=>{
  assert.equal(checkedWorkerPresentationList(list(),{assignmentId:'assignment-one',clientContext:context,approvedLanguage:'ar'}).items.length,1);
  assert.equal(checkedWorkerPresentationList(list({items:[]}),{assignmentId:'assignment-one',clientContext:context,approvedLanguage:'ar'}).items.length,0);
  assert.equal(checkedWorkerPresentationList(list({items:[artifact(),answerArtifact()]}),{assignmentId:'assignment-one',clientContext:context,approvedLanguage:'ar'}).items.length,2);
  assert.throws(()=>checkedWorkerPresentationList(list({clientContext:'b'.repeat(64)}),{assignmentId:'assignment-one',clientContext:context,approvedLanguage:'ar'}),sessionError);
  const same=artifact();
  for(const value of [
    null,{},[],{...list(),extra:'x'},list({assignmentId:'other'}),list({approvedLanguage:'ur'}),
    list({originalLanguage:'fr'}),list({items:null}),list({items:'none'}),
    list({items:[artifact({id:'bad'})]}),list({items:[same,same]}),list({items:[artifact({sourceKind:'audio'})]}),
  ])assert.throws(()=>checkedWorkerPresentationList(value,{assignmentId:'assignment-one',clientContext:context,approvedLanguage:'ar'}),invalid);
  assert.throws(()=>checkedWorkerPresentationList(list({items:Array.from({length:10001},()=>artifact())}),{assignmentId:'assignment-one',clientContext:context,approvedLanguage:'ar'}),invalid);
});

test('presentation requests accept only exact instruction or identified-answer shapes',()=>{
  const requestId=uuid();
  assert.deepEqual(checkedWorkerPresentationRequest({requestId,sourceKind:'instruction'}),{requestId,sourceKind:'instruction'});
  assert.deepEqual(checkedWorkerPresentationRequest({requestId,sourceKind:'answer',sourceId:'submission-0001'}),
    {requestId,sourceKind:'answer',sourceId:'submission-0001'});
  for(const value of [
    null,{},[],{requestId:uuid()},{requestId:'bad',sourceKind:'instruction'},{requestId:uuid().toUpperCase(),sourceKind:'instruction'},
    {requestId:uuid(),sourceKind:'audio'},{requestId:uuid(),sourceKind:'instruction',sourceId:'submission-0001'},
    {requestId:uuid(),sourceKind:'instruction',extra:'x'},{requestId:uuid(),sourceKind:'answer'},
    {requestId:uuid(),sourceKind:'answer',sourceId:'short'},{requestId:uuid(),sourceKind:'answer',sourceId:'has space'},
    {requestId:uuid(),sourceKind:'answer',sourceId:'submission-0001',extra:'x'},
  ])assert.throws(()=>checkedWorkerPresentationRequest(value),invalid);
});

function fake(response,onSend){
  const requests=[];
  return {requests,send:async(path,options)=>{requests.push({path,options});onSend?.(options);return typeof response==='function'?response(options):response;}};
}

test('reading the cached list is a no-store session-fenced GET and never posts',async()=>{
  const {send,requests}=fake(Response.json(list({items:[artifact(),answerArtifact()]})));
  const value=await readWorkerPresentations(send,session(),'assignment-one',new AbortController().signal,()=>true);
  assert.equal(value.items.length,2);
  assert.equal(requests.length,1);
  assert.equal(requests[0].path,'/api/worker/briefings/assignment-one/presentations');
  assert.equal(requests[0].options.method,undefined);
  assert.equal(requests[0].options.credentials,'include');
  assert.equal(requests[0].options.cache,'no-store');
  assert.equal(requests[0].options.headers['x-client-session-context'],context);
  assert.ok(!('content-type' in requests[0].options.headers));
  const empty=fake(Response.json(list({items:[]})));
  assert.equal((await readWorkerPresentations(empty.send,session(),'assignment-one',new AbortController().signal,()=>true)).items.length,0);
});

test('read failures distinguish an invalid session, a changed briefing and honest unavailability',async()=>{
  for(const status of [401,403]){
    await assert.rejects(readWorkerPresentations(fake(new Response(null,{status})).send,session(),'assignment-one',new AbortController().signal,()=>true),sessionError);
  }
  await assert.rejects(readWorkerPresentations(fake(Response.json({error:'Session context changed'},{status:409})).send,session(),'assignment-one',new AbortController().signal,()=>true),sessionError);
  for(const body of [{error:'Presentation source conflict'},{error:'Presentation language changed'},{}]){
    await assert.rejects(readWorkerPresentations(fake(Response.json(body,{status:409})).send,session(),'assignment-one',new AbortController().signal,()=>true),conflictError);
  }
  for(const status of [404,410,500,503]){
    await assert.rejects(readWorkerPresentations(fake(new Response(null,{status})).send,session(),'assignment-one',new AbortController().signal,()=>true),unavailableError);
  }
  for(const response of [new Response('not json',{status:200}),Response.json(list({items:[artifact({id:'bad'})]}))]){
    await assert.rejects(readWorkerPresentations(fake(response).send,session(),'assignment-one',new AbortController().signal,()=>true),invalid);
  }
});

test('read requests fail before any fetch on an invalid identity and fence in-flight authority changes',async()=>{
  const {send,requests}=fake(Response.json(list()));
  for(const [selected,current] of [['has space',()=>true],['assignment-one',()=>false]]){
    await assert.rejects(readWorkerPresentations(send,session(),selected,new AbortController().signal,current),sessionError);
  }
  await assert.rejects(readWorkerPresentations(send,{...session(),expiresAt:'2000-01-01T00:00:00.000Z'},'assignment-one',new AbortController().signal,()=>true),sessionError);
  await assert.rejects(readWorkerPresentations(send,{...session(),language:'fr'},'assignment-one',new AbortController().signal,()=>true),sessionError);
  assert.equal(requests.length,0);

  let allowed=true;
  await assert.rejects(readWorkerPresentations(fake(Response.json(list()),()=>{allowed=false;}).send,session(),'assignment-one',new AbortController().signal,()=>allowed),sessionError);
  const mutable=session();
  await assert.rejects(readWorkerPresentations(fake(Response.json(list()),()=>{mutable.language='ur';}).send,mutable,'assignment-one',new AbortController().signal,()=>true),sessionError);

  const controller=new AbortController();
  await assert.rejects(readWorkerPresentations(fake(()=>{controller.abort();throw new DOMException('Aborted','AbortError');}).send,session(),'assignment-one',controller.signal,()=>true),sessionError);
  await assert.rejects(readWorkerPresentations(fake(()=>{throw Error('offline');}).send,session(),'assignment-one',new AbortController().signal,()=>true),unavailableError);
});

test('requesting a translation posts the exact validated body once and validates the bound result',async()=>{
  const requestId=uuid(),{send,requests}=fake(Response.json(result()));
  const value=await requestWorkerPresentation(send,session(),'assignment-one',{requestId,sourceKind:'instruction'},new AbortController().signal,()=>true);
  assert.equal(value.status,'ready');
  assert.equal(requests.length,1);
  assert.equal(requests[0].path,'/api/worker/briefings/assignment-one/presentations');
  assert.equal(requests[0].options.method,'POST');
  assert.equal(requests[0].options.credentials,'include');
  assert.equal(requests[0].options.cache,'no-store');
  assert.equal(requests[0].options.headers['content-type'],'application/json');
  assert.equal(requests[0].options.headers['x-client-session-context'],context);
  assert.deepEqual(JSON.parse(requests[0].options.body),{requestId,sourceKind:'instruction'});

  const bound=uuid(),answered=fake(Response.json(result({presentation:answerArtifact({sourceId:'submission-0001'}),sourceKind:'answer',sourceId:'submission-0001'})));
  assert.equal((await requestWorkerPresentation(answered.send,session(),'assignment-one',{requestId:bound,sourceKind:'answer',sourceId:'submission-0001'},new AbortController().signal,()=>true)).sourceKind,'answer');
  assert.deepEqual(JSON.parse(answered.requests[0].options.body),{requestId:bound,sourceKind:'answer',sourceId:'submission-0001'});
});

test('request failures distinguish session, conflict, unavailable and invalid results without retrying',async()=>{
  const request={requestId:uuid(),sourceKind:'instruction'},signal=()=>new AbortController().signal;
  const broken=fake(Response.json(result(),{status:500}));
  await assert.rejects(requestWorkerPresentation(broken.send,session(),'assignment-one',request,signal(),()=>true),unavailableError);
  for(const status of [401,403]){
    const {send,requests}=fake(new Response(null,{status}));
    await assert.rejects(requestWorkerPresentation(send,session(),'assignment-one',request,signal(),()=>true),sessionError);
    assert.equal(requests.length,1);
  }
  const changed=fake(Response.json({error:'Session context changed'},{status:409}));
  await assert.rejects(requestWorkerPresentation(changed.send,session(),'assignment-one',request,signal(),()=>true),sessionError);
  for(const response of [
    Response.json({error:'Presentation request conflict'},{status:409}),
    Response.json({error:'Presentation source conflict'},{status:409}),
    Response.json({error:'Presentation language changed'},{status:409}),
  ]){
    const {send,requests}=fake(response);
    await assert.rejects(requestWorkerPresentation(send,session(),'assignment-one',request,signal(),()=>true),conflictError);
    assert.equal(requests.length,1);
  }
  for(const status of [404,410]){
    const {send,requests}=fake(new Response(null,{status}));
    await assert.rejects(requestWorkerPresentation(send,session(),'assignment-one',request,signal(),()=>true),unavailableError);
    assert.equal(requests.length,1);
  }
  for(const response of [
    new Response('not json',{status:200}),Response.json(result({presentation:null})),
    Response.json(result({sourceKind:'answer'})),Response.json(result({targetLanguage:'en'})),
  ]){
    const {send,requests}=fake(response);
    await assert.rejects(requestWorkerPresentation(send,session(),'assignment-one',request,signal(),()=>true),invalid);
    assert.equal(requests.length,1);
  }
  await assert.rejects(requestWorkerPresentation(fake(Response.json(result({clientContext:'b'.repeat(64)}))).send,session(),'assignment-one',request,signal(),()=>true),sessionError);
  const deferred=fake(Response.json(result({status:'deferred',presentation:null,reason:'generation_paused'})));
  assert.equal((await requestWorkerPresentation(deferred.send,session(),'assignment-one',request,signal(),()=>true)).status,'deferred');
  const unavailable=fake(Response.json(result({status:'unavailable',presentation:null,reason:'translation_not_enabled'})));
  assert.equal((await requestWorkerPresentation(unavailable.send,session(),'assignment-one',request,signal(),()=>true)).reason,'translation_not_enabled');
});

test('request validation and in-flight authority checks stop before or after the single POST',async()=>{
  const {send,requests}=fake(Response.json(result()));
  for(const value of [null,{requestId:'bad',sourceKind:'instruction'},{requestId:uuid(),sourceKind:'answer'},{requestId:uuid(),sourceKind:'instruction',sourceId:'submission-0001'}]){
    await assert.rejects(requestWorkerPresentation(send,session(),'assignment-one',value,new AbortController().signal,()=>true),invalid);
  }
  await assert.rejects(requestWorkerPresentation(send,session(),'assignment-one',{requestId:uuid(),sourceKind:'instruction'},new AbortController().signal,()=>false),sessionError);
  assert.equal(requests.length,0);

  const request={requestId:uuid(),sourceKind:'instruction'};
  let allowed=true;
  await assert.rejects(requestWorkerPresentation(fake(Response.json(result()),()=>{allowed=false;}).send,session(),'assignment-one',request,new AbortController().signal,()=>allowed),sessionError);
  const mutable=session();
  await assert.rejects(requestWorkerPresentation(fake(Response.json(result()),()=>{mutable.expiresAt=new Date(Date.parse(now)+1000).toISOString();}).send,mutable,'assignment-one',request,new AbortController().signal,()=>true),sessionError);
  const controller=new AbortController();
  await assert.rejects(requestWorkerPresentation(fake(()=>{controller.abort();throw new DOMException('Aborted','AbortError');}).send,session(),'assignment-one',request,controller.signal,()=>true),sessionError);
  await assert.rejects(requestWorkerPresentation(fake(()=>{throw Error('offline');}).send,session(),'assignment-one',request,new AbortController().signal,()=>true),unavailableError);
});

test('translated multiple-choice artifacts preserve public option identities and reject malformed options',()=>{
  const choices=Array.from({length:4},(_,i)=>({id:String(i).repeat(32),text:`Translated option ${i}`}));
  const content={title:'Translated title',text:'Translated instruction',question:'Translated question?',questionType:'multiple-choice',choices};
  assert.deepEqual(checkedWorkerPresentationArtifact(artifact({content})).content.choices,choices);
  for(const changed of [{...content,choices:choices.slice(0,3)},{...content,choices:[choices[0],choices[0],...choices.slice(2)]},{...content,choices:choices.map(choice=>({...choice,answer:true}))}])assert.throws(()=>checkedWorkerPresentationArtifact(artifact({content:changed})),invalid);
});
