import test from 'node:test';
import assert from 'node:assert/strict';
import {signedInDestination} from '../src/sign-in-navigation.ts';
const session={authenticated:true,role:'staff',staffRole:'owner',staffScope:JSON.stringify(['company','site','owner']),siteState:'active',mode:'synthetic-credential',clientContext:'a'.repeat(64),expiresAt:new Date(Date.now()+3600000).toISOString()};
test('existing sessions leave sign-in for a populated role-specific route',()=>{
  for(const staffRole of ['owner','supervisor','auditor'])assert.equal(signedInDestination({...session,staffRole},'sign-in'),'overview');
  assert.equal(signedInDestination({...session,staffRole:'administrator'},'sign-in'),'settings/staff');
  assert.equal(signedInDestination({...session,firstRunRequired:true},'sign-in'),'onboarding/first-run');
  assert.equal(signedInDestination({...session,role:'worker',workerId:'worker',language:'en'},'sign-in'),'inbox');
});
test('guests, expired sessions and unrelated routes keep their existing flow',()=>{
  for(const value of [null,{authenticated:false}, {...session,expiresAt:'2020-01-01T00:00:00.000Z'},{...session,clientContext:'bad'}])assert.equal(signedInDestination(value,'sign-in'),null);
  for(const route of ['home','plans','contact','register','worker-access','overview','people','briefings'])assert.equal(signedInDestination(session,route),null);
});
