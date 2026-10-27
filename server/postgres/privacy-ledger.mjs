import {isWorkerLanguage} from '../languages.mjs';
import {randomUUID} from 'node:crypto';
import {bundleHash} from '../ai/prepared-bundle.mjs';
import {withBackupSnapshot,backupTables,privateObjectInventory,databaseInventory} from './backup.mjs';
import {schemaName,verifyMigrations} from './migrate.mjs';
import {withTransaction} from './db.mjs';
import {requireQuarantine} from './restore-retention.mjs';
import {retentionInput} from '../retention-input.mjs';
import {textRetentionInput} from '../text-retention-input.mjs';
import {redactExpiredText} from './text-retention.mjs';
import {redactExpiredCase} from './case-retention.mjs';
import {staffChangeInput,staffRoles} from '../staff-input.mjs';
import {siteAccessInput} from '../site-input.mjs';
import {siteLifecycleInput} from '../site-lifecycle-input.mjs';
import {operatorControlInput} from '../operator-input.mjs';
import {validateBriefingExpiryOrigin,validBriefingContentProofs,briefingContentProofsMatch} from './briefing-expiry-origin.mjs';
import {redactExpiredBriefingContent} from './briefing-retention.mjs';
import {compareRestoreInputs} from './restore-input-lifecycle.mjs';
import {compareSourceSnapshot,validateDatabaseInventory} from './source-inventory.mjs';
import {validateRestoreReplayState,requireRestorePredecessor,captureRestoreReplayState} from './restore-replay-state.mjs';

export const PRIVACY_LEDGER_FORMAT='understood-postgres-privacy-ledger-v8';
const uuid=value=>typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const digest=value=>typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
const MAX_ROWS=50000,MAX_BYTES=16*1024*1024;

const receipts=[
  'worker_deletion_requests','worker_deletion_redactions','worker_deletion_pseudonyms','worker_deletion_completions',
  'recording_purges','source_audio_purges','text_retention_purges','case_content_purges','generated_audio_retirements','generated_audio_removals',
  'retention_requests','text_retention_requests','case_retention_requests','generated_retention_requests',
  'activity_retention_requests','briefing_retention_requests','activity_identity_purges','briefing_content_purges',
  'site_access_requests','site_lifecycle_requests','staff_access_requests',
];
const policies=['retention_policies','text_retention_policies','case_retention_policies','generated_retention_policies','activity_retention_policies','briefing_retention_policies'];
const policyContracts={
  retention_policies:{requests:'retention_requests',column:'audio_days',input:'audioDays',parse:retentionInput},
  text_retention_policies:{requests:'text_retention_requests',column:'days',input:'days',parse:textRetentionInput},
  case_retention_policies:{requests:'case_retention_requests',column:'days',input:'days',parse:textRetentionInput},
  generated_retention_policies:{requests:'generated_retention_requests',column:'days',input:'days',parse:textRetentionInput},
  activity_retention_policies:{requests:'activity_retention_requests',column:'days',input:'days',parse:textRetentionInput},
  briefing_retention_policies:{requests:'briefing_retention_requests',column:'days',input:'days',parse:textRetentionInput},
};
const definitions={
  ...Object.fromEntries([...receipts,...policies,'restore_briefing_redactions','restore_privacy_retirements','restore_activity_redactions','restore_access_restrictions','staff_accounts','staff_account_memberships','site_access_controls','site_lifecycle','tenant_controls'].map(name=>[name,`SELECT to_jsonb(t) AS row FROM ${name} t ORDER BY to_jsonb(t)::text COLLATE "C" LIMIT ${MAX_ROWS+1}`])),
  briefing_content_origins:`SELECT row FROM (SELECT to_jsonb(t) AS row FROM briefing_content_origins t UNION ALL
    SELECT source_origin_json AS row FROM restore_briefing_redactions) roots ORDER BY row::text COLLATE "C" LIMIT ${MAX_ROWS+1}`,
  schema_migrations:`SELECT to_jsonb(t) AS row FROM schema_migrations t ORDER BY version COLLATE "C" LIMIT ${MAX_ROWS+1}`,
  organizations:`SELECT jsonb_build_object('id',id) AS row FROM organizations ORDER BY id COLLATE "C" LIMIT ${MAX_ROWS+1}`,
  sites:`SELECT jsonb_build_object('id',id,'org_id',org_id) AS row FROM sites ORDER BY id COLLATE "C" LIMIT ${MAX_ROWS+1}`,
  staff:`SELECT jsonb_build_object('id',s.id,'org_id',s.org_id,'site_id',s.site_id,'role',s.role,'active',s.active,'access_revision',COALESCE(r.revision,1)) AS row
    FROM staff s LEFT JOIN staff_access_revisions r ON r.staff_id=s.id ORDER BY s.id COLLATE "C" LIMIT ${MAX_ROWS+1}`,
  staff_credentials:`SELECT jsonb_build_object('staff_id',staff_id,'email',email,'password_salt',password_salt,'password_hash',password_hash,'changed_at',changed_at) AS row
    FROM staff_credentials ORDER BY staff_id COLLATE "C" LIMIT ${MAX_ROWS+1}`,
  platform_operators:`SELECT jsonb_build_object('id',id,'email',email,'password_salt',password_salt,'password_hash',password_hash,'active',active,'revision',revision,'changed_at',changed_at) AS row
    FROM platform_operators ORDER BY id COLLATE "C" LIMIT ${MAX_ROWS+1}`,
  operator_requests:`SELECT to_jsonb(t) AS row FROM operator_requests t WHERE request_json->>'kind'='tenant' ORDER BY request_id COLLATE "C" LIMIT ${MAX_ROWS+1}`,
  access_audit:`SELECT to_jsonb(t) AS row FROM operational_audit_receipts t WHERE action IN ('worker.disabled','credential.recovered') ORDER BY id COLLATE "C" LIMIT ${MAX_ROWS+1}`,
  workers:`SELECT jsonb_build_object('id',id,'org_id',org_id,'site_id',site_id,'active',active) AS row FROM workers ORDER BY id COLLATE "C" LIMIT ${MAX_ROWS+1}`,
  audit_activity:`SELECT jsonb_build_object('id',id,'org_id',org_id,'site_id',site_id,'actor_type',actor_type,'action',action,'occurred_at',occurred_at,
    'identities_cleared',actor_id='' AND object_id='') AS row FROM audit ORDER BY id COLLATE "C" LIMIT ${MAX_ROWS+1}`,
  briefings:`SELECT jsonb_build_object('id',b.id,'org_id',b.org_id,'site_id',b.site_id,'content_proofs',briefing_content_proofs(b.id,b.org_id,b.site_id),'content_expired',EXISTS(
    SELECT 1 FROM briefing_content_purges p WHERE p.briefing_id=b.id AND p.org_id=b.org_id AND p.site_id=b.site_id)) AS row
    FROM briefings b ORDER BY b.id COLLATE "C" LIMIT ${MAX_ROWS+1}`,
  publications:`SELECT jsonb_build_object('id',id,'org_id',org_id,'site_id',site_id,'briefing_id',briefing_id,'version',version,'snapshot_json',snapshot_json) AS row
    FROM publications ORDER BY id COLLATE "C" LIMIT ${MAX_ROWS+1}`,
  assignments:`SELECT jsonb_build_object('id',id,'org_id',org_id,'site_id',site_id,'publication_id',publication_id,'worker_id',worker_id,'language',language) AS row
    FROM assignments ORDER BY id COLLATE "C" LIMIT ${MAX_ROWS+1}`,
  submission_receipts:`SELECT jsonb_build_object('sequence',r.sequence::text,'org_id',r.org_id,'site_id',a.site_id,'assignment_id',r.assignment_id,
    'submission_id',r.submission_id,'kind',r.kind,'received_at',r.received_at) AS row FROM submission_receipts r JOIN assignments a ON a.id=r.assignment_id
    ORDER BY r.sequence LIMIT ${MAX_ROWS+1}`,
  attempts:`SELECT jsonb_build_object('id',id,'org_id',org_id,'site_id',site_id,'assignment_id',assignment_id,'submission_id',submission_id,'received_at',received_at,
    'answer_text',answer_text,'result_json',jsonb_build_object('outcome',outcome,'assessment_status',assessment_status,'reasons',reasons_json,'evidence',evidence_json),
    'redacted',answer_text IN ('[Deleted]','[Expired]'),'reasons_cleared',reasons_json='[]'::jsonb,'evidence_cleared',evidence_json='[]'::jsonb) AS row
    FROM attempts ORDER BY id COLLATE "C" LIMIT ${MAX_ROWS+1}`,
  recordings:`SELECT jsonb_build_object('id',id,'org_id',org_id,'site_id',site_id,'assignment_id',assignment_id,'submission_id',submission_id,'received_at',received_at,
    'sha256',sha256,'bytes',bytes,'status',status,'transcript',transcript,'transcript_cleared',transcript IS NULL) AS row FROM recordings ORDER BY id COLLATE "C" LIMIT ${MAX_ROWS+1}`,
  clarifications:`SELECT jsonb_build_object('id',id,'org_id',org_id,'site_id',site_id,'assignment_id',assignment_id,'attempt_id',attempt_id,'created_at',created_at,'status',status,'resolved_at',resolved_at,
    'redacted',reason IN ('[Deleted]','[Expired]'),'notes_cleared',notes='') AS row FROM clarifications ORDER BY id COLLATE "C" LIMIT ${MAX_ROWS+1}`,
  source_audio_requests:`SELECT jsonb_build_object('id',id,'request_id',request_id,'org_id',org_id,'site_id',site_id,'requested_by',requested_by,
    'sha256',sha256,'bytes',bytes,'original_id',original_id,'original_sha256',original_sha256,'original_bytes',original_bytes,'received_at',received_at,'briefing_id',briefing_id) AS row
    FROM source_audio_requests ORDER BY id COLLATE "C" LIMIT ${MAX_ROWS+1}`,
  generated_bundles:`SELECT jsonb_build_object('id',id,'org_id',org_id,'site_id',site_id,'briefing_id',briefing_id,'revision',revision,'manifest_hash',manifest_hash,
    'dependency_hash',dependency_hash,'state',state,'stored_at',stored_at) AS row FROM generated_bundles ORDER BY id LIMIT ${MAX_ROWS+1}`,
  generated_audio:`SELECT jsonb_build_object('id',id,'bundle_id',bundle_id,'org_id',org_id,'site_id',site_id,'language',language,'text_hash',text_hash,'sha256',sha256,'bytes',bytes) AS row
    FROM generated_audio ORDER BY id LIMIT ${MAX_ROWS+1}`,
  case_followups:`SELECT jsonb_build_object('id',id,'org_id',org_id,'site_id',site_id,'case_id',case_id,'assignment_id',assignment_id,'actor_id',actor_id,
    'request_hash',request_hash,'created_at',created_at,'delivered_at',delivered_at,'redacted',source_text IN ('[Deleted]','[Expired]'),'manifest_cleared',manifest_json IS NULL) AS row
    FROM case_followups ORDER BY id COLLATE "C" LIMIT ${MAX_ROWS+1}`,
  case_followup_audio:`SELECT jsonb_build_object('id',id,'request_id',request_id,'org_id',org_id,'site_id',site_id,'job_lease',job_lease,'language',language,'text_hash',text_hash,
    'sha256',sha256,'bytes',bytes,'created_at',created_at,'state',state) AS row FROM case_followup_audio ORDER BY id COLLATE "C" LIMIT ${MAX_ROWS+1}`,
  case_voice:`SELECT jsonb_build_object('id',id,'request_id',request_id,'org_id',org_id,'site_id',site_id,'assignment_id',assignment_id,'worker_id',worker_id,'requested_case_id',requested_case_id,
    'kind',kind,'actor_type',actor_type,'actor_id',actor_id,'actor_role',actor_role,'language',language,'created_at',created_at,'sha256',sha256,'bytes',bytes,'status',status,'cleanup_state',cleanup_state,'received_at',received_at) AS row FROM case_voice ORDER BY id COLLATE "C" LIMIT ${MAX_ROWS+1}`,
  help_requests:`SELECT jsonb_build_object('case_id',case_id,'org_id',org_id,'site_id',site_id,'assignment_id',assignment_id,'redacted',text IN ('[Deleted]','[Expired]')) AS row
    FROM help_requests ORDER BY case_id COLLATE "C" LIMIT ${MAX_ROWS+1}`,
  case_messages:`SELECT jsonb_build_object('id',id,'case_id',case_id,'org_id',org_id,'site_id',site_id,'assignment_id',assignment_id,'actor_id',actor_id,
    'request_hash',request_hash,'created_at',created_at,'redacted',text IN ('[Deleted]','[Expired]')) AS row FROM case_messages ORDER BY id COLLATE "C" LIMIT ${MAX_ROWS+1}`,
  case_reviews:`SELECT jsonb_build_object('id',id,'case_id',case_id,'org_id',org_id,'site_id',site_id,'assignment_id',assignment_id,'actor_id',actor_id,
    'kind',kind,'request_hash',request_hash,'created_at',created_at,'redacted',reason IN ('[Deleted]','[Expired]')) AS row FROM case_reviews ORDER BY id COLLATE "C" LIMIT ${MAX_ROWS+1}`,
  report_exports:`SELECT jsonb_build_object('id',id,'org_id',org_id,'site_id',site_id,'publication_id',publication_id,'requested_by',requested_by,'created_at',created_at,'status',status,'expires_at',expires_at,
    'payload_cleared',snapshot_json IS NULL AND csv IS NULL AND checksum IS NULL) AS row FROM report_exports ORDER BY id COLLATE "C" LIMIT ${MAX_ROWS+1}`,
  worker_imports:`SELECT jsonb_build_object('id',id,'org_id',org_id,'site_id',site_id,'requested_by',requested_by,'sha256',sha256,'created_at',created_at,'status',status,'expires_at',expires_at,'payload_cleared',rows_json IS NULL AND errors_json IS NULL) AS row
    FROM worker_imports ORDER BY id COLLATE "C" LIMIT ${MAX_ROWS+1}`,
};
const tableNames=Object.keys(definitions).sort();
const plainObject=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const baselineHash=manifest=>bundleHash({id:manifest.id,createdAt:manifest.createdAt,schema:manifest.schema,sourceIdentitySha256:manifest.sourceIdentitySha256,
  database:manifest.database,objects:manifest.objects,archive:manifest.archive,files:manifest.files});
