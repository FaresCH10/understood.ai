import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readActivationRequest,storeActivationRequest,clearActivationRequest,checkedActivationResult,checkedActivationReceipt} from '../src/activation-request-recovery.ts';
import {completeArtifactMutation,checkedArtifactScope} from '../src/artifact-request.ts';
const fixture=()=>{const values=new Map();return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};};
const pending=()=>({clientContext:'a'.repeat(64),expiresAt:new Date(Date.now()+3600000).toISOString(),requestId:randomUUID(),body:{note:'Please activate this workspace.',confirmed:true}});
const record=(value,state='pending')=>({requestId:value.requestId,request:value.body,createdAt:new Date().toISOString(),state,decidedAt:state==='pending'?null:new Date().toISOString(),decisionRef:state==='pending'?null:randomUUID(),delivery:'platform_operations',changesApplied:false});
test('activation recovery is exact, expiring and session scoped; failed storage never sends',()=>{
  const store=fixture(),value=pending();storeActivationRequest(store,value);assert.deepEqual(readActivationRequest(store,value),value);assert.equal(readActivationRequest(store,{...value,clientContext:'b'.repeat(64)}),null);
  const multiline={...value,body:{note:'Line one\nLine two',confirmed:true}};clearActivationRequest(store,value);storeActivationRequest(store,multiline);assert.deepEqual(readActivationRequest(store,multiline),multiline);
  assert.throws(()=>storeActivationRequest(store,{...multiline,requestId:randomUUID()}),/Resolve/);assert.throws(()=>readActivationRequest(store,{...value,expiresAt:new Date(0).toISOString()}),/cannot be verified/);
  assert.throws(()=>clearActivationRequest(store,{...multiline,requestId:randomUUID()}),/changed/);clearActivationRequest(store,multiline);assert.equal(readActivationRequest(store,multiline),null);
  assert.throws(()=>storeActivationRequest({...store,setItem(){}},value),/No request was sent/);
  assert.throws(()=>storeActivationRequest(store,{...value,body:{note:' padded ',confirmed:true}}),/Invalid activation request/);
  store.values.set(`understood:activation-request:${value.clientContext}`,'not-json');assert.throws(()=>readActivationRequest(store,value),/cannot be verified/);
});
test('activation receipts match the original note and allow only pending, accepted or declined shapes',()=>{
  const value=pending(),base=record(value),accepted=record(value,'accepted'),declined=record(value,'declined');
  assert.equal(checkedActivationReceipt({found:false},value),null);
  assert.deepEqual(checkedActivationReceipt({...base,found:true},value),base);
  assert.deepEqual(checkedActivationReceipt({...accepted,found:true},value),accepted);
  assert.deepEqual(checkedActivationReceipt({...declined,found:true},value),declined);
  assert.deepEqual(checkedActivationResult({...base,duplicate:false},value),base);
  assert.deepEqual(checkedActivationResult({...accepted,duplicate:true},value),accepted);
  for(const mutation of [{requestId:randomUUID()},{request:{...value.body,note:'Other'}},{state:'unknown'},{state:'pending',decidedAt:new Date().toISOString()},{state:'accepted',decidedAt:null},{state:'accepted',decisionRef:'not-a-uuid'},{changesApplied:true},{delivery:'email_sent'},{createdAt:'invalid'},{privateCredential:'never exposed'}])assert.throws(()=>checkedActivationReceipt({...base,found:true,...mutation},value),/receipt/);
  assert.throws(()=>checkedActivationReceipt({found:false,extra:true},value),/receipt/);
  assert.throws(()=>checkedActivationResult({...base,duplicate:true,found:true},value),/acknowledgement/);
});
test('activation completion cannot clear changed storage, held authority or an earlier receipt',async()=>{
  const store=fixture(),value=pending(),base=record(value);let clears=0;
  const complete=()=>{clearActivationRequest(store,value);clears++;};storeActivationRequest(store,value);
  await assert.rejects(completeArtifactMutation({...base,duplicate:false},value,checkedActivationResult,checkedActivationReceipt,async()=>({...base,found:true,createdAt:new Date(Date.now()+1000).toISOString()}),complete,()=>true));
  let held=false;await assert.rejects(completeArtifactMutation({...base,duplicate:false},value,checkedActivationResult,checkedActivationReceipt,async()=>{held=true;return {...base,found:true};},complete,()=>true,()=>!held));
  const changed={...value,body:{...value.body,note:'Changed private note'}};
  await assert.rejects(completeArtifactMutation({...base,duplicate:false},value,checkedActivationResult,checkedActivationReceipt,async()=>{store.setItem(`understood:activation-request:${value.clientContext}`,JSON.stringify(changed));return {...base,found:true};},complete,()=>true));
  assert.equal(clears,0);assert.deepEqual(readActivationRequest(store,value),changed);
});
test('activation recovery scope permits only the owning owner or administrator',()=>{
  const value=pending(),session={...value,authenticated:true,role:'staff',staffRole:'owner',staffScope:JSON.stringify(['cedar','beirut','owner']),siteState:'active',mode:'synthetic-credential'};
  assert.equal(checkedArtifactScope(session.staffScope,session,['owner','administrator']),session.staffScope);
  assert.throws(()=>checkedArtifactScope(session.staffScope,{...session,staffRole:'supervisor'},['owner','administrator']));
  assert.throws(()=>checkedArtifactScope(session.staffScope,{...session,expiresAt:new Date(0).toISOString()},['owner','administrator']));
});
