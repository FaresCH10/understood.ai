import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {conversationComposerPolicy,checkedConversationPage,checkedConversationReceipt,requestConversation,validConversationSession,ConversationRequestError} from '../src/conversation-request.ts';
import {retainMessage,readPendingMessage} from '../src/case-message-recovery.ts';

const context='a'.repeat(64),caseId='case-1',id=randomUUID(),createdAt='2026-01-01T09:00:00.000Z';
const session=()=>({clientContext:context,expiresAt:new Date(Date.now()+60000).toISOString()});
const message=()=>({id,caseId,language:'en',createdAt,author:'worker',authorName:'Worker',text:'Synthetic reply'});
const page=()=>({caseId,clientContext:context,items:[message()],total:1,page:1,pageSize:20,status:'open',language:'en',canReply:true,canGenerate:false,canVoice:false});
const receipt=()=>({id,caseId,language:'en',createdAt,clientContext:context});
const generated=()=>({...receipt(),status:'queued',deliveredAt:null,errorCode:null});
const error=code=>reason=>reason instanceof ConversationRequestError&&reason.code===code;
const request=(send,operation={kind:'page',page:1},s=session(),current=()=>true,canMutate=current)=>requestConversation(send,s,caseId,true,operation,new AbortController().signal,current,canMutate);

test('new generated staff follow-ups use 500 while ordinary messages and captured commands retain 1000',()=>{
  const base={worker:false,pendingKind:null,canGenerate:true,language:'ar',includeAudio:false};
  for(const language of ['ar','ur','hi','fil'])assert.deepEqual(conversationComposerPolicy({...base,language}),{kind:'followup',limit:500});
  assert.deepEqual(conversationComposerPolicy({...base,language:'en',includeAudio:true}),{kind:'followup',limit:500});
  for(const options of [{worker:true},{canGenerate:false},{language:'en'}])assert.deepEqual(conversationComposerPolicy({...base,...options}),{kind:'message',limit:1000});
  for(const [pendingKind,kind] of [['message','message'],['followup','followup']])for(const includeAudio of [false,true])assert.deepEqual(conversationComposerPolicy({...base,pendingKind,includeAudio}),{kind,limit:1000});
});

test('conversation page validates scoped exact DTO, coherent paging, authors, capabilities and private audio paths',()=>{
  assert.equal(checkedConversationPage(page(),caseId,1,context,true).total,1);
  assert.equal(checkedConversationPage({...page(),language:'hi',items:[{...message(),language:'hi'}]},caseId,1,context,true).language,'hi');
  const audio={...message(),kind:'voice',audioUrl:`/api/clarifications/${caseId}/messages/${id}/voice`};
  assert.equal(checkedConversationPage({...page(),items:[audio]},caseId,1,context,true).items[0].kind,'voice');
  assert.equal(checkedConversationPage({...page(),items:[],page:2},caseId,2,context,true).total,1);
  const bad=[null,[],{}, {...page(),notes:'PRIVATE'}, {...page(),caseId:'foreign'}, {...page(),page:2}, {...page(),pageSize:5},
    {...page(),total:-1},{...page(),total:2},{...page(),status:'unknown'},{...page(),language:'xx'}, {...page(),canVoice:'yes'},
    {...page(),canGenerate:true},{...page(),status:'resolved'},{...page(),canReply:false,canVoice:true},
    ...[{...message(),caseId:'foreign'},{...message(),language:'ar'},{...message(),createdAt:'2026-02-31T09:00:00.000Z'},
      {...message(),text:''},{...message(),text:'x'.repeat(1001)},{...message(),author:'system'}, {...message(),authorName:'x\nprivate'},
      {...message(),notes:'PRIVATE'}, {...message(),audioUrl:'https://evil.example/audio'},
      {...audio,author:'staff'}, {...audio,kind:'typed'}, {...message(),audioUrl:audio.audioUrl},
      {...audio,audioUrl:`/api/clarifications/foreign/messages/${id}/voice`}].map(row=>({...page(),items:[row]})),
    {...page(),total:2,items:[message(),message()]},
    {...page(),total:2,items:[message(),{...message(),id:randomUUID(),createdAt:'2026-01-02T09:00:00.000Z'}]}];
  for(const value of bad)assert.throws(()=>checkedConversationPage(value,caseId,1,context,true),error('invalid'));
  assert.throws(()=>checkedConversationPage({...page(),clientContext:'b'.repeat(64)},caseId,1,context,true),error('session'));
  assert.throws(()=>checkedConversationPage({...page(),canVoice:true},caseId,1,context,false),error('invalid'));
});

