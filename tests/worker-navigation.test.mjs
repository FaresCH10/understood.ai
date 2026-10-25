import test from 'node:test';
import assert from 'node:assert/strict';
import {workerInboxPath,workerNavigationText} from '../src/worker-navigation.ts';
import {workerNavigationDecision} from '../src/worker-unsent.ts';
import {assertWorkerDictionary} from './helpers/worker-locales.mjs';

test('Help selects only current own-assignment API, independent of another inbox filter',()=>{
  for(const tab of ['todo','completed','history','followup']){
    assert.equal(workerInboxPath('help',tab,1),'/worker/briefings?view=all&page=1&pageSize=5');
    assert.equal(workerInboxPath('help',tab,2),'/worker/briefings?view=all&page=2&pageSize=5');
  }
  assert.equal(workerInboxPath('inbox','todo',1),'/worker/briefings?view=todo&page=1&pageSize=5');
  assert.equal(workerInboxPath('inbox','completed',2),'/worker/briefings?view=sent&page=2&pageSize=5');
  assert.equal(workerInboxPath('inbox','followup',1),'/worker/briefings?view=followup&page=1&pageSize=5');
  assert.equal(workerInboxPath('inbox','history',1),'/worker/history?view=all&page=1&pageSize=5');
  for(const view of ['device','worker/one','worker/two'])assert.equal(workerInboxPath(view,'todo',1),null);
  for(const page of [0,-1,1.5,5001,NaN])assert.throws(()=>workerInboxPath('help','todo',page));
});
test('all worker navigation labels and read failures are localized, with unsent/busy navigation protected',()=>{
  assertWorkerDictionary(workerNavigationText,'workerNavigationText');
  for(const target of ['inbox','help','device']){
    assert.equal(workerNavigationDecision('worker/one',target,true,false),'confirm');
    assert.equal(workerNavigationDecision('worker/one',target,true,true),'hold');
    assert.equal(workerNavigationDecision('worker/one',target,false,false),'allow');
  }
});
