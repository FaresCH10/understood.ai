import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {PIPELINE_DATASET,runPipelineRehearsal} from '../evaluation/rehearsal.mjs';
import {evaluationDataset,sampleInput} from '../evaluation/runner.mjs';
import {scriptedProvider} from '../evaluation/scripted-provider.mjs';
import {GEMINI_MODELS} from '../server/ai/gemini.mjs';

test('localized dataset is independently pinned and retains legacy English-question fixtures',()=>{
  const arabic=PIPELINE_DATASET.samples.find(sample=>sample.language==='ar');
  assert.equal(sampleInput(PIPELINE_DATASET,arabic).question,PIPELINE_DATASET.publications[0].languageQuestions.ar);
  const legacy=evaluationDataset(JSON.parse(readFileSync(new URL('../evaluation/assessment-v1.json',import.meta.url),'utf8')));
  const sample=legacy.samples.find(item=>item.language==='ar');
  assert.equal(sampleInput(legacy,sample).question,legacy.publications.find(item=>item.id===sample.publicationId).question);
  for(const mutate of [value=>{value.publications[0].languageQuestions.ar+=' changed';},
    value=>{value.publications[0].languageQuestions.ar='English only';},value=>{delete value.publications[0].languageQuestions.ar;},
    value=>{value.publications[0].languageQuestions.ur='اضافی';},value=>{value.samples[0].expected='clarification';}]) {
    const value=structuredClone(PIPELINE_DATASET);mutate(value);assert.throws(()=>evaluationDataset(value),/Invalid/);
  }
});

