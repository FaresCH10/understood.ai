import test from 'node:test';
import assert from 'node:assert/strict';
import {workerWorkResponse,workPageWithinRange} from '../src/worker-work-request.ts';

test('completion conflicts preserve the session; authentication failures invalidate it',async()=>{
 let lost=0;
 const read=(status,error)=>workerWorkResponse(Response.json({error},{status}),()=>lost++);
 await assert.rejects(read(409,'Confirm understanding and resolve follow-up before finishing work'));
 assert.equal(lost,0);
 for(const [status,error] of [[401,'Sign in required'],[403,'Forbidden'],[409,'Session context changed']])await assert.rejects(read(status,error));
 assert.equal(lost,3);
 await assert.rejects(read(503,'Unavailable'));assert.equal(lost,3);
 assert.deepEqual(await workerWorkResponse(Response.json({status:'done'}),()=>lost++),{status:'done'});
});

test('a shrinking filtered inbox returns to a valid page without hiding remaining work',()=>{
 assert.equal(workPageWithinRange(3,11,10),2);
 assert.equal(workPageWithinRange(2,0,10),1);
 assert.equal(workPageWithinRange(2,20,10),2);
});
