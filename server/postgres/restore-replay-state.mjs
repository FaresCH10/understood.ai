import {createHash} from 'node:crypto';
import {bundleHash} from '../ai/prepared-bundle.mjs';
import {databaseInventory,privateObjectInventory} from './backup.mjs';
import {validateDatabaseInventory} from './source-inventory.mjs';

export const replayOperations=['deletions','policies','activity','briefings','retirements','restrictions'];
export const restoreStateHash=state=>createHash('sha256').update(JSON.stringify(state)).digest('hex');
const digest=value=>typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
const auditTables=['audit','operational_audit_receipts'];
const allowed={
  deletions:['staff','workers','worker_deletion_requests','worker_grants','worker_credentials','worker_setup_tokens','sessions','recordings','assessment_jobs'],
  policies:['staff',...['retention','text_retention','case_retention','generated_retention','activity_retention','briefing_retention'].flatMap(name=>[`${name}_policies`,`${name}_requests`])],
  activity:['restore_activity_redactions','activity_identity_purges'],
  briefings:['restore_briefing_redactions','briefing_content_purges','briefing_content_origins','briefings','publications','draft_reviews','briefing_review_requests','briefing_regeneration_requests','generated_bundles','briefing_copies','source_audio_requests'],
  restrictions:['restore_access_restrictions','staff','staff_access_requests','staff_access_revisions','workers','worker_grants','worker_credentials','worker_setup_tokens','sessions','site_access_requests','site_lifecycle_requests','site_access_controls','site_lifecycle','staff_accounts'],
  retirements:['restore_privacy_retirements','text_retention_purges','case_content_purges','generated_audio_retirements','generated_bundles','recording_purges','source_audio_purges','recordings','assessment_jobs','attempts','report_exports','clarifications','help_requests','case_messages','case_reviews','case_followups','case_followup_audio','case_voice'],
};

export function validateRestoreReplayState(state,{baseline,targetIdentitySha256}){
  if(!state || !['understood-restore-quarantine-state-v1','understood-restore-replay-state-v1','understood-restore-cleanup-state-v1'].includes(state.format)
    || state.backupId!==baseline.id || !digest(state.targetIdentitySha256) || state.targetIdentitySha256!==targetIdentitySha256
    || state.activationAllowed!==false || state.productionReady!==false || !Number.isFinite(Date.parse(state.capturedAt))
    || !Array.isArray(state.objects) || state.objects.length>50000 || Buffer.byteLength(JSON.stringify(state))>16*1024*1024)
    throw Error('Invalid restore predecessor state or target binding');
  validateDatabaseInventory(state.database);
  if(state.format==='understood-restore-quarantine-state-v1'){
    if(state.operation!=='backup.restore.quarantined' || state.baselineInventorySha256!==restoreStateHash({database:baseline.database,objects:baseline.objects}))
      throw Error('Restore quarantine baseline binding unavailable');
  }else{
    if(!digest(state.predecessorStateSha256) || !digest(state.ledgerFingerprint)
      || typeof state.ledgerId!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(state.ledgerId))throw Error('Invalid replay checkpoint binding');
    if(state.format==='understood-restore-replay-state-v1' && !replayOperations.includes(state.operation))throw Error('Invalid replay operation');
    if(state.format==='understood-restore-cleanup-state-v1' && (state.immutableInputsVerified!==true || !['database','removal'].includes(state.kind)
      || typeof state.stage!=='string' || !/^[a-zA-Z]{1,30}$/.test(state.stage) || typeof state.transitionId!=='string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(state.transitionId)
      || !Array.isArray(state.removedObjects) || state.removedObjects.length>50000
      || new Set(state.removedObjects.map(row=>row?.id)).size!==state.removedObjects.length
      || state.removedObjects.some(row=>!row || row.retained!==false || !state.objects.some(object=>bundleHash(row)===bundleHash(object)))))
      throw Error('Invalid cleanup checkpoint binding');
  }
  return state;
}

