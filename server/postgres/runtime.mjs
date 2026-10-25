import { isAbsolute,resolve,relative } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { resolveAuthConfig } from '../auth.mjs';
import { assessAnswer } from '../domain.mjs';
import { createPostgresRehearsalServer } from './http.mjs';
import { verifyMigrations } from './migrate.mjs';
import {verifyRuntimePermissions} from './runtime-permissions.mjs';
import { processOnePreparation } from './preparation.mjs';
import { processOneInstructionSend } from './instructions.mjs';
import { processOneAssessment } from './assessment-worker.mjs';
import { processOneExport,expireExports } from './exports.mjs';
import { expireWorkerImports } from './worker-import.mjs';
import {processOneDeletionRedaction} from './deletion-redactions.mjs';
import {processOneDeletionPseudonym} from './deletion-pseudonyms.mjs';
import {processOneDeletionCompletion} from './deletion-completions.mjs';
import { expireStagedRecording } from './recordings.mjs';
import {expireGeneratedBundle} from './generated-audio.mjs';
import {resolveMailConfig} from '../auth-mail.mjs';
import {expireRecovery,processOneRecovery} from './account-recovery.mjs';
import {expireInvitations,processOneInvitation} from './invitations.mjs';
import {expireRegistrations,processOneRegistration} from './registration.mjs';
import {processOneAudioPurge} from './retention.mjs';
import {processOneTextPurge} from './text-retention.mjs';
import {processOneActivityPurge} from './activity-retention.mjs';
import {processOneBriefingContentPurge} from './briefing-retention.mjs';
import {processOneCaseContentPurge} from './case-retention.mjs';
import {retireOneGeneratedBundle} from './generated-retention.mjs';
import {processOneSourceAudioCleanup} from './source-audio-cleanup.mjs';
import {processOneSchedule} from './schedules.mjs';
import {processOneReminder} from './reminders.mjs';
import {processOneSourceAudio} from './source-audio-worker.mjs';
import {resolveSourceTranscription} from '../ai/source-transcription-config.mjs';
import {processOnePilot} from './pilot.mjs';
import {pilotDestination} from '../pilot-input.mjs';
import {randomUUID} from 'node:crypto';
import {recordWorkerPresence} from './worker-health.mjs';
import {resolveProviderVerification} from '../ai/provider-verification-config.mjs';
import {processStorageProbe} from './storage-health.mjs';
import {processOneCaseEscalation} from './case-routing.mjs';
import {expirePushSubscriptions,processOnePushDelivery,sweepOverdueAssignments} from './notification-events.mjs';
import {resolvePushAdapter} from '../push-adapter.mjs';
import {processOneCaseFollowup,processOneCaseFollowupPurge} from './case-followups.mjs';
import {resolveCaseFollowup} from '../ai/case-followup-config.mjs';
import {processOneCaseVoicePurge} from './case-voice.mjs';
import {resolveRecordingAdapter} from '../ai/recording-config.mjs';
import {processOneRecording} from './recording-worker.mjs';
import {resolvePreparationAdapter} from '../ai/preparation-config.mjs';
import {resolveAssessmentAdapter} from '../ai/assessment-config.mjs';
import {processOneProviderVerification} from './provider-verification-worker.mjs';
import {startWorkerHeartbeat} from './worker-heartbeat.mjs';

