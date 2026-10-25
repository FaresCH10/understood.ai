import test from 'node:test';
import assert from 'node:assert/strict';
import {allowPrivateDevice,enableSharedDevice,privateDeviceAllowed,sharedDeviceText} from '../src/worker-device-policy.ts';
import {saveTextDraft} from '../src/worker-text-draft.ts';
import {assertWorkerDictionary} from './helpers/worker-locales.mjs';

const time=Date.parse('2026-10-10T12:00:00.000Z');
const session={authenticated:true,role:'worker',workerId:'fixture-worker',language:'en',mode:'synthetic-demo',clientContext:'a'.repeat(64),expiresAt:new Date(time+60000).toISOString()};
function storage(){const values=new Map();return {values,getItem:key=>values.get(key) ?? null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};}
test('shared mode is the default; private choice binds exact tab, session, expiry and device barrier',()=>{
  const tab=storage(),device=storage();assert.equal(privateDeviceAllowed(session.clientContext,tab,device,time),false);
  allowPrivateDevice(session,tab,device,time);assert.equal(privateDeviceAllowed(session.clientContext,tab,device,time),true);
  assert.equal(privateDeviceAllowed('b'.repeat(64),tab,device,time),false);
  assert.equal(privateDeviceAllowed(session.clientContext,storage(),device,time),false);
  assert.equal(privateDeviceAllowed(session.clientContext,tab,device,time+60000),false);
  assert.throws(()=>allowPrivateDevice({...session,authenticated:false},tab,device,time));
  device.setItem('understood:device-barrier:v1',crypto.randomUUID());assert.equal(privateDeviceAllowed(session.clientContext,tab,device,time),false);
  assert.deepEqual([...device.values.keys()],['understood:device-barrier:v1']);
  assert.equal([...device.values.values()].join('').includes(session.clientContext),false);
});
test('shared transition revokes all old tab choices before purge starts and attempts cleanup even on storage failure',async()=>{
  const device=storage(),tab=storage(),other=storage();allowPrivateDevice(session,tab,device,time);allowPrivateDevice(session,other,device,time);
  let cleared=0;assert.equal(await enableSharedDevice(tab,device,async()=>{cleared++;assert.equal(privateDeviceAllowed(session.clientContext,tab,device,time),false);assert.equal(privateDeviceAllowed(session.clientContext,other,device,time),false);return true;}),true);
  assert.equal(cleared,1);allowPrivateDevice(session,other,device,time);assert.equal(privateDeviceAllowed(session.clientContext,other,device,time),true);
  assert.equal(await enableSharedDevice(tab,device,async()=>false),false);
  assert.equal(await enableSharedDevice({...tab,removeItem:()=>{throw Error();}},device,async()=>{cleared++;return true;}),false);
  assert.equal(await enableSharedDevice(tab,{...device,setItem:()=>{throw Error();}},async()=>{cleared++;return true;}),false);
  assert.equal(cleared,3);assert.equal(await enableSharedDevice(tab,device,async()=>{throw Error();}),false);
});
test('unavailable, malformed and unverified storage fails closed',()=>{
  const tab=storage(),device=storage();
  for(const value of ['null','{}','[]','broken','x'.repeat(401)]){tab.setItem('understood:private-device:v1',value);assert.equal(privateDeviceAllowed(session.clientContext,tab,device,time),false);}
  assert.equal(privateDeviceAllowed(session.clientContext,{...tab,getItem:()=>{throw Error();}},device,time),false);
  assert.throws(()=>allowPrivateDevice(session,{...tab,setItem:()=>{}},device,time));
  device.setItem('understood:device-barrier:v1','bad');assert.throws(()=>allowPrivateDevice(session,tab,device,time));
  assertWorkerDictionary(sharedDeviceText,'sharedDeviceText');
});
test('actual browser text-save boundary rejects shared mode and stale private choice without changing the draft',async()=>{
  const tab=storage(),device=storage(),originalTab=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage'),originalDevice=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'sessionStorage',{value:tab,configurable:true});Object.defineProperty(globalThis,'localStorage',{value:device,configurable:true});
  const liveSession={...session,expiresAt:new Date(Date.now()+60000).toISOString()},scope={assignmentId:'assignment',publicationId:'publication',version:3},draft={answer:'Synthetic answer',help:'',receipts:[]};
  try{
    assert.throws(()=>saveTextDraft(tab,liveSession,scope,draft,true));allowPrivateDevice(liveSession);saveTextDraft(tab,liveSession,scope,draft,true);
    const before=tab.getItem('understood:worker-text-draft:v1');
    await enableSharedDevice(tab,device,async()=>false);assert.throws(()=>saveTextDraft(tab,liveSession,scope,{...draft,answer:'Changed'},true));assert.equal(tab.getItem('understood:worker-text-draft:v1'),before);
  }finally {if(originalTab)Object.defineProperty(globalThis,'sessionStorage',originalTab);else delete globalThis.sessionStorage;if(originalDevice)Object.defineProperty(globalThis,'localStorage',originalDevice);else delete globalThis.localStorage;}
});