export const privacyLedgerFingerprint=ledger=>bundleHash(ledger);
const keyFor=(name,row)=>JSON.stringify(['text_retention_purges','restore_privacy_retirements'].includes(name)?[row.kind,row.reference_id]:name==='schema_migrations'?[row.version]:
  name==='submission_receipts'?[row.assignment_id,row.submission_id]:
  ['site_access_requests','site_lifecycle_requests'].includes(name)?[row.org_id,row.request_id]:name==='staff_access_requests'?[row.org_id,row.site_id,row.request_id]:
    name==='restore_access_restrictions'?[row.backup_id,row.ledger_id,row.kind,row.reference_id]:
    [row.id ?? row.staff_id ?? row.recording_id ?? row.request_id ?? row.case_id ?? row.bundle_id ?? row.event_id ?? row.briefing_id ?? row.site_id ?? row.org_id]);

async function privacyRows(client){
  const tables={};let bytes=0;
  for(const name of tableNames){
    const rows=(await client.query(definitions[name])).rows.map(({row})=>{
      if(name==='attempts'){
        const {answer_text,result_json,...identity}=row;
        return {...identity,input_sha256:bundleHash(answer_text),result_sha256:bundleHash(result_json)};
      }
      if(name==='recordings'){
        const {transcript,...identity}=row;
        return {...identity,transcript_sha256:transcript===null?null:bundleHash(transcript)};
      }
      if(['staff_credentials','platform_operators'].includes(name)){
        const {email,password_salt,password_hash,...identity}=row;
        return {...identity,credential_sha256:bundleHash({email,password_salt,password_hash})};
      }
      if(name!=='publications')return row;
      const {snapshot_json,...identity}=row;return {...identity,snapshot_sha256:bundleHash(snapshot_json)};
    });
    if(rows.length>MAX_ROWS)throw Error('Privacy ledger row bound exceeded');
    bytes+=Buffer.byteLength(JSON.stringify(rows));if(bytes>MAX_BYTES)throw Error('Privacy ledger size bound exceeded');
    tables[name]=rows;
  }
  return tables;
}

