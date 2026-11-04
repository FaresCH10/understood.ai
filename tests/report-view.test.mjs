import test from 'node:test';
import assert from 'node:assert/strict';
import {responseFacts} from '../src/report-view.ts';
test('report partition preserves audience and keeps acknowledgement, assessment and follow-up distinct',()=>{
 const counts={assigned:10,responses:7,matches:3,clarifications:2,unassessed:1,acknowledged:1,pending:3,completion:70,resolved:2};
 const facts=responseFacts(counts);assert.equal(facts.assessed,5);assert.equal(facts.understanding,60);
 assert.equal(facts.segments.reduce((sum,row)=>sum+row.count,0),10);assert.equal(facts.segments.reduce((sum,row)=>sum+row.percent,0),100);
 assert.deepEqual(responseFacts({...counts,resolved:99}),facts);
 const zero=responseFacts({...counts,assigned:0,responses:0,matches:0,clarifications:0,unassessed:0,acknowledged:0,pending:0});assert.equal(zero.understanding,null);assert.ok(zero.segments.every(row=>row.percent===0));
 const window=responseFacts({...counts,responses:1,matches:1,clarifications:0,unassessed:0,acknowledged:0,pending:9});assert.equal(window.segments.find(row=>row.key==='pending').percent,90);
});
