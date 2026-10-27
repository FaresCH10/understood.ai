import {currentPresentationProviderClaim} from './presentation-jobs.mjs';
import {providerDataClass} from '../ai/provider-policy.mjs';
import {randomUUID} from 'node:crypto';
import {domainTransaction} from './domain.mjs';
import {dispatchAllowed} from './operations-gates.mjs';
import {scheduleAuthority} from './schedules.mjs';
import {sourceAudioActor} from '../source-audio-worker.mjs';
import {scheduleHash} from '../schedule-input.mjs';
import {requireOperatorInTransaction} from './operators.mjs';
import {currentVerificationAuthority} from './verification-authority.mjs';
import {currentVerificationClaim} from './verification-job-claim.mjs';
import {checkCaseFollowupClaim} from './case-followups.mjs';
import {currentRecordingClaim} from './recording-claim.mjs';
import {currentPreparationOperation} from './preparation-authority.mjs';
import {currentAssessmentClaim,assessmentInput} from './assessment-claim.mjs';
import {assessmentInputHash} from '../ai/assessment-config.mjs';
import {sourceTranscriptionInputHash,recordingTranscriptionInputHash} from '../ai/audio-provenance.mjs';
import {caseFollowupInputHash,checkedFollowupProvenance} from '../ai/case-followup-bundle.mjs';

async function currentAssessment(client,referenceId,claimToken,orgId,inputHash) {
  const scope=(await client.query('SELECT site_id FROM assessment_jobs WHERE id=$1 AND org_id=$2',[referenceId,orgId])).rows[0];
  const row=scope && await currentAssessmentClaim(client,{id:referenceId,org_id:orgId,site_id:scope.site_id,token:claimToken});
  if(!row || assessmentInputHash(assessmentInput(row))!==inputHash)throw Error('Provider assessment authority changed');
}

async function currentRecording(client,referenceId,claimToken,orgId,kind,inputHash) {
  const scope=(await client.query('SELECT site_id FROM recordings WHERE id=$1 AND org_id=$2',[referenceId,orgId])).rows[0];
  const row=scope && await currentRecordingClaim(client,{id:referenceId,org_id:orgId,site_id:scope.site_id,token:claimToken});
  if(!row)throw Error('Provider recording authority changed');
  const input=(await client.query(`SELECT p.snapshot_json,a.language,a.publication_id,p.version
    FROM assignments a JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
    WHERE a.id=$1 AND a.org_id=$2 AND a.site_id=$3`,[row.assignment_id,row.org_id,row.site_id])).rows[0];
  if(!input)throw Error('Provider recording input unavailable');
  const evaluation={answer:row.transcript,question:input.snapshot_json.languages?.[input.language]?.question || input.snapshot_json.question,
    askedFacts:input.snapshot_json.rubric?.askedFacts,language:input.language,publicationId:input.publication_id,version:input.version};
  if((kind==='recording-transcription'?recordingTranscriptionInputHash(row,evaluation):assessmentInputHash(evaluation))!==inputHash)
    throw Error('Provider recording input changed');
}

async function currentFollowup(client,referenceId,claimToken,orgId,inputHash,provenance,model) {
  const row=(await client.query('SELECT * FROM case_followups WHERE id=$1 AND org_id=$2',[referenceId,orgId])).rows[0];
  if(!row)throw Error('Provider follow-up authority changed');
  checkedFollowupProvenance(provenance,model,row.language);
  if(caseFollowupInputHash(row,provenance)!==inputHash)throw Error('Provider follow-up input changed');
  await checkCaseFollowupClaim(client,{...row,token:claimToken});
}

async function currentSource(client,referenceId,claimToken,orgId,inputHash) {
  const row=(await client.query(`SELECT * FROM source_audio_requests r WHERE request_id=$1 AND lease_token=$2 AND org_id=$3 AND status='processing' AND lease_until>clock_timestamp()
    AND NOT EXISTS(SELECT 1 FROM source_audio_purges p WHERE p.request_id=r.request_id) FOR SHARE`,[referenceId,claimToken,orgId])).rows[0];
  if(!row || scheduleHash(await scheduleAuthority(client,sourceAudioActor(row)))!==scheduleHash(row.authority_json)
    || sourceTranscriptionInputHash(row)!==inputHash)throw Error('Provider source authority changed');
}

