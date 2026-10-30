import test from 'node:test';
import assert from 'node:assert/strict';
import {generateWorkerPassword} from '../src/worker-password.ts';
import {requiredWorkerCreation} from '../server/people.mjs';
test('worker creation requires an ID and valid password; generated passwords are independent',()=>{
  assert.throws(()=>requiredWorkerCreation({code:'W01'}),/Invalid password/);
  assert.throws(()=>requiredWorkerCreation({code:'W01',password:'short'}),/Invalid password/);
  assert.throws(()=>requiredWorkerCreation({password:'A valid long password'}));
  const passwords=Array.from({length:100},generateWorkerPassword);
  assert.equal(new Set(passwords).size,100);
  for(const password of passwords){assert.equal(password.length,18);requiredWorkerCreation({code:'W01',password});}
});
