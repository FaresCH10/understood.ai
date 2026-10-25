import {createHash,randomUUID} from 'node:crypto';
import {schemaName} from './migrate.mjs';
import {withTransaction} from './db.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const scoped=async(client,schema)=>{
  schemaName(schema);
  await client.query("SELECT set_config('search_path',quote_ident($1)||',pg_catalog,pg_temp',true)",[schema]);
  await client.query("SET LOCAL timezone='UTC'");
};

export async function backupTables(client,schema) {
  schemaName(schema);
  return (await client.query(`SELECT tablename AS name,quote_ident(schemaname)||'.'||quote_ident(tablename) AS identifier
    FROM pg_tables WHERE schemaname=$1 ORDER BY tablename COLLATE "C"`,[schema])).rows;
}

// Hash the complete database rows, not a hand-maintained subset of business tables.
export async function databaseInventory(client,schema='public') {
  await scoped(client,schema);
  const tables=[];
  for(const table of await backupTables(client,schema)) {
    const digest=createHash('sha256');let count=0;
    await client.query(`DECLARE understood_backup_rows NO SCROLL CURSOR FOR
      SELECT to_jsonb(t)::text AS payload FROM ${table.identifier} t ORDER BY to_jsonb(t)::text COLLATE "C"`);
    try {
      for(;;) {
        const rows=(await client.query('FETCH FORWARD 100 FROM understood_backup_rows')).rows;
        if(!rows.length)break;
        for(const {payload} of rows){digest.update(payload+'\n');count++;}
      }
    }finally {await client.query('CLOSE understood_backup_rows');}
    tables.push({name:table.name,count,sha256:digest.digest('hex')});
  }
  const sequences=[];
  for(const row of (await client.query(`SELECT sequencename AS name,quote_ident(schemaname)||'.'||quote_ident(sequencename) AS identifier
    FROM pg_sequences WHERE schemaname=$1 ORDER BY sequencename COLLATE "C"`,[schema])).rows) {
    const value=(await client.query(`SELECT last_value::text AS value,is_called FROM ${row.identifier}`)).rows[0];
    sequences.push({name:row.name,...value});
  }
  const definitions=(await client.query(`SELECT kind,name,definition,validated FROM (
    SELECT 'constraint' AS kind,c.relname||'.'||k.conname AS name,pg_get_constraintdef(k.oid,true) AS definition,k.convalidated AS validated
      FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1
    UNION ALL SELECT 'trigger',c.relname||'.'||t.tgname,pg_get_triggerdef(t.oid,true),NULL::boolean
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND NOT t.tgisinternal
    UNION ALL SELECT 'function',p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',pg_get_functiondef(p.oid),NULL::boolean
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.prokind IN ('f','p')
    ) d ORDER BY kind COLLATE "C",name COLLATE "C",definition COLLATE "C"`,[schema])).rows;
  // These three checks intentionally preserve honestly unknown historical provider inputs.
  if((await client.query(`SELECT 1 FROM pg_constraint k JOIN pg_namespace n ON n.oid=k.connamespace JOIN pg_class c ON c.oid=k.conrelid
    WHERE n.nspname=$1 AND NOT k.convalidated AND NOT (c.relname='provider_operations' AND k.contype='c'
      AND k.conname IN ('audio_operations_provenance','followup_operations_provenance','preparation_operations_provenance')) LIMIT 1`,[schema])).rows.length)
    throw Error('Backup constraints must be validated');
  return {tables,sequences,definitionsSha256:hash(JSON.stringify(definitions))};
}

