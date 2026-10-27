import {bundleHash} from '../ai/prepared-bundle.mjs';
import {checkedPreparationOperation,preparationStageProvenance} from '../ai/preparation-provenance.mjs';

const fail=()=>{throw Error('Generated provider evidence unavailable');};
const uuid=value=>typeof value==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);

export async function preparationBundleOperations(client,bundle) {
  if(bundle.provider_operation_count===null)return null;
  const rows=(await client.query(`SELECT o.* FROM generated_bundle_operations link JOIN provider_operations o ON o.id=link.operation_id
    WHERE link.bundle_id=$1 AND link.org_id=$2 AND link.site_id=$3 AND link.job_id=$4 ORDER BY o.created_at,o.id`,
    [bundle.id,bundle.org_id,bundle.site_id,bundle.job_id])).rows;
  const all=(await client.query("SELECT id FROM provider_operations WHERE kind='preparation' AND reference_id=$1 AND org_id=$2 AND claim_token=$3",[bundle.job_id,bundle.org_id,bundle.job_lease])).rows;
  if(rows.length!==bundle.provider_operation_count || all.length!==rows.length || all.some(row=>!rows.some(operation=>operation.id===row.id)))fail();
  const requests=(await client.query('SELECT operation_id,state,cleanup,sequence FROM provider_requests WHERE operation_id=ANY($1::text[])',[rows.map(row=>row.id)])).rows;
  const events=(await client.query(`SELECT step,stage,language,track,state,origin FROM preparation_stage_events
    WHERE job_id=$1 AND run_id=$2 AND step=ANY($3::integer[])`,[bundle.job_id,bundle.job_lease,rows.map(row=>row.preparation_context_json?.step)])).rows;
  const provider=bundle.manifest_json.provenance,roots=new Set();
  for(const operation of rows) {
    const context=operation.preparation_context_json,provenance=operation.provenance_json;
    checkedPreparationOperation(context,provenance,{orgId:bundle.org_id,referenceId:bundle.job_id,claimToken:bundle.job_lease,model:operation.model,inputHash:operation.input_hash});
    if(operation.kind!=='preparation' || operation.reserved_requests!==1 || operation.data_class!==provider.dataClass
      || context.siteId!==bundle.site_id || context.briefingId!==bundle.briefing_id || context.revision!==bundle.revision
      || context.providerHash!==bundleHash(provider) || bundleHash(context.languages)!==bundleHash(bundle.manifest_json.dependencies.languages)
      || bundleHash(provenance)!==bundleHash(preparationStageProvenance(provider,context.stage)))fail();
    roots.add(context.rootHash);
    const journal=requests.filter(request=>request.operation_id===operation.id);
    if(journal.length!==1 || journal[0].state!=='accepted' || journal[0].cleanup || journal[0].sequence!==1)fail();
    const stageEvents=events.filter(event=>event.step===context.step);
    if(stageEvents.length!==2 || !stageEvents.some(event=>event.state==='started') || !stageEvents.some(event=>['completed','failed'].includes(event.state))
      || stageEvents.some(event=>event.stage!==context.stage || event.language!==context.language || event.track!==context.track || event.origin!=='generated'))fail();
  }
  if(roots.size!==1)fail();
  return rows;
}

export async function linkPreparationOperations(client,bundle,operationIds) {
  const all=(await client.query("SELECT id FROM provider_operations WHERE kind='preparation' AND reference_id=$1 AND org_id=$2 AND claim_token=$3",[bundle.job_id,bundle.org_id,bundle.job_lease])).rows;
  if(operationIds===null) {if(all.length || bundle.provider_operation_count!==null)fail();return;}
  if(!Array.isArray(operationIds) || operationIds.length<1 || operationIds.length>68 || !operationIds.every(uuid)
    || new Set(operationIds).size!==operationIds.length || operationIds.length!==all.length || bundle.provider_operation_count!==operationIds.length
    || all.some(row=>!operationIds.includes(row.id)))fail();
  for(const operationId of operationIds)await client.query(`INSERT INTO generated_bundle_operations(bundle_id,operation_id,org_id,site_id,job_id)
    VALUES($1,$2,$3,$4,$5)`,[bundle.id,operationId,bundle.org_id,bundle.site_id,bundle.job_id]);
  await preparationBundleOperations(client,bundle);
}
