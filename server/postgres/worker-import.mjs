import { randomUUID } from 'node:crypto';
import { importInput,parseWorkerCsv,publicImport,importErrorsCsv,importFilenameHash,importFilenameMatches,importLabelHashes } from '../worker-import.mjs';
import { validateWorkerInput } from '../people.mjs';
import { domainTransaction,requirePrincipal,domainAudit } from './domain.mjs';
import { requireWritableEntitlement } from './entitlements.mjs';
import { requireWorkerCapacity } from './worker-capacity.mjs';

const deletionImportExpiry=`EXISTS(SELECT 1 FROM worker_deletion_requests d JOIN workers w ON w.id=d.worker_id
  WHERE d.org_id=i.org_id AND (strpos(i.filename,w.code)>0 OR EXISTS(
    SELECT 1 FROM jsonb_array_elements(COALESCE(i.rows_json,'[]'::jsonb)) entry WHERE entry->>'workerId'=w.code)))`;

async function expireRow(client,session,row){
  if(row.deletion_expired && !row.filename_hash){
    row.filename_hash=importFilenameHash(row.filename);row.filename='[Deleted].csv';
    await client.query("UPDATE worker_imports SET status='expired',rows_json=NULL,errors_json=NULL,filename=$1,filename_hash=$2 WHERE id=$3",
      [row.filename,row.filename_hash,row.id]);
  }else await client.query("UPDATE worker_imports SET status='expired',rows_json=NULL,errors_json=NULL WHERE id=$1",[row.id]);
  await domainAudit(client,{...session,principal_type:'system',principal_id:'import-worker'},row.deletion_expired?'workers.import_deletion_purged':'workers.import_expired',row.id);
  row.status='expired';row.rows_json=null;row.errors_json=null;
}

async function scopedRow(client,session,id) {
  const row=(await client.query(`SELECT i.*,expires_at<=clock_timestamp() AS expired,${deletionImportExpiry} AS deletion_expired
    FROM worker_imports i WHERE id=$1 AND org_id=$2 AND site_id=$3 FOR UPDATE`,[id,session.org_id,session.site_id])).rows[0];
  if (!row) throw new Error('Import unavailable');
  if ((row.expired && row.status!=='expired') || (row.deletion_expired && !row.filename_hash))await expireRow(client,session,row);
  return row;
}

async function revalidate(client,session,rows,{lockCrews=false,filename=''}={}) {
  if (!Array.isArray(rows) || rows.length>1000) throw new Error('Fix CSV errors before importing');
  const existing=new Set((await client.query(`SELECT code FROM workers WHERE org_id=$1 AND (code=ANY($2::text[]) OR strpos($3,code)>0)
    ORDER BY id FOR SHARE`,[session.org_id,rows.map((row) => row.workerId),filename])).rows.map((row) => row.code));
  if((await client.query('SELECT 1 FROM worker_deletion_pseudonyms WHERE org_id=$1 AND code_hash=ANY($2::text[])',
    [session.org_id,importLabelHashes(rows,filename)])).rows.length)throw new Error('CSV contains unavailable worker IDs');
  const crews=(await client.query(`SELECT id,name FROM crews WHERE org_id=$1 AND site_id=$2 AND active=true AND name=ANY($3::text[])
    ORDER BY id ${lockCrews ? 'FOR SHARE' : ''}`,[session.org_id,session.site_id,rows.map((row) => row.crew).filter(Boolean)])).rows;
  const crewIds=new Map(crews.map((row) => [row.name,row.id])),seen=new Set();
  const checked=rows.map((row) => {
    const errors=[];
    try {validateWorkerInput({code:row.workerId,language:row.language});} catch (error) {errors.push(error.message);}
    if (seen.has(row.workerId)) errors.push('Duplicate worker ID in file');
    seen.add(row.workerId);
    if (existing.has(row.workerId)) errors.push('Worker ID already exists');
    if (row.crew && !crewIds.has(row.crew)) errors.push('Crew is not available at this site');
    return {...row,errors,valid:!errors.length};
  });
  return {rows:checked,crewIds};
}

async function preview(client,session,row) {
  const rows=row.rows_json || [],errors=row.errors_json || [];
  return publicImport(row,row.status==='validated' ? (await revalidate(client,session,rows)).rows : rows,errors);
}

