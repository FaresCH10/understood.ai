import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readPendingMessage,retainMessage,clearPendingMessage,checkedMessageReceipt} from '../src/case-message-recovery.ts';

test('conversation recovery retains only scoped metadata and never silently changes an uncertain command',async()=>{
  const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const session={clientContext:'a'.repeat(64),expiresAt:new Date(Date.now()+60000).toISOString()},caseId=randomUUID(),text='Synthetic private follow-up';
  const pending=await retainMessage(storage,session,caseId,text);
  assert.deepEqual(readPendingMessage(storage,session,caseId),pending);
  assert.equal(JSON.stringify([...values]).includes(text),false);
  assert.deepEqual(await retainMessage(storage,session,caseId,` ${text} `),pending);
  assert.equal(readPendingMessage(storage,{...session,clientContext:'b'.repeat(64)},caseId),null);
  await assert.rejects(retainMessage(storage,session,caseId,'A different message'),/pending receipt/);
  assert.throws(()=>clearPendingMessage(storage,session,caseId,randomUUID()),/changed/);
  const receipt={id:pending.id,caseId,language:'en',createdAt:new Date().toISOString()};
  assert.equal(checkedMessageReceipt(receipt,caseId,pending.id),receipt);
  assert.equal(checkedMessageReceipt({...receipt,language:'hi'},caseId,pending.id).language,'hi');
  for(const invalid of [null,{}, {...receipt,caseId:randomUUID()}, {...receipt,id:randomUUID()}, {...receipt,language:'xx'}, {...receipt,createdAt:'invalid'}])assert.throws(()=>checkedMessageReceipt(invalid,caseId,pending.id));
  clearPendingMessage(storage,session,caseId,pending.id);assert.equal(readPendingMessage(storage,session,caseId),null);
  const generated=await retainMessage(storage,session,caseId,text,'followup');assert.equal(generated.kind,'followup');
  assert.deepEqual(readPendingMessage(storage,session,caseId),generated);
  assert.equal(JSON.stringify([...values]).includes(text),false);
  await assert.rejects(retainMessage(storage,session,caseId,text,'message'),/pending receipt/);
  clearPendingMessage(storage,session,caseId,generated.id);
  await assert.rejects(retainMessage({...storage,setItem(){}},session,caseId,text),/Nothing was sent/);
  assert.throws(()=>readPendingMessage(storage,{...session,expiresAt:'2000-01-01'},caseId),/session unavailable/);
  values.set(`understood:case-message:${session.clientContext}:${caseId}`,'broken');assert.throws(()=>readPendingMessage(storage,session,caseId));
});

test('private review recovery is isolated from messages and retains only metadata',async()=>{
  const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const session={clientContext:'c'.repeat(64),expiresAt:new Date(Date.now()+60000).toISOString()},caseId=randomUUID(),reason='Synthetic private disagreement';
  const message=await retainMessage(storage,session,caseId,'Synthetic conversation message');
  const review=await retainMessage(storage,session,caseId,reason,'disagree','review');
  assert.notEqual(message.id,review.id);assert.deepEqual(readPendingMessage(storage,session,caseId,'review'),review);assert.deepEqual(readPendingMessage(storage,session,caseId),message);
  assert.equal(JSON.stringify([...values]).includes(reason),false);
  await assert.rejects(retainMessage(storage,session,caseId,reason,'deadline','review'),/pending receipt/);
  await assert.rejects(retainMessage(storage,session,caseId,reason,'disagree'),/pending receipt/);
  await assert.rejects(retainMessage(storage,session,caseId,reason,'message','review'),/pending receipt/);
  clearPendingMessage(storage,session,caseId,review.id,'review');assert.equal(readPendingMessage(storage,session,caseId,'review'),null);assert.deepEqual(readPendingMessage(storage,session,caseId),message);
  values.set(`understood:case-review:${session.clientContext}:${caseId}`,JSON.stringify(message));assert.throws(()=>readPendingMessage(storage,session,caseId,'review'));
});

test('conversation hashing cannot retain metadata after selection, session or authority changes',async()=>{
  const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  for(const change of ['selection','context','expiry']){
    let live=true;const session={clientContext:'d'.repeat(64),expiresAt:new Date(Date.now()+60000).toISOString()};
    const retained=retainMessage(storage,session,randomUUID(),'Synthetic stale draft','message','message',()=>live);
    if(change==='selection')live=false;
    if(change==='context')session.clientContext='e'.repeat(64);
    if(change==='expiry')session.expiresAt='2000-01-01T00:00:00.000Z';
    await assert.rejects(retained,/session unavailable/);assert.equal(values.size,0);
  }
});
