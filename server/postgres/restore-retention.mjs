import {createHash,randomUUID} from 'node:crypto';
import {schemaName,verifyMigrations} from './migrate.mjs';
import {withTransaction,acquirePostgresClient,assertPostgresClientHealthy} from './db.mjs';
import {backupTables,privateObjectInventory} from './backup.mjs';
import {processOneAudioPurge} from './retention.mjs';
import {processOneTextPurge} from './text-retention.mjs';
import {activityRetentionDue,processOneActivityPurge} from './activity-retention.mjs';
import {briefingContentRetentionDue,processOneBriefingContentPurge} from './briefing-retention.mjs';
import {caseContentRetentionDue,processOneCaseContentPurge} from './case-retention.mjs';
import {retireOneGeneratedBundle} from './generated-retention.mjs';
import {processOneSourceAudioCleanup} from './source-audio-cleanup.mjs';
import {expireGeneratedBundle} from './generated-audio.mjs';
import {expireStagedRecording} from './recordings.mjs';
import {processOneCaseFollowupPurge} from './case-followups.mjs';
import {processOneCaseVoicePurge} from './case-voice.mjs';
import {processOneDeletionRedaction} from './deletion-redactions.mjs';
import {processOneDeletionPseudonym} from './deletion-pseudonyms.mjs';
import {processOneDeletionCompletion} from './deletion-completions.mjs';
import {expireExports} from './exports.mjs';
import {deletionExportExpiry} from '../exports.mjs';
import {expireWorkerImports} from './worker-import.mjs';

const uuid=value=>typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
async function scope(client,schema){
  await client.query("SELECT set_config('search_path',quote_ident($1)||',pg_catalog',true)",[schemaName(schema)]);
}

export async function requireQuarantine(client,backupId){
  const control=(await client.query("SELECT jobs_paused,provider_paused FROM system_controls WHERE id='global' FOR SHARE")).rows[0];
  if(!control?.jobs_paused || !control?.provider_paused)throw Error('Restore dispatch quarantine required');
  const denied=(await client.query(`SELECT EXISTS(SELECT 1 FROM organizations o LEFT JOIN tenant_controls t ON t.org_id=o.id WHERE t.state IS DISTINCT FROM 'suspended')
    OR EXISTS(SELECT 1 FROM sessions WHERE revoked_at IS NULL) OR EXISTS(SELECT 1 FROM worker_grants WHERE revoked_at IS NULL)
    OR EXISTS(SELECT 1 FROM worker_credentials) OR EXISTS(SELECT 1 FROM worker_setup_tokens WHERE revoked_at IS NULL AND used_at IS NULL)
    OR EXISTS(SELECT 1 FROM operator_sessions WHERE revoked_at IS NULL)
    OR EXISTS(SELECT 1 FROM staff_accounts WHERE active=true)
    OR EXISTS(SELECT 1 FROM platform_operators WHERE active=true)
    OR EXISTS(SELECT 1 FROM staff_recovery_tokens WHERE revoked_at IS NULL AND used_at IS NULL)
    OR EXISTS(SELECT 1 FROM staff_invitation_tokens WHERE revoked_at IS NULL AND used_at IS NULL)
    OR EXISTS(SELECT 1 FROM staff_invitations WHERE state='pending')
    OR EXISTS(SELECT 1 FROM staff_recovery_mail WHERE state IN ('queued','processing'))
    OR EXISTS(SELECT 1 FROM staff_invitation_mail WHERE state IN ('queued','processing'))
    OR EXISTS(SELECT 1 FROM pilot_inquiries WHERE state IN ('saved','queued','processing'))
    OR EXISTS(SELECT 1 FROM provider_policies WHERE enabled)
    OR EXISTS(SELECT 1 FROM provider_requests WHERE state='started')
    OR EXISTS(SELECT 1 FROM provider_verifications WHERE state='pending')
    OR EXISTS(SELECT 1 FROM worker_health WHERE state<>'stopped' AND seen_at>clock_timestamp()-interval '2 minutes')
    OR EXISTS(SELECT 1 FROM sites s WHERE NOT EXISTS(SELECT 1 FROM operational_audit_receipts a WHERE a.org_id=s.org_id AND a.site_id=s.id
      AND a.actor_type='system' AND a.actor_id='restore-operator' AND a.action='backup.restore.quarantined' AND a.object_id=$1)) AS denied`,[backupId])).rows[0].denied;
  if(denied)throw Error('Restored access or dispatch is not quarantined');
}

