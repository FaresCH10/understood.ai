import test from 'node:test';
import assert from 'node:assert/strict';
import {recorderHasUnsent,workerLeaveRequired,workerLeaveText,workerNavigationDecision,retainWorkerDetail,workerRefreshText,workerInputAvailability} from '../src/worker-unsent.ts';
import {assertWorkerDictionary} from './helpers/worker-locales.mjs';

test('worker answer, help and conversation drafts block competing writers, never their own continuation',()=>{
  const empty={answer:' \n',help:' ',audio:false,helpVoice:false,conversation:false};
  assert.deepEqual(workerInputAvailability(empty),{answerBlocked:false,helpBlocked:false,conversationBlocked:false});
  for(const patch of [{answer:'Original draft'},{audio:true}])assert.deepEqual(workerInputAvailability({...empty,...patch}),{answerBlocked:false,helpBlocked:true,conversationBlocked:true});
  for(const patch of [{help:'Original help'},{helpVoice:true}])assert.deepEqual(workerInputAvailability({...empty,...patch}),{answerBlocked:true,helpBlocked:false,conversationBlocked:true});
  assert.deepEqual(workerInputAvailability({...empty,conversation:true}),{answerBlocked:true,helpBlocked:true,conversationBlocked:false});
  assert.deepEqual(workerInputAvailability({...empty,audio:true,helpVoice:true,conversation:true}),{answerBlocked:true,helpBlocked:true,conversationBlocked:true});
});

test('worker leave warnings distinguish retained typed text from discarded recording and sent work',()=>{
  for(const phase of ['requesting','recording','preview','uploading'])assert.equal(recorderHasUnsent(phase),true);
  for(const phase of ['idle','received','unknown'])assert.equal(recorderHasUnsent(phase),false);
  const blank={answer:'  ',help:'\n',audio:false};
  for(const action of ['back','logout','type'])assert.equal(workerLeaveRequired(action,blank),false);
  for(const action of ['back','logout'])for(const work of [{...blank,answer:'unsent'},{...blank,help:'unsent'},{...blank,audio:true}])assert.equal(workerLeaveRequired(action,work),true);
  assert.equal(workerLeaveRequired('type',{...blank,answer:'retained',help:'retained'}),false);
  assert.equal(workerLeaveRequired('type',{...blank,audio:true}),true);
  assertWorkerDictionary(workerLeaveText,'workerLeaveText');
});
test('only same-assignment unsent work survives transient detail refresh failures, never access denials',()=>{
  for(const status of [0,500,502,503,504,599])assert.equal(retainWorkerDetail('one','one',true,status),true);
  for(const status of [null,200,400,401,403,404,409,429,600])assert.equal(retainWorkerDetail('one','one',true,status),false);
  for(const [current,loaded,unsent] of [[null,'one',true],['two','one',true],['one',null,true],['one','one',false]])assert.equal(retainWorkerDetail(current,loaded,unsent,503),false);
  assertWorkerDictionary(workerRefreshText,'workerRefreshText');
});
test('worker route changes hold busy submissions and require confirmation only for actual unsent navigation',()=>{
  for(const unsent of [false,true])for(const busy of [false,true]) {
    assert.equal(workerNavigationDecision('worker/id','worker/id',unsent,busy),'allow');
    assert.equal(workerNavigationDecision('worker/id','inbox',unsent,busy),busy ? 'hold' : unsent ? 'confirm' : 'allow');
  }
  for(const target of ['overview','worker/other','worker-access/token',''])assert.equal(workerNavigationDecision('worker/id',target,true,false),'confirm');
});
