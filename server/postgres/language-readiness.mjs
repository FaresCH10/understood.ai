import { domainTransaction, requirePrincipal } from './domain.mjs';
import { responseRead } from './responses.mjs';
import { languageReadinessModel } from '../language-readiness.mjs';
import {readGenerationLanguages} from './settings.mjs';
import {readProviderStageTests} from './provider-controls.mjs';
import {generatedBundleEvidence,verifyGeneratedAudio} from './generated-audio.mjs';
import {bundleHash} from '../ai/prepared-bundle.mjs';

async function latestPublication(client, session) {
  const row = (await client.query(`SELECT id,briefing_id,version,state,snapshot_json FROM publications
    WHERE org_id=$1 AND site_id=$2 AND state='published' ORDER BY published_at DESC,id LIMIT 1`, [session.org_id, session.site_id])).rows[0];
  if (!row) return null;
  return { id: row.id, briefingId:row.briefing_id,version: row.version, state: row.state, snapshot: row.snapshot_json };
}

function parseSnapshot(publication) {
  if (!publication) return null;
  try { return { ...publication, snapshot: typeof publication.snapshot === 'string' ? JSON.parse(publication.snapshot) : publication.snapshot }; }
  catch { return { ...publication, snapshot: null }; }
}

async function inspectReadiness(pool,session,{schema='public',pipeline,providerVerification,storage},{run=false}={}){
  const loaded=await responseRead(pool, schema, async (client) => {
    await requirePrincipal(client, session, 'staff', ['owner', 'administrator', 'supervisor', 'auditor']);
    const publication = parseSnapshot(await latestPublication(client, session));
    let evidence=null;
    if(publication?.snapshot?.artifactBundle){
      try{evidence=await generatedBundleEvidence(client,{...session,briefing_id:publication.briefingId},publication.snapshot);}catch{}
    }
    return {publication,evidence,stageTests:await readProviderStageTests(client,providerVerification),generationDefaults:await readGenerationLanguages(client,session.org_id,session.site_id)};
  });
  let verifiedArtifactLanguages=[];
  if(loaded.evidence){
    try{await verifyGeneratedAudio(loaded.evidence,storage);verifiedArtifactLanguages=loaded.evidence.manifest.dependencies.languages;}catch{}
  }
  return responseRead(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff',run?['owner','administrator','supervisor']:['owner','administrator','supervisor','auditor']);
    const current=parseSnapshot(await latestPublication(client,session));
    if(current?.id!==loaded.publication?.id || bundleHash(current?.snapshot ?? null)!==bundleHash(loaded.publication?.snapshot ?? null))throw Error('Publication is no longer current');
    return languageReadinessModel({mode:pipeline?.dataClass==='real'?'live-credential':'synthetic-credential',publication:loaded.publication,pipeline,stageTests:loaded.stageTests,generationDefaults:loaded.generationDefaults,
      verifiedArtifactLanguages,...(run?{testedAt:new Date().toISOString()}: {})});
  });
}

export function getLanguageReadiness(pool, session, options={}) {
  return inspectReadiness(pool,session,options);
}

export function runLanguageReadiness(pool, session, input = {}, options={}) {
  if (!input || typeof input !== 'object' || Object.keys(input).length) throw new Error('Invalid language readiness request');
  return domainTransaction(pool, options.schema ?? 'public', async (client) => {
    await requirePrincipal(client, session, 'staff', ['owner', 'administrator', 'supervisor']);
  }).then(()=>inspectReadiness(pool,session,options,{run:true}));
}
