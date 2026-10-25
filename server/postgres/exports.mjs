import { createHash,randomUUID } from 'node:crypto';
import { publicExport,exportCsv,deletionExportExpiry } from '../exports.mjs';
import {reportActivity} from './reports.mjs';
import {reportScope,exportInput,exportRetryInput,exportRequestId} from '../report-input.mjs';
import { domainTransaction,requirePrincipal,domainAudit } from './domain.mjs';
import {dispatchAllowed,dispatchPredicate} from './operations-gates.mjs';

const roles=['owner','supervisor','auditor'];
const system=(row) => ({...row,principal_type:'system',principal_id:'export-worker'});

async function expireRow(client,row) {
  if (row.status==='expired' || (!row.expired && !row.deletion_expired)) return row;
  await client.query("UPDATE report_exports SET status='expired',snapshot_json=NULL,csv=NULL,checksum=NULL,lease_token=NULL,lease_until=NULL,error=NULL WHERE id=$1",[row.id]);
  await domainAudit(client,system(row),row.deletion_expired?'export.deletion_purged':'export.expired',row.id);
  return {...row,status:'expired',snapshot_json:null,csv:null,checksum:null,lease_token:null,lease_until:null,error:null};
}

async function scopedExport(client,session,id) {
  const row=(await client.query(`SELECT e.*,encode(convert_to(e.csv,'UTF8'),'hex') AS csv_hex,e.expires_at<=clock_timestamp() AS expired,
    ${deletionExportExpiry} AS deletion_expired FROM report_exports e WHERE e.id=$1 AND e.org_id=$2 AND e.site_id=$3 FOR UPDATE`,[id,session.org_id,session.site_id])).rows[0];
  if (!row) throw new Error('Export unavailable');
  return expireRow(client,row);
}

async function expireBatch(client,scope) {
  const rows=(await client.query(`SELECT e.*,true AS expired,${deletionExportExpiry} AS deletion_expired FROM report_exports e
    WHERE (expires_at<=clock_timestamp() OR ${deletionExportExpiry}) AND status!='expired'
    ${scope ? 'AND org_id=$1 AND site_id=$2' : ''} ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED`,scope ? [scope.org_id,scope.site_id] : [])).rows;
  for (const row of rows) await expireRow(client,row);
  return rows.length;
}

export async function expireExports(pool,{schema='public'}={}) {
  return domainTransaction(pool,schema,(client) => expireBatch(client));
}

export async function requestExport(pool,session,body,{schema='public'}={}) {
  body=exportInput(body);
  const filters=reportScope(body.filters);
  return domainTransaction(pool,schema,async (client) => {
    await requirePrincipal(client,session,'staff',roles);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`export:${body.requestId}`]);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`report-retention:${session.org_id}:${body.publicationId}`]);
    const old=(await client.query(`SELECT e.*,expires_at<=clock_timestamp() AS expired,${deletionExportExpiry} AS deletion_expired
      FROM report_exports e WHERE id=$1 FOR UPDATE`,[body.requestId])).rows[0];
    if (old) {
      if (old.org_id!==session.org_id || old.site_id!==session.site_id || old.requested_by!==session.principal_id || old.publication_id!==body.publicationId) throw new Error('Export request ID conflict');
      const {timezone,...oldFilters}=old.filters_json;
      if(JSON.stringify(reportScope(oldFilters))!==JSON.stringify(filters))throw Error('Export request ID conflict');
      return {...publicExport(await expireRow(client,old)),duplicate:true};
    }
    const publication=(await client.query('SELECT id,version,snapshot_json FROM publications WHERE id=$1 AND org_id=$2 AND site_id=$3 FOR SHARE',[body.publicationId,session.org_id,session.site_id])).rows[0];
    if (!publication) throw new Error('Publication unavailable');
    await client.query(`SELECT w.id FROM workers w WHERE EXISTS(SELECT 1 FROM assignments a
      WHERE a.worker_id=w.id AND a.publication_id=$1) ORDER BY w.id FOR SHARE`,[publication.id]);
    if((await client.query(`SELECT 1 FROM worker_deletion_requests d JOIN assignments a ON a.worker_id=d.worker_id
      WHERE a.publication_id=$1 AND NOT EXISTS(SELECT 1 FROM worker_deletion_pseudonyms p WHERE p.request_id=d.id)`,[publication.id])).rows.length)
      throw new Error('Worker deletion pending');
    // One statement snapshots every latest receipt; later submissions never change this export request.
    const timezone=(await client.query('SELECT timezone FROM sites WHERE id=$1 AND org_id=$2',[session.site_id,session.org_id])).rows[0].timezone;
    const selection=await reportActivity(client,session,publication,filters,timezone);
    const snapshot=JSON.stringify(selection.rows);
    if (Buffer.byteLength(snapshot)>2_000_000) throw new Error('Report exceeds export limit');
    const row=(await client.query(`INSERT INTO report_exports(id,org_id,site_id,publication_id,requested_by,created_at,expires_at,status,snapshot_json,filters_json)
      VALUES($1,$2,$3,$4,$5,clock_timestamp(),clock_timestamp()+interval '24 hours','queued',$6,$7) RETURNING *`,
    [body.requestId,session.org_id,session.site_id,publication.id,session.principal_id,snapshot,JSON.stringify({...filters,timezone})])).rows[0];
    await domainAudit(client,session,'export.requested',row.id);
    return {...publicExport(row),duplicate:false};
  });
}

