import test from 'node:test';
import assert from 'node:assert/strict';
import { workerResponseState } from '../src/worker-state.ts';

test('expired content closes fresh controls without changing publication or answer evidence',()=>{
  const item={state:'published',contentExpired:true,outcome:'clarification',repeatRequest:{id:'repeat',caseId:'case',dueAt:'2099-01-01T00:00:00.000Z'}};
  const before=structuredClone(item),result=workerResponseState(item);
  assert.equal(result.closed,true);assert.equal(result.canRespond,false);assert.equal(result.canHelp,false);
  assert.deepEqual(item,before);
});
test('authorized repeat reopens response controls without changing the recorded original outcome',()=>{
  const item={state:'published',dueAt:'2000-01-01T00:00:00.000Z',outcome:'clarification',repeatRequest:{id:'repeat',caseId:'case',dueAt:'2099-01-01T00:00:00.000Z'}};
  assert.deepEqual(workerResponseState(item),{received:false,pending:false,closed:false,canRespond:true,canHelp:true});
  assert.equal(item.outcome,'clarification');assert.equal(workerResponseState({...item,state:'withdrawn'}).canRespond,false);
  assert.equal(workerResponseState({...item,repeatRequest:{...item.repeatRequest,dueAt:'2000-01-02T00:00:00.000Z'}}).canRespond,false);
});

test('worker receipt state separates pending, failed capture and completed assessments', () => {
  const base={state:'published',dueAt:null};
  assert.deepEqual(workerResponseState(base),{received:false,pending:false,closed:false,canRespond:true,canHelp:true});
  const typed=workerResponseState({...base,assessmentStatus:'pending'});
  assert.equal(typed.received,true); assert.equal(typed.pending,true); assert.equal(typed.canRespond,false);
  for (const audioStatus of ['received','processing','transcribed']) {
    const result=workerResponseState({...base,audioStatus,assessmentStatus:'pending'});
    assert.equal(result.received,true); assert.equal(result.pending,true); assert.equal(result.canRespond,false);
  }
  const failed=workerResponseState({...base,audioStatus:'failed',assessmentStatus:'pending'});
  assert.equal(failed.received,true); assert.equal(failed.pending,false); assert.equal(failed.canRespond,true);
  for (const outcome of ['matched','clarification','unassessable']) {
    const result=workerResponseState({...base,outcome,assessmentStatus:'complete'});
    assert.equal(result.received,true); assert.equal(result.pending,false); assert.equal(result.canRespond,false);
  }
});

test('withdrawn or superseded assignment closes answers and help', () => {
  for (const item of [{state:'superseded'},{state:'withdrawn'}]) {
    const result=workerResponseState({...item,assessmentStatus:'pending'},Date.parse('2026-10-04T11:00:00Z'));
    assert.equal(result.closed,true); assert.equal(result.received,true); assert.equal(result.canRespond,false); assert.equal(result.canHelp,false);
  }
});

test('answer deadline closes answers without hiding independent help',()=>{
  const result=workerResponseState({state:'published',dueAt:'2026-10-04T11:00:00Z',assessmentStatus:'pending'},Date.parse('2026-10-04T11:00:00Z'));
  assert.equal(result.closed,true);assert.equal(result.received,true);assert.equal(result.canRespond,false);assert.equal(result.canHelp,true);
});

test('acknowledge-only instructions close response controls once receipt is recorded',()=>{
  const base={state:'published',dueAt:null,responseMode:'acknowledge',deliveryMode:'text'};
  assert.deepEqual(workerResponseState(base),{received:false,pending:false,closed:false,canRespond:true,canHelp:true});
  const acknowledged=workerResponseState({...base,assessmentStatus:'complete',acknowledgedAt:'2026-10-23T08:00:00.000Z'});
  assert.equal(acknowledged.received,true);assert.equal(acknowledged.pending,false);assert.equal(acknowledged.canRespond,false);
  const expired=workerResponseState({...base,acknowledgedAt:'2026-10-23T08:00:00.000Z',contentExpired:true});
  assert.equal(expired.received,true);assert.equal(expired.canRespond,false);assert.equal(expired.canHelp,false);
});

test('unavailable recording processing permits a typed replacement while preserving its receipt',()=>{
  const state=workerResponseState({state:'published',audioStatus:'blocked'});
  assert.equal(state.received,true);assert.equal(state.pending,false);assert.equal(state.canRespond,true);
});