export async function reserveProviderOperation(client,{orgId,kind,referenceId,model,dataClass,maxRequests,claimToken=null,inputHash=null,provenance=null,preparationContext=null}) {
  if(!['synthetic','real'].includes(dataClass) || dataClass==='real'&&(['connection-test','stage-test'].includes(kind)||!providerDataClass(provenance)||provenance.dataClass!==dataClass) || !['source-transcription','connection-test','stage-test','case-followup','recording-transcription','recording-assessment','preparation','typed-assessment','presentation'].includes(kind) || typeof referenceId!=='string' || !/^[A-Za-z0-9_-]{1,100}$/.test(referenceId)
    || typeof model!=='string' || !/^[a-z0-9][a-z0-9.:/-]{2,79}$/.test(model) || !Number.isInteger(maxRequests) || maxRequests<1 || maxRequests>64
    || (['connection-test','stage-test'].includes(kind)?orgId!==null || claimToken!==null:typeof orgId!=='string' || !/^[A-Za-z0-9_-]{1,100}$/.test(orgId) || typeof claimToken!=='string' || !/^[a-f0-9-]{36}$/i.test(claimToken)))throw Error('Invalid provider reservation');
  if(kind!=='preparation' && preparationContext!==null)throw Error('Invalid provider input evidence');
  if(['typed-assessment','source-transcription','recording-transcription','recording-assessment','preparation','presentation'].includes(kind)) {
    if(typeof inputHash!=='string' || !/^[a-f0-9]{64}$/.test(inputHash) || !provenance || provenance.dataClass!==dataClass
      || provenance.model!==model || Object.keys(provenance).sort().join(',')!=='adapter,dataClass,model,promptVersion,schemaVersion'
      || !['adapter','promptVersion','schemaVersion'].every(key=>typeof provenance[key]==='string' && /^[a-z0-9-]{1,80}$/.test(provenance[key])))throw Error('Invalid assessment provenance');
  }else if(kind==='case-followup') {
    if(typeof inputHash!=='string' || !/^[a-f0-9]{64}$/.test(inputHash) || !provenance)throw Error('Invalid follow-up provenance');
  }else if(inputHash!==null || provenance!==null)throw Error('Invalid provider input evidence');
  if(!await dispatchAllowed(client,orgId,{provider:true}))throw Error('Provider dispatch paused');
  if(kind==='source-transcription')await currentSource(client,referenceId,claimToken,orgId,inputHash);
  if(kind==='case-followup')await currentFollowup(client,referenceId,claimToken,orgId,inputHash,provenance,model);
  if(kind==='recording-transcription' || kind==='recording-assessment')await currentRecording(client,referenceId,claimToken,orgId,kind,inputHash);
  if(kind==='preparation')await currentPreparationOperation(client,referenceId,claimToken,orgId,preparationContext,provenance,model,inputHash);
  if(kind==='presentation')await currentPresentationProviderClaim(client,referenceId,claimToken,orgId,inputHash);
  if(kind==='typed-assessment')await currentAssessment(client,referenceId,claimToken,orgId,inputHash);
  // One short quota lock counts reservations across every worker before dispatch.
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended(current_schema()||':provider-quota',0))");
  const day=(await client.query("SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date::text AS day")).rows[0].day;
  const rules=(await client.query('SELECT scope_key,enabled,max_daily_requests FROM provider_policies WHERE scope_key=ANY($1::text[])',[['global',...(orgId===null?[]:[`tenant:${orgId}`])]])).rows;
  const global=rules.find(row=>row.scope_key==='global'),tenant=rules.find(row=>row.scope_key===`tenant:${orgId}`);
  if(!global?.enabled || orgId!==null && !tenant?.enabled)throw Error('Provider quota is closed');
  const usage=(await client.query(`SELECT COALESCE(SUM(reserved_requests),0)::int AS global,
    COALESCE(SUM(reserved_requests) FILTER(WHERE org_id=$2),0)::int AS tenant FROM provider_operations WHERE quota_day=$1::date`,[day,orgId])).rows[0];
  if(usage.global+maxRequests>global.max_daily_requests || orgId!==null && usage.tenant+maxRequests>tenant.max_daily_requests)throw Error('Provider request quota reached');
  const id=randomUUID();
  await client.query(`INSERT INTO provider_operations(id,org_id,kind,reference_id,claim_token,model,data_class,reserved_requests,quota_day,input_hash,provenance_json,preparation_context_json)
    VALUES($1,$2,$3,$4,$5,$6,$12,$7,$8,$9,$10,$11)`,[id,orgId,kind,referenceId,claimToken,model,maxRequests,day,inputHash,provenance===null?null:JSON.stringify(provenance),preparationContext===null?null:JSON.stringify(preparationContext),dataClass]);
  return {id,orgId,maxRequests};
}
export function providerRequestJournal(pool,operation,{schema='public'}={}) {
  return Object.freeze({
    async beforeRequest({cleanup=false}={}) {
      if(typeof cleanup!=='boolean')throw Error('Invalid provider request');
      return domainTransaction(pool,schema,async client=>{
        const row=(await client.query('SELECT * FROM provider_operations WHERE id=$1',[operation.id])).rows[0];
        if(!row || row.org_id!==operation.orgId || row.reserved_requests!==operation.maxRequests)throw Error('Provider reservation unavailable');
        if(!cleanup && !await dispatchAllowed(client,row.org_id,{provider:true}))throw Error('Provider dispatch paused');
        if(!cleanup && row.kind==='source-transcription')await currentSource(client,row.reference_id,row.claim_token,row.org_id,row.input_hash);
        if(row.kind==='case-followup')await currentFollowup(client,row.reference_id,row.claim_token,row.org_id,row.input_hash,row.provenance_json,row.model);
        if(!cleanup && (row.kind==='recording-transcription' || row.kind==='recording-assessment'))await currentRecording(client,row.reference_id,row.claim_token,row.org_id,row.kind,row.input_hash);
        if(row.kind==='preparation')await currentPreparationOperation(client,row.reference_id,row.claim_token,row.org_id,row.preparation_context_json,row.provenance_json,row.model,row.input_hash);
        if(row.kind==='presentation')await currentPresentationProviderClaim(client,row.reference_id,row.claim_token,row.org_id,row.input_hash);
        if(row.kind==='typed-assessment')await currentAssessment(client,row.reference_id,row.claim_token,row.org_id,row.input_hash);
        if(['connection-test','stage-test'].includes(row.kind)) {
          if(cleanup)throw Error('Provider verification cleanup is not permitted');
          const queued=(await client.query('SELECT request_id FROM provider_verification_jobs WHERE operation_id=$1',[row.id])).rows[0];
          if(queued)await currentVerificationClaim(client,{id:row.reference_id,operationId:row.id,token:operation.verificationToken});
          else {
            const approval=(await client.query("SELECT session_hash FROM provider_verifications WHERE operation_id=$1 AND state='pending' AND deadline_at>clock_timestamp()",[row.id])).rows[0];
            if(!approval)throw Error('Provider verification unavailable');
            await requireOperatorInTransaction(client,{token_hash:approval.session_hash});
            await currentVerificationAuthority(client,row.reference_id);
          }
        }
        await client.query('SELECT id FROM provider_operations WHERE id=$1 FOR UPDATE',[row.id]);
        const count=(await client.query('SELECT COUNT(*)::int n FROM provider_requests WHERE operation_id=$1',[row.id])).rows[0].n;
        if(count>=row.reserved_requests)throw Error('Provider operation allowance exhausted');
        const id=randomUUID();await client.query("INSERT INTO provider_requests(id,operation_id,sequence,cleanup,state) VALUES($1,$2,$3,$4,'started')",[id,row.id,count+1,cleanup]);return id;
      });
    },
    async afterRequest(id,{httpStatus=null}={}) {
      if(typeof id!=='string' || !/^[a-f0-9-]{36}$/i.test(id) || httpStatus!==null && (!Number.isInteger(httpStatus) || httpStatus<100 || httpStatus>599))throw Error('Invalid provider response evidence');
      return domainTransaction(pool,schema,client=>client.query(`UPDATE provider_requests SET state=$3,http_status=$4,finished_at=clock_timestamp()
        WHERE id=$1 AND operation_id=$2 AND state='started'`,[id,operation.id,httpStatus===null?'uncertain':httpStatus>=200 && httpStatus<300?'accepted':'rejected',httpStatus]));
    },
  });
}