test('conversation receipts bind exact command and context without inventing generation stages',()=>{
  assert.equal(checkedConversationReceipt(receipt(),caseId,id,context,'message').id,id);
  for(const status of ['queued','processing','delivered','failed']){
    const value={...generated(),status,...(status==='delivered'?{deliveredAt:createdAt}:{}),...(status==='failed'?{errorCode:'interrupted'}:{})};
    assert.equal(checkedConversationReceipt(value,caseId,id,context,'followup').status,status);
  }
  for(const value of [null,{}, {...receipt(),extra:true},{...receipt(),id:randomUUID()},{...receipt(),language:'xyz'},{...receipt(),createdAt:'yesterday'}])
    assert.throws(()=>checkedConversationReceipt(value,caseId,id,context,'message'),error('invalid'));
  for(const value of [{...generated(),status:'complete'},{...generated(),status:'delivered'}, {...generated(),deliveredAt:createdAt},
    {...generated(),errorCode:'PRIVATE SQL'}, {...generated(),errorCode:'interrupted'},
    {...generated(),status:'delivered',deliveredAt:'2025-01-01T00:00:00.000Z'}, {...generated(),status:'failed',errorCode:'private diagnostic'}])
    assert.throws(()=>checkedConversationReceipt(value,caseId,id,context,'followup'),error('invalid'));
  assert.throws(()=>checkedConversationReceipt(receipt(),caseId,id,'invalid','message'),error('invalid'));
  assert.throws(()=>checkedConversationReceipt({...receipt(),clientContext:'b'.repeat(64)},caseId,id,context,'message'),error('session'));
});

test('conversation transport uses bounded GET and captured identity; POST is explicit and exactly scoped',async()=>{
  const calls=[];const send=async(url,options)=>{calls.push({url,options});return Response.json(options.method==='POST'?receipt():page());};
  await request(send);assert.equal(calls[0].url,`/api/clarifications/${caseId}/messages?page=1&pageSize=20`);
  assert.equal(calls[0].options.method,'GET');assert.equal(calls[0].options.body,undefined);
  assert.equal(calls[0].options.headers['x-client-session-context'],context);
  assert.equal(calls[0].options.cache,'no-store');assert.equal(calls[0].options.credentials,'include');assert.equal(calls[0].options.redirect,'error');
  await request(send,{kind:'message',requestId:id,text:'  Synthetic reply  '});
  assert.equal(calls.length,2);assert.equal(calls[1].options.method,'POST');assert.equal(calls[1].options.body,JSON.stringify({requestId:id,text:'Synthetic reply'}));
  let reads=0;await request(async(url,options)=>{reads++;assert.equal(options.method,'GET');assert.equal(url,`/api/clarifications/${caseId}/messages/${id}`);return Response.json(receipt());},{kind:'message',requestId:id});assert.equal(reads,1);
  await requestConversation(async(url,options)=>{assert.equal(url,`/api/clarifications/${caseId}/followups/${id}`);assert.equal(options.method,'GET');return Response.json(generated());},session(),caseId,false,{kind:'followup',requestId:id},new AbortController().signal,()=>true);
});

