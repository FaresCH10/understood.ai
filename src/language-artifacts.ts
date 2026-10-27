import {WORKER_LOCALES,workerLocale} from '../server/languages.mjs';
export const artifactLanguages = WORKER_LOCALES.map(locale=>({code:locale.code,name:locale.englishName,dir:locale.direction}));

type StoredLanguage = { title?:unknown; text?:unknown; question?:unknown; speech?:unknown };
export type PreparedArtifacts = {
  source?:unknown; question?:unknown; facts?:unknown; rubric?:{askedFacts?:unknown};
  responseMode?:unknown; deliveryMode?:unknown;
  languages?:Record<string,StoredLanguage>; provenance?:{adapter?:unknown;live?:unknown;dataClass?:unknown};
};
export type ArtifactField = { value:string; status:'present'|'missing'|'invalid' };

export function artifactField(value:unknown,max:number):ArtifactField {
  if(value===undefined || value===null || value==='') return {value:'',status:'missing'};
  if(typeof value!=='string' || !value.trim() || value.length>max) return {value:'',status:'invalid'};
  return {value,status:'present'};
}

export function languageArtifacts(prepared:PreparedArtifacts|null,source:string,code:string) {
  const supported=artifactLanguages.some((language) => language.code===code);
  const stored=prepared?.languages?.[code];
  const title=artifactField(stored?.title,120),text=artifactField(stored?.text,5000),question=artifactField(stored?.question,500);
  const sourceMatches=artifactField(source,4000).status==='present' && prepared?.source===source;
  const synthetic=prepared?.provenance?.adapter==='synthetic-local-v1' && prepared.provenance.live===false;
  // Device speech and arbitrary stored markers cannot prove a private generated audio artifact exists.
  const audio=synthetic && stored?.speech==='device-synthesis-demo' ? 'device-demo'
    : stored?.speech===undefined || stored.speech===null ? 'missing' : 'unverified';
  return {supported,title,text,question,sourceMatches,synthetic,audio,
    canPreview:supported && sourceMatches && synthetic && audio==='device-demo' && text.status==='present' && question.status==='present'};
}

export function artifactVoiceLanguage(language:string,code:string) {
  const locale=workerLocale(code),tag=language.replaceAll('_','-');
  if(!locale)return false;
  if(locale.base==='pa'){
    try{const voice=new Intl.Locale(tag).maximize();return voice.language==='pa' && voice.script===(code==='pa-Arab'?'Arab':'Guru');}catch{return false;}
  }
  const base=tag.toLowerCase().split('-')[0];
  return base===locale.base || locale.code==='fil' && base==='tl';
}

export function artifactSpeechUrls(value:unknown,briefingId:string|undefined,selection:string,revision:number,code:string) {
  if(!briefingId || !artifactLanguages.some(item=>item.code===code) || !value || typeof value!=='object') return null;
  const row=(value as Record<string,unknown>)[code];
  if(!row || typeof row!=='object') return null;
  const base=`/api/briefings/${encodeURIComponent(briefingId)}/artifacts/${selection==='draft' ? `draft/${revision}` : `publication/${encodeURIComponent(selection)}`}/${code}`;
  const expected={body:`${base}/body`,question:`${base}/question`};
  return (row as Record<string,unknown>).body===expected.body && (row as Record<string,unknown>).question===expected.question ? expected : null;
}
