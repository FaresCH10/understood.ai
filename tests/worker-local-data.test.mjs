import test from 'node:test';
import assert from 'node:assert/strict';
import {clearWorkerLocalData,localCleanupText} from '../src/worker-local-data.ts';
import {assertWorkerDictionary} from './helpers/worker-locales.mjs';

test('local cleanup attempts tab, audio and briefing stores independently and reports failures',async()=>{
  const removed=[];let audio=0,briefings=0;const cache=async()=>{briefings++;};
  const storage=Object.assign({removeItem:key=>removed.push(key)},{'understood:text':'draft','unrelated':'keep','understood:pending':'receipt'});
  assert.equal(await clearWorkerLocalData('old-context',storage,async()=>{audio++;},cache),true);
  assert.deepEqual(removed,['understood:text','understood:pending']);assert.equal(audio,1);
  assert.equal(await clearWorkerLocalData('old-context',{removeItem:()=>{throw Error();},'understood:text':'draft'},async()=>{audio++;},cache),false);
  assert.equal(audio,2);
  assert.equal(await clearWorkerLocalData('old-context',storage,async()=>{throw Error();},cache),false);
  assert.equal(await clearWorkerLocalData('old-context',new Proxy({}, {ownKeys:()=>{throw Error();}}),async()=>{audio++;},cache),false);
  assert.equal(audio,3);
  assert.equal(briefings,4);
  assert.equal(await clearWorkerLocalData('old-context',storage,async()=>{audio++;},async()=>{throw Error();}),false);
  assert.equal(audio,4);
  assertWorkerDictionary(localCleanupText,'localCleanupText');
});
