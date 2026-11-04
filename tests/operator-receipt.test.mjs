import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesControlReceipt} from '../src/operator-receipt.ts';
test('operator receipt matches exact reviewed scope and resulting controls',()=>{
 for(const command of [{kind:'system',revision:4,jobsPaused:true,providerPaused:false},{kind:'tenant',revision:2,orgId:'cedar',state:'suspended'},{kind:'provider-policy',revision:1,orgId:null,enabled:true,maxDailyRequests:30}]){
  const result={...command,revision:command.revision+1};
  assert.equal(matchesControlReceipt(command,result),true);
  for(const [key,value] of Object.entries(result))assert.equal(matchesControlReceipt(command,{...result,[key]:typeof value==='boolean'?!value:typeof value==='number'?value+1:'foreign'}),false,key);
 }
 for(const value of [null,[],{},'invalid'])assert.equal(matchesControlReceipt({kind:'system',revision:0,jobsPaused:false,providerPaused:false},value),false);
});
