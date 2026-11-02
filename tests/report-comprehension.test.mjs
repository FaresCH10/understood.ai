import test from 'node:test';
import assert from 'node:assert/strict';
import {reportScope,selectReport} from '../server/report-scope.mjs';

const at='2026-10-24T09:00:00.000Z';
const answered=(id,code,language,outcome)=>({assignment_id:id,code,language,attempt_at:at,outcome,audio_status:null,audio_at:null,acknowledged_at:null});
const acknowledged=(id,code,language)=>({assignment_id:id,code,language,attempt_at:null,outcome:null,audio_status:null,audio_at:null,acknowledged_at:at});
const pending=(id,code,language)=>({assignment_id:id,code,language,attempt_at:null,outcome:null,audio_status:null,audio_at:null,acknowledged_at:null});

test('language breakdown separates understanding from completion and acknowledgement',()=>{
  const report=selectReport([
    answered('en-1','w1','en','matched'),answered('en-2','w2','en','matched'),answered('en-3','w3','en','clarification'),
    acknowledged('en-4','w4','en'),pending('en-5','w5','en'),
    answered('ar-1','w6','ar','matched'),answered('ar-2','w7','ar','unassessable'),
    pending('ur-1','w8','ur')
  ],3,reportScope(),'UTC',[]);
  const byLanguage=Object.fromEntries(report.languages.map(row=>[row.language,row]));
  assert.deepEqual(Object.keys(byLanguage).sort(),['ar','en','ur']);
  assert.equal(byLanguage.en.assigned,5);
  assert.equal(byLanguage.en.received,4);
  assert.equal(byLanguage.en.completion,80);
  assert.equal(byLanguage.en.matched,2);
  assert.equal(byLanguage.en.clarified,1);
  assert.equal(byLanguage.en.acknowledged,1);
  assert.equal(byLanguage.en.understanding,67);
  assert.equal(byLanguage.ar.understanding,50);
  assert.equal(byLanguage.ar.clarified,1);
  assert.equal(byLanguage.ur.understanding,null);
  assert.equal(report.metrics.matches,3);
  assert.equal(report.metrics.clarifications,2);
  assert.equal(report.metrics.responses,6);
  assert.doesNotMatch(JSON.stringify(report.languages),/PRIVATE ANSWER|rubric|reasons_json/);
});
