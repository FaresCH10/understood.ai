import test from 'node:test';
import assert from 'node:assert/strict';
import {clientSessionContext,verifyClientSession} from '../server/session-context.mjs';
import {validWorkerSession,sameWorkerSession,workerSessionText,sessionLoadText} from '../src/session-state.ts';
import {assertWorkerDictionary} from './helpers/worker-locales.mjs';

const serverSession={token_hash:'a'.repeat(64),org_id:'org',site_id:'site',principal_type:'worker',principal_id:'worker',access_mode:'demo',language:'en',expires_at:'2027-01-01T00:00:00.000Z'};
test('page context is non-credential, stable and changes on cookie, identity, site or language rotation',()=>{
  const context=clientSessionContext(serverSession);
  assert.deepEqual(Object.keys(context),['clientContext','expiresAt']);assert.notEqual(context.clientContext,serverSession.token_hash);
  assert.deepEqual(clientSessionContext({...serverSession}),context);
  for(const change of [{token_hash:'b'.repeat(64)},{site_id:'other'},{principal_id:'other'},{language:'ar'},{access_mode:'credential'}])
    assert.notEqual(clientSessionContext({...serverSession,...change}).clientContext,context.clientContext);
  assert.throws(()=>clientSessionContext({...serverSession,token_hash:''}),/Sign in required/);
  const request=(value,method='POST')=>({method,headers:value===undefined ? {} : {'x-client-session-context':value}});
  for(const path of ['/api/worker/briefings/id/answers','/api/worker/briefings/id/help','/api/worker/briefings/id/audio','/api/worker/briefings/id/help-audio/id','/api/clarifications/id/voice/id','/api/logout']) {
    for(const value of [undefined,'','z'.repeat(64),'b'.repeat(64),[context.clientContext]])
      assert.throws(()=>verifyClientSession(request(value),serverSession,path),/Session context changed/);
    assert.doesNotThrow(()=>verifyClientSession(request(context.clientContext),serverSession,path));
  }
  assert.doesNotThrow(()=>verifyClientSession(request(undefined,'GET'),serverSession,'/api/worker/briefings'));
  assert.throws(()=>verifyClientSession(request('b'.repeat(64),'GET'),serverSession,'/api/worker/briefings'),/Session context changed/);
  const staff={...serverSession,principal_type:'staff',role:'owner'};
  assert.doesNotThrow(()=>verifyClientSession(request(undefined),staff,'/api/logout'));
  assert.throws(()=>verifyClientSession(request(context.clientContext),staff,'/api/logout'),/Session context changed/);
});
test('worker verification fails closed for expiry, changed identity, malformed response and supported-language changes',()=>{
  const now=Date.parse('2026-10-07T00:00:00Z');
  const session={authenticated:true,role:'worker',workerId:'worker',mode:'synthetic-credential',language:'en',...clientSessionContext(serverSession)};
  assert.equal(validWorkerSession(session,now),true);assert.equal(sameWorkerSession(session,{...session},now),true);
  for(const change of [{authenticated:false},{role:'staff'},{workerId:'other'},{workerId:' '},{language:'ar'},{language:'xyz'},{mode:'other'},{mode:undefined},{mode:42},{clientContext:'b'.repeat(64)},{expiresAt:'bad'},{expiresAt:'2027-01-01'},{expiresAt:new Date(now).toISOString()}])
    assert.equal(sameWorkerSession(session,{...session,...change},now),false);
  for(const value of [null,[],{},'not a session'])assert.equal(sameWorkerSession(session,value,now),false);
  for(const [name,labels] of [['workerSessionText',workerSessionText],['sessionLoadText',sessionLoadText]])assertWorkerDictionary(labels,name);
});