export function validatePrivacyLedger(ledger,baseline){
  if(ledger?.format!==PRIVACY_LEDGER_FORMAT || !uuid(ledger.id) || ledger.backupId!==baseline.id || ledger.schema!==baseline.schema
    || ledger.baselineSha256!==baselineHash(baseline) || ledger.sourceIdentitySha256!==baseline.sourceIdentitySha256
    || !digest(ledger.baselineSha256) || !Number.isFinite(Date.parse(ledger.capturedAt)) || Date.parse(ledger.capturedAt)<Date.parse(baseline.createdAt)
    || !plainObject(ledger.tables) || JSON.stringify(Object.keys(ledger.tables).sort())!==JSON.stringify(tableNames)
    || !Array.isArray(ledger.objects) || ledger.objects.length>MAX_ROWS || !plainObject(ledger.sourceInventory)
    || !digest(ledger.sourceInventory.definitionsSha256) || !Array.isArray(ledger.sourceInventory.tables)
    || Buffer.byteLength(JSON.stringify(ledger))>MAX_BYTES)throw Error('Invalid privacy ledger or backup binding');
  validateDatabaseInventory(ledger.sourceInventory);
  for(const [name,rows] of Object.entries(ledger.tables)){
    if(!Array.isArray(rows) || rows.length>MAX_ROWS || rows.some(row=>!plainObject(row)))throw Error('Invalid privacy ledger rows');
    const keys=new Set();
    for(const row of rows){
      const key=keyFor(name,row);
      if(JSON.parse(key).some(value=>typeof value!=='string' || value.length<1 || value.length>100) || keys.has(key))throw Error('Privacy ledger row identity unavailable or duplicated');
      keys.add(key);
    }
  }
  if(ledger.tables.publications.some(row=>!digest(row.snapshot_sha256) || 'snapshot_json' in row)
    || ledger.tables.staff.some(row=>'name' in row || 'email' in row)
    || ledger.tables.workers.some(row=>'code' in row || 'name' in row)
    || ledger.tables.attempts.some(row=>!digest(row.input_sha256) || !digest(row.result_sha256) || 'result_json' in row || 'answer_text' in row || 'reasons_json' in row || 'evidence_json' in row)
    || ledger.tables.recordings.some(row=>'transcript' in row || (row.transcript_sha256!==null && !digest(row.transcript_sha256)))
    || ledger.tables.audit_activity.some(row=>Object.keys(row).sort().join(',')!=='action,actor_type,id,identities_cleared,occurred_at,org_id,site_id'
      || typeof row.identities_cleared!=='boolean')
    || ledger.tables.briefings.some(row=>Object.keys(row).sort().join(',')!=='content_expired,content_proofs,id,org_id,site_id'
      || typeof row.content_expired!=='boolean' || !validBriefingContentProofs(row.content_proofs,row.id))
    || ['staff_credentials','platform_operators'].some(name=>ledger.tables[name].some(row=>!digest(row.credential_sha256)
      || ['name','email','password_salt','password_hash'].some(key=>key in row))))throw Error('Privacy ledger includes unsupported content');
  for(const row of ledger.tables.staff)if(!staffRoles.includes(row.role) || typeof row.active!=='boolean'
    || !Number.isSafeInteger(row.access_revision) || row.access_revision<1)throw Error('Privacy staff access state unavailable');
  const sequences=new Set();
  const assignmentsById=new Map(ledger.tables.assignments.map(row=>[row.id,row]));
  for(const row of ledger.tables.case_voice){
    const assignment=assignmentsById.get(row.assignment_id),actor=ledger.tables.staff.find(staff=>staff.id===row.actor_id);
    if(Object.keys(row).sort().join(',')!=='actor_id,actor_role,actor_type,assignment_id,bytes,cleanup_state,created_at,id,kind,language,org_id,received_at,request_id,requested_case_id,sha256,site_id,status,worker_id'
      ||!assignment||assignment.org_id!==row.org_id||assignment.site_id!==row.site_id||assignment.worker_id!==row.worker_id
      ||!isWorkerLanguage(row.language)||!digest(row.sha256)||!Number.isSafeInteger(row.bytes)||row.bytes<45||row.bytes>2880044
      ||!['storing','received','failed'].includes(row.status)||!['active','cleaning','cleaned'].includes(row.cleanup_state)
      ||!Number.isFinite(Date.parse(row.created_at))||Date.parse(row.created_at)>Date.parse(ledger.capturedAt)
      ||(row.status==='received'?!Number.isFinite(Date.parse(row.received_at))||Date.parse(row.received_at)<Date.parse(row.created_at)||Date.parse(row.received_at)>Date.parse(ledger.capturedAt):row.received_at!==null)
      ||(row.actor_type==='staff'?row.kind!=='in_person'||row.bytes<8044||!['owner','supervisor'].includes(row.actor_role)||!actor||actor.org_id!==row.org_id||actor.site_id!==row.site_id
        :row.actor_type!=='worker'||!['help','reply'].includes(row.kind)||row.actor_id!==null||row.actor_role!==null))throw Error('Original case voice authorship unavailable');
  }
  const acceptedByKind=Object.fromEntries(['typed','audio'].map(kind=>[kind,new Map(ledger.tables[kind==='typed'?'attempts':'recordings']
    .map(row=>[JSON.stringify([row.assignment_id,row.submission_id]),row]))]));
  for(const row of ledger.tables.submission_receipts){
    const assignment=assignmentsById.get(row.assignment_id);
    const evidence=acceptedByKind[row.kind]?.get(JSON.stringify([row.assignment_id,row.submission_id]));
    if(Object.keys(row).sort().join(',')!=='assignment_id,kind,org_id,received_at,sequence,site_id,submission_id'
      || typeof row.sequence!=='string' || !/^[1-9][0-9]{0,18}$/.test(row.sequence) || BigInt(row.sequence)>9223372036854775807n || sequences.has(row.sequence)
      || !['typed','audio'].includes(row.kind) || !assignment || !evidence || row.org_id!==assignment.org_id || row.site_id!==assignment.site_id
      || row.org_id!==evidence.org_id || row.site_id!==evidence.site_id || row.received_at!==evidence.received_at
      || !Number.isFinite(Date.parse(row.received_at)) || Date.parse(row.received_at)>Date.parse(ledger.capturedAt))throw Error('Original submission acceptance evidence unavailable');
    sequences.add(row.sequence);
  }
  const timely=row=>Number.isFinite(Date.parse(row.created_at ?? row.occurred_at)) && Date.parse(row.created_at ?? row.occurred_at)<=Date.parse(ledger.capturedAt);
  for(const row of ledger.tables.staff_access_requests){
    const value=staffChangeInput(row.action,{...row.request_json,requestId:row.request_id,confirmed:true});
    const actor=ledger.tables.staff.find(staff=>staff.id===row.created_by),target=ledger.tables.staff.find(staff=>staff.id===row.staff_id);
    if(!actor || !target || [actor,target].some(staff=>staff.org_id!==row.org_id || staff.site_id!==row.site_id)
      || bundleHash(value)!==bundleHash(row.request_json) || row.result_json.id!==row.staff_id || !staffRoles.includes(row.result_json.role)
      || typeof row.result_json.active!=='boolean' || row.result_json.revision!==value.revision+1 || !timely(row))throw Error('Original staff access receipt unavailable');
  }
  for(const [name,parse] of [['site_access_requests',siteAccessInput],['site_lifecycle_requests',siteLifecycleInput]])for(const row of ledger.tables[name]){
    const value=parse({...row.request_json,requestId:row.request_id}),actor=ledger.tables.staff.find(staff=>staff.id===row.actor_id);
    if(!actor || actor.org_id!==row.org_id || actor.site_id!==row.origin_site_id || value.siteId!==row.site_id
      || bundleHash(value)!==bundleHash(row.request_json) || row.revision!==value.revision+1 || !timely(row))throw Error('Original site access receipt unavailable');
  }
  for(const row of ledger.tables.operator_requests){
    const value=operatorControlInput({...row.request_json,requestId:row.request_id});
    if(value.kind!=='tenant' || !ledger.tables.platform_operators.some(operator=>operator.id===row.operator_id)
      || bundleHash(value)!==bundleHash(row.request_json) || row.result_json.orgId!==value.orgId || row.result_json.state!==value.state
      || row.result_json.revision!==value.revision+1 || !timely(row))throw Error('Original tenant access receipt unavailable');
  }
  for(const row of ledger.tables.worker_deletion_requests){
    const worker=ledger.tables.workers.find(worker=>worker.id===row.worker_id),actor=ledger.tables.staff.find(actor=>actor.id===row.actor_id);
    if(!worker || worker.active!==false || worker.org_id!==row.org_id || worker.site_id!==row.site_id
      || !actor || actor.org_id!==row.org_id || actor.site_id!==row.site_id || !['owner','supervisor','administrator','auditor'].includes(actor.role)
      || !digest(row.fingerprint) || !['worker_request','customer_policy'].includes(row.reason)
      || !Number.isFinite(Date.parse(row.created_at)) || Date.parse(row.created_at)>Date.parse(ledger.capturedAt))throw Error('Privacy deletion decision evidence unavailable');
  }
  for(const [name,contract] of Object.entries(policyContracts))for(const row of ledger.tables[contract.requests]){
    const actor=ledger.tables.staff.find(actor=>actor.id===row.actor_id);
    const request=contract.parse({...row.request_json,requestId:row.id});
    if(!actor || actor.org_id!==row.org_id || actor.site_id!==row.site_id || bundleHash(request)!==bundleHash(row.request_json)
      || row.revision!==request.revision+1 || !Number.isFinite(Date.parse(row.created_at))
      || Date.parse(row.created_at)>Date.parse(ledger.capturedAt))throw Error(`Privacy ${name} decision evidence unavailable`);
  }
  for(const [name,identityName,key,flag,contractName] of [
    ['activity_identity_purges','audit_activity','event_id','identities_cleared','activity_retention_policies'],
    ['briefing_content_purges','briefings','briefing_id','content_expired','briefing_retention_policies'],
  ])for(const row of ledger.tables[name]){
    const identity=ledger.tables[identityName].find(value=>value.id===row[key] && value.org_id===row.org_id && value.site_id===row.site_id);
    const decisions=ledger.tables[policyContracts[contractName].requests].filter(value=>value.org_id===row.org_id && value.site_id===row.site_id
      && value.revision===row.policy_revision && value.request_json.days===row.days);
    const completed=Date.parse(row.completed_at);
    if(!identity?.[flag] || decisions.length!==1 || !Number.isFinite(completed) || completed>Date.parse(ledger.capturedAt)
      || Date.parse(decisions[0].created_at)>completed || name==='activity_identity_purges' && Date.parse(identity.occurred_at)>completed-row.days*86400000)
      throw Error('Privacy activity or briefing retirement evidence unavailable');
    if(name==='briefing_content_purges' && !validBriefingContentProofs(row.proofs_json,row.briefing_id))throw Error('Privacy briefing content proofs unavailable');
  }
  for(const purge of ledger.tables.briefing_content_purges) {
    const origin=ledger.tables.briefing_content_origins.find(row=>row.briefing_id===purge.briefing_id);
    const policy=ledger.tables.briefing_retention_requests.find(row=>row.org_id===purge.org_id && row.site_id===purge.site_id
      && row.revision===purge.policy_revision && row.request_json.days===purge.days);
    const journal=ledger.tables.restore_briefing_redactions.find(row=>row.briefing_id===purge.briefing_id);
    if(journal) {
      const original=origin?.source_receipt_json;
      if(Object.keys(journal).sort().join(',')!=='backup_id,briefing_id,imported_at,ledger_fingerprint,ledger_id,org_id,site_id,source_captured_at,source_origin_json'
        || !uuid(journal.backup_id) || !uuid(journal.ledger_id) || !digest(journal.ledger_fingerprint)
        || bundleHash(journal.source_origin_json)!==bundleHash(origin)
        || ['briefing_id','org_id','site_id'].some(key=>journal[key]!==purge[key] || original?.[key]!==purge[key])
        || !validBriefingContentProofs(original?.proofs_json,purge.briefing_id)
        || !briefingContentProofsMatch(purge.proofs_json,original.proofs_json)
        || original.policy_revision!==purge.policy_revision || original.days!==purge.days
        || !Number.isFinite(Date.parse(journal.source_captured_at)) || !Number.isFinite(Date.parse(journal.imported_at))
        || Date.parse(journal.source_captured_at)<Date.parse(origin.captured_at) || Date.parse(journal.source_captured_at)>Date.parse(journal.imported_at)
        || Date.parse(journal.imported_at)>Date.parse(purge.completed_at))throw Error('Original restored briefing provenance unavailable');
      validateBriefingExpiryOrigin(origin,{purge:original,policy,capturedAt:ledger.capturedAt});
    } else validateBriefingExpiryOrigin(origin,{purge,policy,capturedAt:ledger.capturedAt});
  }
  if(ledger.tables.briefing_content_origins.some(origin=>!ledger.tables.briefing_content_purges.some(purge=>purge.briefing_id===origin.briefing_id)))
    throw Error('Orphaned briefing expiry provenance unavailable');
  if(ledger.tables.restore_briefing_redactions.some(row=>!ledger.tables.briefing_content_purges.some(purge=>purge.briefing_id===row.briefing_id)))
    throw Error('Incomplete restored briefing provenance unavailable');
  for(const row of ledger.tables.restore_activity_redactions){
    const event=ledger.tables.audit_activity.find(value=>value.id===row.event_id),{identities_cleared,...identity}=event ?? {};
    const original=row.source_receipt_json,policy=row.source_policy_json;
    if(!identities_cleared || !ledger.tables.activity_identity_purges.some(value=>value.event_id===row.event_id)
      || !uuid(row.backup_id) || !uuid(row.ledger_id) || !digest(row.ledger_fingerprint)
      || bundleHash(identity)!==bundleHash(row.original_event_json)
      || original?.event_id!==row.event_id || original.org_id!==row.org_id || original.site_id!==row.site_id
      || Object.keys(original).sort().join(',')!=='completed_at,days,event_id,org_id,policy_revision,site_id'
      || !ledger.tables.activity_retention_requests.some(value=>bundleHash(value)===bundleHash(policy))
      || policy.revision!==original.policy_revision || policy.request_json.days!==original.days
      || !Number.isFinite(Date.parse(row.source_captured_at)) || Date.parse(row.source_captured_at)>Date.parse(ledger.capturedAt)
      || !Number.isFinite(Date.parse(original.completed_at)) || Date.parse(original.completed_at)>Date.parse(row.source_captured_at)
      || Date.parse(identity.occurred_at)>Date.parse(original.completed_at)-original.days*86400000)
      throw Error('Original restore activity provenance unavailable');
  }
  const ids=new Set();
  for(const row of ledger.objects){
    if(!uuid(row.id) || ids.has(row.id.toLowerCase()) || !['recording','source','source-original','generated','case-followup','case-voice'].includes(row.family)
      || ![row.org_id,row.site_id].every(id=>typeof id==='string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id)) || !digest(row.sha256)
      || typeof row.retained!=='boolean' || (row.family==='source-original')!==(row.format==='original')
      || !['original','wav'].includes(row.format) || !Number.isInteger(row.bytes) || row.bytes<1 || row.bytes>(row.format==='original'?10485760:2880044))throw Error('Invalid privacy object reference');
    ids.add(row.id.toLowerCase());
  }
  return ledger;
}

export async function exportPrivacyLedger(pool,baseline,{schema=baseline.schema,sourceIdentitySha256,writersStopped=false}={}){
  return withPrivacyLedgerSnapshot(pool,baseline,{schema,sourceIdentitySha256,writersStopped},ledger=>ledger);
}

export async function withPrivacyLedgerSnapshot(pool,baseline,{schema=baseline.schema,sourceIdentitySha256,writersStopped=false}={},inspect){
  if(writersStopped!==true)throw Error('Privacy ledger export requires stopped writers and cleanup workers');
  if(schema!==baseline.schema || sourceIdentitySha256!==baseline.sourceIdentitySha256)throw Error('Privacy ledger requires the original backup source');
  await verifyMigrations(pool,{schema});
  return withBackupSnapshot(pool,{schema,writersStopped},async(snapshot,client)=>{
    const tables=await privacyRows(client),capturedAt=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
    const ledger=validatePrivacyLedger({format:PRIVACY_LEDGER_FORMAT,id:randomUUID(),backupId:baseline.id,schema,baselineSha256:baselineHash(baseline),
      sourceIdentitySha256,capturedAt:new Date(capturedAt).toISOString(),sourceInventory:snapshot.database,tables,objects:snapshot.objects},baseline);
    return inspect(ledger,client);
  });
}

const bindingKeys={
  sites:['org_id'],staff:['org_id','site_id'],workers:['org_id','site_id'],
  briefings:['org_id','site_id'],
  staff_accounts:['credential_staff_id'],staff_account_memberships:['account_id','org_id','site_id'],
  publications:['org_id','site_id','briefing_id','version'],assignments:['org_id','site_id','publication_id','worker_id','language'],
  attempts:['org_id','site_id','assignment_id','submission_id','received_at'],recordings:['org_id','site_id','assignment_id','submission_id','received_at','sha256','bytes'],
  clarifications:['org_id','site_id','assignment_id','attempt_id','created_at'],source_audio_requests:['org_id','site_id','request_id','sha256','bytes','original_id','original_sha256','original_bytes','received_at'],
  generated_bundles:['org_id','site_id','briefing_id','revision','manifest_hash','dependency_hash','stored_at'],
  generated_audio:['bundle_id','org_id','site_id','language','text_hash','sha256','bytes'],
  case_followups:['org_id','site_id','case_id','assignment_id','actor_id','request_hash','created_at'],
  case_followup_audio:['org_id','site_id','request_id','job_lease','language','text_hash','sha256','bytes','created_at'],
  case_voice:['org_id','site_id','request_id','assignment_id','worker_id','requested_case_id','kind','actor_type','actor_id','actor_role','language','created_at','sha256','bytes','received_at'],
  help_requests:['org_id','site_id','assignment_id'],case_messages:['org_id','site_id','case_id','assignment_id','actor_id','request_hash','created_at'],
  case_reviews:['org_id','site_id','case_id','assignment_id','actor_id','kind','request_hash','created_at'],report_exports:['org_id','site_id','publication_id','requested_by','created_at','expires_at'],
  worker_imports:['org_id','site_id','requested_by','sha256','created_at','expires_at'],
};

async function privacyRestoreTransaction(pool,baseline,ledger,{schema=baseline.schema,isolatedTarget=false,writersStopped=false,predecessor,targetIdentitySha256,replayOperation,prepareState}={},apply){
  if(isolatedTarget!==true || writersStopped!==true)throw Error('Privacy reconciliation inspection requires a stopped isolated restore');
  schemaName(schema);if(schema!==baseline.schema)throw Error('Restore schema must match the backup');
  validatePrivacyLedger(ledger,baseline);await verifyMigrations(pool,{schema});
  if(predecessor)validateRestoreReplayState(predecessor,{baseline,targetIdentitySha256});
  return withTransaction(pool,async client=>{
    await client.query("SELECT set_config('search_path',quote_ident($1)||',pg_catalog,pg_temp',true)",[schema]);await client.query("SET LOCAL timezone='UTC'");
    await client.query("SET LOCAL lock_timeout='5s'");await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`understood:migrations:${schema}`]);
    const tables=await backupTables(client,schema);await client.query(`LOCK TABLE ${tables.map(row=>row.identifier).join(',')} IN ${apply?'ACCESS EXCLUSIVE':'SHARE'} MODE`);
    await requireQuarantine(client,baseline.id);
    const inventory=await databaseInventory(client,schema);
    if(inventory.definitionsSha256!==ledger.sourceInventory.definitionsSha256)throw Error('Privacy ledger guarded definitions differ from the restore');
    const current=await privacyRows(client),objects=await privateObjectInventory(client),conflicts=[],missingReceipts={},missingActors={},changedPolicies={},restrictions={},redactions={};
    const before={database:inventory,objects};
    if(predecessor)await requireRestorePredecessor(client,predecessor,before,baseline);
    if(bundleHash(ledger.tables.schema_migrations.map(({version,checksum})=>({version,checksum})))!==bundleHash(current.schema_migrations.map(({version,checksum})=>({version,checksum}))))
      throw Error('Privacy ledger migration contract differs from the restore');
    const indexed=Object.fromEntries(tableNames.map(name=>[name,new Map(ledger.tables[name].map(row=>[keyFor(name,row),row]))]));
    for(const [name,keys] of Object.entries(bindingKeys))for(const target of current[name]){
      const source=indexed[name].get(keyFor(name,target));
      if(!source || keys.some(key=>bundleHash(source[key] ?? null)!==bundleHash(target[key] ?? null)))conflicts.push({table:name,key:keyFor(name,target),reason:'source_binding_unavailable'});
    }
    // A changed snapshot is expected only when the original erased projection
    // binds the still-present target bytes. Never waive unrelated hash conflicts.
    for(const target of current.publications) {
      const source=indexed.publications.get(keyFor('publications',target));
      if(!source || target.snapshot_sha256===source.snapshot_sha256)continue;
      const original=ledger.tables.briefing_content_origins.find(row=>row.briefing_id===target.briefing_id && row.org_id===target.org_id && row.site_id===target.site_id)?.source_receipt_json;
      const briefing=current.briefings.find(row=>row.id===target.briefing_id);
      if(!original || !briefing || original.proofs_json.publications?.[target.id]!==briefing.content_proofs.publications?.[target.id])
        conflicts.push({table:'publications',key:keyFor('publications',target),reason:'source_binding_unavailable'});
    }
    const sites=new Set(current.sites.map(row=>row.id)),workers=new Set(current.workers.map(row=>row.id)),staff=new Set(current.staff.map(row=>row.id));
    const references={recording_purges:new Set(current.recordings.map(row=>row.id)),source_audio_purges:new Set(current.source_audio_requests.map(row=>row.request_id)),
      case_content_purges:new Set(current.clarifications.map(row=>row.id)),generated_audio_retirements:new Set(current.generated_bundles.map(row=>row.id)),generated_audio_removals:new Set(current.generated_bundles.map(row=>row.id)),
      activity_identity_purges:new Set(current.audit_activity.map(row=>row.id)),briefing_content_purges:new Set(current.briefings.map(row=>row.id))};
    const relevant=(name,row)=>{
      if(!sites.has(row.site_id))return false;
      if(name==='worker_deletion_requests')return workers.has(row.worker_id);
      if(name==='staff_access_requests')return staff.has(row.staff_id);
      if(['worker_deletion_redactions','worker_deletion_pseudonyms','worker_deletion_completions'].includes(name))return workers.has(indexed.worker_deletion_requests.get(JSON.stringify([row.request_id]))?.worker_id);
      if(name==='text_retention_purges')return current[row.kind==='attempt'?'attempts':'recordings'].some(target=>target.id===row.reference_id);
      if(references[name])return references[name].has(row.recording_id ?? row.request_id ?? row.case_id ?? row.bundle_id ?? row.event_id ?? row.briefing_id);
      return true;
    };
    for(const name of receipts){
      const targets=new Map(current[name].map(row=>[keyFor(name,row),row]));let missing=0,actors=0;
      for(const source of ledger.tables[name])if(relevant(name,source)){
        const target=targets.get(keyFor(name,source));
        if(!target){
          missing++;
          if(source.actor_id && !current.staff.some(row=>row.id===source.actor_id)){
            actors++;
            const actor=indexed.staff.get(JSON.stringify([source.actor_id]));
            if(!actor || actor.org_id!==source.org_id || actor.site_id!==(source.origin_site_id ?? source.site_id))conflicts.push({table:name,key:keyFor(name,source),reason:'source_actor_unavailable'});
          }
          continue;
        }
        if(['worker_deletion_requests',...Object.values(policyContracts).map(value=>value.requests),'site_access_requests','site_lifecycle_requests','staff_access_requests'].includes(name)
          && bundleHash(source)!==bundleHash(target))conflicts.push({table:name,key:keyFor(name,source),reason:'immutable_receipt_conflict'});
      }
      missingReceipts[name]=missing;missingActors[name]=actors;
    }
    for(const name of policies){
      const targets=new Map(current[name].map(row=>[row.site_id,row]));let changes=0;
      for(const source of ledger.tables[name])if(sites.has(source.site_id)){
        const target=targets.get(source.site_id);
        if(target && source.revision<target.revision)conflicts.push({table:name,key:source.site_id,reason:'source_policy_older_than_restore'});
        if(target && source.revision===target.revision && bundleHash(source)!==bundleHash(target))conflicts.push({table:name,key:source.site_id,reason:'same_revision_policy_conflict'});
        if(bundleHash(source)!==bundleHash(target ?? null))changes++;
      }
      for(const target of current[name])if(!ledger.tables[name].some(row=>row.site_id===target.site_id && row.org_id===target.org_id))conflicts.push({table:name,key:target.site_id,reason:'source_policy_unavailable'});
      changedPolicies[name]=changes;
    }
    for(const name of ['staff','workers'])restrictions[name]=current[name].filter(target=>target.active && indexed[name].get(keyFor(name,target))?.active===false).length;
    restrictions.staffRoles=current.staff.filter(target=>target.role!==indexed.staff.get(keyFor('staff',target))?.role).length;
    restrictions.changedCredentials=current.staff_credentials.filter(target=>target.credential_sha256!==indexed.staff_credentials.get(keyFor('staff_credentials',target))?.credential_sha256).length;
    for(const [name,field,restricted] of [['site_access_controls','state','paused'],['site_lifecycle','state','archived'],['tenant_controls','state','suspended']]){
      const targets=new Map(current[name].map(row=>[keyFor(name,row),row]));
      restrictions[name]=ledger.tables[name].filter(row=>(sites.has(row.site_id) || !row.site_id && current.organizations.some(org=>org.id===row.org_id))
        && row[field]===restricted && targets.get(keyFor(name,row))?.[field]!==restricted).length;
    }
    for(const name of ['attempts','clarifications','help_requests','case_messages','case_reviews','case_followups'])redactions[name]=current[name].filter(target=>!target.redacted && indexed[name].get(keyFor(name,target))?.redacted).length;
    redactions.recordings=current.recordings.filter(target=>!target.transcript_cleared && indexed.recordings.get(keyFor('recordings',target))?.transcript_cleared).length;
    for(const name of ['report_exports','worker_imports'])redactions[name]=current[name].filter(target=>!target.payload_cleared && indexed[name].get(keyFor(name,target))?.payload_cleared).length;
    redactions.briefings=current.briefings.filter(target=>!target.content_expired && indexed.briefings.get(keyFor('briefings',target))?.content_expired).length;
    for(const target of current.briefings) {
      if(target.content_expired || !indexed.briefings.get(keyFor('briefings',target))?.content_expired)continue;
      const origin=ledger.tables.briefing_content_origins.find(row=>row.briefing_id===target.id && row.org_id===target.org_id && row.site_id===target.site_id);
      const original=origin?.source_receipt_json;
      if(!original || !briefingContentProofsMatch(target.content_proofs,original.proofs_json))
        conflicts.push({table:'briefings',key:keyFor('briefings',target),reason:'original_content_unbound'});
      if(origin && (await client.query('SELECT briefing_origin_target_matches($1::jsonb) AS matched',[JSON.stringify(origin)])).rows[0].matched!==true)
        conflicts.push({table:'briefings',key:keyFor('briefings',target),reason:'original_lineage_unbound'});
    }
    redactions.audit_activity=0;
    for(const target of current.audit_activity){
      const source=indexed.audit_activity.get(keyFor('audit_activity',target));
      if(!source?.identities_cleared || target.identities_cleared)continue;
      if(['org_id','site_id','actor_type','action','occurred_at'].some(key=>source[key]!==target[key])
        || !ledger.tables.activity_identity_purges.some(row=>row.event_id===target.id && row.org_id===target.org_id && row.site_id===target.site_id))
        conflicts.push({table:'audit_activity',key:keyFor('audit_activity',target),reason:'redaction_authority_unavailable'});
      else redactions.audit_activity++;
    }
    const deletionFor=assignmentId=>{
      const assignment=indexed.assignments.get(JSON.stringify([assignmentId]));
      return assignment && ledger.tables.worker_deletion_requests.some(row=>row.worker_id===assignment.worker_id && row.org_id===assignment.org_id && row.site_id===assignment.site_id);
    };
    for(const name of ['attempts','recordings','clarifications','help_requests','case_messages','case_reviews','case_followups'])for(const target of current[name]){
      const source=indexed[name].get(keyFor(name,target));
      const cleared=source && (name==='recordings'?source.transcript_cleared&&!target.transcript_cleared:source.redacted&&!target.redacted);
      if(!cleared || deletionFor(source.assignment_id))continue;
      const receipt=['attempts','recordings'].includes(name)?ledger.tables.text_retention_purges.find(row=>row.kind===(name==='attempts'?'attempt':'recording') && row.reference_id===source.id
        && row.org_id===source.org_id && row.site_id===source.site_id && row.assignment_id===source.assignment_id):
        ledger.tables.case_content_purges.find(row=>row.case_id===(source.case_id ?? source.id) && row.org_id===source.org_id && row.site_id===source.site_id);
      if(!receipt)conflicts.push({table:name,key:keyFor(name,source),reason:'redaction_authority_unavailable'});
    }
    const sourceObjects=new Map(ledger.objects.map(row=>[row.id,row]));let retirements=0;
    for(const target of objects){
      const source=sourceObjects.get(target.id);
      if(!source || ['family','org_id','site_id','sha256','bytes','format'].some(key=>source[key]!==target[key]))conflicts.push({table:'private_objects',key:target.id,reason:'source_binding_unavailable'});
      else if(target.retained && !source.retained)retirements++;
    }
    const report={backupId:baseline.id,ledgerId:ledger.id,ledgerFingerprint:privacyLedgerFingerprint(ledger),capturedAt:ledger.capturedAt,inspectedAt:new Date().toISOString(),
      conflicts,missingReceipts,missingActors,changedPolicies,restrictions,redactions,privateRetirements:retirements,
      acceptedInputLifecycle:compareRestoreInputs(ledger.tables,current,ledger.objects,objects),
      sourceSnapshot:compareSourceSnapshot(baseline,ledger),
      relevantDeletionRequests:ledger.tables.worker_deletion_requests.filter(row=>workers.has(row.worker_id)).length,
      historicalContentReplayPending:{activity:redactions.audit_activity,briefing:redactions.briefings},
      authoritativeReconciliationComplete:false,activationAllowed:false,productionReady:false,
      limitation:'Read-only comparison only. Original actor-bound privacy decisions, policy revisions and retirement/redaction evidence have not been applied. No release or provider operation is authorized.'};
    if(!apply)return report;
    const result=await apply(client,{current,indexed,report,objects});
    if(!predecessor)return result;
    const state=await captureRestoreReplayState(client,{before,predecessor,baseline,ledger,operation:replayOperation,duplicate:result.duplicate});
    // Candidate evidence is persisted while locks are held, before commit. Reuse
    // requires both exact target state and the committed operational audit receipt.
    if(prepareState)await prepareState(state);
    return {...result,state};
  });
}