test('scripted transport rejects unplanned or changed inputs and retains only bounded hashed trace evidence',async()=>{
  const mock=scriptedProvider();await assert.rejects(mock.fetchImpl('https://example.test',{}),/Unexpected/);
  mock.structured('prepare',{source:'Synthetic source'},{title:'Synthetic'},'title');
  await assert.rejects(mock.fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODELS.text}:generateContent`,
    {method:'POST',body:JSON.stringify({contents:[{parts:[{text:JSON.stringify({source:'Unapproved content'})}]}]})}),/deep-equal/);
  assert.equal(mock.requestCount,0);
  const pending=scriptedProvider();pending.structured('prepare',{}, {},'title');assert.throws(()=>pending.finish(),/not all executed/);
});

test('normal credential/audio/publication/answer/help/report paths complete without network or fabricated business rows',async()=>{
  const stages=[],originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>assert.fail('The rehearsal must not use an external network transport');
  let report;
  try {report=await runPipelineRehearsal({onStage:name=>stages.push(name)});}finally{globalThis.fetch=originalFetch;}
  assert.equal(stages.length,10);assert.deepEqual(report.checks,stages.map(name=>({name,status:'passed'})));
  assert.ok(Object.isFrozen(report));assert.ok(Object.isFrozen(report.typedEvaluation));
  assert.deepEqual(report.metrics,{assigned:5,responses:5,matches:3,clarifications:2,unassessed:0,pending:0,completion:100});
  assert.equal(report.providerEvidence.scriptedRequests,24);assert.equal(report.providerEvidence.externalRequests,0);
  assert.equal(report.providerEvidence.operations,16);assert.equal(report.providerEvidence.reservedRequests,24);assert.equal(report.providerEvidence.acceptedRequests,24);
  assert.deepEqual(report.providerEvidence.byKind,{'source-transcription':1,preparation:8,'typed-assessment':4,'recording-transcription':1,'recording-assessment':1,'case-followup':1});
  assert.equal(report.privateStorage.objects,9);assert.equal(report.frozenPublication.version,1);
  assert.deepEqual(report.privateStorage.families,{'case-followup':1,'case-voice':1,generated:4,recording:1,source:1,'source-original':1});
  assert.equal(report.workerPermissions.profile,'worker');assert.equal(report.workerPermissions.verified,true);
  assert.equal(report.workerPermissions.taskExecutions,15);
  assert.deepEqual(report.workerPermissions.stages,['assessment','caseFollowup','preparation','recording','sourceTranscription']);
  assert.equal(report.workerPermissions.hiddenTables,15);assert.equal(report.workerPermissions.nativeAuthentication,'not-tested');
  assert.equal(report.workerPermissions.apiIdentity,'embedded-application-role');
  assert.equal(report.apiPermissions.profile,'application');assert.equal(report.apiPermissions.verified,true);
  assert.equal(report.apiPermissions.writableTables,137);assert.equal(report.apiPermissions.readOnlyTables,14);assert.equal(report.apiPermissions.hiddenTables,7);
  assert.equal(report.apiPermissions.taskExecutions,10);assert.deepEqual(report.apiPermissions.stages,[...stages].sort());
  assert.equal(report.apiPermissions.nativeAuthentication,'not-tested');assert.equal(report.apiPermissions.schemaOwnerUsedForCustomerOperations,false);
  assert.equal(report.apiPermissions.roleRestoredAfterNestedWork,true);
  assert.deepEqual(report.apiPermissions.maintenanceStages,['workspace-bootstrap','provider-policy-fixture','pause-provider','resume-provider']);
  assert.equal(report.typedEvaluation.metrics.completed,4);assert.equal(report.typedEvaluation.metrics.failed,0);
  assert.equal(report.typedEvaluation.metrics.notRun,0);assert.equal(report.typedEvaluation.metrics.outcomeDisagreements,0);
  assert.ok(report.typedEvaluation.results.every(row=>row.provenance.model===GEMINI_MODELS.text && /^[a-f0-9]{64}$/.test(row.inputHash)));
  assert.notEqual(report.typedEvaluation.results[2].questionHash,report.typedEvaluation.results[0].questionHash);
  assert.equal(report.evidenceLimits.productionReady,false);assert.equal(report.evidenceLimits.semanticAccuracyClaim,false);
  assert.equal(report.evidenceLimits.recordedInputModelPromptProvenance,'verified-synthetic-operation-links');
  assert.equal(report.evidenceLimits.sourceInputModelPromptProvenance,'verified-synthetic-operation-link');
  assert.equal(report.evidenceLimits.preparationInputModelPromptProvenance,'verified-synthetic-stage-operation-links');
  assert.equal(report.preparationEvidence.length,8);assert.ok(Object.isFrozen(report.preparationEvidence));
  assert.deepEqual(report.preparationEvidence.map(row=>row.stage),['preparation','grounding_check','translation','translation_check','speech','speech','speech','speech']);
  assert.deepEqual(report.preparationEvidence.slice(4).map(row=>[row.language,row.track]),[['en','body'],['en','question'],['ar','body'],['ar','question']]);
  assert.equal(new Set(report.preparationEvidence.map(row=>row.rootHash)).size,1);
  assert.equal(new Set(report.preparationEvidence.map(row=>row.inputHash)).size,8);
  assert.ok(report.preparationEvidence.every(row=>row.stageState==='completed' && /^[a-f0-9]{64}$/.test(row.argumentsHash)
    && row.provenance.model===(row.stage==='speech'?GEMINI_MODELS.speech:GEMINI_MODELS.text)
    && row.provenance.promptVersion.endsWith(row.stage.replaceAll('_','-'))));
  assert.equal(report.recordedEvaluation.metrics.completed,1);assert.equal(report.recordedEvaluation.metrics.notRun,3);
  assert.equal(report.recordedEvaluation.results[2].provenance.adapter,'gemini-recording-assessment-v1');
  assert.equal(report.recordedEvaluation.results[2].transcriptionEvidence.provenance.model,GEMINI_MODELS.transcription);
  assert.equal(report.sourceEvidence.provenance.model,GEMINI_MODELS.transcription);
  assert.equal(report.followupEvidence.provenance.textModel,GEMINI_MODELS.text);
  assert.equal(report.followupEvidence.provenance.speechModel,GEMINI_MODELS.speech);
  assert.match(report.followupEvidence.inputHash,/^[a-f0-9]{64}$/);
  assert.equal(report.evidenceLimits.followupInputModelPromptProvenance,'verified-synthetic-operation-link');
  assert.equal(report.typedEvaluation.pilotAcceptance.status,'not_evaluated');
  const serialized=JSON.stringify(report);
  assert.doesNotMatch(serialized,/scripted-provider-only-not-a-key|pipeline-owner@example|Synthetic-|password|token_hash|understood_session|apiKey|Later synthetic draft/);
  for(const sample of PIPELINE_DATASET.samples)assert.equal(serialized.includes(sample.answer),false);
});

test('rehearsal CLI rejects unknown options before starting a database or provider',()=>{
  const result=spawnSync(process.execPath,['scripts/evaluate-rehearsal.mjs','--live'],{encoding:'utf8'});
  assert.equal(result.status,2);assert.match(result.stderr,/Usage:/);assert.equal(result.stdout,'');
});
