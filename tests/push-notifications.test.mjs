import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {checkedPushStatus,checkedPushSubscriptionId,pushApplicationServerKey,pushCapability,readRememberedPushId} from '../src/push-notifications.ts';

const keyBytes=Buffer.from([4,...Array.from({length:64},(_,index)=>index+1)]);
const publicKey=keyBytes.toString('base64url');
const storageWith=value=>{const values=new Map();if(value!==undefined)values.set('understood:push-registration',value);return {getItem:key=>values.get(key)??null,setItem:(key,item)=>values.set(key,item),removeItem:key=>values.delete(key)};};

test('push application server keys must decode to one uncompressed 65-byte P-256 point',()=>{
  const decoded=pushApplicationServerKey(publicKey);
  assert.equal(decoded.length,65);assert.equal(decoded[0],4);
  assert.deepEqual(Array.from(decoded),Array.from(keyBytes));
  for(const value of ['',publicKey.slice(0,4),Buffer.from(keyBytes.subarray(0,64)).toString('base64url'),
    Buffer.concat([Buffer.from([3]),keyBytes.subarray(1)]).toString('base64url'),'not+base64url!', 'A'.repeat(201),null,42]){
    assert.throws(()=>pushApplicationServerKey(value),/configured correctly/);
  }
});

test('push status accepts only bounded registrations and immutable adapter fields',()=>{
  const id=randomUUID(),now='2026-10-24T10:00:00.000Z';
  assert.deepEqual(checkedPushStatus({adapter:'webpush',configured:true,publicKey:'synthetic-key',subscriptions:[{id,createdAt:now,updatedAt:now,lastSeenAt:now,extra:'ignored'}]}),
    {adapter:'webpush',configured:true,publicKey:'synthetic-key',subscriptions:[{id,createdAt:now,updatedAt:now,lastSeenAt:now}]});
  assert.deepEqual(checkedPushStatus({adapter:'disabled',configured:false,publicKey:null,subscriptions:[]}),
    {adapter:'disabled',configured:false,publicKey:null,subscriptions:[]});
  const registration={id,createdAt:now,updatedAt:now,lastSeenAt:now};
  for(const value of [null,[],{adapter:'other',configured:false,publicKey:null,subscriptions:[]},
    {adapter:'disabled',configured:false,publicKey:'key',subscriptions:[]},
    {adapter:'webpush',configured:'yes',publicKey:null,subscriptions:[]},
    {adapter:'webpush',configured:true,publicKey:null,subscriptions:[]},
    {adapter:'webpush',configured:true,publicKey:null,subscriptions:Array.from({length:11},()=>({...registration,id:randomUUID()}))},
    {adapter:'webpush',configured:true,publicKey:null,subscriptions:[{...registration,id:'../foreign'}]},
    {adapter:'webpush',configured:true,publicKey:null,subscriptions:[{...registration,createdAt:'not a date'}]},
  ])assert.throws(()=>checkedPushStatus(value),/configured correctly/);
  assert.equal(checkedPushSubscriptionId({id}),id);
  for(const value of [null,{}, {id:'not-a-uuid'},{id:`${id} `}])assert.throws(()=>checkedPushSubscriptionId(value),/configured correctly/);
});

test('browser push capability requires every platform feature',()=>{
  assert.equal(pushCapability({serviceWorker:true,pushManager:true,notification:true,secure:true}),'supported');
  for(const field of ['serviceWorker','pushManager','notification','secure'])
    assert.equal(pushCapability({serviceWorker:true,pushManager:true,notification:true,secure:true,[field]:false}),'unsupported');
});

test('remembered push ids are scoped to the exact captured session context',()=>{
  const context='a'.repeat(64),id=randomUUID();
  assert.equal(readRememberedPushId(storageWith(JSON.stringify({context,id})),context),id);
  assert.equal(readRememberedPushId(storageWith(JSON.stringify({id,context})),context),id);
  assert.equal(readRememberedPushId(storageWith(JSON.stringify({context,id})),'b'.repeat(64)),null);
  assert.equal(readRememberedPushId(storageWith(JSON.stringify({context,id,extra:true})),context),null);
  assert.equal(readRememberedPushId(storageWith(JSON.stringify({context,id})) ,'invalid'),null);
  for(const raw of ['not json',JSON.stringify({context,id:'foreign'}),'x'.repeat(201),JSON.stringify({context})])
    assert.equal(readRememberedPushId(storageWith(raw),context),null);
  assert.equal(readRememberedPushId(storageWith(),context),null);
});