export async function privateObjectInventory(client) {
  const rows=(await client.query(`SELECT * FROM (
    SELECT 'recording' AS family,r.id,r.org_id,r.site_id,r.sha256,r.bytes,'wav' AS format,
      (r.received_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM recording_purges p WHERE p.recording_id=r.id)
        AND NOT EXISTS(SELECT 1 FROM worker_deletion_requests d JOIN assignments a ON a.worker_id=d.worker_id WHERE a.id=r.assignment_id)) AS retained
      FROM recordings r
    UNION ALL SELECT 'source',s.id,s.org_id,s.site_id,s.sha256,s.bytes,'wav',
      (s.received_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM source_audio_purges p WHERE p.request_id=s.request_id)) FROM source_audio_requests s
    UNION ALL SELECT 'source-original',s.original_id,s.org_id,s.site_id,s.original_sha256,s.original_bytes,'original',
      (s.received_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM source_audio_purges p WHERE p.request_id=s.request_id)) FROM source_audio_requests s
    UNION ALL SELECT 'generated',a.id::text,a.org_id,a.site_id,a.sha256,a.bytes,'wav',
      (b.state IN ('stored','attached') AND NOT EXISTS(SELECT 1 FROM generated_audio_retirements d WHERE d.bundle_id=b.id))
      FROM generated_audio a JOIN generated_bundles b ON b.id=a.bundle_id
    UNION ALL SELECT 'case-followup',a.id,a.org_id,a.site_id,a.sha256,a.bytes,'wav',
      (a.state='attached' AND f.status='delivered' AND NOT EXISTS(SELECT 1 FROM case_content_purges p WHERE p.case_id=f.case_id)
        AND NOT EXISTS(SELECT 1 FROM worker_deletion_requests d JOIN assignments x ON x.worker_id=d.worker_id WHERE x.id=f.assignment_id))
      FROM case_followup_audio a JOIN case_followups f ON f.id=a.request_id
    UNION ALL SELECT 'case-voice',v.id,v.org_id,v.site_id,v.sha256,v.bytes,'wav',
      (v.status='received' AND v.cleanup_state='active' AND NOT EXISTS(SELECT 1 FROM case_content_purges p WHERE p.case_id=v.requested_case_id)
        AND NOT EXISTS(SELECT 1 FROM worker_deletion_requests d WHERE d.worker_id=v.worker_id)) FROM case_voice v
    ) objects ORDER BY family COLLATE "C",id COLLATE "C"`)).rows;
  const seen=new Set();
  for(const row of rows) {
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.id)
      || ![row.org_id,row.site_id].every(value=>/^[a-zA-Z0-9_-]{1,100}$/.test(value))
      || !/^[a-f0-9]{64}$/.test(row.sha256) || !Number.isInteger(row.bytes) || row.bytes<1
      || row.bytes>(row.format==='original'?10485760:2880044))throw Error('Invalid backup private object reference');
    const key=row.id.toLowerCase();
    if(seen.has(key))throw Error('Backup private object identity collision');
    seen.add(key);
  }
  return rows;
}

export async function withBackupSnapshot(pool,{schema='public',writersStopped=false}={},callback) {
  if(writersStopped!==true)throw Error('Stop all writers and cleanup workers before backup');
  schemaName(schema);
  return withTransaction(pool,async client=>{
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await scoped(client,schema);
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`understood:migrations:${schema}`]);
    const tables=await backupTables(client,schema);
    if(!tables.some(row=>row.name==='schema_migrations'))throw Error('Backup requires an initialized application schema');
    await client.query(`LOCK TABLE ${tables.map(row=>row.identifier).join(',')} IN SHARE MODE`);
    const control=(await client.query("SELECT jobs_paused,provider_paused FROM system_controls WHERE id='global'")).rows[0];
    if(!control?.jobs_paused || !control?.provider_paused)throw Error('Pause jobs and providers before backup');
    if((await client.query("SELECT 1 FROM worker_health WHERE state<>'stopped' AND seen_at>clock_timestamp()-interval '2 minutes' LIMIT 1")).rows.length)
      throw Error('Backup worker shutdown is not yet verified');
    const leases=(await client.query(`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1
      AND column_name IN ('lease_until','cleanup_until') ORDER BY table_name,column_name`,[schema])).rows;
    for(const lease of leases) {
      const table=tables.find(row=>row.name===lease.table_name);
      if(table && (await client.query(`SELECT 1 FROM ${table.identifier} WHERE ${lease.column_name}>clock_timestamp() LIMIT 1`)).rows.length)
        throw Error('Backup has an outstanding operation lease');
    }
    const snapshot=(await client.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
    const database=await databaseInventory(client,schema),objects=await privateObjectInventory(client);
    return callback({snapshot,schema,database,objects},client);
  });
}

