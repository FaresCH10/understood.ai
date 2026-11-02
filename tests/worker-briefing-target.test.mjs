import test from 'node:test';
import assert from 'node:assert/strict';
import {workerBriefingTargetFromHash,saveWorkerBriefingTarget,readWorkerBriefingTarget,clearWorkerBriefingTarget,validWorkerBriefingTarget} from '../src/worker-briefing-target.ts';
import {workplaceQrUrl} from '../src/workplace-qr.ts';

function memoryStorage(){
  const values=new Map();
  return {getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key),values};
}

test('workplace QR references a briefing, never a credential or worker identity',()=>{
  assert.equal(workplaceQrUrl('http://127.0.0.1:3020','/','shelf'),'http://127.0.0.1:3020/#worker-access/briefing/shelf');
  assert.equal(workplaceQrUrl('https://app.example.test/','/understood/','a b/c?'),'https://app.example.test/understood/#worker-access/briefing/a%20b%2Fc%3F');
  const url=workplaceQrUrl('https://app.example.test','/','0b7c1a5e-67e8-4a95-a4ea-b25ea59f674e');
  assert.match(url,/#worker-access\/briefing\//);
  assert.doesNotMatch(url,/[?&](?:token|session|password|cookie|grant|workerId|worker_id)=|workerId|worker_id/i);
  assert.throws(()=>workplaceQrUrl('https://app.example.test','/',''),/Invalid briefing reference/);
  assert.throws(()=>workplaceQrUrl('https://app.example.test','/','x'.repeat(101)),/Invalid briefing reference/);
});

test('only the exact worker-access briefing route is accepted',()=>{
  assert.equal(workerBriefingTargetFromHash('#worker-access/briefing/shelf'),'shelf');
  assert.equal(workerBriefingTargetFromHash('#worker-access/briefing/a%20b%2Fc%3F'),'a b/c?');
  for(const hash of ['#worker-access','#worker-access/briefing/','#worker-access/briefing/a/b','#worker-access/briefing/a?x=1','#worker-access/briefing/%E0%A4%A','#inbox','#worker-access/shelf']){
    assert.equal(workerBriefingTargetFromHash(hash),null,hash);
  }
  assert.equal(validWorkerBriefingTarget('shelf'),true);
  assert.equal(validWorkerBriefingTarget('bad\u0000id'),false);
  assert.equal(validWorkerBriefingTarget(42),false);
});

test('a scanned briefing target expires and can be cleared without storing private data',()=>{
  const storage=memoryStorage(),now=1700000000000;
  assert.equal(saveWorkerBriefingTarget(storage,'shelf',now),true);
  assert.equal(readWorkerBriefingTarget(storage,now+29*60*1000),'shelf');
  assert.equal(readWorkerBriefingTarget(storage,now+31*60*1000),null);
  assert.equal(storage.getItem('understood:worker-briefing-target'),null);
  saveWorkerBriefingTarget(storage,'ladder',now);
  clearWorkerBriefingTarget(storage);
  assert.equal(readWorkerBriefingTarget(storage,now),null);
  const corrupt=memoryStorage();corrupt.setItem('understood:worker-briefing-target','{"id":"shelf","createdAt":"soon"}');
  assert.equal(readWorkerBriefingTarget(corrupt,now),null);
  assert.equal(readWorkerBriefingTarget(corrupt,now),null);
});