export async function listExports(pool,session,{schema='public'}={}) {
  return domainTransaction(pool,schema,async (client) => {
    await requirePrincipal(client,session,'staff',roles);
    const rows=(await client.query('SELECT id FROM report_exports WHERE org_id=$1 AND site_id=$2 ORDER BY created_at DESC,id LIMIT 50',[session.org_id,session.site_id])).rows;
    // A consistent lock order avoids two history reads holding different expired batches before each other.
    const results=new Map();
    for (const id of rows.map((row) => row.id).sort()) results.set(id,publicExport(await scopedExport(client,session,id)));
    return rows.map((row) => results.get(row.id));
  });
}

const retryResult=row=>({requestId:row.request_id,id:row.export_id,attempts:row.attempts,acceptedAt:row.created_at instanceof Date?row.created_at.toISOString():row.created_at});
export async function exportReceipt(pool,session,kind,requestId,{schema='public'}={}) {
  if(!['create','retry'].includes(kind))throw Error('Invalid export request');exportRequestId(requestId);
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff',roles);
    if(kind==='retry') {
      const row=(await client.query('SELECT * FROM report_export_retries WHERE request_id=$1 AND org_id=$2 AND site_id=$3 AND requested_by=$4',[requestId,session.org_id,session.site_id,session.principal_id])).rows[0];
      return row?{found:true,request:{requestId:row.request_id,exportId:row.export_id,attempts:row.attempts},result:retryResult(row)}:{found:false};
    }
    const row=(await client.query('SELECT * FROM report_exports WHERE id=$1 AND org_id=$2 AND site_id=$3 AND requested_by=$4',[requestId,session.org_id,session.site_id,session.principal_id])).rows[0];
    if(!row)return {found:false};const {timezone,...filters}=row.filters_json;
    return {found:true,request:{requestId:row.id,publicationId:row.publication_id,filters:reportScope(filters)},result:publicExport(row)};
  });
}
export async function retryExport(pool,session,id,body,{schema='public'}={}) {
  const input=exportRetryInput(id,body);
  const result=await domainTransaction(pool,schema,async (client) => {
    await requirePrincipal(client,session,'staff',roles);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`export-retry:${input.requestId}`]);
    const old=(await client.query('SELECT * FROM report_export_retries WHERE request_id=$1',[input.requestId])).rows[0];
    if(old) {
      if(old.org_id!==session.org_id || old.site_id!==session.site_id || old.requested_by!==session.principal_id || old.export_id!==id || old.attempts!==input.attempts)throw Error('Export request ID conflict');
      return {...retryResult(old),duplicate:true};
    }
    const row=await scopedExport(client,session,id);
    if (row.status!=='failed' || row.attempts!==input.attempts || row.attempts>=3 || !row.snapshot_json) return {error:'Export cannot be retried'};
    await client.query("UPDATE report_exports SET status='queued',error=NULL WHERE id=$1",[id]);
    const accepted=(await client.query('INSERT INTO report_export_retries(request_id,org_id,site_id,export_id,requested_by,attempts) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[input.requestId,session.org_id,session.site_id,id,session.principal_id,input.attempts])).rows[0];
    await domainAudit(client,session,'export.retried',id);
    return {...retryResult(accepted),duplicate:false};
  });
  if (result.error && !result.id) throw new Error(result.error);
  return result;
}

