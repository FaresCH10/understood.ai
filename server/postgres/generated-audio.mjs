import {providerDataClass} from '../ai/provider-policy.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {domainTransaction,domainAudit,requireActiveBriefing,requirePrincipal} from './domain.mjs';
import {readGlossarySnapshot} from './glossary.mjs';
import {bundleHash,checkedPreparedBundle,preparedAudioReferences,reviewContent} from '../ai/prepared-bundle.mjs';
import {inspectWav} from '../audio.mjs';
import {appendPreparationStage,systemStage} from './preparation-progress.mjs';
import {isWorkerLanguage} from '../languages.mjs';
import {dispatchAllowed} from './operations-gates.mjs';
import {checkPreparationAuthority} from './preparation-authority.mjs';
import {linkPreparationOperations,preparationBundleOperations} from './preparation-evidence.mjs';

const hash=value=>createHash('sha256').update(typeof value==='string' ? value : JSON.stringify(value)).digest('hex');
const uuid=value=>typeof value==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const receipt=(row,duplicate)=>({id:row.id,state:row.state,manifestHash:row.manifest_hash,duplicate});
function claimInput(job) {
  if(!job || !['id','briefing_id','org_id','site_id'].every(key=>typeof job[key]==='string' && /^[A-Za-z0-9_-]{1,100}$/.test(job[key]))
    || !Number.isSafeInteger(job.revision) || job.revision<1 || !uuid(job.token)) throw Error('Invalid preparation claim');
}
function storageInput(storage) {
  if(!['save','read','remove'].every(key=>typeof storage?.[key]==='function')) throw Error('Private generated storage unavailable');
}

async function currentClaim(client,job,manifest) {
  if(!await dispatchAllowed(client,job.org_id,{provider:true}))throw Error('Operational dispatch paused');
  // Keep the draft-before-job lock order used by editing, queueing and completion.
  const draft=(await client.query('SELECT * FROM briefings WHERE id=$1 AND org_id=$2 AND site_id=$3 FOR UPDATE',[job.briefing_id,job.org_id,job.site_id])).rows[0];
  const current=(await client.query(`SELECT id FROM jobs WHERE id=$1 AND org_id=$2 AND site_id=$3 AND briefing_id=$4 AND revision=$5
    AND kind='prepare' AND status='processing' AND lease_token=$6 AND lease_until>clock_timestamp() FOR UPDATE`,
  [job.id,job.org_id,job.site_id,job.briefing_id,job.revision,job.token])).rows[0];
  if(!current || !draft || draft.state!=='processing' || draft.revision!==job.revision || draft.source!==manifest.source) throw Error('Preparation claim is obsolete');
  await requireActiveBriefing(client,job,job.briefing_id);
  await checkPreparationAuthority(client,job);
  const requester=(await client.query('SELECT requested_by,requested_role,requested_session_hash FROM briefing_regeneration_requests WHERE job_id=$1 AND org_id=$2 AND site_id=$3',[job.id,job.org_id,job.site_id])).rows[0];
  if(requester) await requirePrincipal(client,{...job,principal_type:'staff',principal_id:requester.requested_by,role:requester.requested_role,
    ...(requester.requested_session_hash===null ? {} : {token_hash:requester.requested_session_hash})},'staff');
  const review=(await client.query('SELECT content_json FROM draft_reviews WHERE briefing_id=$1 AND org_id=$2 AND site_id=$3',[job.briefing_id,job.org_id,job.site_id])).rows[0]?.content_json ?? null;
  const glossary=await readGlossarySnapshot(client,job.org_id,job.site_id),dependencies=manifest.dependencies;
  if(dependencies.revision!==job.revision || dependencies.sourceHash!==hash(draft.source)
    || dependencies.titleHash!==undefined && dependencies.titleHash!==hash(draft.title.trim())
    || dependencies.reviewHash!==hash(reviewContent(review,job.revision)) || dependencies.glossaryHash!==glossary.hash
    || dependencies.glossaryRevision!==glossary.revision) throw Error('Preparation dependencies changed');
  await client.query("UPDATE jobs SET lease_until=clock_timestamp()+interval '180 seconds' WHERE id=$1",[job.id]);
}