export async function planPrivacyReconciliation(pool,baseline,ledger,options={}){
  return privacyRestoreTransaction(pool,baseline,ledger,options);
}

async function privacyReplayReceipt(client,baseline,ledger,current,report,operation){
  const marker=`${baseline.id}:${ledger.id}:${report.ledgerFingerprint}`,action=`backup.restore.privacy.${operation}`;
  const old=(await client.query(`SELECT org_id,site_id,object_id FROM operational_audit_receipts WHERE action=$2
    AND actor_type='system' AND actor_id='restore-operator' AND strpos(object_id,$1)=1`,[`${baseline.id}:${ledger.id}:`,action])).rows;
  if(old.length && (old.length!==current.sites.length || old.some(row=>row.object_id!==marker
    || !current.sites.some(site=>site.id===row.site_id && site.org_id===row.org_id))))throw Error('Privacy replay ledger receipt conflict');
  // A proven completed command can be acknowledged without reapplying it after
  // later target changes. Keep those conflicts visible and all activation gates closed.
  if(!old.length && report.conflicts.length)throw Error('Privacy reconciliation conflicts must be resolved before decision replay');
  return {duplicate:old.length>0,async commit(){
    for(const site of current.sites)await client.query(`INSERT INTO audit(id,org_id,site_id,actor_type,actor_id,action,object_id)
      VALUES($1,$2,$3,'system','restore-operator',$4,$5)`,
      [bundleHash({backupId:baseline.id,ledgerId:ledger.id,siteId:site.id,operation}),site.org_id,site.id,action,marker]);
    await requireQuarantine(client,baseline.id);
  }};
}

