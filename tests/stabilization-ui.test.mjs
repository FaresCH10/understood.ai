import test from 'node:test';
import assert from 'node:assert/strict';
import {instructionSendState,instructionResponseCounts} from '../src/instruction-status.ts';
import {responseFacts} from '../src/report-view.ts';
import {staffUiReason} from '../src/staff-ui-locale.ts';
import {caseReason} from '../src/clarification-locale.ts';

test('unsent audio-derived drafts are never labelled Scheduled or sent',()=>{
  const unsent={state:'ready',publication_state:null,schedule_state:null,scheduled_for:null,metrics:null};
  assert.equal(instructionSendState(unsent),'draft');
  assert.equal(instructionResponseCounts(unsent),null);
  assert.equal(instructionSendState({...unsent,state:'processing'}),'processing');
  assert.equal(instructionSendState({...unsent,state:'failed'}),'failed');
  assert.equal(instructionSendState({...unsent,schedule_state:'queued',scheduled_for:null}),'draft');
  assert.equal(instructionSendState({...unsent,schedule_state:'queued',scheduled_for:'2026-11-04T07:00:00.000Z'}),'scheduled');
  assert.equal(instructionSendState({...unsent,state:'published'}),'draft');
});

test('a sent version stays visible when a later update is only scheduled or drafted',()=>{
  assert.equal(instructionSendState({state:'ready',publication_state:'published',schedule_state:'queued',scheduled_for:'2026-11-04T07:00:00.000Z'}),'published');
  assert.equal(instructionSendState({state:'ready',publication_state:'superseded'}),'superseded');
  assert.equal(instructionSendState({state:'ready',publication_state:null,schedule_state:'cancelled',scheduled_for:null}),'draft');
});

test('response counts appear only when workers are assigned',()=>{
  assert.equal(instructionResponseCounts({state:'ready',metrics:{assigned:0,responses:0}}),null);
  assert.deepEqual(instructionResponseCounts({state:'ready',metrics:{assigned:8,responses:3}}),{responses:3,assigned:8});
  assert.equal(instructionResponseCounts({state:'ready',metrics:null}),null);
});

test('internal reason codes never reach staff screens',()=>{
  assert.equal(staffUiReason('en','uncertain_placement'),'Placement is unclear');
  assert.equal(staffUiReason('ar','uncertain_placement'),'المكان المقصود غير واضح');
  assert.equal(staffUiReason('en','some_new_internal_code'),'Reason unavailable');
  assert.equal(staffUiReason('ar','some_new_internal_code'),'التفسير غير متاح');
  assert.equal(staffUiReason('en','A readable sentence.'),'A readable sentence.');
  assert.equal(caseReason('en','uncertain_placement'),'Placement is unclear');
  assert.equal(caseReason('en','unknown_new_code'),'Reason unavailable');
  assert.equal(caseReason('ar','unknown_new_code'),'التفسير غير متاح');
  assert.equal(caseReason('en','Staff follow-up: New deadline requested'),'Staff follow-up: New deadline requested');
});

test('answer match rate excludes acknowledgements and pending answers from its denominator',()=>{
  const facts=responseFacts({assigned:10,responses:6,matches:3,clarifications:1,unassessed:1,pending:4,completion:60,acknowledged:1,resolved:2});
  assert.equal(facts.assessed,4);
  assert.equal(facts.understanding,75);
  assert.deepEqual(facts.segments.map(segment=>[segment.key,segment.count]),[['matched',3],['clarification',1],['assessment',1],['acknowledged',1],['pending',4]]);
  assert.equal(facts.segments.some(segment=>segment.key==='resolved'),false);
  assert.equal(facts.segments.reduce((sum,segment)=>sum+segment.percent,0),100);
  assert.equal(responseFacts({assigned:0,responses:0,matches:0,clarifications:0,unassessed:0,pending:0,completion:0}).understanding,null);
  assert.equal(responseFacts({assigned:0,responses:0,matches:0,clarifications:0,unassessed:0,pending:0,completion:0}).segments.every(segment=>segment.percent===0),true);
});

test('instruction updates use the same content, recipients, review and send model',async()=>{
  const {readFile}=await import('node:fs/promises');
  const main=await readFile(new URL('../src/main.tsx',import.meta.url),'utf8');
  assert.match(main,/<UpdateInstructionRecipients state=\{updateAudience\}/);
  assert.match(main,/<UpdateInstructionReview state=\{updateAudience\}/);
  assert.doesNotMatch(main,/<PublishForm /);
  assert.match(main,/Question and language preparation/);
  const update=await readFile(new URL('../src/UpdateInstructionSend.tsx',import.meta.url),'utf8');
  assert.match(update,/hideRecipients/);
  assert.match(update,/initialWorkers=\{workers\}/);
  const publish=await readFile(new URL('../src/PublishForm.tsx',import.meta.url),'utf8');
  assert.match(publish,/hideRecipients\?staffT\("Review and send"\)/);
  assert.match(publish,/publish-more-options/);
});