export async function checkPreparationClaim(pool,job,{source,review,glossary},{schema='public'}={}) {
  claimInput(job);
  return domainTransaction(pool,schema,async client=>{
    await currentClaim(client,job,{source,dependencies:{revision:job.revision,sourceHash:hash(source),
      reviewHash:hash(reviewContent(review,job.revision)),glossaryHash:glossary.hash,glossaryRevision:glossary.revision}});
    return true;
  });
}

export async function recordPreparationStage(pool,job,{source,review,glossary},event,{schema='public'}={}) {
  claimInput(job);
  const write=()=>domainTransaction(pool,schema,async client=>{
    await currentClaim(client,job,{source,dependencies:{revision:job.revision,sourceHash:hash(source),
      reviewHash:hash(reviewContent(review,job.revision)),glossaryHash:glossary.hash,glossaryRevision:glossary.revision}});
    await appendPreparationStage(client,job,event);
  });
  // A lost commit acknowledgement retries the event identity, never the provider operation.
  try {await write();}catch {await write();}
}

function verifyReference(row,bytes) {
  const info=inspectWav(bytes);
  if(info.sha256!==row.sha256 || info.bytes!==row.bytes || info.durationSeconds!==row.duration_seconds) throw Error('Generated audio integrity failed');
}

export function generatedManifest(snapshot) {
  const {artifactBundle,responseMode,deliveryMode,...manifest}=snapshot || {};
  if(responseMode!==undefined && !['question','acknowledge'].includes(responseMode)
    || deliveryMode!==undefined && !['text','voice','both'].includes(deliveryMode))throw Error('Generated bundle unavailable');
  if(!artifactBundle || Object.keys(artifactBundle).sort().join(',')!=='id,manifestHash'
    || !uuid(artifactBundle.id) || artifactBundle.manifestHash!==bundleHash(manifest)) throw Error('Generated bundle unavailable');
  preparedAudioReferences(manifest);
  // Live/real-data enablement remains a separate rollout gate, never inferred from stored bytes.
  if(!providerDataClass(manifest.provenance)) throw Error('Generated bundle unavailable');
  return manifest;
}

export async function generatedBundleEvidence(client,scope,snapshot,states=['attached']) {
  const manifest=generatedManifest(snapshot),tag=snapshot.artifactBundle;
  const row=(await client.query(`SELECT * FROM generated_bundles WHERE id=$1 AND org_id=$2 AND site_id=$3
    AND briefing_id=$4 FOR SHARE`,[tag.id,scope.org_id,scope.site_id,scope.briefing_id])).rows[0];
  if(!row || !states.includes(row.state) || row.manifest_hash!==tag.manifestHash || bundleHash(row.manifest_json)!==tag.manifestHash
    || row.dependency_hash!==manifest.dependencyHash || row.revision!==manifest.dependencies.revision) throw Error('Generated bundle unavailable');
  await preparationBundleOperations(client,row);
  const audio=(await client.query('SELECT * FROM generated_audio WHERE bundle_id=$1 AND org_id=$2 AND site_id=$3 ORDER BY id',[tag.id,scope.org_id,scope.site_id])).rows;
  const refs=preparedAudioReferences(manifest);
  if(audio.length!==refs.length || refs.some(ref=>{
    const item=audio.find(item=>item.id===ref.id);
    return !item || item.language!==ref.language || item.text_hash!==ref.textHash || item.sha256!==ref.sha256
      || item.bytes!==ref.bytes || item.duration_seconds!==ref.durationSeconds;
  })) throw Error('Generated bundle unavailable');
  return {row,manifest,audio};
}

export async function verifyGeneratedAudio(evidence,storage) {
  storageInput(storage);
  for(const row of evidence.audio) verifyReference(row,await storage.read(row));
}