export function rehearsalConfig(env=process.env) {
  const config=resolveAuthConfig({tier:env.UNDERSTOOD_TIER,aiMode:env.UNDERSTOOD_AI_MODE,
    accessMode:env.UNDERSTOOD_ACCESS_MODE,publicOrigin:env.UNDERSTOOD_PUBLIC_ORIGIN});
  const schema=env.UNDERSTOOD_POSTGRES_SCHEMA;
  if (config.accessMode!=='credential' || env.UNDERSTOOD_DATA_CLASS!=='synthetic'
    || !/^understood_test_[a-z0-9_]{1,47}$/.test(schema || '')) throw new Error('Use an explicitly isolated synthetic PostgreSQL rehearsal');
  const port=Number(env.UNDERSTOOD_REHEARSAL_PORT || 3031);
  if (!Number.isInteger(port) || port<1024 || port>65535) throw new Error('Invalid rehearsal port');
  const root=env.UNDERSTOOD_REHEARSAL_AUDIO_ROOT;
  if (!root || !isAbsolute(root)) throw new Error('Set an absolute isolated rehearsal audio directory');
  const audioRoot=resolve(root),defaultRoot=resolve('data/private-audio');
  const contains=(parent,child) => {const path=relative(parent,child);return path==='' || (!path.startsWith('..') && !isAbsolute(path));};
  if (contains(defaultRoot,audioRoot) || contains(audioRoot,defaultRoot)) throw new Error('Rehearsal storage must not overlap the default audio directory');
  const mail=resolveMailConfig({mode:env.UNDERSTOOD_EMAIL_MODE ?? 'disabled',apiKey:env.UNDERSTOOD_RESEND_KEY,
    from:env.UNDERSTOOD_EMAIL_FROM,key:env.UNDERSTOOD_AUTH_MAIL_KEY,publicOrigin:config.publicOrigin,allowLocal:true});
  if(env.UNDERSTOOD_OPERATOR_ACCESS!==undefined && !['true','false'].includes(env.UNDERSTOOD_OPERATOR_ACCESS))throw Error('Invalid operator access setting');
  if(env.UNDERSTOOD_STORAGE_CHECKS!==undefined && !['true','false'].includes(env.UNDERSTOOD_STORAGE_CHECKS))throw Error('Invalid storage health setting');
  return {...config,schema,port,audioRoot,dataClass:'synthetic',integrationMode:'synthetic',mail,storageChecks:env.UNDERSTOOD_STORAGE_CHECKS==='true',operatorAccess:env.UNDERSTOOD_OPERATOR_ACCESS==='true',sourceAdapter:resolveSourceTranscription(env),caseFollowupAdapter:resolveCaseFollowup(env),recordingAdapter:resolveRecordingAdapter(env),preparationAdapter:resolvePreparationAdapter(env),assessmentAdapter:resolveAssessmentAdapter(env),providerVerification:resolveProviderVerification(env)};
}

export const syntheticAssessmentAdapter={
  async assess(answer,question,facts) {
    if (facts?.join('|')!=='finished -> blue shelf|unfinished -> yellow shelf' || typeof question!=='string')
      return {outcome:'unassessable',reasons:['unsupported_synthetic_rubric'],evidence:[]};
    const result=assessAnswer(answer);
    if (result.outcome==='matched' && answer.length>300)
      return {outcome:'unassessable',reasons:['synthetic_evidence_limit'],evidence:[]};
    return {...result,evidence:result.outcome==='matched' ? facts.map((_,factIndex) => ({factIndex,quote:answer})) : []};
  },
};

export function rehearsalTasks(pool,storage,config,{verificationSignal}={}) {
  const options={schema:config.schema,integrationMode:'synthetic'};
  return {
    storageProbe:()=>processStorageProbe(pool,storage,{...options,adapter:config.storageAdapter ?? 'local',enabled:config.storageChecks ?? false}),
    providerVerification:()=>config.runtimeRoleProfile==='application'?false:processOneProviderVerification(pool,config.providerVerification,{...options,signal:verificationSignal}),
    preparation:() => processOnePreparation(pool,{...options,...(config.preparationAdapter ? {adapter:config.preparationAdapter,storage,languages:config.preparationLanguages} : {})}),
    instructionSend:() => processOneInstructionSend(pool,options),
    sourceTranscription:() => processOneSourceAudio(pool,config.sourceAdapter,storage,options),
    publicationSchedule:() => processOneSchedule(pool,{...options,storage}),
    assignmentReminder:() => processOneReminder(pool,options),
    notificationSweep:() => sweepOverdueAssignments(pool,options),
    pushExpiry:() => expirePushSubscriptions(pool,options),
    pushDelivery:() => processOnePushDelivery(pool,config.pushAdapter ?? resolvePushAdapter(),options),
    caseEscalation:() => processOneCaseEscalation(pool,options),
    caseFollowup:()=>config.caseFollowupAdapter?processOneCaseFollowup(pool,config.caseFollowupAdapter,storage,{...options,dataClass:config.dataClass}):false,
    caseFollowupRetention:()=>processOneCaseFollowupPurge(pool,storage,options),
    caseVoiceRetention:()=>processOneCaseVoicePurge(pool,storage,options),
    assessment:() => processOneAssessment(pool,config.assessmentAdapter ?? syntheticAssessmentAdapter,options),
    recording:() => config.recordingAdapter?processOneRecording(pool,config.recordingAdapter,storage,options):false,
    export:() => processOneExport(pool,options),
    stagedAudio:() => expireStagedRecording(pool,storage,options),
    audioRetention:() => processOneAudioPurge(pool,storage,options),
    responseTextRetention:() => processOneTextPurge(pool,options),
    activityRetention:() => processOneActivityPurge(pool,options),
    briefingContentRetention:() => processOneBriefingContentPurge(pool,options),
    recordingTextRetention:() => processOneTextPurge(pool,{...options,kind:'recording'}),
    caseContentRetention:() => processOneCaseContentPurge(pool,options),
    sourceAudioRetention:() => processOneSourceAudioCleanup(pool,storage,options),
    generatedAudioExpiry:() => expireGeneratedBundle(pool,storage,options),
    generatedAudioRetention:() => retireOneGeneratedBundle(pool,options),
    importExpiry:() => expireWorkerImports(pool,options),
    exportExpiry:() => expireExports(pool,options),
    deletionRedaction:() => processOneDeletionRedaction(pool,options),
    deletionPseudonym:() => processOneDeletionPseudonym(pool,options),
    deletionCompletion:() => processOneDeletionCompletion(pool,storage,options),
    recoveryExpiry:() => expireRecovery(pool,options),
    recoveryMail:() => processOneRecovery(pool,config.mail ?? {available:false},options),
    invitationExpiry:() => expireInvitations(pool,options),
    invitationMail:() => processOneInvitation(pool,config.mail ?? {available:false},options),
    registrationExpiry:() => expireRegistrations(pool,options),
    registrationMail:() => processOneRegistration(pool,config.mail ?? {available:false},options),
    pilotMail:() => processOnePilot(pool,config.mail ?? {available:false},{...options,destination:pilotDestination(config.pilotDestination)}),
  };
}

