import test from 'node:test';
import assert from 'node:assert/strict';
import {workListPath,workItemOverdue,workJourneyStep} from '../src/worker-journey.ts';
import {workerJourneyText} from '../src/worker-journey-text.ts';
import {WORKER_LANGUAGE_CODES} from '../server/languages.mjs';
test('work navigation distinguishes answering, working and completion and never treats a help case as done',()=>{
 assert.equal(workJourneyStep({status:'sent',responseStatus:'waiting'}),1);
 assert.equal(workJourneyStep({status:'sent',responseStatus:'pending'}),1);
 assert.equal(workJourneyStep({status:'follow-up',responseStatus:'received'}),1);
 assert.equal(workJourneyStep({status:'in-progress',responseStatus:'received'}),2);
 assert.equal(workJourneyStep({status:'done',responseStatus:'received'}),3);
});
test('work list builds bounded, escaped queries and flags overdue active work only',()=>{
 assert.equal(workListPath('follow-up',2,'shelf & count'),'/api/workspace/work?status=follow-up&page=2&pageSize=10&search=shelf+%26+count');
 for(const page of [0,5001,1.2,NaN])assert.throws(()=>workListPath('active',page));
 assert.throws(()=>workListPath('unknown',1));assert.throws(()=>workListPath('active',1,'x'.repeat(81)));
 const item={status:'sent',publicationState:'published',dueAt:'2026-11-05T08:00:00.000Z'},now=Date.parse('2026-11-05T08:00:00.000Z');
 assert.equal(workItemOverdue(item,now),true);assert.equal(workItemOverdue({...item,status:'done'},now),false);assert.equal(workItemOverdue({...item,publicationState:'withdrawn'},now),false);assert.equal(workItemOverdue({...item,dueAt:null},now),false);
});
test('worker journey copy covers every worker locale without empty controls',()=>{
 const keys=Object.keys(workerJourneyText('en')).sort();
 for(const language of WORKER_LANGUAGE_CODES){const text=workerJourneyText(language);assert.deepEqual(Object.keys(text).sort(),keys);for(const value of Object.values(text))assert.ok(typeof value==='string'&&value.trim().length>0,language);}
});