export async function verifyRestoredInventory(pool,expected,{schema='public'}={}) {
  return withTransaction(pool,async client=>{
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const database=await databaseInventory(client,schema),objects=await privateObjectInventory(client);
    if(JSON.stringify(database)!==JSON.stringify(expected.database) || JSON.stringify(objects)!==JSON.stringify(expected.objects))
      throw Error('Restored database inventory does not match the backup');
    return {tables:database.tables.length,rows:database.tables.reduce((n,t)=>n+t.count,0),objects:objects.filter(row=>row.retained).length};
  });
}

// This never activates a restore. Later deletions and elapsed policies must be reconciled before release.
export async function quarantineRestoredDatabase(pool,{schema='public',backupId,expected}={}) {
  if(!/^[0-9a-f-]{36}$/i.test(backupId || ''))throw Error('Invalid backup identity');
  return withTransaction(pool,async client=>{
    await scoped(client,schema);
    let before;
    if(expected!==undefined){
      if(expected.schema!==undefined && expected.schema!==schema || expected.id!==undefined && expected.id!==backupId)throw Error('Quarantine baseline scope mismatch');
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`understood:migrations:${schema}`]);
      const tables=await backupTables(client,schema);
      await client.query(`LOCK TABLE ${tables.map(row=>row.identifier).join(',')} IN SHARE MODE`);
      before={database:await databaseInventory(client,schema),objects:await privateObjectInventory(client)};
      if(JSON.stringify(before.database)!==JSON.stringify(expected.database) || JSON.stringify(before.objects)!==JSON.stringify(expected.objects))
        throw Error('Quarantine baseline does not match the restored database');
    }
    const pushTables=(await client.query("SELECT to_regclass('push_subscriptions') AS subscriptions,to_regclass('push_deliveries') AS deliveries")).rows[0];
    if(pushTables.subscriptions){
      await client.query(`UPDATE push_subscriptions SET revoked_at=clock_timestamp(),revoke_reason='restore_quarantine',updated_at=clock_timestamp()
        WHERE revoked_at IS NULL`);
      if(pushTables.deliveries)await client.query(`UPDATE push_deliveries SET state='cancelled',last_error='restore_quarantine',updated_at=clock_timestamp()
        WHERE state IN ('queued','sending')`);
    }
    await client.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE revoked_at IS NULL');
    await client.query('UPDATE worker_grants SET revoked_at=clock_timestamp() WHERE revoked_at IS NULL');
    await client.query('UPDATE worker_setup_tokens SET revoked_at=clock_timestamp() WHERE revoked_at IS NULL');
    await client.query('DELETE FROM worker_credentials');
    await client.query('UPDATE operator_sessions SET revoked_at=clock_timestamp() WHERE revoked_at IS NULL');
    await client.query('UPDATE staff_accounts SET active=false WHERE active=true');
    await client.query('UPDATE platform_operators SET active=false,revision=revision+1 WHERE active=true');
    await client.query('UPDATE staff_recovery_tokens SET revoked_at=clock_timestamp() WHERE revoked_at IS NULL AND used_at IS NULL');
    await client.query('UPDATE staff_invitation_tokens SET revoked_at=clock_timestamp() WHERE revoked_at IS NULL AND used_at IS NULL');
    await client.query('UPDATE registration_tokens SET revoked_at=clock_timestamp() WHERE revoked_at IS NULL AND used_at IS NULL');
    await client.query("UPDATE staff_recovery_mail SET state='expired',payload=NULL,lease_token=NULL,lease_until=NULL WHERE state IN ('queued','processing')");
    await client.query("UPDATE staff_invitation_mail SET state='expired',payload=NULL,lease_token=NULL,lease_until=NULL WHERE state IN ('queued','processing')");
    await client.query("UPDATE registration_mail SET state='expired',payload=NULL,lease_token=NULL,lease_until=NULL WHERE state IN ('queued','processing')");
    await client.query("UPDATE organization_registrations SET state='expired',payload=NULL WHERE state='pending'");
    await client.query("UPDATE pilot_inquiries SET state='expired',content_json=NULL,destination=NULL,lease_token=NULL,lease_until=NULL WHERE state IN ('saved','queued','processing')");
    await client.query("UPDATE staff_invitations SET state='cancelled',revision=revision+1,email_payload=NULL WHERE state='pending'");
    await client.query(`INSERT INTO system_controls(id,revision,jobs_paused,provider_paused) VALUES('global',1,true,true)
      ON CONFLICT(id) DO UPDATE SET revision=system_controls.revision+1,jobs_paused=true,provider_paused=true,updated_at=clock_timestamp()`);
    await client.query(`INSERT INTO tenant_controls(org_id,revision,state,reason) SELECT id,1,'suspended','maintenance' FROM organizations
      ON CONFLICT(org_id) DO UPDATE SET revision=tenant_controls.revision+1,state='suspended',reason='maintenance',updated_at=clock_timestamp()`);
    await client.query('UPDATE provider_policies SET enabled=false,revision=revision+1,changed_at=clock_timestamp()');
    await client.query("UPDATE provider_requests SET state='uncertain',finished_at=clock_timestamp() WHERE state='started'");
    await client.query("UPDATE provider_verifications SET state='uncertain',finished_at=clock_timestamp() WHERE state='pending'");
    await client.query("UPDATE worker_health SET state='stopped',stage=NULL,seen_at=clock_timestamp()");
    await client.query("UPDATE report_exports SET status='expired',snapshot_json=NULL,csv=NULL,checksum=NULL,lease_token=NULL,lease_until=NULL WHERE status<>'expired' AND expires_at<=clock_timestamp()");
    await client.query("UPDATE worker_imports SET status='expired',rows_json=NULL,errors_json=NULL WHERE status<>'expired' AND expires_at<=clock_timestamp()");
    const sites=(await client.query('SELECT id,org_id FROM sites ORDER BY id')).rows;
    for(const site of sites)await client.query(`INSERT INTO audit(id,org_id,site_id,actor_type,actor_id,action,object_id)
      VALUES($1,$2,$3,'system','restore-operator','backup.restore.quarantined',$4)`,[randomUUID(),site.org_id,site.id,backupId]);
    let state;
    if(before){
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      const database=await databaseInventory(client,schema),objects=await privateObjectInventory(client);
      const changed=new Set(['sessions','worker_grants','worker_setup_tokens','worker_credentials','operator_sessions','staff_accounts','platform_operators','staff_recovery_tokens',
        'staff_invitation_tokens','staff_recovery_mail','staff_invitation_mail','registration_tokens','registration_mail','organization_registrations','pilot_inquiries','staff_invitations','system_controls','tenant_controls',
        'provider_policies','provider_requests','provider_verifications','worker_health','report_exports','worker_imports','audit','operational_audit_receipts',
        'push_subscriptions','push_deliveries']);
      if(database.definitionsSha256!==before.database.definitionsSha256 || JSON.stringify(database.sequences)!==JSON.stringify(before.database.sequences)
        || JSON.stringify(database.tables.filter(row=>!changed.has(row.name)))!==JSON.stringify(before.database.tables.filter(row=>!changed.has(row.name)))
        || JSON.stringify(objects)!==JSON.stringify(before.objects))throw Error('Quarantine changed unrelated restored evidence');
      const capturedAt=new Date((await client.query('SELECT clock_timestamp() AS now')).rows[0].now).toISOString();
      state={format:'understood-restore-quarantine-state-v1',backupId,capturedAt,baselineInventorySha256:hash(JSON.stringify(before)),database,objects,
        operation:'backup.restore.quarantined',activationAllowed:false,productionReady:false};
    }
    return {quarantined:true,sites:sites.length,activationAllowed:false,...(state?{state}: {})};
  });
}
