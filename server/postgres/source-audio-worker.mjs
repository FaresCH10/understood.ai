import {randomUUID} from 'node:crypto';
import {domainTransaction,domainAudit} from './domain.mjs';
import {scheduleAuthority} from './schedules.mjs';
import {scheduleHash} from '../schedule-input.mjs';
import {createDraftInTransaction} from './preparation.mjs';
import {sourceAudioActor,processSourceAudioWithJournal} from '../source-audio-worker.mjs';
import {dispatchAllowed,dispatchPredicate} from './operations-gates.mjs';
import {reserveProviderOperation,providerRequestJournal} from './provider-budget.mjs';
import {sourceTranscriptionInputHash} from '../ai/audio-provenance.mjs';

export function sourceAudioProcessingJournal(pool,{schema='public'}={}) {
  const run=fn=>domainTransaction(pool,schema,fn);
  async function valid(client,row) {
    if(!await dispatchAllowed(client,row.org_id,{provider:true}))return null;
    const current=(await client.query("SELECT * FROM source_audio_requests WHERE request_id=$1 AND status='processing' AND lease_token=$2 AND lease_until>clock_timestamp() FOR UPDATE",[row.request_id,row.lease_token])).rows[0];
    if(!current || (await client.query('SELECT 1 FROM source_audio_purges WHERE request_id=$1',[row.request_id])).rows.length)return null;
    try {if(scheduleHash(await scheduleAuthority(client,sourceAudioActor(current)))!==scheduleHash(current.authority_json))throw Error('Changed');}
    catch(error) {
      if(!['Changed','Forbidden','Sign in required'].includes(error.message))throw error;
      await client.query("UPDATE source_audio_requests SET status='blocked',lease_token=NULL,lease_until=NULL,retry_at=NULL,error='Source audio authority changed' WHERE request_id=$1",[row.request_id]);return null;
    }
    return current;
  }
  return {
    claim() {return run(async client=>{
      const row=(await client.query(`SELECT * FROM source_audio_requests WHERE ((status='received' AND (retry_at IS NULL OR retry_at<=clock_timestamp()))
        OR (status='processing' AND lease_until<=clock_timestamp())) AND NOT EXISTS(SELECT 1 FROM source_audio_purges p WHERE p.request_id=source_audio_requests.request_id)
        AND ${dispatchPredicate('source_audio_requests',{provider:true})}
        ORDER BY created_at,request_id FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0];
      if(!row || !await dispatchAllowed(client,row.org_id,{provider:true}))return null;
      if(row.attempts>=3) {await client.query("UPDATE source_audio_requests SET status='failed',lease_token=NULL,lease_until=NULL,retry_at=NULL,error='Source transcription attempts exhausted' WHERE request_id=$1",[row.request_id]);return {...row,exhausted:true};}
      return (await client.query("UPDATE source_audio_requests SET status='processing',lease_token=$2,lease_until=clock_timestamp()+interval '180 seconds',attempts=attempts+1,retry_at=NULL,error=NULL WHERE request_id=$1 RETURNING *",[row.request_id,randomUUID()])).rows[0];
    });},
    validate(row) {return run(async client=>!!await valid(client,row));},
    finish(row,input,{providerOperationId=null}={}) {return run(async client=>{
      if(!await valid(client,row))return;
      await createDraftInTransaction(client,sourceAudioActor(row),input,schema);
      await client.query("UPDATE source_audio_requests SET status='transcribed',briefing_id=$2,transcription_operation_id=$3,lease_token=NULL,lease_until=NULL,retry_at=NULL,error=NULL WHERE request_id=$1",[row.request_id,input.requestId,providerOperationId]);
      await domainAudit(client,sourceAudioActor(row),'briefing.source_audio_transcribed',row.request_id);
    });},
    block(row) {return run(client=>client.query("UPDATE source_audio_requests SET status='blocked',lease_token=NULL,lease_until=NULL,retry_at=NULL,error='Source transcription provider unavailable' WHERE request_id=$1 AND status='processing' AND lease_token=$2 AND lease_until>clock_timestamp()",[row.request_id,row.lease_token]));},
    fail(row) {return run(client=>client.query("UPDATE source_audio_requests SET status=$3,lease_token=NULL,lease_until=NULL,retry_at=$4,error='Source transcription failed' WHERE request_id=$1 AND status='processing' AND lease_token=$2 AND lease_until>clock_timestamp()",[row.request_id,row.lease_token,row.attempts>=3?'failed':'received',row.attempts>=3?null:new Date(Date.now()+row.attempts*15000).toISOString()]));},
  };
}
export async function processOneSourceAudio(pool,adapter,storage,repository) {
  const metered=typeof adapter?.withJournal==='function'?{...adapter,async transcribe(bytes,mime,row){
    const operation=await domainTransaction(pool,repository?.schema ?? 'public',async client=>{
      if(!await dispatchAllowed(client,row.org_id,{provider:true}))throw Error('Provider dispatch paused');
      return reserveProviderOperation(client,{orgId:row.org_id,kind:'source-transcription',referenceId:row.request_id,claimToken:row.lease_token,
        model:adapter.model,dataClass:adapter.provenance.dataClass,maxRequests:adapter.provenance.dataClass==='real'?1:4,inputHash:sourceTranscriptionInputHash(row),provenance:adapter.transcriptionProvenance});
    });
    const result=await adapter.withJournal(providerRequestJournal(pool,operation,repository)).transcribe(bytes,mime);
    return {...result,providerOperationId:operation.id};
  }}:adapter;
  return processSourceAudioWithJournal(sourceAudioProcessingJournal(pool,repository),metered,storage);
}