export async function attachPreparedBundle(pool,job,bundleId,storage,{schema='public'}={}) {
  claimInput(job);storageInput(storage);if(!uuid(bundleId)) throw Error('Invalid generated bundle ID');
  const accepted=async()=>domainTransaction(pool,schema,async client=>(await client.query(`SELECT * FROM generated_bundles
    WHERE id=$1 AND org_id=$2 AND site_id=$3 AND briefing_id=$4 AND revision=$5 AND job_id=$6 AND job_lease=$7 AND state='attached'`,
  [bundleId,job.org_id,job.site_id,job.briefing_id,job.revision,job.id,job.token])).rows[0]);
  try {
    const old=await accepted();if(old) return receipt(old,true);
    const evidence=await domainTransaction(pool,schema,async client=>{
      const row=(await client.query(`SELECT * FROM generated_bundles WHERE id=$1 AND org_id=$2 AND site_id=$3
        AND job_id=$4 AND job_lease=$5`,[bundleId,job.org_id,job.site_id,job.id,job.token])).rows[0];
      if(!row) throw Error('Generated bundle unavailable');
      await currentClaim(client,job,row.manifest_json);
      const snapshot={...row.manifest_json,artifactBundle:{id:row.id,manifestHash:row.manifest_hash}};
      const checked=await generatedBundleEvidence(client,job,snapshot,['stored']);
      await appendPreparationStage(client,job,systemStage('finalization','started'));
      return {...checked,snapshot};
    });
    // Object reads happen outside row-lock transactions; the commit rechecks ownership/dependencies.
    await verifyGeneratedAudio(evidence,storage);
    return await domainTransaction(pool,schema,async client=>{
      await currentClaim(client,job,evidence.manifest);
      const checked=await generatedBundleEvidence(client,job,evidence.snapshot,['stored']);
      await client.query("UPDATE generated_bundles SET state='attached' WHERE id=$1",[bundleId]);
      await client.query(`UPDATE briefings SET prepared_json=$4,state='ready',updated_at=clock_timestamp()
        WHERE id=$1 AND org_id=$2 AND site_id=$3`,[job.briefing_id,job.org_id,job.site_id,JSON.stringify(evidence.snapshot)]);
      await appendPreparationStage(client,job,systemStage('finalization','completed'));
      if((await client.query("SELECT 1 FROM preparation_stage_events WHERE job_id=$1 AND run_id=$2 AND step=0 AND state='started'",[job.id,job.token])).rows.length) {
        await appendPreparationStage(client,job,systemStage('worker','completed'));
      }
      await client.query("UPDATE jobs SET status='ready',lease_token=NULL,lease_until=NULL,error=NULL WHERE id=$1",[job.id]);
      await domainAudit(client,{...job,principal_type:'system',principal_id:'artifact-worker'},'briefing.prepared',job.briefing_id);
      return receipt({...checked.row,state:'attached'},false);
    });
  }catch {
    try {const old=await accepted();if(old) return receipt(old,true);}catch { /* Keep unknown acceptance journaled. */ }
    throw Error('Generated preparation was not durably accepted');
  }
}

export async function getAssignmentSpeech(pool,session,assignmentId,kind,storage,{schema='public'}={}) {
  if(!['body','question'].includes(kind) || typeof assignmentId!=='string' || !assignmentId.length || assignmentId.length>100) throw Error('Assignment unavailable');
  const load=()=>domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'worker');
    const assignment=(await client.query(`SELECT a.language,p.briefing_id,p.snapshot_json FROM assignments a
      JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
      WHERE a.id=$1 AND a.org_id=$2 AND a.site_id=$3 AND a.worker_id=$4`,[assignmentId,session.org_id,session.site_id,session.principal_id])).rows[0];
    if(!assignment) throw Error('Assignment unavailable');
    const evidence=await generatedBundleEvidence(client,{...session,briefing_id:assignment.briefing_id},assignment.snapshot_json);
    const ref=evidence.manifest.languages[assignment.language]?.speech[kind];
    const row=evidence.audio.find(row=>row.id===ref?.id && row.language===assignment.language);
    if(!row) throw Error('Assignment unavailable');
    return row;
  });
  const row=await load();
  let bytes;try {bytes=Buffer.from(await storage.read(row));verifyReference(row,bytes);}catch {throw Error('Generated audio unavailable');}
  // An access revocation during a slow private-object read must prevent delivery.
  const current=await load();if(current.id!==row.id || current.sha256!==row.sha256) throw Error('Assignment unavailable');
  return bytes;
}

