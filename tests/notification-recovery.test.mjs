import test from 'node:test';
import assert from 'node:assert/strict';
import {notificationKinds} from '../server/notification-input.mjs';
import {checkedNotification,checkedNotificationPage,pendingNotificationSignature,readPendingNotification,savePendingNotification,clearPendingNotification,checkedNotificationResult,checkedNotificationReceipt} from '../src/notification-recovery.ts';
import {completeArtifactMutation,checkedArtifactScope} from '../src/artifact-request.ts';
import {StaffRequestError,retainStaffRequest} from '../src/staff-request.ts';

const item={id:'notice-original',kind:'briefing.prepared',...notificationKinds['briefing.prepared'],subject:null,occurredAt:'2026-10-14T00:00:00.000Z',readAt:null};
const pending={requestId:item.id,body:{},item},accepted={...item,readAt:'2026-10-14T00:01:00.000Z'};
const store=()=>{const rows=new Map();return {getItem:key=>rows.get(key)??null,setItem:(key,value)=>rows.set(key,value),removeItem:key=>rows.delete(key)};};

test('notification recovery retains only exact original event metadata in the original actor/site tab scope',()=>{
  const storage=store();savePendingNotification(storage,'original',pending);
  assert.deepEqual(readPendingNotification(storage,'original'),pending);assert.equal(readPendingNotification(storage,'other'),null);
  const changed={...pending,item:{...item,occurredAt:'2026-10-13T00:00:00.000Z'}};
  assert.throws(()=>savePendingNotification(storage,'original',changed),/Recover/);
  assert.throws(()=>clearPendingNotification(storage,'original',item.id,changed),/changed/);
  assert.throws(()=>savePendingNotification(storage,'original',{requestId:'another',body:{},item:{...item,id:'another'}}),/Recover/);
  for(const value of ['', '{}',JSON.stringify({...pending,extra:true}),JSON.stringify({...pending,body:{actorId:'other'}}),JSON.stringify({...pending,item:accepted}),'x'.repeat(2049)]) {
    storage.setItem('understood:notification-read:bad',value);assert.throws(()=>readPendingNotification(storage,'bad'));
  }
  assert.throws(()=>savePendingNotification({getItem:()=>null,setItem(){},removeItem(){}},'scope',pending),/No request was sent/);
  const unavailable={getItem:()=>JSON.stringify(pending),setItem(){},removeItem(){}};
  assert.throws(()=>clearPendingNotification(unavailable,'scope',item.id,pending),/could not be cleared/);
  clearPendingNotification(storage,'original',item.id,pending);assert.equal(readPendingNotification(storage,'original'),null);
});

test('notification completion verifies immutable personal timestamp before clearing and fences asynchronous identity/hold/storage changes',async()=>{
  const storage=store(),receipt={found:true,item:accepted};let clears=0;
  const complete=()=>{clearPendingNotification(storage,'scope',item.id,pending);clears++;};
  savePendingNotification(storage,'scope',pending);
  await completeArtifactMutation(accepted,pending,checkedNotificationResult,checkedNotificationReceipt,async()=>receipt,complete,()=>true);
  assert.equal(clears,1);assert.equal(readPendingNotification(storage,'scope'),null);
  savePendingNotification(storage,'scope',pending);
  for(const value of [{found:false},{found:false,item:accepted},{found:true,item:{...accepted,id:'other'}},{found:true,item:{...accepted,readAt:null}},{found:true,item:accepted,actor:'other'}]) {
    await assert.rejects(completeArtifactMutation(accepted,pending,checkedNotificationResult,checkedNotificationReceipt,async()=>value,complete,()=>true));assert.equal(clears,1);
  }
  await assert.rejects(completeArtifactMutation(accepted,pending,checkedNotificationResult,checkedNotificationReceipt,async()=>({found:true,item:{...accepted,readAt:'2026-10-14T00:02:00.000Z'}}),complete,()=>true));
  let current=true;await assert.rejects(completeArtifactMutation(accepted,pending,checkedNotificationResult,checkedNotificationReceipt,async()=>{current=false;return receipt;},complete,()=>current));
  let held=false;await assert.rejects(completeArtifactMutation(accepted,pending,checkedNotificationResult,checkedNotificationReceipt,async()=>{held=true;return receipt;},complete,()=>true,()=>!held));
  const changed={requestId:'other',body:{},item:{...item,id:'other'}};
  await assert.rejects(completeArtifactMutation(accepted,pending,checkedNotificationResult,checkedNotificationReceipt,async()=>{storage.setItem('understood:notification-read:scope',JSON.stringify(changed));return receipt;},complete,()=>true));
  assert.deepEqual(readPendingNotification(storage,'scope'),changed);assert.equal(clears,1);
  assert.equal(checkedNotificationReceipt({found:false},pending),null);
  assert.equal(retainStaffRequest(true,true,new StaffRequestError('Later rejection',false,403)),true);
});

test('notification DTOs reject private fields, forged destinations, unknown kinds and inconsistent bounded page evidence',()=>{
  const asOf='2026-10-14T01:00:00.000Z',since=new Date(Date.parse(asOf)-90*86400000).toISOString(),page={items:[item],total:1,unread:1,page:1,pageSize:20,asOf,since};
  assert.deepEqual(checkedNotificationPage(page,1,'all'),page);assert.deepEqual(checkedNotification(accepted),accepted);
  for(const value of [{...item,actorId:'private'},{...item,destination:'https://external.invalid'},{...item,kind:'__proto__'},{...item,label:'Private worker'},{...item,readAt:'bad'},{...accepted,readAt:'2026-10-13T00:00:00.000Z'},{...item,id:'../../other'}])assert.throws(()=>checkedNotification(value));
  for(const value of [{...page,extra:true},{...page,total:-1},{...page,unread:2},{...page,items:[item,item],total:2,unread:2},{...page,page:2},{...page,pageSize:100},{...page,since:'2000-01-01T00:00:00.000Z'},{...page,items:[{...item,occurredAt:'2025-01-01T00:00:00.000Z'}]},{...page,items:Array(21).fill(item),total:21,unread:21}])assert.throws(()=>checkedNotificationPage(value,1,'all'));
  assert.throws(()=>checkedNotificationPage({...page,items:[accepted]},1,'unread'));
  assert.throws(()=>checkedNotificationPage(page,1,'unsupported'));
  assert.throws(()=>pendingNotificationSignature({...pending,requestId:'other'}));
});

test('notification recovery explicitly admits authorized auditor identity without broadening default artifact writers',()=>{
  const scope=JSON.stringify(['cedar','beirut','auditor']),session={authenticated:true,role:'staff',staffRole:'auditor',staffScope:scope,siteState:'active',mode:'credential',clientContext:'a'.repeat(64),expiresAt:new Date(Date.now()+60_000).toISOString()};
  assert.throws(()=>checkedArtifactScope(scope,session));assert.equal(checkedArtifactScope(scope,session,['owner','supervisor','auditor']),scope);
  assert.throws(()=>checkedArtifactScope(JSON.stringify(['cedar','other','auditor']),session,['owner','supervisor','auditor']));
});
