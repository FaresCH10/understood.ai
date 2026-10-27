import {providerDataClass} from '../ai/provider-policy.mjs';
import {assessMultipleChoice} from '../multiple-choice.mjs';
import { randomUUID } from 'node:crypto';
import { domainTransaction, domainAudit } from './domain.mjs';
import {dispatchAllowed,dispatchPredicate} from './operations-gates.mjs';
import {routeNewCase} from './case-routing.mjs';
import {currentAssessmentClaim,assessmentInput} from './assessment-claim.mjs';
import {assessmentInputHash} from '../ai/assessment-config.mjs';
import {reserveProviderOperation,providerRequestJournal} from './provider-budget.mjs';
import {staffAuditOnce} from './notification-events.mjs';

export function validatedAssessment(value,answer,askedFacts) {
  if (!['matched','clarification','unassessable'].includes(value?.outcome) || !Array.isArray(value.reasons)
    || !value.reasons.length || value.reasons.length>12 || !value.reasons.every((reason) => typeof reason==='string' && reason.trim() && reason.length<=300)
    || !Array.isArray(value.evidence) || value.evidence.length>24) throw new Error('Assessment invalid');
  const covered = new Set();
  for (const item of value.evidence) {
    if (!Number.isInteger(item?.factIndex) || item.factIndex<0 || item.factIndex>=askedFacts.length
      || typeof item.quote!=='string' || !item.quote.trim() || item.quote.length>300 || !answer.includes(item.quote)) throw new Error('Assessment evidence invalid');
    covered.add(item.factIndex);
  }
  if (value.outcome==='matched' && covered.size!==askedFacts.length) throw new Error('Assessment evidence incomplete');
  return {outcome:value.outcome,reasons:value.reasons,evidence:value.evidence.map(({factIndex,quote}) => ({factIndex,quote}))};
}

