import test from 'node:test';
import {improvementFixture} from './helpers/self-healing-fixture.mjs';
import {selfHealingContract} from './helpers/self-healing-contract.mjs';

test('PostgreSQL self-healing detects latest clarification, reviews separate drafts and compares scoped follow-up checks',async()=>{
  const f=await improvementFixture(true);try{await selfHealingContract(f);}finally{await f.close();}
});
