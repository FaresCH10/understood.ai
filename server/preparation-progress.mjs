import {isWorkerLanguage} from './languages.mjs';
const stages=['worker','preparation','grounding_check','translation','translation_check','speech','storage','finalization'];
const errors=['preparation_failed','grounding_check_failed','translation_failed','translation_check_failed','speech_failed',
  'invalid_preparation','invalid_preparation_check','invalid_grounding_evidence','invalid_question_evidence','ambiguous_source',
  'ungrounded_preparation','preparation_check_failed','question_alignment_failed','invalid_translation','invalid_translation_check',
  'translation_check_failed','invalid_speech','speech_bundle_exceeds_limit','manifest_exceeds_limit','regeneration_dependencies_changed',
  'invalid_regeneration','invalid_bundle','invalid_bundle_audio','invalid_manifest','invalid_dependencies','invalid_speech_reference',
  'invalid_bundle_input','invalid_review','invalid_glossary','invalid_provider','translation_language_unavailable','language_capability_unavailable',
  'terminology_exceeds_limit','obsolete_or_unauthorized','preparation_unavailable'];

export const preparationErrorCode=error=>errors.includes(error?.code) ? error.code : 'preparation_unavailable';

export function preparationStage(value) {
  if(!value || typeof value!=='object' || Array.isArray(value)
    || Object.keys(value).sort().join(',')!=='errorCode,language,origin,stage,state,step,track'
    || !Number.isInteger(value.step) || value.step<0 || value.step>101 || !stages.includes(value.stage)
    || !['started','completed','reused','failed'].includes(value.state)
    || !['generated','retained','override','cache','system'].includes(value.origin)
    || !(value.language===null || isWorkerLanguage(value.language))
    || !(value.track===null || ['body','question'].includes(value.track))
    || (value.stage==='speech' ? value.track===null || value.language===null : value.track!==null)
    || (['worker','storage','finalization'].includes(value.stage) ? value.language!==null || value.origin!=='system' : value.language===null)
    || (value.state==='failed' ? !errors.includes(value.errorCode) : value.errorCode!==null)
    || (value.state==='reused' ? !['retained','override','cache'].includes(value.origin) : !['generated','system'].includes(value.origin))) {
    throw Error('Invalid preparation stage');
  }
  return {...value};
}
