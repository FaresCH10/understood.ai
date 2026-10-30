import {domainTransaction,requirePrincipal} from './domain.mjs';
import {workspaceOperation} from '../workspace.mjs';
import {requireWritableEntitlement} from './entitlements.mjs';
export async function postgresWorkspace(pool,session,operation,input,{schema='public'}={}){
 return domainTransaction(pool,schema,async client=>{
  await requirePrincipal(client,session,session.principal_type,['owner','supervisor','auditor']);
  if(input.content||input.file||input.complete)await requireWritableEntitlement(client,session.org_id);
  // Serialize composition uploads and completions within their tenant.
  if(input.content||input.file||input.complete)await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${session.org_id}:${session.site_id}:workspace`]);
  return workspaceOperation(async(sql,values=[])=>{let n=0;return (await client.query(sql.replace(/\?/g,()=>`$${++n}`),values)).rows;},session,operation,input);
 });
}
