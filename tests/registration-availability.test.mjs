import test from 'node:test';
import assert from 'node:assert/strict';
import {checkRegistrationEmail,requestAccount,RegistrationError} from '../src/registration.ts';

test('email check binds the response to the current email and sends it in a same-origin POST',async t=>{
  t.mock.method(globalThis,'fetch',async(path,options)=>{
    assert.equal(path,'/api/auth/registrations/availability');assert.equal(options.method,'POST');assert.equal(options.credentials,'include');assert.equal(options.cache,'no-store');
    assert.deepEqual(JSON.parse(options.body),{email:'owner@example.test'});
    return Response.json({email:'older@example.test',available:true});
  });
  await assert.rejects(checkRegistrationEmail('owner@example.test',new AbortController().signal),/could not be confirmed/);
});
test('signup preserves a definitive duplicate-email response instead of treating it as an uncertain receipt',async t=>{
  t.mock.method(globalThis,'fetch',async()=>Response.json({error:'Email is taken',code:'REGISTRATION_EMAIL_TAKEN'},{status:409}));
  await assert.rejects(requestAccount({}),error=>error instanceof RegistrationError&&error.code==='REGISTRATION_EMAIL_TAKEN'&&error.status===409&&!error.uncertain);
});
test('email checks respect cancellation when the address changes',async t=>{
  t.mock.method(globalThis,'fetch',(_path,options)=>new Promise((_resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});}));
  const controller=new AbortController(),pending=checkRegistrationEmail('old@example.test',controller.signal);
  controller.abort();await assert.rejects(pending,error=>error.name==='AbortError');
});