const pendingQueries={
  briefingContent:`SELECT b.id FROM briefings b JOIN briefing_retention_policies p ON p.org_id=b.org_id AND p.site_id=b.site_id WHERE ${briefingContentRetentionDue}`,
  activityIdentity:`SELECT e.id FROM audit e JOIN activity_retention_policies p ON p.org_id=e.org_id AND p.site_id=e.site_id WHERE ${activityRetentionDue}`,
  recordingAudio:`SELECT r.id FROM recordings r JOIN assignments a ON a.id=r.assignment_id
    LEFT JOIN retention_policies p ON p.org_id=r.org_id AND p.site_id=r.site_id LEFT JOIN recording_purges d ON d.recording_id=r.id
    WHERE (d.recording_id IS NOT NULL AND d.status<>'complete') OR (d.recording_id IS NULL AND r.status<>'storing'
      AND (r.received_at<=clock_timestamp()-p.audio_days*interval '1 day' OR EXISTS(SELECT 1 FROM worker_deletion_requests x WHERE x.worker_id=a.worker_id)))`,
  stagedRecording:`SELECT id FROM recordings WHERE status='storing' AND received_at IS NULL`,
  sourceAudio:`SELECT s.request_id FROM source_audio_requests s LEFT JOIN source_audio_purges d ON d.request_id=s.request_id
    LEFT JOIN retention_policies p ON p.org_id=s.org_id AND p.site_id=s.site_id WHERE (d.request_id IS NOT NULL AND d.status<>'complete')
    OR (d.request_id IS NULL AND ((s.received_at IS NULL AND s.created_at<=clock_timestamp()-interval '1 day')
      OR s.received_at<=clock_timestamp()-p.audio_days*interval '1 day'))`,
  attemptText:`SELECT r.id FROM attempts r JOIN text_retention_policies p ON p.org_id=r.org_id AND p.site_id=r.site_id
    WHERE r.received_at<=clock_timestamp()-p.days*interval '1 day'
    AND NOT EXISTS(SELECT 1 FROM text_retention_purges d WHERE d.kind='attempt' AND d.reference_id=r.id)`,
  recordingText:`SELECT r.id FROM recordings r JOIN text_retention_policies p ON p.org_id=r.org_id AND p.site_id=r.site_id
    WHERE r.received_at<=clock_timestamp()-p.days*interval '1 day'
    AND NOT EXISTS(SELECT 1 FROM text_retention_purges d WHERE d.kind='recording' AND d.reference_id=r.id)`,
  resolvedCaseText:`SELECT c.id FROM clarifications c JOIN case_retention_policies p ON p.org_id=c.org_id AND p.site_id=c.site_id WHERE ${caseContentRetentionDue}`,
  generatedAudio:`SELECT b.id FROM generated_bundles b LEFT JOIN generated_retention_policies p ON p.org_id=b.org_id AND p.site_id=b.site_id
    LEFT JOIN generated_audio_retirements t ON t.bundle_id=b.id WHERE b.state='cleaning'
    OR (b.state='attached' AND b.stored_at<=clock_timestamp()-p.days*interval '1 day')
    OR (b.state IN ('storing','stored') AND b.expires_at<=clock_timestamp())
    OR (t.bundle_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM generated_audio_removals m WHERE m.bundle_id=b.id))`,
  followupAudio:`SELECT a.id FROM case_followup_audio a JOIN case_followups f ON f.id=a.request_id
    LEFT JOIN retention_policies p ON p.org_id=f.org_id AND p.site_id=f.site_id WHERE a.state<>'cleaned'
    AND (a.state='cleaning' OR (a.state='storing' AND (a.expires_at<=clock_timestamp() OR f.status='failed'))
      OR a.state='attached' AND f.delivered_at<=clock_timestamp()-p.audio_days*interval '1 day'
      OR EXISTS(SELECT 1 FROM case_content_purges d WHERE d.case_id=f.case_id)
      OR EXISTS(SELECT 1 FROM worker_deletion_requests d JOIN assignments x ON x.worker_id=d.worker_id WHERE x.id=f.assignment_id))`,
  caseVoice:`SELECT v.id FROM case_voice v LEFT JOIN retention_policies p ON p.org_id=v.org_id AND p.site_id=v.site_id
    WHERE v.cleanup_state='cleaning' OR (v.cleanup_state='active' AND (v.status='failed' OR v.status='storing'
      OR v.received_at<=clock_timestamp()-p.audio_days*interval '1 day'
      OR EXISTS(SELECT 1 FROM worker_deletion_requests d WHERE d.worker_id=v.worker_id)
      OR EXISTS(SELECT 1 FROM case_content_purges d WHERE d.case_id=v.requested_case_id)))`,
  workerDeletion:`SELECT d.id FROM worker_deletion_requests d WHERE NOT EXISTS(SELECT 1 FROM worker_deletion_completions c WHERE c.request_id=d.id)`,
  exports:`SELECT e.id FROM report_exports e WHERE e.status<>'expired' AND (e.expires_at<=clock_timestamp() OR ${deletionExportExpiry})`,
  imports:`SELECT id FROM worker_imports WHERE status<>'expired' AND expires_at<=clock_timestamp()`,
};

