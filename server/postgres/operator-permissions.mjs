const fields=value=>value?value.split(' '):[];
const updateGuardSha256='4eee91ca2a85465fe44d25c9a1877bbbb63493adcedf088cb0044afac25bcf39';
const guardTables=['organizations','sites','platform_operators','sessions','operator_sessions','briefings','jobs','assessment_jobs','report_exports'];
const row=(select,insert='',update='',remove=false)=>Object.freeze({select:Object.freeze(fields(select)),insert:Object.freeze(fields(insert)),update:Object.freeze(fields(update)),remove});
const policy=Object.freeze({
  schema_migrations:row('version checksum'),
  platform_operators:row('id email name active revision password_salt password_hash','','id'),
  operator_sessions:row('token_hash operator_id operator_revision expires_at revoked_at','token_hash operator_id operator_revision expires_at revoked_at','revoked_at',true),
  operator_auth_attempts:row('key_hash count window_started_at','key_hash count window_started_at','count',true),
  operator_requests:row('request_id operator_id request_json result_json created_at','request_id operator_id request_json result_json'),
  operator_audit:row('id operator_id action object_type object_id created_at','id operator_id action object_type object_id'),
  organizations:row('id name','','id'),
  sites:row('id org_id name','','id'),
  workers:row('id org_id site_id code active'),
  staff:row('id org_id site_id role active'),
  sessions:row('org_id site_id principal_id principal_type access_mode grant_id revoked_at expires_at','','revoked_at'),
  worker_grants:row('id org_id site_id worker_id redeemed_at revoked_at expires_at'),
  site_lifecycle:row('site_id org_id state'),
  site_access_controls:row('site_id org_id state'),
  tenant_controls:row('org_id revision state reason updated_at','org_id revision state reason updated_at','revision state reason updated_at'),
  organization_entitlements:row('org_id state started_at ends_at worker_limit plan terms_reference revision updated_by updated_at',
    'org_id state started_at ends_at worker_limit plan terms_reference revision updated_by updated_at',
    'state started_at ends_at worker_limit plan terms_reference revision updated_by updated_at'),
  organization_entitlement_transitions:row('org_id revision state started_at ends_at worker_limit plan terms_reference reason actor_type actor_id request_id created_at',
    'org_id revision state started_at ends_at worker_limit plan terms_reference reason actor_type actor_id request_id created_at'),
  organization_activation_requests:row('request_id org_id site_id requested_by note entitlement_revision state created_at decided_at decided_by decision_ref',
    '','state decided_at decided_by decision_ref'),
  system_controls:row('id revision jobs_paused provider_paused updated_at','id revision jobs_paused provider_paused updated_at','revision jobs_paused provider_paused updated_at'),
  provider_policies:row('scope_key org_id revision enabled max_daily_requests changed_at','scope_key org_id revision enabled max_daily_requests','revision enabled max_daily_requests changed_at'),
  provider_operations:row('id org_id kind reference_id claim_token model data_class quota_day reserved_requests','id org_id kind reference_id claim_token model data_class reserved_requests quota_day input_hash provenance_json preparation_context_json'),
  provider_requests:row('operation_id state'),
  provider_verifications:row('request_id operator_id session_hash operation_id config_hash request_json state deadline_at created_at finished_at test_stage language result_json diagnostic_code','request_id operator_id session_hash operation_id config_hash request_json state deadline_at test_stage language'),
  provider_verification_authorities:row('request_id expires_at revoked','request_id expires_at revoked','revoked'),
  provider_verification_jobs:row('request_id operation_id config_hash model test_stage language max_requests deadline_at created_at status attempts finished_at result_json diagnostic_code','request_id operation_id config_hash model test_stage language max_requests deadline_at'),
  provider_verification_workers:row('config_hash capability_hash state seen_at'),
  worker_health:row('id state stage started_at seen_at failure_stages last_failure_at'),
  storage_probes:row('id adapter state result readback_verified created_at completed_at'),
  jobs:row('id org_id site_id briefing_id revision kind status attempts created_at lease_until lease_token','','status attempts lease_token lease_until error due_at'),
  assessment_jobs:row('id org_id site_id attempt_id status attempts created_at lease_until lease_token','','status attempts lease_token lease_until error due_at'),
  report_exports:row('id org_id site_id publication_id requested_by expires_at status attempts created_at lease_until lease_token snapshot_available','','status attempts lease_token lease_until error'),
  source_audio_requests:row('request_id org_id status attempts created_at lease_until'),
  publication_schedules:row('id org_id state attempts created_at'),
  briefings:row('id org_id site_id revision state','','state prepared_json updated_at'),
  briefing_archives:row('briefing_id'),
  briefing_content_purges:row('briefing_id'),
  briefing_regeneration_requests:row('job_id'),
  attempts:row('id org_id site_id assignment_id assessment_status'),
  assignments:row('id org_id site_id worker_id publication_id'),
  worker_deletion_requests:row('id org_id site_id worker_id created_at'),
  worker_deletion_pseudonyms:row('request_id'),
});

