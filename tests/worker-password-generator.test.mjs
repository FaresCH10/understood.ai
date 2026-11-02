import test from 'node:test';
import assert from 'node:assert/strict';
import {generateWorkerPassword} from '../src/worker-password.ts';
import {requiredWorkerCreation} from '../server/people.mjs';
test('worker creation requires a valid password and name; IDs are always generated; generated passwords are independent',()=>{
  assert.throws(()=>requiredWorkerCreation({code:'W01',name:'Synthetic Worker'}),/Invalid password/);
  assert.throws(()=>requiredWorkerCreation({code:'W01',name:'Synthetic Worker',password:'short'}),/Invalid password/);
  assert.throws(()=>requiredWorkerCreation({password:'A valid long password'}),/Worker name is required/);
  assert.throws(()=>requiredWorkerCreation({name:'   ',password:'A valid long password'}),/Invalid worker name/);
  assert.equal(requiredWorkerCreation({code:'CUSTOM-9',name:'Synthetic Worker',password:'A valid long password'}).code,null);
  const passwords=Array.from({length:100},generateWorkerPassword);
  assert.equal(new Set(passwords).size,100);
  for(const password of passwords){assert.equal(password.length,18);requiredWorkerCreation({code:'W01',name:'Synthetic Worker',password});}
});
