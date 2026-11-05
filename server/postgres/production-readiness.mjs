import {domainTransaction} from './domain.mjs';
import {assertProductionAdmission} from './production-admission.mjs';

// Public operational summary only: no worker IDs, tenants, jobs or provider keys.
export async function readProductionReadiness(pool,config){
  assertProductionAdmission(config);
  const worker=await domainTransaction(pool,config.schema,async client=>{
    const rows=(await client.query("SELECT state,failure_stages FROM worker_health WHERE seen_at>clock_timestamp()-interval '30 seconds' AND state IN ('idle','busy') LIMIT 50")).rows;
    return !rows.length?'not responding':rows.some(row=>JSON.parse(typeof row.failure_stages==='string'?row.failure_stages:JSON.stringify(row.failure_stages)).length)?'degraded':'responding';
  });
  const attachments=typeof config.attachmentScanner?.scan==='function'?'configured':'unavailable';
  return {status:worker==='responding'&&attachments==='configured'?'ready':'degraded',mode:'live-credential',worker,attachments};
}