// One awaited task per stage keeps a busy preparation queue from starving expiry or exports.
export async function runWorkerCycle(tasks,{signal,onError=() => {},onStage}={}) {
  const results={};
  for (const [name,task] of Object.entries(tasks)) {
    if (signal?.aborted) break;
    if(onStage)await onStage(name);
    if(signal?.aborted)break;
    try {results[name]=await task();} catch {results[name]=null;onError(name);}
  }
  return results;
}

export async function runRehearsalWorker(pool,storage,config,{signal,intervalMs=750,heartbeatIntervalMs=5000,onError=() => {}}={}) {
  if(config.runtimePermissionsRequired===true)await verifyRuntimePermissions(pool,{schema:config.schema,profile:config.runtimeRoleProfile ?? 'application'});
  const fault=new AbortController(),loopSignal=signal?AbortSignal.any([signal,fault.signal]):fault.signal;
  const tasks=rehearsalTasks(pool,storage,config,{verificationSignal:fault.signal}),id=randomUUID();
  const failures=new Map();let failureVersion=0,presence={state:'idle',stage:null},heartbeat,stopFailed=false;
  const failed=stage=>{failures.set(stage,++failureVersion);onError(stage);};
  const publish=async snapshot=>{
    const observed=new Map(failures);
    await recordWorkerPresence(pool,id,snapshot,config);
    for(const [stage,version] of observed)if(failures.get(stage)===version)failures.delete(stage);
  };
  const snapshot=()=>({...presence,failures:[...failures.keys()]});
  try {
    if(!loopSignal.aborted)heartbeat=await startWorkerHeartbeat(publish,snapshot,{intervalMs:heartbeatIntervalMs,onFailure:()=>{
      fault.abort();failed('workerHealth');
    }});
    while (!loopSignal.aborted) {
      await runWorkerCycle(tasks,{signal:loopSignal,onStage:stage=>{heartbeat.assertHealthy();presence={state:'busy',stage};},onError:failed});
      presence={state:'idle',stage:null};heartbeat.assertHealthy();
      try {await sleep(intervalMs,undefined,{signal:loopSignal});}
      catch(error) {if(error.name!=='AbortError') throw error;}
    }
    heartbeat?.assertHealthy();
  }finally{
    const stopped=()=>({state:'stopped',stage:null,failures:[...failures.keys()]});
    try{if(heartbeat)await heartbeat.stop(stopped);else await publish(stopped());}catch{stopFailed=true;onError('workerHealth');}
  }
  if(fault.signal.aborted)throw Error('Worker heartbeat unavailable');
  if(stopFailed)throw Error('Worker heartbeat stop unavailable');
}

export async function startRehearsalApi(pool,storage,config) {
  await verifyMigrations(pool,{schema:config.schema});
  const server=createPostgresRehearsalServer(pool,{...config,storage});
  server.headersTimeout=15000;
  server.requestTimeout=30000;
  await new Promise((done,reject) => {
    server.once('error',reject);
    server.listen(config.port,'127.0.0.1',() => {server.off('error',reject);done();});
  });
  return server;
}