export async function previewWorkerImport(pool,session,input,{schema='public'}={}) {
  const {requestId,filename,bytes,sha}=importInput(input),parsed=parseWorkerCsv(bytes);
  return domainTransaction(pool,schema,async (client) => {
    await requirePrincipal(client,session,'staff');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`import:${requestId}`]);
    const old=(await client.query('SELECT * FROM worker_imports WHERE id=$1',[requestId])).rows[0];
    if (old) {
      if (old.org_id!==session.org_id || old.site_id!==session.site_id || old.requested_by!==session.principal_id || old.sha256!==sha || !importFilenameMatches(old,filename)) throw new Error('Import request ID conflict');
      return {...await preview(client,session,await scopedRow(client,session,requestId)),duplicate:true};
    }
    const {rows}=await revalidate(client,session,parsed.rows,{filename});
    const row=(await client.query(`INSERT INTO worker_imports(id,org_id,site_id,requested_by,filename,sha256,status,rows_json,errors_json,created_at,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,'validated',$7,$8,clock_timestamp(),clock_timestamp()+interval '24 hours') RETURNING *`,
    [requestId,session.org_id,session.site_id,session.principal_id,filename,sha,JSON.stringify(rows),JSON.stringify(parsed.errors)])).rows[0];
    await domainAudit(client,session,'workers.import_validated',requestId);
    return {...await preview(client,session,await scopedRow(client,session,row.id)),duplicate:false};
  });
}

export async function getWorkerImport(pool,session,id,{schema='public'}={}) {
  return domainTransaction(pool,schema,async (client) => {
    await requirePrincipal(client,session,'staff');
    return preview(client,session,await scopedRow(client,session,id));
  });
}

export async function confirmWorkerImport(pool,session,id,{schema='public'}={}) {
  try {
    const result=await domainTransaction(pool,schema,async (client) => {
      await requirePrincipal(client,session,'staff');
      const row=await scopedRow(client,session,id);
      // Return errors after commit so an expired request's purge is not rolled back by its denial.
      if (row.status==='expired') return {error:'Import expired'};
      if (row.status==='imported') return {id,status:'imported',imported:row.imported_count,duplicate:true};
      await requireWritableEntitlement(client,session.org_id);
      const {rows,crewIds}=await revalidate(client,session,row.rows_json,{lockCrews:true});
      if (row.errors_json.length || !rows.length || rows.some((entry) => !entry.valid)) throw new Error('Fix CSV errors before importing');
      await requireWorkerCapacity(client, session.org_id, rows.length);
      for (const entry of rows) {
        const workerId=randomUUID();
        await client.query('INSERT INTO workers(id,org_id,site_id,code,language) VALUES($1,$2,$3,$4,$5)',[workerId,session.org_id,session.site_id,entry.workerId,entry.language]);
        if (entry.crew) await client.query('INSERT INTO crew_memberships(worker_id,org_id,site_id,crew_id) VALUES($1,$2,$3,$4)',[workerId,session.org_id,session.site_id,crewIds.get(entry.crew)]);
      }
      await client.query("UPDATE worker_imports SET status='imported',imported_count=$1 WHERE id=$2",[rows.length,id]);
      await domainAudit(client,session,'workers.imported',id);
      return {id,status:'imported',imported:rows.length,duplicate:false};
    });
    if (result.error) throw new Error(result.error);
    return result;
  } catch (error) {
    // The unique constraint covers concurrent creation after preview without a partial import or site disclosure.
    if (error.code==='23505') throw new Error('Fix CSV errors before importing');
    throw error;
  }
}

export async function workerImportErrorsCsv(pool,session,id,{schema='public'}={}) {
  const result=await domainTransaction(pool,schema,async (client) => {
    await requirePrincipal(client,session,'staff');
    const row=await scopedRow(client,session,id);
    if (row.status==='expired') return {error:'Import expired'};
    const csv=importErrorsCsv(await preview(client,session,row));
    await domainAudit(client,session,'workers.import_errors_downloaded',id);
    return {csv};
  });
  if (result.error) throw new Error(result.error);
  return result.csv;
}

export async function expireWorkerImports(pool,{schema='public'}={}) {
  return domainTransaction(pool,schema,async (client) => {
    const rows=(await client.query(`SELECT i.*,${deletionImportExpiry} AS deletion_expired FROM worker_imports i
      WHERE (expires_at<=clock_timestamp() AND status!='expired') OR (${deletionImportExpiry} AND i.filename_hash IS NULL)
      ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED`)).rows;
    for (const row of rows) {
      await expireRow(client,row,row);
    }
    return rows.length;
  });
}