test('conversation rejects forged operations and expired identities before any transport',async()=>{
  let calls=0;const send=async()=>{calls++;return Response.json(page());};
  for(const op of [{kind:'page',page:0},{kind:'page',page:5001},{kind:'page',page:1,site:'foreign'}, {kind:'message',requestId:'forged'},
    {kind:'message',requestId:id,text:''},{kind:'message',requestId:id,text:'x'.repeat(1001)}, {kind:'message',requestId:id,text:'ok',extra:true},
    {kind:'followup',requestId:id,text:'forbidden'}])await assert.rejects(request(send,op),error('invalid'));
  for(const s of [{...session(),expiresAt:'2000-01-01T00:00:00.000Z'}, {...session(),expiresAt:'tomorrow'}, {...session(),clientContext:'bad'}]){
    assert.equal(validConversationSession(s),false);await assert.rejects(request(send,undefined,s),error('session'));
  }
  await assert.rejects(request(send,undefined,session(),()=>false),error('session'));assert.equal(calls,0);
  await assert.rejects(request(send,{kind:'message',requestId:id,text:'Synthetic'},session(),()=>true,()=>false),error('blocked'));assert.equal(calls,0);
});

test('late selection, context, expiry, JSON and mutation authority changes cannot commit a response',async()=>{
  let live=true;await assert.rejects(request(async()=>{live=false;return Response.json(page());},undefined,session(),()=>live),error('session'));
  const s=session();await assert.rejects(request(async()=>{s.clientContext='b'.repeat(64);return Response.json(page());},undefined,s),error('session'));
  const exp=session();await assert.rejects(request(async()=>{exp.expiresAt='2000-01-01T00:00:00.000Z';return Response.json(page());},undefined,exp),error('session'));
  live=true;await assert.rejects(request(async()=>({ok:true,status:200,json:async()=>{live=false;return page();}}),undefined,session(),()=>live),error('session'));
  let allowed=true;await assert.rejects(request(async()=>{allowed=false;return Response.json(receipt());},{kind:'message',requestId:id,text:'Synthetic'},session(),()=>true,()=>allowed),error('blocked'));
});

test('conversation failures are typed, redact server diagnostics and never turn failed reads into an empty page',async()=>{
  for(const [status,body,code] of [[401,null,'session'],[403,null,'session'],[409,{error:'Session context changed'},'session'],
    [409,{error:'Conversation is closed'},'closed'],[409,{error:'Conversation request conflict'},'conflict'],
    [503,{error:'Follow-up translation unavailable'},'translation'],[503,{error:'PRIVATE DATABASE DIAGNOSTIC'},'unavailable'],[404,{error:'Receipt unavailable'},'unavailable']]){
    await assert.rejects(request(async()=>Response.json(body,{status})),reason=>error(code)(reason)&&!reason.message.includes('PRIVATE'));
  }
  await assert.rejects(request(async()=>{throw Error('PRIVATE TRANSPORT');}),error('unavailable'));
  await assert.rejects(request(async()=>new Response('PRIVATE NOT JSON')),error('unavailable'));
  await assert.rejects(request(async()=>Response.json({...page(),unexpected:'PRIVATE'})),error('invalid'));
  const controller=new AbortController();controller.abort();
  await assert.rejects(requestConversation(async()=>Response.json(page()),session(),caseId,true,{kind:'page',page:1},controller.signal,()=>true),error('unavailable'));
});

test('unverified or missing command acknowledgement retains the same metadata without plaintext or automatic resend',async()=>{
  const values=new Map(),store={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const s=session(),pending=await retainMessage(store,s,caseId,'Synthetic unsent text');let posts=0;
  await assert.rejects(request(async(url,options)=>{if(options.method==='POST')posts++;return Response.json({...receipt(),id:pending.id,notes:'PRIVATE'});},{kind:'message',requestId:pending.id,text:'Synthetic unsent text'},s),error('invalid'));
  assert.equal(posts,1);assert.deepEqual(readPendingMessage(store,s,caseId),pending);
  await assert.rejects(request(async(url,options)=>{assert.equal(options.method,'GET');return Response.json({error:'Receipt unavailable'},{status:404});},{kind:'message',requestId:pending.id},s),error('unavailable'));
  assert.equal(posts,1);assert.deepEqual(readPendingMessage(store,s,caseId),pending);assert.equal(JSON.stringify([...values]).includes('Synthetic unsent text'),false);
});