// Snapshot counts include deferred retry/cleanup leases, not just immediately claimable jobs.
export async function restoredRetentionState(pool,storage,{schema='public',backupId}={}){
  schemaName(schema);if(!uuid(backupId))throw Error('Invalid restore identity');
  if(typeof storage?.exists!=='function' || typeof storage.existsOriginal!=='function')throw Error('Restore object absence verification unavailable');
  return withTransaction(pool,async client=>{
    await scope(client,schema);await client.query("SET LOCAL lock_timeout='5s'");
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`understood:migrations:${schema}`]);
    const tables=await backupTables(client,schema);
    if(!tables.some(row=>row.name==='schema_migrations'))throw Error('Restored application schema unavailable');
    await client.query(`LOCK TABLE ${tables.map(row=>row.identifier).join(',')} IN SHARE MODE`);
    await requireQuarantine(client,backupId);
    const pending={};
    for(const [name,query] of Object.entries(pendingQueries))pending[name]=(await client.query(`SELECT count(*)::integer AS n FROM (${query}) due`)).rows[0].n;
    pending.activeLeases=0;
    for(const lease of (await client.query(`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1
      AND column_name IN ('lease_until','cleanup_until') ORDER BY table_name,column_name`,[schema])).rows){
      const table=tables.find(row=>row.name===lease.table_name);
      if(table)pending.activeLeases+=(await client.query(`SELECT count(*)::integer AS n FROM ${table.identifier} WHERE ${lease.column_name}>clock_timestamp()`)).rows[0].n;
    }
    let unverifiedObjects=0,retiredObjects=0,retainedObjects=0,unverifiedRetainedObjects=0;
    for(const reference of await privateObjectInventory(client)){
      if(!reference.retained){
        retiredObjects++;
        try{
          const exists=reference.format==='original'?await storage.existsOriginal(reference):await storage.exists(reference);
          if(exists!==false)unverifiedObjects++;
        }catch{unverifiedObjects++;}
      }else{
        retainedObjects++;
        try{
          const bytes=await (reference.format==='original'?storage.readOriginal(reference):storage.read(reference));
          if(bytes.length!==reference.bytes || createHash('sha256').update(bytes).digest('hex')!==reference.sha256)unverifiedRetainedObjects++;
        }catch{unverifiedRetainedObjects++;}
      }
    }
    const pendingCount=Object.values(pending).reduce((n,count)=>n+count,0);
    return {pending,pendingCount,retiredObjects,unverifiedObjects,retainedObjects,unverifiedRetainedObjects,
      elapsedPoliciesReconciled:pendingCount===0 && unverifiedObjects===0 && unverifiedRetainedObjects===0,
      authoritativePrivacyReconciliation:'required',activationAllowed:false,productionReady:false};
  });
}

