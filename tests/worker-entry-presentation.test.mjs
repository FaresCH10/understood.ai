import test from 'node:test';
import assert from 'node:assert/strict';
import {workerEntryIdentity,workerEntryLanguages,workerEntryText} from '../src/worker-entry-presentation.ts';
import {WORKER_LANGUAGE_CODES} from '../server/languages.mjs';

const now=Date.parse('2026-10-16T06:00:00.000Z'),worker={authenticated:true,role:'worker',clientContext:'a'.repeat(64),workerId:'worker-014',language:'en',mode:'synthetic-credential',expiresAt:'2026-10-16T07:00:00.000Z',name:'Worker 014',organization:'Synthetic Entry QA',site:'Beirut QA'};
test('entry choices and complete localized copy cover every worker locale without deriving identity from a link',()=>{
  assert.deepEqual(workerEntryLanguages.map(item=>item.value).sort(),[...WORKER_LANGUAGE_CODES].sort());
  const keys=Object.keys(workerEntryText.en).sort();
  for(const language of WORKER_LANGUAGE_CODES){
    assert.deepEqual(Object.keys(workerEntryText[language]).sort(),keys);
    for(const value of Object.values(workerEntryText[language]))assert.ok(value.trim().length);
    assert.deepEqual(workerEntryIdentity(worker,language,now),{name:worker.name,organization:worker.organization,site:worker.site});
  }
  assert.equal(workerEntryIdentity(undefined,'en',now),null);
  for(const invalid of [{...worker,authenticated:false},{...worker,expiresAt:new Date(now).toISOString()},{...worker,clientContext:'forged'},{token:'a'.repeat(43),name:'Forged target',authenticated:true}])assert.equal(workerEntryIdentity(invalid,'en',now),null);
});
test('entry shows only validated own-session labels, bounds mixed-direction metadata and never changes session evidence',()=>{
  const before=structuredClone(worker),staff={...worker,role:'staff',staffRole:'owner',staffScope:'["staff","organization","site"]',siteState:'active',name:'Synthetic Owner'};
  assert.equal(workerEntryIdentity(staff,'ar',now).name,'Synthetic Owner');
  for(const name of ['x'.repeat(255),'unsafe\u0000label',''])assert.notEqual(workerEntryIdentity({...worker,name},'ur',now).name,name);
  assert.deepEqual(worker,before);
});
