import test from 'node:test';
import assert from 'node:assert/strict';
import {PageLoadState,pageLoads,installPageLoadTracking,loadingRoute,tracksPageRequest} from '../src/page-load-state.ts';
test('only navigation data requests count; mutations, notifications and other origins do not',()=>{
  const origin='https://understood.example';
  for(const path of ['/api/session','/api/overview','/api/people/workers','/api/worker/briefings?page=1'])assert.equal(tracksPageRequest(path,'GET',origin),true);
  for(const path of ['/api/notifications','/api/worker/notifications','/api/health','/api/realtime','https://other.example/api/overview','/shell-worker.js'])assert.equal(tracksPageRequest(path,'GET',origin),false);
  assert.equal(tracksPageRequest('/api/send','POST',origin),false);
});
test('completed or aborted tasks release once; old-page completions do not release new-page work',()=>{
  const state=new PageLoadState();const old=state.begin();assert.equal(state.size,1);
  state.start();const current=state.begin();old();assert.equal(state.size,1);
  current();current();assert.equal(state.size,0);
  state.finish();state.begin();assert.equal(state.size,0);
  state.start();const next=state.begin();assert.equal(state.size,1);next();assert.equal(state.size,0);
});
test('landing section anchors share one loading cycle, while other pages are distinct',()=>{
  assert.equal(loadingRoute('#home'),loadingRoute('#plans'));
  assert.equal(loadingRoute('#platform/worker'),'landing');
  assert.notEqual(loadingRoute('#home'),loadingRoute('#contact'));
  assert.notEqual(loadingRoute('#briefings/one'),loadingRoute('#briefings/two'));
});
test('streaming response bodies keep loading active after headers, including read failures',async()=>{
  const previousWindow=globalThis.window,previousLocation=globalThis.location;
  let controller;
  globalThis.window={fetch:async()=>new Response(new ReadableStream({start(value){controller=value;}}),{headers:{'content-type':'application/json'}})};
  globalThis.location={origin:'https://understood.example'};
  try{
    installPageLoadTracking();pageLoads.start();
    const response=await window.fetch('/api/overview');assert.equal(pageLoads.size,0);
    const body=response.json();assert.equal(pageLoads.size,1);
    controller.enqueue(new TextEncoder().encode('{"ready":true}'));controller.close();
    assert.deepEqual(await body,{ready:true});assert.equal(pageLoads.size,0);
    const failed=await window.fetch('/api/overview');const failure=failed.json();
    assert.equal(pageLoads.size,1);controller.error(new Error('connection lost'));
    await assert.rejects(failure,/connection lost/);assert.equal(pageLoads.size,0);
  }finally{pageLoads.finish();globalThis.window=previousWindow;globalThis.location=previousLocation;}
});