export async function requireRestorePredecessor(client,state,before,baseline){
  if(bundleHash({database:state.database,objects:state.objects})!==bundleHash(before))throw Error('Restore target differs from the authenticated predecessor state');
  if(state.format==='understood-restore-replay-state-v1'){
    const sites=(await client.query('SELECT id,org_id FROM sites')).rows;
    const rows=(await client.query(`SELECT org_id,site_id,object_id FROM operational_audit_receipts
      WHERE action=$1 AND actor_type='system' AND actor_id='restore-operator' AND object_id=$2`,
      [`backup.restore.privacy.${state.operation}`,`${baseline.id}:${state.ledgerId}:${state.ledgerFingerprint}`])).rows;
    if(!sites.length || rows.length!==sites.length || sites.some(site=>!rows.some(row=>row.site_id===site.id && row.org_id===site.org_id)))
      throw Error('Replay checkpoint has no complete committed audit receipt');
  }
  if(state.format==='understood-restore-cleanup-state-v1' && state.kind==='database'){
    const sites=(await client.query('SELECT id,org_id FROM sites')).rows;
    const rows=(await client.query(`SELECT org_id,site_id FROM operational_audit_receipts WHERE action='backup.restore.cleanup.transition'
      AND actor_type='system' AND actor_id='restore-operator' AND object_id=$1`,[`${baseline.id}:${state.transitionId}:${state.stage}`])).rows;
    if(!sites.length || rows.length!==sites.length || sites.some(site=>!rows.some(row=>row.site_id===site.id && row.org_id===site.org_id)))
      throw Error('Cleanup checkpoint has no complete committed audit receipt');
  }
}

export async function captureRestoreReplayState(client,{before,predecessor,baseline,ledger,operation,duplicate}){
  await client.query('SET CONSTRAINTS ALL IMMEDIATE');
  const after={database:await databaseInventory(client,baseline.schema),objects:await privateObjectInventory(client)};
  const writable=new Set(duplicate?[]:[...auditTables,...allowed[operation]]);
  if(!allowed[operation] || before.database.definitionsSha256!==after.database.definitionsSha256
    || bundleHash(before.database.sequences)!==bundleHash(after.database.sequences)
    || before.database.tables.length!==after.database.tables.length
    || before.database.tables.some((row,index)=>row.name!==after.database.tables[index]?.name
      || !writable.has(row.name) && bundleHash(row)!==bundleHash(after.database.tables[index])))
    throw Error('Privacy replay changed an unaccounted database surface');
  const sourceObjects=new Map(ledger.objects.map(row=>[row.id,row]));
  if(before.objects.length!==after.objects.length || before.objects.some((row,index)=>{
    const next=after.objects[index],{retained,...identity}=row,{retained:nextRetained,...nextIdentity}=next??{};
    return bundleHash(identity)!==bundleHash(nextIdentity) || retained!==nextRetained
      && (duplicate || retained!==true || nextRetained!==false || sourceObjects.get(row.id)?.retained!==false);
  }))throw Error('Privacy replay changed an unaccounted private reference');
  if(duplicate){
    if(predecessor.format!=='understood-restore-replay-state-v1' || predecessor.operation!==operation
      || predecessor.ledgerId!==ledger.id || predecessor.ledgerFingerprint!==bundleHash(ledger))
      throw Error('Duplicate replay requires its exact committed checkpoint');
    return predecessor;
  }
  const capturedAt=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
  return {format:'understood-restore-replay-state-v1',backupId:baseline.id,targetIdentitySha256:predecessor.targetIdentitySha256,
    capturedAt:new Date(capturedAt).toISOString(),predecessorStateSha256:restoreStateHash(predecessor),ledgerId:ledger.id,
    ledgerFingerprint:bundleHash(ledger),operation,...after,activationAllowed:false,productionReady:false};
}
