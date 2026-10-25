import {GEMINI_MODELS} from './gemini.mjs';

const methods=(handle,names)=>names.every(name=>typeof handle?.[name]==='function');
const synthetic=handle=>handle?.provenance?.dataClass==='synthetic';
const bundle=handle=>synthetic(handle) && ['gemini-bundle-v1','openrouter-gemini-bundle-v1'].includes(handle.provenance.adapter);
const languages=handle=>Array.isArray(handle?.capabilities?.textLanguages)?handle.capabilities.textLanguages:null;
const speechLanguages=handle=>Array.isArray(handle?.capabilities?.speechLanguages)?handle.capabilities.speechLanguages:null;

// Project only known runtime contracts. Never serialize handles, credentials or input allowlists.
export function pipelineStatus(config={}) {
  const preparation=config.preparationAdapter,source=config.sourceAdapter,recording=config.recordingAdapter,
    assessment=config.assessmentAdapter,followup=config.caseFollowupAdapter;
  const prepared=bundle(preparation) && methods(preparation,['prepare','checkPreparation','translate','checkTranslation','speech','permitsPreparation','withJournal']);
  const typedAssessment=synthetic(assessment) && ['gemini-typed-assessment-v1','openrouter-typed-assessment-v1'].includes(assessment.provenance.adapter)
    && methods(assessment,['assess','permitsAssessment','withJournal']);
  const recorded=synthetic(recording) && ['gemini-recording-allowlist-v1','openrouter-gemini-recording-v1'].includes(recording.provenance.adapter)
    && methods(recording,['transcribe','assess','permitsRecording','withJournal']);
  const rows=[
    ['source','Source transcription',synthetic(source) && source.provenance.adapter==='gemini-source-allowlist-v1' && methods(source,['transcribe','permitsSourceAudio','withJournal']),
      source?[source.model ?? GEMINI_MODELS.transcription]:[],[], 
      'Exact synthetic WAV allowlist, current source authority and request quotas required. Transcription language coverage is unverified.'],
    ['preparation','Content preparation',prepared,
      prepared?[preparation.provenance.textModel]:[],languages(preparation) ?? [],
      prepared&&preparation.provenance.adapter==='openrouter-gemini-bundle-v1'
        ? 'OpenRouter text preparation with exact complete-input allowlist, requester authority and quotas; generated speech uses the configured audio model.'
        : 'Exact complete-input allowlist, current requester authority and request quotas required.'],
    ['translation','Translation',prepared,
      prepared?[preparation.provenance.textModel]:[],languages(preparation) ?? [],
      'Generated text and question must pass structured completeness checks. Declared language support is not an accuracy evaluation.'],
    ['speech','Generated speech',prepared,
      prepared?[preparation.provenance.speechModel]:[],speechLanguages(preparation) ?? [],
      'Private WAV generation and exact readback required. Urdu speech is unsupported by the configured speech adapter.'],
    ['assessment','Typed answer checking',typedAssessment,
      typedAssessment?[assessment.provenance.model]:[],[], 
      'Exact answer/question/frozen-rubric allowlist, active worker, current job and request quotas required.'],
    ['recording','Recorded answer checking',recorded,
      recorded?[recording.transcriptionModel,recording.assessmentModel]:[],[], 
      'Exact synthetic WAV allowlist, active worker and separate transcription/assessment quotas required. Audio language coverage is unverified.'],
    ['followup','Clarification follow-up',bundle(followup) && methods(followup,['prepare','translate','speech','withJournal']),
      followup?[followup.provenance.textModel,followup.provenance.speechModel]:[],speechLanguages(followup) ?? [],
      'Scoped staff request, current case authority and request quotas required. Urdu audio follow-up is unsupported.'],
  ];
  return Object.freeze({dataClass:'synthetic',realDataAllowed:false,productionReady:false,
    stages:Object.freeze(rows.map(([id,name,enabled,models,declaredLanguages,evidence])=>Object.freeze({id,name,
      configuration:enabled?'configured':'disabled',verification:'not_tested',
      models:Object.freeze(enabled?[...models]:[]),declaredLanguages:Object.freeze(enabled?[...declaredLanguages]:[]),
      evidence:enabled?evidence:'Provider stage is disabled. Local synthetic fixtures are not live provider evidence.'}))) });
}