async function currentDraftManifest(client,scope,draft,manifest,states=['ready']) {
  if(!states.includes(draft.state) || manifest.source!==draft.source || manifest.dependencies.revision!==draft.revision) throw Error('Artifact audio unavailable');
  const review=(await client.query('SELECT content_json FROM draft_reviews WHERE briefing_id=$1 AND org_id=$2 AND site_id=$3',[scope.briefing_id,scope.org_id,scope.site_id])).rows[0]?.content_json ?? null;
  const glossary=await readGlossarySnapshot(client,scope.org_id,scope.site_id);
  if(manifest.dependencies.titleHash!==undefined && manifest.dependencies.titleHash!==hash(draft.title.trim()) || manifest.dependencies.sourceHash!==hash(draft.source) || manifest.dependencies.reviewHash!==hash(reviewContent(review,draft.revision))
    || manifest.dependencies.glossaryHash!==glossary.hash || manifest.dependencies.glossaryRevision!==glossary.revision) throw Error('Artifact audio unavailable');
}

export async function draftGeneratedEvidence(client,scope,draft) {
  const evidence=await generatedBundleEvidence(client,scope,draft.prepared_json);
  // Publication opens the next draft without changing its source revision. Its retained
  // checked baseline may be regenerated, but this does not make that draft publish-ready.
  await currentDraftManifest(client,scope,draft,evidence.manifest,['ready','draft']);
  return evidence;
}

export async function staffArtifactUrls(client,session,briefingId,version,snapshot,draft=null) {
  if(!['owner','supervisor'].includes(session.role) || !snapshot?.artifactBundle) return null;
  try {
    const scope={...session,briefing_id:briefingId},evidence=await generatedBundleEvidence(client,scope,snapshot);
    if(draft) await currentDraftManifest(client,scope,draft,evidence.manifest);
    const base=`/api/briefings/${encodeURIComponent(briefingId)}/artifacts/${draft ? 'draft' : 'publication'}/${encodeURIComponent(version)}`;
    return Object.fromEntries(Object.keys(evidence.manifest.languages).map(language=>[language,{body:`${base}/${language}/body`,question:`${base}/${language}/question`}]));
  }catch(error) {
    if(['Generated bundle unavailable','Artifact audio unavailable'].includes(error.message)) return null;
    throw error;
  }
}

export async function getStaffArtifactSpeech(pool,session,briefingId,versionType,version,language,kind,storage,{schema='public'}={}) {
  const identity=value=>typeof value==='string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
  if(!identity(briefingId) || !['draft','publication'].includes(versionType) || !isWorkerLanguage(language) || !['body','question'].includes(kind)
    || (versionType==='draft' ? !/^[1-9][0-9]{0,14}$/.test(version) || !Number.isSafeInteger(Number(version)) : !identity(version))) throw Error('Artifact audio unavailable');
  const load=()=>domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff');
    const scope={...session,briefing_id:briefingId};
    let snapshot,draft;
    if(versionType==='draft') {
      draft=(await client.query('SELECT source,title,state,revision,prepared_json FROM briefings WHERE id=$1 AND org_id=$2 AND site_id=$3 FOR SHARE',[briefingId,session.org_id,session.site_id])).rows[0];
      if(!draft || draft.revision!==Number(version)) throw Error('Artifact audio unavailable');
      snapshot=draft.prepared_json;
    }else {
      snapshot=(await client.query('SELECT snapshot_json FROM publications WHERE id=$1 AND briefing_id=$2 AND org_id=$3 AND site_id=$4',[version,briefingId,session.org_id,session.site_id])).rows[0]?.snapshot_json;
    }
    const evidence=await generatedBundleEvidence(client,scope,snapshot);
    if(draft) await currentDraftManifest(client,scope,draft,evidence.manifest);
    const ref=evidence.manifest.languages[language]?.speech[kind],row=evidence.audio.find(row=>row.id===ref?.id && row.language===language);
    if(!row) throw Error('Artifact audio unavailable');
    return {row,snapshotHash:bundleHash(snapshot)};
  });
  const old=await load();
  let bytes;try {bytes=Buffer.from(await storage.read(old.row));verifyReference(old.row,bytes);}catch {throw Error('Generated audio unavailable');}
  // Recheck the selected version and authority after the potentially slow object read.
  const current=await load();
  if(current.snapshotHash!==old.snapshotHash || current.row.id!==old.row.id || current.row.sha256!==old.row.sha256) throw Error('Artifact audio unavailable');
  return bytes;
}