export function operatorColumnPolicy() {
  return Object.entries(policy).map(([table,value])=>({table,...value,select:[...value.select],insert:[...value.insert],update:[...value.update]}));
}

export async function inspectColumnRuntimeGuards(client,schema) {
  const guards=(await client.query(`WITH guard AS (
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
    WHERE n.nspname=$1 AND p.proname='restrict_column_runtime_update' AND p.pronargs=0 AND p.prorettype='trigger'::regtype
      AND p.prokind='f' AND NOT p.prosecdef AND p.proconfig IS NULL AND l.lanname='plpgsql'
      AND encode(sha256(convert_to(replace(p.prosrc,chr(13)||chr(10),chr(10)),'UTF8')),'hex')=$2)
    SELECT (SELECT COUNT(*) FROM guard)=1 AND
      (SELECT COUNT(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
       JOIN guard g ON g.oid=t.tgfoid WHERE n.nspname=$1 AND c.relname=ANY($3::text[])
        AND t.tgname='column_runtime_update' AND t.tgenabled='O' AND t.tgtype=19 AND NOT t.tgisinternal
        AND t.tgattr::text='' AND t.tgqual IS NULL AND t.tgnargs=0 AND octet_length(t.tgargs)=0)=9
      AND EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE n.nspname=$1 AND c.relname='report_exports' AND a.attname='snapshot_available' AND a.attgenerated='s'
          AND a.atttypid='boolean'::regtype AND NOT a.attisdropped AND pg_get_expr(d.adbin,d.adrelid)='(snapshot_json IS NOT NULL)') AS valid`,
  [schema,updateGuardSha256,guardTables])).rows[0];
  if(!guards?.valid)throw Error('Operator runtime guards do not match policy');
}

export async function inspectOperatorColumns(client,{schema,role}) {
  await inspectColumnRuntimeGuards(client,schema);
  const rows=operatorColumnPolicy();
  const missing=(await client.query(`WITH policy AS (SELECT * FROM jsonb_to_recordset($2::jsonb)
    AS p("table" text,"select" jsonb,"insert" jsonb,"update" jsonb))
    SELECT 1 FROM policy p CROSS JOIN LATERAL jsonb_array_elements_text(p."select"||p."insert"||p."update") col(name)
    WHERE NOT EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=$1 AND c.relname=p."table" AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped AND a.attname=col.name) LIMIT 1`,[schema,JSON.stringify(rows)])).rows.length;
  if(missing)throw Error('Operator policy requires the complete current column schema');
  const invalid=(await client.query(`WITH policy AS (SELECT * FROM jsonb_to_recordset($3::jsonb)
    AS p("table" text,"select" jsonb,"insert" jsonb,"update" jsonb,remove boolean)),objects AS (
    SELECT c.oid,c.relname,c.relacl,p."select",p."insert",p."update",COALESCE(p.remove,false) AS remove
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN policy p ON p."table"=c.relname
    WHERE n.nspname=$2 AND c.relkind IN ('r','p','v','m','f')),tables AS (
    SELECT o.*,v.privilege,(v.privilege='DELETE' AND o.remove) AS expected
    FROM objects o CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) v(privilege)),columns AS (
    SELECT o.oid,a.attnum,a.attacl,v.privilege,
      COALESCE(CASE v.privilege WHEN 'SELECT' THEN o."select" WHEN 'INSERT' THEN o."insert" WHEN 'UPDATE' THEN o."update" ELSE '[]'::jsonb END ? a.attname,false) AS expected
    FROM objects o JOIN pg_attribute a ON a.attrelid=o.oid AND a.attnum>0 AND NOT a.attisdropped
    CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) v(privilege))
    SELECT 1 WHERE EXISTS(SELECT 1 FROM tables t WHERE has_table_privilege($1,t.oid,t.privilege) IS DISTINCT FROM t.expected
      OR has_table_privilege($1,t.oid,t.privilege||' WITH GRANT OPTION')
      OR EXISTS(SELECT 1 FROM aclexplode(t.relacl) acl WHERE acl.grantee=0))
    OR EXISTS(SELECT 1 FROM columns c WHERE has_column_privilege($1,c.oid,c.attnum,c.privilege) IS DISTINCT FROM c.expected
      OR has_column_privilege($1,c.oid,c.attnum,c.privilege||' WITH GRANT OPTION')
      OR EXISTS(SELECT 1 FROM aclexplode(c.attacl) acl WHERE acl.grantee=0))`,[role,schema,JSON.stringify(rows)])).rows.length;
  if(invalid)throw Error('Runtime table or column privileges do not match operator policy');
}
