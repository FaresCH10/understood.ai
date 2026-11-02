import test from 'node:test';
import assert from 'node:assert/strict';
import {improvementView} from '../server/self-healing-input.mjs';
import {isCredentialMode} from '../src/session-state.ts';
import {usageModel} from '../server/usage.mjs';
import {checkedUsageModel} from '../src/usage-state.ts';

test('credential features support admitted live sessions while rejecting demo profiles and unknown modes',()=>{
  for(const mode of ['synthetic-credential','live-credential'])assert.equal(isCredentialMode(mode),true);
  for(const mode of [undefined,null,'live','synthetic-profile','synthetic-demo','unknown',{},true])assert.equal(isCredentialMode(mode),false);
});

test('live plan and usage validates its own real-data scope without claiming invoices or accepting synthetic allowance evidence',()=>{
  const allowance={day:'2026-11-01',timezone:'UTC',resetsAt:'2026-11-02T00:00:00.000Z',state:'closed',reason:'quota_closed',limit:0,reserved:0,remaining:0,
    requests:{started:0,accepted:0,rejected:0,uncertain:0},jobsPaused:false,providerPaused:false,dataClass:'real',billingVerified:false};
  const row=usageModel({mode:'live-credential',providerAllowance:allowance});
  assert.deepEqual(checkedUsageModel(row,'live-credential','owner'),row);
  assert.equal(row.plan.state,'unverified');assert.equal(row.spend.actual.amount,null);
  assert.doesNotMatch(JSON.stringify(row),/synthetic|No provider rate card or billable inference was used/);
  assert.throws(()=>checkedUsageModel({...row,providerAllowance:{...allowance,dataClass:'synthetic'}},'live-credential','owner'));
  assert.throws(()=>checkedUsageModel(row,'synthetic-credential','owner'));
  assert.throws(()=>checkedUsageModel({...row,spend:{...row.spend,actual:{...row.spend.actual,amount:10}}},'live-credential','owner'));
});

test('production improvement analysis labels real response counts as deterministic rules without synthetic outcomes',()=>{
  const publication={id:'publication',state:'published',snapshot_json:{source:'Keep the north gate closed.',title:'Gate'}};
  const rows=[{language:'en',outcome:'clarification'},{language:'en',outcome:'clarification'},{language:'en',outcome:'matched'}];
  const production=improvementView(publication,null,rows,null,[],{integrationMode:'live'});
  assert.equal(production.simulated,false);assert.equal(production.adapter,'deterministic-rules-v1');
  assert.deepEqual(production.current,{assessed:3,matched:1,clarification:2,matchRate:33});
  const demo=improvementView(publication,null,rows,null);
  assert.equal(demo.simulated,true);assert.equal(demo.adapter,'synthetic');
  assert.deepEqual(demo.current,production.current);
});