export async function sweepRestoredRetention(pool,storage,{schema='public',backupId,isolatedTarget=false,writersStopped=false,maxCycles=100,maxMilliseconds=120000,accountingFactory}={}){
  if(isolatedTarget!==true || writersStopped!==true)throw Error('Restore cleanup requires a stopped isolated target');
  schemaName(schema);if(!uuid(backupId))throw Error('Invalid restore identity');
  if(!Number.isInteger(maxCycles) || maxCycles<1 || maxCycles>1000 || !Number.isInteger(maxMilliseconds) || maxMilliseconds<1 || maxMilliseconds>1800000)
    throw Error('Invalid restore cleanup bounds');
  if(typeof storage?.remove!=='function' || typeof storage.removeOriginal!=='function')throw Error('Restore private storage unavailable');
  await verifyMigrations(pool,{schema});
  const lock=await acquirePostgresClient(pool),lockName=`understood:restore-retention:${schema}`;
  let owned=false;
  try{
    owned=(await lock.query('SELECT pg_try_advisory_lock(hashtext($1)) AS owned',[lockName])).rows[0].owned;
    if(!owned)throw Error('Restore cleanup is already running');
    const accounting=accountingFactory?await accountingFactory():null;
    const options={schema},tasks={
      stagedRecording:(p,s)=>expireStagedRecording(p,s,options),
      recordingAudio:(p,s)=>processOneAudioPurge(p,s,options),
      sourceAudio:(p,s)=>processOneSourceAudioCleanup(p,s,options),
      attemptText:p=>processOneTextPurge(p,options),
      activityIdentity:p=>processOneActivityPurge(p,options),
      briefingContent:p=>processOneBriefingContentPurge(p,options),
      recordingText:p=>processOneTextPurge(p,{...options,kind:'recording'}),
      resolvedCaseText:p=>processOneCaseContentPurge(p,options),
      generatedRetirement:p=>retireOneGeneratedBundle(p,options),
      generatedAudio:(p,s)=>expireGeneratedBundle(p,s,options),
      followupAudio:(p,s)=>processOneCaseFollowupPurge(p,s,options),
      caseVoice:(p,s)=>processOneCaseVoicePurge(p,s,options),
      exports:p=>expireExports(p,options),
      imports:p=>expireWorkerImports(p,options),
      deletionRedaction:p=>processOneDeletionRedaction(p,options),
      deletionPseudonym:p=>processOneDeletionPseudonym(p,options),
      deletionCompletion:(p,s)=>processOneDeletionCompletion(p,s,options),
    };
    const started=Date.now(),work=Object.fromEntries(Object.keys(tasks).map(name=>[name,0])),errors=new Set();
    let state=await restoredRetentionState(pool,storage,{schema,backupId}),cycles=0,stop='waiting';
    while(!state.elapsedPoliciesReconciled && cycles<maxCycles && Date.now()-started<maxMilliseconds){
      let activity=false;cycles++;
      for(const [name,task] of Object.entries(tasks)){
        assertPostgresClientHealthy(lock);
        if(Date.now()-started>=maxMilliseconds)break;
        try{
          const result=accounting?await accounting.run(name,task):await task(pool,storage);
          if(result===true || typeof result==='number' && result>0){activity=true;work[name]+=result===true?1:result;}
        }catch{errors.add(name);}
        accounting?.assertHealthy();
        assertPostgresClientHealthy(lock);
      }
      state=await restoredRetentionState(pool,storage,{schema,backupId});
      if(!activity)break;
    }
    if(state.elapsedPoliciesReconciled && errors.size===0)stop='reconciled';
    else if(Date.now()-started>=maxMilliseconds || cycles>=maxCycles)stop='bounded';
    const completionAudit=p=>withTransaction(p,async client=>{
      await scope(client,schema);await requireQuarantine(client,backupId);
      for(const site of (await client.query('SELECT id,org_id FROM sites ORDER BY id')).rows)await client.query(`INSERT INTO audit(id,org_id,site_id,actor_type,actor_id,action,object_id)
        VALUES($1,$2,$3,'system','restore-operator','backup.restore.elapsed_policies_reconciled',$4)`,[randomUUID(),site.org_id,site.id,backupId]);
    });
    if(stop==='reconciled'){
      assertPostgresClientHealthy(lock);
      if(accounting)await accounting.run('completionAudit',completionAudit);else await completionAudit(pool);
    }
    const cleanupState=accounting?await accounting.verify():undefined;
    assertPostgresClientHealthy(lock);
    return {...state,elapsedPoliciesReconciled:stop==='reconciled',stop,cycles,work,failedStages:[...errors],
      ...(cleanupState?{cleanupState,accountedEvents:accounting.events}:{}),
      limitation:'Uses policies and deletion requests present in this restored database only. Authoritative post-backup requests, policy changes and retirement evidence must still be reconciled. No activation is performed.'};
  }finally{
    try{if(owned)await lock.query('SELECT pg_advisory_unlock(hashtext($1))',[lockName]);}finally{lock.release();}
  }
}