export async function processOneAssessment(pool,adapter,{schema='public'}={}) {
  if (typeof adapter?.assess!=='function') throw new Error('Assessment adapter unavailable');
  const job = await domainTransaction(pool,schema,async (client) => {
    const row = (await client.query(`SELECT * FROM assessment_jobs WHERE ((status='queued' AND due_at<=clock_timestamp())
      OR (status='processing' AND lease_until<=clock_timestamp())) AND ${dispatchPredicate('assessment_jobs',{provider:true})}
      ORDER BY due_at,id FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0];
    if (!row || !await dispatchAllowed(client,row.org_id,{provider:true})) return null;
    if (row.attempts>=3) {
      await client.query(`UPDATE assessment_jobs SET status='failed',lease_token=NULL,lease_until=NULL,error='Assessment interrupted too many times' WHERE id=$1`,[row.id]);
      return {...row,exhausted:true};
    }
    const token = randomUUID();
    await client.query(`UPDATE assessment_jobs SET status='processing',attempts=attempts+1,lease_until=clock_timestamp()+interval '180 seconds',
      lease_token=$2,error=NULL WHERE id=$1`,[row.id,token]);
    return {...row,attempts:row.attempts+1,token};
  });
  if (!job) return false;
  if (job.exhausted) return true;
  try {
    const input = await domainTransaction(pool,schema,client=>currentAssessmentClaim(client,job));
    if (!input) {
      await domainTransaction(pool,schema,async (client) => client.query(`UPDATE assessment_jobs SET status='blocked',lease_until=NULL,lease_token=NULL,error='Assignment unavailable'
        WHERE id=$1 AND status='processing' AND lease_token=$2 AND lease_until>clock_timestamp()`,[job.id,job.token]));
      return true;
    }
    const evaluation=assessmentInput(input),inputHash=assessmentInputHash(evaluation);
    const {answer,question,askedFacts}=evaluation;
    const multipleChoice=input.snapshot_json?.rubric?.mode==='multiple-choice';
    if(!multipleChoice && typeof adapter.permitsAssessment==='function' && !adapter.permitsAssessment(evaluation)) {
      await domainTransaction(pool,schema,client=>client.query(`UPDATE assessment_jobs SET status='blocked',lease_until=NULL,lease_token=NULL,error='Synthetic assessment input not allowlisted'
        WHERE id=$1 AND status='processing' AND lease_token=$2 AND lease_until>clock_timestamp()`,[job.id,job.token]));return true;
    }
    let assessor=adapter,operation=null;
    if(!multipleChoice && typeof adapter.withJournal==='function') {
      if(!providerDataClass(adapter.provenance) || typeof adapter.permitsAssessment!=='function')throw Error('Assessment provider provenance unavailable');
      operation=await domainTransaction(pool,schema,client=>reserveProviderOperation(client,{orgId:job.org_id,kind:'typed-assessment',
        referenceId:job.id,claimToken:job.token,model:adapter.assessmentModel,dataClass:adapter.provenance.dataClass,maxRequests:1,inputHash,provenance:adapter.provenance}));
      assessor=adapter.withJournal(providerRequestJournal(pool,operation,{schema}));
    }
    if(!await domainTransaction(pool,schema,async client=>{
      const current=await currentAssessmentClaim(client,job);return current && assessmentInputHash(assessmentInput(current))===inputHash;
    }))return true;
    const result = validatedAssessment(multipleChoice?assessMultipleChoice(answer,input.snapshot_json,input.language):await assessor.assess(answer,question,askedFacts),answer,askedFacts);
    await domainTransaction(pool,schema,async (client) => {
      if(!await dispatchAllowed(client,job.org_id,{provider:true}))return;
      // Same worker/assignment lock order as receipt acceptance. Completion cannot revise another attempt.
      const worker = (await client.query(`SELECT w.active FROM workers w JOIN assignments a ON a.worker_id=w.id AND a.org_id=w.org_id AND a.site_id=w.site_id
        WHERE a.id=$1 AND a.org_id=$2 AND a.site_id=$3 FOR SHARE OF w`,[job.assignment_id,job.org_id,job.site_id])).rows[0];
      await client.query('SELECT id FROM assignments WHERE id=$1 AND org_id=$2 AND site_id=$3 FOR UPDATE',[job.assignment_id,job.org_id,job.site_id]);
      const current = (await client.query(`SELECT id FROM assessment_jobs WHERE id=$1 AND status='processing' AND lease_token=$2 AND lease_until>clock_timestamp() FOR UPDATE`,[job.id,job.token])).rows[0];
      if (!current) return;
      if (!worker?.active) {
        await client.query(`UPDATE assessment_jobs SET status='blocked',lease_token=NULL,lease_until=NULL,error='Assignment unavailable' WHERE id=$1`,[job.id]);
        return;
      }
      const currentInput=await currentAssessmentClaim(client,job);
      if(!currentInput || assessmentInputHash(assessmentInput(currentInput))!==inputHash)return;
      const changed = (await client.query(`UPDATE attempts SET outcome=$2,reasons_json=$3,evidence_json=$4,assessment_status='complete'
        WHERE id=$1 AND org_id=$5 AND site_id=$6 AND assignment_id=$7 AND assessment_status='pending' RETURNING id`,
      [job.attempt_id,result.outcome,JSON.stringify(result.reasons),JSON.stringify(result.evidence),job.org_id,job.site_id,job.assignment_id])).rows.length;
      if (changed) {
        const repeat=(await client.query(`SELECT cr.case_id FROM case_repeats cr JOIN attempts t ON t.assignment_id=cr.assignment_id AND t.submission_id=cr.submission_id
          AND t.org_id=cr.org_id AND t.site_id=cr.site_id WHERE t.id=$1 AND cr.status='submitted'`,[job.attempt_id])).rows[0];
        if (result.outcome!=='matched' && !repeat) {
          const caseId=randomUUID();await client.query(`INSERT INTO clarifications(id,org_id,site_id,assignment_id,attempt_id,reason,status)
          VALUES ($1,$2,$3,$4,$5,$6,'open')`,[caseId,job.org_id,job.site_id,job.assignment_id,job.attempt_id,result.reasons[0]]);
          await routeNewCase(client,job.org_id,job.site_id,caseId);
          await staffAuditOnce(client,{orgId:job.org_id,siteId:job.site_id,action:'answer.needs_attention',objectId:caseId});
        }
        await domainAudit(client,{...job,principal_type:'system',principal_id:'assessment-worker'},'answer.checked',job.attempt_id);
      }
      await client.query(`UPDATE assessment_jobs SET status='complete',lease_token=NULL,lease_until=NULL,error=NULL,provider_operation_id=$2 WHERE id=$1`,[job.id,operation?.id ?? null]);
    });
  } catch {
    await domainTransaction(pool,schema,async (client) => client.query(`UPDATE assessment_jobs SET status=$3,lease_token=NULL,lease_until=NULL,
      due_at=clock_timestamp()+$4*interval '15 seconds',error='Answer assessment failed'
      WHERE id=$1 AND status='processing' AND lease_token=$2 AND lease_until>clock_timestamp()`,[job.id,job.token,job.attempts>=3 ? 'failed' : 'queued',job.attempts]));
  }
  return true;
}
