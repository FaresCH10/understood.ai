import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptedRegistrationReceipt} from '../src/registration.ts';

test('browser keeps the canonical receipt when restarting an expired Neon registration',()=>{
  const receipt={requestId:'b99abaef-fc98-4fce-a244-34e4b8b2dc00',email:'test@example.test',state:'pending',createdAt:new Date().toISOString()};
  const canonical='6934748f-84f9-42b0-815c-ec4373b73560';
  assert.equal(acceptedRegistrationReceipt(receipt,{requestId:canonical,verification:'neon-code'}).requestId,canonical);
  assert.equal(acceptedRegistrationReceipt(receipt,{verification:'neon-code'}).requestId,receipt.requestId);
  assert.throws(()=>acceptedRegistrationReceipt(receipt,{requestId:'untrusted'}),/could not be confirmed/);
});
