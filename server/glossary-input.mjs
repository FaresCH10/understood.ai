import {CONTENT_LANGUAGE_CODES} from './languages.mjs';
const languages=[...CONTENT_LANGUAGE_CODES];
export function glossaryRequestId(value) {
  if(typeof value!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error('Invalid glossary request');
  return value;
}
export function glossaryInput(kind,id,input) {
  if(!['create','edit','remove','restore','regenerate'].includes(kind) || !input || typeof input!=='object' || Array.isArray(input) || input.confirmed!==true) throw new Error('Invalid glossary request');
  glossaryRequestId(input.requestId);
  const allowed=['requestId','confirmed',...(kind==='create' ? ['term','sourceLanguage','targetLanguage','override'] : ['revision',...(kind==='edit' ? ['override'] : [])])];
  if(Object.keys(input).some(key=>!allowed.includes(key)) || (kind!=='create' && (typeof id!=='string' || !id || id.length>100 || !Number.isSafeInteger(input.revision) || input.revision<1))) throw new Error('Invalid glossary request');
  const value={kind,id:kind==='create' ? input.requestId : id,...(kind==='create' ? {} : {revision:input.revision})};
  if(kind==='create') {
    if(typeof input.term!=='string' || !input.term.trim() || input.term.length>200 || /[\u0000-\u001f\u007f]/.test(input.term) || !languages.includes(input.sourceLanguage) || !languages.includes(input.targetLanguage) || input.sourceLanguage===input.targetLanguage) throw new Error('Invalid glossary request');
    const normalized=input.term.normalize('NFKC').trim();if(normalized.length>200) throw new Error('Invalid glossary request');
    Object.assign(value,{term:normalized,sourceLanguage:input.sourceLanguage,targetLanguage:input.targetLanguage});
  }
  if(['create','edit'].includes(kind)) {
    if(typeof input.override!=='string' || input.override.length>500 || /[\u0000-\u001f\u007f]/.test(input.override)) throw new Error('Invalid glossary request');
    value.override=input.override.trim();
  }
  return value;
}
export const glossarySignature=value=>JSON.stringify(['kind','id','revision','term','sourceLanguage','targetLanguage','override'].map(key=>value[key] ?? null));
export const termKey=term=>term.normalize('NFKC').trim().toLowerCase();
export function glossaryFilters(input={}) {
  if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>!['search','status','sourceLanguage','targetLanguage','page','pageSize'].includes(key))) throw new Error('Invalid glossary filter');
  const {search='',status='active',sourceLanguage='all',targetLanguage='all'}=input,page=Number(input.page ?? 1),pageSize=Number(input.pageSize ?? 20);
  if(typeof search!=='string' || search.length>80 || !['active','removed','all'].includes(status) || !['all',...languages].includes(sourceLanguage) || !['all',...languages].includes(targetLanguage) || !Number.isSafeInteger(page) || page<1 || page>5000 || !Number.isInteger(pageSize) || pageSize<1 || pageSize>100) throw new Error('Invalid glossary filter');
  return {search:search.trim(),status,sourceLanguage,targetLanguage,page,pageSize};
}
export function glossaryHistory(input={}) {
  if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>!['page','version'].includes(key))) throw new Error('Invalid glossary filter');
  const page=Number(input.page ?? 1),version=input.version===undefined ? null : Number(input.version);
  if(!Number.isSafeInteger(page) || page<1 || page>5000 || (version!==null && (!Number.isSafeInteger(version) || version<1))) throw new Error('Invalid glossary filter');
  return {page,version};
}
const fixtures={
  'blue shelf':{ar:'الرف الأزرق',ur:'نیلی شیلف'},
  'yellow shelf':{ar:'الرف الأصفر',ur:'پیلی شیلف'},
};
export function syntheticTermSuggestion(term,sourceLanguage,targetLanguage) {
  const text=sourceLanguage==='en' ? fixtures[termKey(term)]?.[targetLanguage] : null;
  return text ? {text,provenance:{adapter:'synthetic-glossary-v1',live:false}} : null;
}
export function checkedSyntheticGlossary(prepared,snapshot) {
  for(const term of snapshot.terms) {
    if(term.sourceLanguage!=='en' || !prepared.source.toLowerCase().includes(term.term.toLowerCase())) continue;
    const expected=syntheticTermSuggestion(term.term,term.sourceLanguage,term.targetLanguage)?.text;
    if(!expected || (term.override || term.suggestion)!==expected) throw new Error('Synthetic preparation cannot apply this glossary override. No AI result was generated.');
  }
  return {...prepared,provenance:{...prepared.provenance,glossary:{revision:snapshot.revision,hash:snapshot.hash,terms:snapshot.terms.map(({id,revision})=>({id,revision}))}}};
}
export function assertGlossaryCurrent(prepared,snapshot) {
  if(snapshot.revision===0 && !prepared?.provenance?.glossary) return;
  const dependency=prepared?.provenance?.glossary;
  if(!dependency || dependency.revision!==snapshot.revision || dependency.hash!==snapshot.hash) throw new Error('Glossary dependency changed');
}
