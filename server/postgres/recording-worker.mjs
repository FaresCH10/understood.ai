import {providerDataClass} from '../ai/provider-policy.mjs';
import { randomUUID } from 'node:crypto';
import { inspectWav } from '../audio.mjs';
import { domainTransaction,domainAudit } from './domain.mjs';
import { validatedAssessment } from './assessment-worker.mjs';
import {routeNewCase} from './case-routing.mjs';
import {dispatchAllowed,dispatchPredicate} from './operations-gates.mjs';
import {currentRecordingClaim} from './recording-claim.mjs';
import {recordPresentationBinding} from './presentations.mjs';
import {reserveProviderOperation,providerRequestJournal} from './provider-budget.mjs';
import {recordingTranscriptionInputHash} from '../ai/audio-provenance.mjs';
import {assessmentInputHash} from '../ai/assessment-config.mjs';
import {staffAuditOnce} from './notification-events.mjs';

export async function processOneRecording(pool,adapter,storage,{schema='public'}={}) {
  if (typeof adapter?.transcribe!=='function' || typeof adapter.assess!=='function' || typeof storage?.read!=='function') throw new Error('Recording processor unavailable');
  const job = await domainTransaction(pool,schema,async (client) => {
    const row = (await client.query(`SELECT * FROM recordings WHERE ((status='received' AND (retry_at IS NULL OR retry_at<=clock_timestamp()))
      OR (status='processing' AND lease_until<=clock_timestamp())) AND received_at IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM recording_purges p WHERE p.recording_id=recordings.id)
      AND ${dispatchPredicate('recordings',{provider:true})} ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0];
    if (!row || !await dispatchAllowed(client,row.org_id,{provider:true})) return null;
    if (row.attempts>=3) {
      await client.query(`UPDATE recordings SET status='failed',lease_token=NULL,lease_until=NULL,error='Recording interrupted too many times' WHERE id=$1`,[row.id]);
      return {...row,exhausted:true};
    }
    const token = randomUUID();
    await client.query(`UPDATE recordings SET status='processing',attempts=attempts+1,lease_token=$2,lease_until=clock_timestamp()+interval '300 seconds',retry_at=NULL,error=NULL WHERE id=$1`,[row.id,token]);
    return {...row,attempts:row.attempts+1,token};
  });
  if (!job) return false;
  if (job.exhausted) return true;
  const current=()=>domainTransaction(pool,schema,client=>currentRecordingClaim(client,job));
  let transcriptionOperation=null,assessmentOperation=null;
  const stageAdapter=async(kind,model,maxRequests,inputHash,provenance)=>{
    if(typeof adapter.withJournal!=='function')return adapter;
    if(!providerDataClass(adapter.provenance) || typeof adapter.permitsRecording!=='function')throw Error('Recording provider provenance unavailable');
    const operation=await domainTransaction(pool,schema,client=>reserveProviderOperation(client,
      {orgId:job.org_id,kind,referenceId:job.id,claimToken:job.token,model,dataClass:adapter.provenance.dataClass,maxRequests,inputHash,provenance}));
    if(kind==='recording-transcription')transcriptionOperation=operation;else assessmentOperation=operation;
    return adapter.withJournal(providerRequestJournal(pool,operation,{schema}));
  };
  try {
    const input = await domainTransaction(pool,schema,async (client) => (await client.query(`SELECT p.snapshot_json,a.language,a.publication_id,p.version,w.active
      FROM assignments a JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
      JOIN workers w ON w.id=a.worker_id AND w.org_id=a.org_id AND w.site_id=a.site_id
      WHERE a.id=$1 AND a.org_id=$2 AND a.site_id=$3`,[job.assignment_id,job.org_id,job.site_id])).rows[0]);
    if (!input?.active) {
      await domainTransaction(pool,schema,async (client) => client.query(`UPDATE recordings SET status='blocked',lease_token=NULL,lease_until=NULL,error='Assignment unavailable'
        WHERE id=$1 AND status='processing' AND lease_token=$2 AND lease_until>clock_timestamp()`,[job.id,job.token]));
      return true;
    }
    if(typeof adapter.permitsRecording==='function' && !adapter.permitsRecording(job)) {
      await domainTransaction(pool,schema,client=>client.query(`UPDATE recordings SET status='blocked',lease_token=NULL,lease_until=NULL,error='Recording provider unavailable'
        WHERE id=$1 AND status='processing' AND lease_token=$2 AND lease_until>clock_timestamp()`,[job.id,job.token]));
      return true;
    }
    const snapshot = input.snapshot_json, facts = snapshot.rubric?.askedFacts;
    const question = job.presented_question || snapshot.languages?.[input.language]?.question || snapshot.question;
    const frozenInput={question,askedFacts:facts,language:input.language,publicationId:input.publication_id,version:input.version};
    if (typeof question!=='string' || !question.trim() || question.length>500 || !Array.isArray(facts)
      || !facts.length || facts.length>6 || !facts.every((fact) => typeof fact==='string' && fact.trim() && fact.length<=500)) throw new Error('Published rubric unavailable');
    let transcript = job.transcript;
    if (!transcript) {
      const bytes=await storage.read(job), info=inspectWav(bytes);
      if (info.sha256!==job.sha256 || info.bytes!==job.bytes) throw new Error('Private recording integrity check failed');
      if(!await current())return true;
      const transcriber=await stageAdapter('recording-transcription',adapter.transcriptionModel,adapter.provenance?.dataClass==='real'?1:4,
        recordingTranscriptionInputHash(job,frozenInput),adapter.transcriptionProvenance);
      transcript=(await transcriber.transcribe(bytes,'audio/wav'))?.text;
      if (typeof transcript!=='string' || !transcript.trim() || transcript.length>2000) throw new Error('Transcript unavailable');
      transcript=transcript.trim();
      const saved=await domainTransaction(pool,schema,async (client) => {
        if(!await currentRecordingClaim(client,job))return false;
        return (await client.query(`UPDATE recordings SET transcript=$3,transcription_operation_id=$6
        WHERE id=$1 AND org_id=$4 AND site_id=$5 AND status='processing' AND lease_token=$2 AND lease_until>clock_timestamp() RETURNING id`,
      [job.id,job.token,transcript,job.org_id,job.site_id,transcriptionOperation?.id ?? null])).rows.length;
      });
      if (!saved) return true;
    }
    if(!await current())return true;
    const assessor=await stageAdapter('recording-assessment',adapter.assessmentModel,1,
      assessmentInputHash({...frozenInput,answer:transcript}),adapter.assessmentProvenance);
    const result = validatedAssessment(await assessor.assess(transcript,question,facts),transcript,facts);
    await domainTransaction(pool,schema,async (client) => {
      if(!await dispatchAllowed(client,job.org_id,{provider:true}))return;
      const worker = (await client.query(`SELECT w.active FROM workers w JOIN assignments a ON a.worker_id=w.id AND a.org_id=w.org_id AND a.site_id=w.site_id
        WHERE a.id=$1 AND a.org_id=$2 AND a.site_id=$3 FOR SHARE OF w`,[job.assignment_id,job.org_id,job.site_id])).rows[0];
      await client.query('SELECT id FROM assignments WHERE id=$1 AND org_id=$2 AND site_id=$3 FOR UPDATE',[job.assignment_id,job.org_id,job.site_id]);
      const current = (await client.query(`SELECT id FROM recordings WHERE id=$1 AND status='processing' AND lease_token=$2 AND lease_until>clock_timestamp() FOR UPDATE`,[job.id,job.token])).rows[0];
      if (!current) return;
      if((await client.query('SELECT 1 FROM recording_purges WHERE recording_id=$1',[job.id])).rows.length)return;
      if (!worker?.active) {
        await client.query(`UPDATE recordings SET status='blocked',lease_token=NULL,lease_until=NULL,error='Assignment unavailable' WHERE id=$1`,[job.id]);
        return;
      }
      const previous=(await client.query('SELECT id FROM attempts WHERE assignment_id=$1 AND submission_id=$2',[job.assignment_id,job.submission_id])).rows[0];
      if (!previous) {
        const attemptId=randomUUID();
        await client.query(`INSERT INTO attempts(id,org_id,site_id,assignment_id,submission_id,answer_text,outcome,reasons_json,evidence_json,received_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[attemptId,job.org_id,job.site_id,job.assignment_id,job.submission_id,transcript,result.outcome,JSON.stringify(result.reasons),JSON.stringify(result.evidence),job.received_at]);
        await recordPresentationBinding(client,attemptId,job.presentation_id && job.presentation_language && job.presented_question
          ? {id:job.presentation_id,org_id:job.org_id,site_id:job.site_id,assignment_id:job.assignment_id,
            target_language:job.presentation_language,question:job.presented_question} : null);
        const repeat=(await client.query(`SELECT case_id FROM case_repeats WHERE assignment_id=$1 AND submission_id=$2
          AND org_id=$3 AND site_id=$4 AND status='submitted'`,[job.assignment_id,job.submission_id,job.org_id,job.site_id])).rows[0];
        if (result.outcome!=='matched' && !repeat) {
          const caseId=randomUUID();await client.query(`INSERT INTO clarifications(id,org_id,site_id,assignment_id,attempt_id,reason,status)
          VALUES ($1,$2,$3,$4,$5,$6,'open')`,[caseId,job.org_id,job.site_id,job.assignment_id,attemptId,result.reasons[0]]);
          await routeNewCase(client,job.org_id,job.site_id,caseId);
          await staffAuditOnce(client,{orgId:job.org_id,siteId:job.site_id,action:'answer.needs_attention',objectId:caseId});
        }
        await domainAudit(client,{...job,principal_type:'system',principal_id:'recording-worker'},'answer.checked',attemptId);
      }
      await client.query(`UPDATE recordings SET status='transcribed',assessment_operation_id=$2,lease_token=NULL,lease_until=NULL,retry_at=NULL,error=NULL WHERE id=$1`,[job.id,assessmentOperation?.id ?? null]);
    });
  } catch {
    await domainTransaction(pool,schema,async (client) => client.query(`UPDATE recordings SET status=$3,lease_token=NULL,lease_until=NULL,
      retry_at=CASE WHEN $3='failed' THEN NULL ELSE clock_timestamp()+$4*interval '15 seconds' END,error='Recording AI processing failed'
      WHERE id=$1 AND status='processing' AND lease_token=$2 AND lease_until>clock_timestamp()`,[job.id,job.token,job.attempts>=3 ? 'failed' : 'received',job.attempts]));
  }
  return true;
}