export async function downloadExport(pool,session,id,{schema='public'}={}) {
  const result=await domainTransaction(pool,schema,async (client) => {
    await requirePrincipal(client,session,'staff',roles);
    const row=await scopedExport(client,session,id);
    if (row.status==='expired') return {error:'Export expired'};
    if (row.status!=='ready' || !row.csv) return {error:'Export is not ready'};
    // Decode stored bytes explicitly: some PostgreSQL protocol decoders strip an initial UTF-8 BOM from text.
    const csv=Buffer.from(row.csv_hex,'hex').toString('utf8');
    if (createHash('sha256').update(csv).digest('hex')!==row.checksum) throw new Error('Export integrity failed');
    await domainAudit(client,session,'export.downloaded',id);
    return {csv,filename:publicExport(row).filename};
  });
  if (result.error) throw new Error(result.error);
  return result;
}

export async function processOneExport(pool,{schema='public',render=exportCsv}={}) {
  const token=randomUUID();
  const row=await domainTransaction(pool,schema,async (client) => {
    await expireBatch(client);
    const job=(await client.query(`SELECT * FROM report_exports WHERE expires_at>clock_timestamp() AND
      (status='queued' OR (status='processing' AND lease_until<=clock_timestamp()))
      AND ${dispatchPredicate('report_exports')}
      ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`)).rows[0];
    if (!job || !await dispatchAllowed(client,job.org_id)) return null;
    if (job.attempts>=3) {
      await client.query("UPDATE report_exports SET status='failed',error='Export retry limit reached',lease_token=NULL,lease_until=NULL WHERE id=$1",[job.id]);
      await domainAudit(client,system(job),'export.failed',job.id);
      return {exhausted:true};
    }
    await client.query("UPDATE report_exports SET status='processing',attempts=attempts+1,lease_token=$2,lease_until=clock_timestamp()+interval '30 seconds' WHERE id=$1",[job.id,token]);
    return job;
  });
  if (!row) return false;
  if (row.exhausted) return true;
  try {
    const csv=await render(row.snapshot_json);
    if (typeof csv!=='string' || Buffer.byteLength(csv)>2_000_000) throw new Error('Invalid export output');
    await domainTransaction(pool,schema,async (client) => {
      if(!await dispatchAllowed(client,row.org_id))return;
      const active=(await client.query("SELECT id FROM staff WHERE id=$1 AND org_id=$2 AND site_id=$3 AND active=true AND role IN ('owner','supervisor','auditor') FOR SHARE",[row.requested_by,row.org_id,row.site_id])).rows[0];
      if (!active) throw new Error('Requester unavailable');
      await scopedExport(client,{org_id:row.org_id,site_id:row.site_id},row.id);
      const changed=(await client.query(`UPDATE report_exports SET status='ready',csv=$1,checksum=$2,error=NULL,lease_token=NULL,lease_until=NULL
        WHERE id=$3 AND status='processing' AND lease_token=$4 AND lease_until>clock_timestamp() AND expires_at>clock_timestamp() RETURNING id`,
      [csv,createHash('sha256').update(csv).digest('hex'),row.id,token])).rows;
      if (changed.length) await domainAudit(client,system(row),'export.ready',row.id);
    });
  } catch {
    await domainTransaction(pool,schema,async (client) => {
      const changed=(await client.query(`UPDATE report_exports SET status='failed',error='Export generation failed',lease_token=NULL,lease_until=NULL
        WHERE id=$1 AND status='processing' AND lease_token=$2 AND lease_until>clock_timestamp() AND expires_at>clock_timestamp() RETURNING id`,[row.id,token])).rows;
      if (changed.length) await domainAudit(client,system(row),'export.failed',row.id);
    });
  }
  return true;
}
