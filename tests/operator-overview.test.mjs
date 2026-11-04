import test from 'node:test';
import assert from 'node:assert/strict';
import {overviewSummary,healthTone,operatorSections} from '../src/operator-overview.ts';
test('command center reconciles queue totals without treating missing health as healthy',()=>{
 const report={backlog:[{status:'failed',count:2},{status:'blocked',count:3},{status:'queued',count:4},{status:'received',count:1},{status:'processing',count:2},{status:'complete',count:100}],control:{jobsPaused:false,providerPaused:true},workerHealth:{items:[{fresh:true,state:'idle'},{fresh:false,state:'busy'},{fresh:true,state:'stopped'}]}};
 assert.deepEqual(overviewSummary(report),{failed:5,queued:5,processing:2,freshWorkers:1,paused:true});
 for(const value of ['unverified','checking','new state'])assert.equal(healthTone(value),'unknown');
 assert.equal(healthTone('responding'),'good');assert.equal(healthTone('degraded'),'attention');
 assert.equal(new Set(operatorSections.map(item=>item.id)).size,operatorSections.length);
});
