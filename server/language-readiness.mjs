import {generationLanguages} from './settings-input.mjs';
import {WORKER_LOCALES,languageCapability} from './languages.mjs';
import {pipelineStatus} from './ai/pipeline-status.mjs';
import {STAGE_TESTS,stageVerificationPipeline} from './ai/provider-stage-verification.mjs';
const LANGUAGE_DEFINITIONS = Object.freeze(WORKER_LOCALES.map(locale=>Object.freeze({
  code: locale.code, name: locale.englishName, nativeName: locale.name, direction: locale.direction, source: locale.code === 'en',
})));

const copy = Object.freeze({
  synthetic: 'Synthetic-only environment. Full-pipeline evaluation and real-data permission are not verified.',
  missing: 'No published version contains a complete stored language artifact.',
  present: 'A published version contains title, text and question fields for this language.',
  ui: 'Worker UI labels, direction and text fallback are localized in every selectable locale; native-speaker review is still pending.',
  translationUnsupported: 'No stored demo translation or configured translation provider is available for this locale.',
  translationUndeclared: 'The configured translation adapter does not declare this language.',
  speechUnsupported: 'No stored demo speech or configured speech provider is available for this locale.',
  speechUndeclared: 'The configured speech adapter does not declare this language.',
});

function contentState(snapshot, code) {
  const item = snapshot?.languages?.[code];
  const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
  const present = code === 'en'
    ? [snapshot?.title, snapshot?.source, snapshot?.question].every(nonempty)
    : [item?.title, item?.text, item?.question].every(nonempty);
  return { state: present ? 'ready' : 'missing', evidence: present ? copy.present : copy.missing };
}

export function languageReadinessModel({ mode = 'synthetic-credential', publication = null, testedAt = null,generationDefaults=['en','ar','ur'],pipeline=pipelineStatus(),stageTests=STAGE_TESTS.map(test=>({...test,state:'untested'})),verifiedArtifactLanguages=[] } = {}) {
  const defaults=generationLanguages(generationDefaults);
  const synthetic = String(mode).startsWith('synthetic');
  const snapshot = publication?.snapshot || null;
  const languages = LANGUAGE_DEFINITIONS.map((definition) => {
    const content = contentState(snapshot, definition.code);
    const provider = synthetic
      ? { state: 'not_tested', evidence: copy.synthetic }
      : { state: 'unavailable', evidence: 'Provider configuration is not verified in this environment.' };
    const translationStage=pipeline.stages.find(stage=>stage.id==='translation'),speechStage=pipeline.stages.find(stage=>stage.id==='speech');
    let translation=!languageCapability(definition.code,'translation') && !(translationStage.configuration==='configured' && translationStage.declaredLanguages.includes(definition.code))
      ? {state:'unavailable',evidence:copy.translationUnsupported}
      : translationStage.configuration!=='configured' ? provider
      : translationStage.declaredLanguages.includes(definition.code)
      ? {state:'not_tested',evidence:pipeline.dataClass==='real'?'Production translation is configured; independent language-quality evaluation is still required.':'Synthetic translation adapter is configured; language accuracy and live translation have not been verified.'}
      : {state:'unavailable',evidence:copy.translationUndeclared};
    let speech=!languageCapability(definition.code,'speech') && !(speechStage.configuration==='configured' && speechStage.declaredLanguages.includes(definition.code))
      ? {state:'unavailable',evidence:copy.speechUnsupported}
      : speechStage.configuration!=='configured' ? provider
      : speechStage.declaredLanguages.includes(definition.code)
      ? {state:'not_tested',evidence:pipeline.dataClass==='real'?'Production speech is configured; independent language-quality evaluation is still required.':'Synthetic speech adapter is configured; live speech has not been verified.'}
      : {state:'unavailable',evidence:copy.speechUndeclared};
    const check=(stage,current)=>{
      const test=stageTests.find(test=>test.stage===stage && test.language===definition.code);
      const configured=stage==='translation'?translationStage:speechStage;
      if(!test || test.state==='untested' || current.state==='unavailable' || configured.configuration!=='configured'
        || test.evidence && !configured.models.includes(test.evidence.model))return current;
      return {state:test.state==='verified'?'technical_test_passed':test.state,
        evidence:stage==='translation'?'Fixed synthetic translation and automated comparison only; language accuracy is not certified.':'Fixed synthetic WAV format and nonempty audio only; speech accuracy and quality are not certified.'};
    };
    translation=check('translation',translation);speech=check('speech',speech);
    if(content.state==='ready' && verifiedArtifactLanguages.includes(definition.code)){
      translation={state:'ready',evidence:'The published translation passed its stored completeness checks. This is artifact readiness, not native-speaker accuracy certification.'};
      speech={state:'ready',evidence:'Both published speech tracks passed private-storage integrity checks. Speech quality still requires listening review.'};
    }
    return { ...definition,generationDefault:defaults.includes(definition.code), ui: { state: 'ready', evidence: copy.ui }, content, translation, speech };
  });
  return {
    generatedAt: testedAt || new Date().toISOString(),
    mode,
    dataClass: pipeline.dataClass==='real'?'real':synthetic ? 'synthetic' : 'unknown',
    realDataAllowed: pipeline.dataClass==='real'&&pipeline.realDataAllowed===true,
    pipeline:stageVerificationPipeline(pipeline,stageTests),stageTests,
    provider: {
      adapter: pipeline.dataClass==='real'?'gemini-approved-v1':pipeline.stages.some(stage=>stage.configuration==='configured') ? 'gemini-synthetic-runtime' : synthetic ? 'synthetic-local-v1' : 'unverified',
      connection: synthetic ? { state: 'not_tested', evidence: copy.synthetic } : { state: 'unavailable', evidence: 'Provider connection has not been verified.' },
      evidence: pipeline.dataClass==='real'?'Approved production adapter configured. Language quality and deployed connections require separate verification.':synthetic ? 'Synthetic-only environment. Keep real worker data off free-tier providers.' : 'Live provider evidence is required before production data access.',
    },
    publication: publication ? { id: publication.id, version: publication.version, state: publication.state } : null,
    languages,
    tests: {
      connection: { state: 'not_tested', evidence: synthetic ? copy.synthetic : 'No connection test has completed.' },
      translation: { state: 'not_tested', evidence: 'Fixed-fixture results above do not certify language accuracy or the full pipeline.' },
      speech: { state: 'not_tested', evidence: 'Stored audio and fixed-fixture results do not certify speech quality in every language.' },
    },
  };
}

export function latestPublicationSnapshot(db, session) {
  const row = db.prepare(`SELECT id,version,state,snapshot_json FROM publications
    WHERE org_id=? AND site_id=? AND state='published' ORDER BY published_at DESC,id LIMIT 1`).get(session.org_id, session.site_id);
  if (!row) return null;
  let snapshot = null;
  try { snapshot = JSON.parse(row.snapshot_json); } catch { /* malformed history stays unavailable */ }
  return { id: row.id, version: row.version, state: row.state, snapshot };
}

export const languageDefinitions = LANGUAGE_DEFINITIONS;