async function ensurePrivacyActor(client,actor,actorIds){
  if(actorIds.has(actor.id))return 0;
  await client.query('INSERT INTO staff(id,org_id,site_id,name,role,active) VALUES($1,$2,$3,$4,$5,false)',
    [actor.id,actor.org_id,actor.site_id,'[Restored privacy actor]',actor.role]);
  actorIds.add(actor.id);return 1;
}

// Replay decisions, not old success claims: restored bytes need their own cleanup proof.
export async function replayPrivacyDeletions(pool,baseline,ledger,options={}){
  return privacyRestoreTransaction(pool,baseline,ledger,{...options,replayOperation:'deletions'},async(client,{current,indexed,report})=>{
    const receipt=await privacyReplayReceipt(client,baseline,ledger,current,report,'deletions');
    if(receipt.duplicate){
      return {...report,duplicate:true,importedRequests:0,importedActors:0,limitation:'Deletion decisions were already replayed. Cleanup, other privacy decisions and release gates remain required.'};
    }
    let importedRequests=0,importedActors=0;
    const workerIds=new Set(current.workers.map(row=>row.id)),existing=new Map(current.worker_deletion_requests.map(row=>[row.id,row])),actorIds=new Set(current.staff.map(row=>row.id));
    for(const request of ledger.tables.worker_deletion_requests){
      if(!workerIds.has(request.worker_id) || existing.has(request.id))continue;
      if(current.worker_deletion_requests.some(row=>row.worker_id===request.worker_id))throw Error('Restored worker has a conflicting deletion decision');
      if(!actorIds.has(request.actor_id)){
        const actor=indexed.staff.get(JSON.stringify([request.actor_id]));
        importedActors+=await ensurePrivacyActor(client,actor,actorIds);
      }
      await client.query('UPDATE workers SET active=false WHERE id=$1 AND org_id=$2 AND site_id=$3',[request.worker_id,request.org_id,request.site_id]);
      await client.query(`INSERT INTO worker_deletion_requests(id,org_id,site_id,worker_id,actor_id,fingerprint,reason,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[request.id,request.org_id,request.site_id,request.worker_id,request.actor_id,request.fingerprint,request.reason,request.created_at]);
      await client.query('UPDATE worker_grants SET revoked_at=clock_timestamp() WHERE worker_id=$1 AND revoked_at IS NULL',[request.worker_id]);
      await client.query('UPDATE worker_setup_tokens SET revoked_at=clock_timestamp() WHERE worker_id=$1 AND revoked_at IS NULL',[request.worker_id]);
      await client.query('DELETE FROM worker_credentials WHERE worker_id=$1',[request.worker_id]);
      await client.query("UPDATE sessions SET revoked_at=clock_timestamp() WHERE principal_type='worker' AND principal_id=$1 AND revoked_at IS NULL",[request.worker_id]);
      await client.query(`UPDATE recordings SET status='failed',transcript=NULL,lease_token=NULL,lease_until=NULL,retry_at=NULL,error='Worker deletion pending'
        WHERE status<>'storing' AND assignment_id IN (SELECT id FROM assignments WHERE worker_id=$1)`,[request.worker_id]);
      await client.query(`UPDATE assessment_jobs SET status='blocked',lease_token=NULL,lease_until=NULL,error='Worker deletion pending'
        WHERE status<>'complete' AND assignment_id IN (SELECT id FROM assignments WHERE worker_id=$1)`,[request.worker_id]);
      importedRequests++;
    }
    await receipt.commit();
    return {...report,duplicate:false,importedRequests,importedActors,
      limitation:'Original worker deletion decisions replayed atomically. Imported actors are disabled and have no credentials. Completion receipts were not copied; physical cleanup, all other privacy decisions and release gates remain required.'};
  });
}

export async function replayPrivacyPolicies(pool,baseline,ledger,options={}){
  return privacyRestoreTransaction(pool,baseline,ledger,{...options,replayOperation:'policies'},async(client,{current,indexed,report})=>{
    const receipt=await privacyReplayReceipt(client,baseline,ledger,current,report,'policies');
    if(receipt.duplicate)return {...report,duplicate:true,importedRequests:0,importedActors:0,changedPolicyRows:0,
      limitation:'Current policy decisions were already replayed. Historical retirement/redaction evidence, cleanup and release gates remain required.'};
    const sites=new Map(current.sites.map(row=>[row.id,row.org_id])),actors=new Set(current.staff.map(row=>row.id));
    let importedRequests=0,importedActors=0,changedPolicyRows=0;
    for(const [name,contract] of Object.entries(policyContracts)){
      for(const policy of ledger.tables[name])if(sites.get(policy.site_id)===policy.org_id){
        const target=current[name].find(row=>row.site_id===policy.site_id);
        if(bundleHash(policy)===bundleHash(target ?? null))continue;
        const decision=ledger.tables[contract.requests].find(row=>row.org_id===policy.org_id && row.site_id===policy.site_id
          && row.revision===policy.revision && row.request_json[contract.input]===policy[contract.column]);
        if(!decision || !Number.isSafeInteger(policy.revision) || policy.revision<1 || !Number.isFinite(Date.parse(policy.updated_at))
          || Date.parse(policy.updated_at)>Date.parse(ledger.capturedAt))throw Error('Current privacy policy receipt unavailable');
      }
      for(const request of ledger.tables[contract.requests])if(sites.get(request.site_id)===request.org_id
        && !current[contract.requests].some(row=>row.id===request.id)){
        importedActors+=await ensurePrivacyActor(client,indexed.staff.get(JSON.stringify([request.actor_id])),actors);
        await client.query(`INSERT INTO ${contract.requests}(id,org_id,site_id,actor_id,request_json,revision,created_at)
          VALUES($1,$2,$3,$4,$5,$6,$7)`,[request.id,request.org_id,request.site_id,request.actor_id,JSON.stringify(request.request_json),request.revision,request.created_at]);
        importedRequests++;
      }
      for(const policy of ledger.tables[name])if(sites.get(policy.site_id)===policy.org_id){
        const target=current[name].find(row=>row.site_id===policy.site_id);
        if(bundleHash(policy)===bundleHash(target ?? null))continue;
        await client.query(`INSERT INTO ${name}(site_id,org_id,revision,${contract.column},updated_at) VALUES($1,$2,$3,$4,$5)
          ON CONFLICT(site_id) DO UPDATE SET revision=excluded.revision,${contract.column}=excluded.${contract.column},updated_at=excluded.updated_at`,
          [policy.site_id,policy.org_id,policy.revision,policy[contract.column],policy.updated_at]);
        changedPolicyRows++;
      }
    }
    await receipt.commit();
    return {...report,duplicate:false,importedRequests,importedActors,changedPolicyRows,
      limitation:'Current audio, response-text, resolved-case, generated-audio, activity and archived-briefing policies and original receipts replayed atomically. Historical activity/briefing redaction replay, other retirement evidence, physical cleanup and release gates remain required.'};
  });
}

export async function replayPrivacyActivity(pool,baseline,ledger,options={}){
  return privacyRestoreTransaction(pool,baseline,ledger,{...options,replayOperation:'activity'},async(client,{current,indexed,report})=>{
    const receipt=await privacyReplayReceipt(client,baseline,ledger,current,report,'activity');
    if(receipt.duplicate)return {...report,duplicate:true,activityRedactions:0,journaled:0,
      limitation:'Activity redaction was already replayed. Briefing-content replay, final source cutoff and activation remain required.'};
    if(report.missingReceipts.activity_retention_requests)throw Error('Replay original activity policy decisions before activity redaction');
    const targetEvents=new Map(current.audit_activity.map(row=>[row.id,row])),targetPurges=new Set(current.activity_identity_purges.map(row=>row.event_id));
    let activityRedactions=0,journaled=0;
    for(const sourceReceipt of ledger.tables.activity_identity_purges){
      const target=targetEvents.get(sourceReceipt.event_id);
      if(!target || targetPurges.has(target.id))continue;
      const source=indexed.audit_activity.get(JSON.stringify([target.id])),{identities_cleared,...identity}=source;
      const inherited=ledger.tables.restore_activity_redactions.find(row=>row.event_id===target.id);
      const original=inherited?.source_receipt_json ?? sourceReceipt;
      const policy=inherited?.source_policy_json ?? ledger.tables.activity_retention_requests.find(row=>row.org_id===original.org_id
        && row.site_id===original.site_id && row.revision===original.policy_revision && row.request_json.days===original.days);
      const captured=inherited?.source_captured_at ?? ledger.capturedAt;
      if(!identities_cleared || !policy)throw Error('Original activity redaction decision unavailable');
      await client.query(`INSERT INTO restore_activity_redactions(event_id,org_id,site_id,backup_id,ledger_id,ledger_fingerprint,
        original_event_json,source_receipt_json,source_policy_json,source_captured_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[target.id,target.org_id,target.site_id,baseline.id,ledger.id,report.ledgerFingerprint,
        JSON.stringify(identity),JSON.stringify(original),JSON.stringify(policy),captured]);
      await client.query('INSERT INTO activity_identity_purges(event_id,org_id,site_id,policy_revision,days) VALUES($1,$2,$3,$4,$5)',
        [target.id,target.org_id,target.site_id,original.policy_revision,original.days]);
      await client.query("UPDATE audit SET actor_id='',object_id='' WHERE id=$1 AND org_id=$2 AND site_id=$3",[target.id,target.org_id,target.site_id]);
      activityRedactions++;journaled++;
    }
    await receipt.commit();
    return {...report,duplicate:false,activityRedactions,journaled,
      limitation:'Original activity expiry evidence retained and identifiers freshly redacted in quarantine. Current policies and mandatory operational receipts remain unchanged. Briefing-content replay, final source cutoff and activation remain required.'};
  });
}

export async function replayPrivacyBriefings(pool,baseline,ledger,options={}) {
  return privacyRestoreTransaction(pool,baseline,ledger,{...options,replayOperation:'briefings'},async(client,{current,report})=>{
    const receipt=await privacyReplayReceipt(client,baseline,ledger,current,report,'briefings');
    if(receipt.duplicate)return {...report,duplicate:true,briefingRedactions:0,journaled:0,
      limitation:'Briefing redaction was already replayed. Accepted-input/final-source-cutoff reconciliation and activation remain required.'};
    if(report.missingReceipts.briefing_retention_requests)throw Error('Replay original briefing policy decisions before briefing redaction');
    let briefingRedactions=0,journaled=0;
    for(const sourceReceipt of ledger.tables.briefing_content_purges) {
      const target=current.briefings.find(row=>row.id===sourceReceipt.briefing_id);
      if(!target || target.content_expired)continue;
      const origin=ledger.tables.briefing_content_origins.find(row=>row.briefing_id===target.id);
      const inherited=ledger.tables.restore_briefing_redactions.find(row=>row.briefing_id===target.id);
      await client.query(`INSERT INTO restore_briefing_redactions(briefing_id,org_id,site_id,backup_id,ledger_id,ledger_fingerprint,source_origin_json,source_captured_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[target.id,target.org_id,target.site_id,baseline.id,ledger.id,report.ledgerFingerprint,JSON.stringify(origin),inherited?.source_captured_at ?? ledger.capturedAt]);
      await client.query(`INSERT INTO briefing_content_purges(briefing_id,org_id,site_id,policy_revision,days,proofs_json)
        VALUES($1,$2,$3,$4,$5,briefing_content_proofs($1,$2,$3))`,[target.id,target.org_id,target.site_id,origin.source_receipt_json.policy_revision,origin.source_receipt_json.days]);
      await redactExpiredBriefingContent(client,target.id);briefingRedactions++;journaled++;
    }
    await receipt.commit();
    return {...report,duplicate:false,briefingRedactions,journaled,
      limitation:'Original briefing expiry proof retained and target content freshly erased in quarantine. Version states, accepted outcomes, archive/case clocks and current policies are unchanged. Accepted-input/final source cutoff and activation remain required.'};
  });
}

export async function replayPrivacyRestrictions(pool,baseline,ledger,options={}){
  return privacyRestoreTransaction(pool,baseline,ledger,{...options,replayOperation:'restrictions'},async(client,{current,indexed,report})=>{
    const receipt=await privacyReplayReceipt(client,baseline,ledger,current,report,'restrictions');
    if(receipt.duplicate)return {...report,duplicate:true,journaled:0,importedRequests:0,importedActors:0,changedStaff:0,disabledWorkers:0,changedSites:0,
      limitation:'Original access restrictions were already reconciled for this ledger. Credential re-provisioning, final cutoff and activation remain required.'};
    const sites=new Map(current.sites.map(row=>[row.id,row.org_id])),actors=new Set(current.staff.map(row=>row.id));
    let journaled=0,importedRequests=0,importedActors=0,changedStaff=0,disabledWorkers=0,changedSites=0;
    const sourceTime=Date.parse(ledger.capturedAt),timely=row=>row.updated_at==null || Number.isFinite(Date.parse(row.updated_at)) && Date.parse(row.updated_at)<=sourceTime;
    for(const name of ['site_access_controls','site_lifecycle','tenant_controls'])for(const row of ledger.tables[name])if(!timely(row))throw Error('Original access state time unavailable');
    for(const previous of current.restore_access_restrictions)if(Date.parse(previous.source_captured_at)>sourceTime)throw Error('Access ledger is older than prior reconciliation');
    const originalStaffDecision=source=>ledger.tables.staff_access_requests.find(row=>row.staff_id===source.id && row.org_id===source.org_id && row.site_id===source.site_id
      && row.result_json.role===source.role && row.result_json.active===source.active && row.result_json.revision===source.access_revision);
    const inherited=(kind,id,source)=>ledger.tables.restore_access_restrictions.some(row=>row.kind===kind && row.reference_id===id && bundleHash(row.source_state_json)===bundleHash(source));
    for(const target of current.staff){
      const source=indexed.staff.get(keyFor('staff',target));
      if(source.access_revision<target.access_revision)throw Error('Original staff access revision is older than restore');
      if((source.role!==target.role || target.active && !source.active) && !originalStaffDecision(source) && !inherited('staff',source.id,source))throw Error('Original staff restriction decision unavailable');
    }
    for(const target of current.workers){
      const source=indexed.workers.get(keyFor('workers',target));
      if(target.active && !source.active && !ledger.tables.worker_deletion_requests.some(row=>row.worker_id===source.id)
        && !ledger.tables.access_audit.some(row=>row.action==='worker.disabled' && row.object_id===source.id && row.org_id===source.org_id && row.site_id===source.site_id
          && Number.isFinite(Date.parse(row.occurred_at)) && Date.parse(row.occurred_at)<=sourceTime) && !inherited('worker',source.id,source))throw Error('Original worker restriction decision unavailable');
    }
    for(const request of ledger.tables.staff_access_requests)if(current.staff.some(row=>row.id===request.staff_id)
      && !current.staff_access_requests.some(row=>keyFor('staff_access_requests',row)===keyFor('staff_access_requests',request))){
      importedActors+=await ensurePrivacyActor(client,indexed.staff.get(JSON.stringify([request.created_by])),actors);
      await client.query(`INSERT INTO staff_access_requests(request_id,org_id,site_id,staff_id,action,request_json,result_json,created_by,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[request.request_id,request.org_id,request.site_id,request.staff_id,request.action,
        JSON.stringify(request.request_json),JSON.stringify(request.result_json),request.created_by,request.created_at]);importedRequests++;
    }
    for(const name of ['site_access_requests','site_lifecycle_requests'])for(const request of ledger.tables[name])if(sites.get(request.site_id)===request.org_id
      && sites.get(request.origin_site_id)===request.org_id && !current[name].some(row=>keyFor(name,row)===keyFor(name,request))){
      importedActors+=await ensurePrivacyActor(client,indexed.staff.get(JSON.stringify([request.actor_id])),actors);
      await client.query(`INSERT INTO ${name}(request_id,org_id,origin_site_id,site_id,actor_id,request_json,revision,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [request.request_id,request.org_id,request.origin_site_id,request.site_id,request.actor_id,JSON.stringify(request.request_json),request.revision,request.created_at]);importedRequests++;
    }
    for(const target of current.staff){
      const source=indexed.staff.get(keyFor('staff',target)),active=target.active && source.active;
      if(source.role!==target.role || active!==target.active){
        await client.query('UPDATE staff SET role=$2,active=$3 WHERE id=$1',[target.id,source.role,active]);changedStaff++;
      }
      if(source.access_revision>1)await client.query(`INSERT INTO staff_access_revisions(staff_id,org_id,site_id,revision) VALUES($1,$2,$3,$4)
        ON CONFLICT(staff_id) DO UPDATE SET revision=GREATEST(staff_access_revisions.revision,excluded.revision)`,[target.id,target.org_id,target.site_id,source.access_revision]);
    }
    for(const target of current.workers)if(target.active && indexed.workers.get(keyFor('workers',target)).active===false){
      await client.query('UPDATE workers SET active=false WHERE id=$1',[target.id]);
      await client.query('UPDATE worker_grants SET revoked_at=clock_timestamp() WHERE worker_id=$1 AND revoked_at IS NULL',[target.id]);
      await client.query('UPDATE worker_setup_tokens SET revoked_at=clock_timestamp() WHERE worker_id=$1 AND revoked_at IS NULL',[target.id]);
      await client.query("UPDATE sessions SET revoked_at=clock_timestamp() WHERE principal_type='worker' AND principal_id=$1 AND revoked_at IS NULL",[target.id]);disabledWorkers++;
    }
    for(const [name,restricted] of [['site_access_controls','paused'],['site_lifecycle','archived']])for(const source of ledger.tables[name])if(sites.get(source.site_id)===source.org_id){
      const target=current[name].find(row=>row.site_id===source.site_id);
      if(target && target.revision>source.revision)throw Error('Original site access revision is older than restore');
      const state=source.state===restricted?restricted:target?.state??restricted;
      if(!target || state!==target.state || source.revision!==target.revision){
        await client.query(`INSERT INTO ${name}(site_id,org_id,revision,state,reason,updated_at) VALUES($1,$2,$3,$4,$5,$6)
          ON CONFLICT(site_id) DO UPDATE SET revision=excluded.revision,state=excluded.state,reason=excluded.reason,updated_at=excluded.updated_at`,
          [source.site_id,source.org_id,source.revision,state,state===source.state?source.reason:target?.reason??'operational',source.updated_at]);changedSites++;
      }
    }
    // Account/operator fencing was established by quarantine, never by copying secrets.
    for(const source of ledger.tables.staff_accounts)if(current.staff_accounts.some(row=>row.id===source.id))await client.query(
      'UPDATE staff_accounts SET revision=GREATEST(revision,$2) WHERE id=$1',[source.id,source.revision]);
    const updated=await privacyRows(client);
    const journal=async(kind,id,orgId,siteId,source,target,evidence=[])=>{
      await client.query(`INSERT INTO restore_access_restrictions(backup_id,ledger_id,ledger_fingerprint,kind,reference_id,org_id,site_id,
        source_state_json,source_receipts_json,target_state_json,source_captured_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [baseline.id,ledger.id,report.ledgerFingerprint,kind,id,orgId,siteId,JSON.stringify(source),JSON.stringify(evidence),JSON.stringify(target),ledger.capturedAt]);journaled++;
    };
    for(const original of current.staff){
      const source=indexed.staff.get(keyFor('staff',original)),target=updated.staff.find(row=>row.id===original.id);
      await journal('staff',source.id,source.org_id,source.site_id,source,target,ledger.tables.staff_access_requests.filter(row=>row.staff_id===source.id));
    }
    for(const original of current.workers){
      const source=indexed.workers.get(keyFor('workers',original)),target=updated.workers.find(row=>row.id===original.id);
      await journal('worker',source.id,source.org_id,source.site_id,source,target,ledger.tables.access_audit.filter(row=>row.action==='worker.disabled' && row.object_id===source.id
        && row.org_id===source.org_id && row.site_id===source.site_id));
    }
    for(const [name,kind,requests] of [['site_access_controls','site-access','site_access_requests'],['site_lifecycle','site-lifecycle','site_lifecycle_requests']]){
      for(const source of ledger.tables[name])if(sites.get(source.site_id)===source.org_id)await journal(kind,source.site_id,source.org_id,source.site_id,source,
        updated[name].find(row=>row.site_id===source.site_id),ledger.tables[requests].filter(row=>row.org_id===source.org_id && row.site_id===source.site_id));
    }
    for(const org of current.organizations){
      const source=ledger.tables.tenant_controls.find(row=>row.org_id===org.id)??{org_id:org.id,revision:0,state:'active',reason:null,updated_at:null};
      await journal('tenant',org.id,org.id,null,source,updated.tenant_controls.find(row=>row.org_id===org.id),ledger.tables.operator_requests.filter(row=>row.request_json.orgId===org.id));
    }
    for(const original of current.staff_accounts){
      const source=indexed.staff_accounts.get(keyFor('staff_accounts',original)),staff=indexed.staff.get(JSON.stringify([source.credential_staff_id]));
      const credential=ledger.tables.staff_credentials.find(row=>row.staff_id===source.credential_staff_id)??null;
      if(credential && (!Number.isFinite(Date.parse(credential.changed_at)) || Date.parse(credential.changed_at)>sourceTime))throw Error('Original credential change time unavailable');
      await journal('account',source.id,staff.org_id,staff.site_id,{...source,credential},updated.staff_accounts.find(row=>row.id===source.id),
        ledger.tables.access_audit.filter(row=>row.action==='credential.recovered' && row.object_id===source.credential_staff_id));
    }
    for(const original of current.platform_operators){
      const source=indexed.platform_operators.get(keyFor('platform_operators',original))??{id:original.id,source_missing:true};
      const target=updated.platform_operators.find(row=>row.id===original.id),{credential_sha256,...state}=target;
      await journal('operator',original.id,null,null,source,state,ledger.tables.operator_requests.filter(row=>row.operator_id===original.id));
    }
    await receipt.commit();
    return {...report,duplicate:false,journaled,importedRequests,importedActors,changedStaff,disabledWorkers,changedSites,
      limitation:'Source access states and original receipts are preserved separately from target maintenance fences. No account, operator, worker, site or tenant is re-enabled and no credentials are copied. Cross-site receipts whose origin is absent stay in provenance only. Final cutoff, fresh credential provisioning and activation remain required.'};
  });
}

export async function replayPrivacyRetirements(pool,baseline,ledger,options={}){
  return privacyRestoreTransaction(pool,baseline,ledger,{...options,replayOperation:'retirements'},async(client,{current,indexed,report,objects})=>{
    const receipt=await privacyReplayReceipt(client,baseline,ledger,current,report,'retirements');
    if(receipt.duplicate)return {...report,duplicate:true,journaled:0,textRetirements:0,caseRetirements:0,generatedRetirements:0,queuedAudio:0,
      limitation:'Historical retirement decisions were already replayed. Physical absence, access restrictions, final cutoff and activation remain required.'};
    if(Object.values(report.changedPolicies).some(Boolean) || report.missingReceipts.worker_deletion_requests
      || Object.values(policyContracts).some(contract=>report.missingReceipts[contract.requests]))throw Error('Replay original deletion and policy decisions before historical retirements');
    const targets=Object.fromEntries(tableNames.map(name=>[name,new Map(current[name].map(row=>[keyFor(name,row),row]))]));
    let journaled=0,textRetirements=0,caseRetirements=0,generatedRetirements=0,queuedAudio=0;
    const identity=(name,row,extra=[])=>Object.fromEntries(['id',...bindingKeys[name],...extra].map(key=>[key,row[key] ?? null]));
    const originalPolicy=(name,row)=>{
      const contract=policyContracts[name],choices=ledger.tables[contract.requests].filter(request=>request.org_id===row.org_id && request.site_id===row.site_id
        && request.revision===row.policy_revision && request.request_json[contract.input]===row.days);
      if(choices.length!==1)throw Error('Historical privacy policy decision unavailable or ambiguous');
      return choices[0];
    };
    const journal=async(kind,referenceId,sourceIdentity,sourceReceipt,sourcePolicy=null)=>{
      const old=targets.restore_privacy_retirements.get(JSON.stringify([kind,referenceId]));
      if(old){
        if(old.org_id!==sourceIdentity.org_id || old.site_id!==sourceIdentity.site_id || bundleHash(old.source_identity_json)!==bundleHash(sourceIdentity))throw Error('Historical retirement journal input conflict');
        return;
      }
      await client.query(`INSERT INTO restore_privacy_retirements(kind,reference_id,org_id,site_id,backup_id,ledger_id,ledger_fingerprint,
        source_identity_json,source_receipt_json,source_policy_json,source_captured_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [kind,referenceId,sourceIdentity.org_id,sourceIdentity.site_id,baseline.id,ledger.id,report.ledgerFingerprint,
          JSON.stringify(sourceIdentity),JSON.stringify(sourceReceipt),sourcePolicy?JSON.stringify(sourcePolicy):null,ledger.capturedAt]);
      journaled++;
    };
    for(const retired of ledger.tables.text_retention_purges){
      const name=retired.kind==='attempt'?'attempts':retired.kind==='recording'?'recordings':null;
      if(!name)throw Error('Historical text retirement kind unavailable');
      const target=targets[name].get(JSON.stringify([retired.reference_id]));if(!target)continue;
      const source=indexed[name].get(JSON.stringify([retired.reference_id]));
      if(retired.kind==='attempt' && (!source.redacted || !source.reasons_cleared || !source.evidence_cleared)
        || retired.kind==='recording' && !source.transcript_cleared)throw Error('Source text retirement completion unavailable');
      if(!targets.text_retention_purges.has(keyFor('text_retention_purges',retired))){
        await journal(`${retired.kind}-text`,retired.reference_id,identity(name,source),retired,originalPolicy('text_retention_policies',retired));
        await client.query('INSERT INTO text_retention_purges(kind,reference_id,org_id,site_id,assignment_id,policy_revision,days) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [retired.kind,retired.reference_id,retired.org_id,retired.site_id,retired.assignment_id,retired.policy_revision,retired.days]);
        textRetirements++;
      }
      const assignment=targets.assignments.get(JSON.stringify([target.assignment_id]));
      await redactExpiredText(client,{kind:retired.kind,id:target.id,assignmentId:target.assignment_id,publicationId:assignment.publication_id,orgId:target.org_id,siteId:target.site_id});
    }
    for(const retired of ledger.tables.case_content_purges){
      const target=targets.clarifications.get(JSON.stringify([retired.case_id]));if(!target)continue;
      const source=indexed.clarifications.get(JSON.stringify([retired.case_id]));
      if(!source.redacted || !source.notes_cleared)throw Error('Source case retirement completion unavailable');
      const inherited=indexed.restore_privacy_retirements.get(JSON.stringify(['case-content',retired.case_id]));
      const origin=inherited?.source_identity_json ?? source;
      if(bindingKeys.clarifications.some(key=>bundleHash(origin[key] ?? null)!==bundleHash(source[key] ?? null)))throw Error('Original case resolution identity unavailable');
      if(!targets.case_content_purges.has(keyFor('case_content_purges',retired))){
        await journal('case-content',retired.case_id,identity('clarifications',origin,['status','resolved_at']),retired,originalPolicy('case_retention_policies',retired));
        await client.query('INSERT INTO case_content_purges(case_id,org_id,site_id,assignment_id,policy_revision,days) VALUES($1,$2,$3,$4,$5,$6)',
          [retired.case_id,retired.org_id,retired.site_id,retired.assignment_id,retired.policy_revision,retired.days]);
        caseRetirements++;
      }
      await redactExpiredCase(client,retired.case_id);
    }
    for(const retired of ledger.tables.generated_audio_retirements){
      const target=targets.generated_bundles.get(JSON.stringify([retired.bundle_id]));if(!target || target.state!=='attached')continue;
      const source=indexed.generated_bundles.get(JSON.stringify([retired.bundle_id]));
      if(!['cleaning','cleaned'].includes(source.state))throw Error('Source generated retirement unavailable');
      await journal('generated-audio',retired.bundle_id,identity('generated_bundles',source),retired,originalPolicy('generated_retention_policies',retired));
      if(!targets.generated_audio_retirements.has(keyFor('generated_audio_retirements',retired)))await client.query(
        'INSERT INTO generated_audio_retirements(bundle_id,org_id,site_id,policy_revision,days) VALUES($1,$2,$3,$4,$5)',
        [retired.bundle_id,retired.org_id,retired.site_id,retired.policy_revision,retired.days]);
      await client.query("UPDATE generated_bundles SET state='cleaning',cleanup_token=$2,cleanup_until=clock_timestamp() WHERE id=$1",[retired.bundle_id,randomUUID()]);
      generatedRetirements++;
    }
    for(const retired of ledger.tables.recording_purges){
      const target=targets.recordings.get(JSON.stringify([retired.recording_id]));
      if(!target || targets.recording_purges.has(keyFor('recording_purges',retired)))continue;
      await journal('recording-audio',retired.recording_id,identity('recordings',indexed.recordings.get(JSON.stringify([retired.recording_id]))),retired);
      await client.query("INSERT INTO recording_purges(recording_id,org_id,site_id,status,created_at) VALUES($1,$2,$3,'queued',clock_timestamp())",[retired.recording_id,retired.org_id,retired.site_id]);
      await client.query("UPDATE recordings SET status='failed',lease_token=NULL,lease_until=NULL,retry_at=NULL,error='Restored privacy retirement' WHERE id=$1 AND status<>'storing'",[target.id]);
      queuedAudio++;
    }
    for(const retired of ledger.tables.source_audio_purges){
      const target=current.source_audio_requests.find(row=>row.request_id===retired.request_id);
      if(!target || targets.source_audio_purges.has(keyFor('source_audio_purges',retired)))continue;
      await journal('source-audio',retired.request_id,identity('source_audio_requests',indexed.source_audio_requests.get(JSON.stringify([target.id]))),retired);
      await client.query("INSERT INTO source_audio_purges(request_id,org_id,site_id,reason,status,created_at) VALUES($1,$2,$3,$4,'queued',clock_timestamp())",
        [retired.request_id,retired.org_id,retired.site_id,retired.reason]);queuedAudio++;
    }
    const sourceObjects=new Map(ledger.objects.map(row=>[row.id,row]));
    for(const object of objects)if(object.retained && sourceObjects.get(object.id)?.retained===false){
      if(object.family==='case-followup'){
        const target=targets.case_followup_audio.get(JSON.stringify([object.id])),source=indexed.case_followup_audio.get(JSON.stringify([object.id]));
        if(['cleaning','cleaned'].includes(target.state))continue;
        await journal('followup-audio',object.id,identity('case_followup_audio',source),source);
        await client.query("UPDATE case_followup_audio SET state='cleaning',cleanup_token=$2,cleanup_until=clock_timestamp() WHERE id=$1",[object.id,randomUUID()]);queuedAudio++;
      }else if(object.family==='case-voice'){
        const target=targets.case_voice.get(JSON.stringify([object.id])),source=indexed.case_voice.get(JSON.stringify([object.id]));
        if(['cleaning','cleaned'].includes(target.cleanup_state))continue;
        await journal('case-voice',object.id,identity('case_voice',source),source);
        await client.query("UPDATE case_voice SET cleanup_state='cleaning',cleanup_token=$2,cleanup_until=clock_timestamp() WHERE id=$1",[object.id,randomUUID()]);queuedAudio++;
      }
    }
    await receipt.commit();
    return {...report,duplicate:false,journaled,textRetirements,caseRetirements,generatedRetirements,queuedAudio,
      limitation:'Original historical retirement evidence replayed with fresh target text redaction and queued private-byte removal. Original case clock/outcomes and current policies remain unchanged. Physical absence, restrictions, final cutoff and activation remain required.'};
  });
}