// Internal job API, never a worker/staff-facing upload or readiness endpoint.
export async function stagePreparedBundle(pool,job,bundle,storage,{schema='public',bundleId,providerOperations=null}={}) {
  claimInput(job);storageInput(storage);if(!uuid(bundleId)) throw Error('Invalid generated bundle ID');
  const checked=checkedPreparedBundle(bundle),manifest=checked.manifest,refs=preparedAudioReferences(manifest),manifestHash=bundleHash(manifest);
  let reservation;
  try {
    reservation=await domainTransaction(pool,schema,async client=>{
      await currentClaim(client,job,manifest);
      await appendPreparationStage(client,job,systemStage('storage','started'));
      const old=(await client.query('SELECT * FROM generated_bundles WHERE job_id=$1 AND job_lease=$2 FOR UPDATE',[job.id,job.token])).rows[0];
      if(old) {
        if(old.id!==bundleId || old.manifest_hash!==manifestHash || !['storing','stored'].includes(old.state)) throw Error('Generated bundle replay conflict');
        const linked=await preparationBundleOperations(client,old);
        if((providerOperations===null)!==(linked===null) || linked && (linked.length!==providerOperations.length || linked.some(operation=>!providerOperations.includes(operation.id))))throw Error('Generated bundle replay conflict');
        return old;
      }
      if((await client.query('SELECT id FROM recordings WHERE id=ANY($1::text[])',[refs.map(ref=>ref.id)])).rows.length) throw Error('Private audio identity conflict');
      const row=(await client.query(`INSERT INTO generated_bundles(id,org_id,site_id,briefing_id,revision,job_id,job_lease,manifest_json,manifest_hash,dependency_hash,state,provider_operation_count)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'storing',$11) RETURNING *`,
      [bundleId,job.org_id,job.site_id,job.briefing_id,job.revision,job.id,job.token,JSON.stringify(manifest),manifestHash,manifest.dependencyHash,providerOperations?.length ?? null])).rows[0];
      await linkPreparationOperations(client,row,providerOperations);
      for(const ref of refs) await client.query(`INSERT INTO generated_audio(id,bundle_id,org_id,site_id,language,text_hash,sha256,bytes,duration_seconds)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[ref.id,bundleId,job.org_id,job.site_id,ref.language,ref.textHash,ref.sha256,ref.bytes,ref.durationSeconds]);
      return row;
    });
    if(reservation.state==='stored') return receipt(reservation,true);
    for(const artifact of checked.audio) {
      const row={id:artifact.id,org_id:job.org_id,site_id:job.site_id,sha256:artifact.sha256,bytes:artifact.bytes.length,duration_seconds:artifact.durationSeconds};
      await domainTransaction(pool,schema,async client=>{
        await currentClaim(client,job,manifest);
        const row=(await client.query("SELECT id FROM generated_bundles WHERE id=$1 AND job_lease=$2 AND state='storing' FOR UPDATE",[bundleId,job.token])).rows[0];
        if(!row) throw Error('Generated storage claim is obsolete');
      });
      let exists=false;
      try {verifyReference(row,await storage.read(row));exists=true;}catch { /* Conditional save below cannot overwrite an existing object. */ }
      if(!exists) {
        try {await storage.save(row,artifact.bytes);}catch { /* Confirm unknown storage acknowledgements by exact readback. */ }
        verifyReference(row,await storage.read(row));
      }
    }
    return await domainTransaction(pool,schema,async client=>{
      await currentClaim(client,job,manifest);
      const row=(await client.query("SELECT * FROM generated_bundles WHERE id=$1 AND job_lease=$2 AND state='storing' FOR UPDATE",[bundleId,job.token])).rows[0];
      if(!row || row.manifest_hash!==manifestHash) throw Error('Generated storage claim is obsolete');
      const stored=(await client.query("UPDATE generated_bundles SET state='stored',stored_at=clock_timestamp() WHERE id=$1 RETURNING *",[bundleId])).rows[0];
      await appendPreparationStage(client,job,systemStage('storage','completed'));
      await domainAudit(client,{...job,principal_type:'system',principal_id:'artifact-worker'},'briefing.audio_staged',bundleId);
      return receipt(stored,false);
    });
  }catch {
    // Do not delete objects after an uncertain database commit. The journal owns cleanup.
    if(reservation) {
      try {
        const accepted=await domainTransaction(pool,schema,async client=>(await client.query(`SELECT * FROM generated_bundles WHERE id=$1 AND org_id=$2 AND site_id=$3
          AND job_id=$4 AND job_lease=$5 AND manifest_hash=$6 AND state IN ('stored','attached')`,[bundleId,job.org_id,job.site_id,job.id,job.token,manifestHash])).rows[0]);
        if(accepted) return receipt(accepted,true);
      }catch { /* Unknown acceptance remains pending reconciliation, never destructive compensation. */ }
    }
    throw Error('Generated audio was not durably accepted');
  }
}

export async function expireGeneratedBundle(pool,storage,{schema='public'}={}) {
  storageInput(storage);
  if(typeof storage.exists!=='function')throw Error('Private generated absence verification unavailable');
  const candidate=await domainTransaction(pool,schema,async client=>{
    const row=(await client.query(`SELECT b.* FROM generated_bundles b WHERE (b.expires_at<=clock_timestamp()
      OR EXISTS(SELECT 1 FROM generated_audio_retirements t WHERE t.bundle_id=b.id))
      AND (b.state IN ('storing','stored') OR (b.state='cleaning' AND b.cleanup_until<=clock_timestamp()))
      AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.id=b.job_id AND j.status='processing' AND j.lease_token=b.job_lease AND j.lease_until>clock_timestamp())
      ORDER BY b.expires_at,b.id FOR UPDATE OF b SKIP LOCKED LIMIT 1`)).rows[0];
    if(!row) return null;
    const token=randomUUID();
    await client.query("UPDATE generated_bundles SET state='cleaning',cleanup_token=$2,cleanup_until=clock_timestamp()+interval '90 seconds' WHERE id=$1",[row.id,token]);
    const audio=(await client.query('SELECT * FROM generated_audio WHERE bundle_id=$1 AND org_id=$2 AND site_id=$3 ORDER BY id',[row.id,row.org_id,row.site_id])).rows;
    return {...row,token,audio};
  });
  if(!candidate) return false;
  try {
    for(const row of candidate.audio) {
      const owned=await domainTransaction(pool,schema,async client=>(await client.query(`UPDATE generated_bundles SET cleanup_until=clock_timestamp()+interval '90 seconds'
        WHERE id=$1 AND state='cleaning' AND cleanup_token=$2 AND cleanup_until>clock_timestamp() RETURNING id`,[candidate.id,candidate.token])).rows.length);
      if(!owned) return true;
      await storage.remove(row);
      if(await storage.exists(row)!==false)throw Error('Generated audio removal is unverified');
    }
    await domainTransaction(pool,schema,async client=>{
      const changed=(await client.query(`UPDATE generated_bundles SET state='cleaned',cleanup_token=NULL,cleanup_until=NULL
        WHERE id=$1 AND state='cleaning' AND cleanup_token=$2 AND cleanup_until>clock_timestamp() RETURNING id`,[candidate.id,candidate.token])).rows.length;
      if(!changed)return;
      await client.query('INSERT INTO generated_audio_removals(bundle_id,org_id,site_id) VALUES($1,$2,$3)',[candidate.id,candidate.org_id,candidate.site_id]);
      await domainAudit(client,{...candidate,principal_type:'system',principal_id:'generated-retention-worker'},'retention.generated_audio.removed',candidate.id);
    });
  }catch { /* A durable cleanup lease remains reclaimable; no readiness or publication is issued. */ }
  return true;
}
