import {WORKER_LANGUAGE_CODES,languageTextMatches} from './languages.mjs';
const targets=WORKER_LANGUAGE_CODES.filter(code=>code!=='en');
// Full target text only: private facts, provider metadata and audio references are never editable here.
export function translationEdits(value) {
  if(value===undefined) return {};
  if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(key=>!targets.includes(key))) throw Error('Invalid translation edits');
  const result={};
  for(const language of targets) {
    if(!Object.hasOwn(value,language)) continue;
    const item=value[language];
    if(!item || typeof item!=='object' || Array.isArray(item) || Object.keys(item).sort().join(',')!=='question,text,title'
      || !Object.entries({title:120,text:5000,question:500}).every(([key,max])=>typeof item[key]==='string' && item[key].trim().length>0
        && item[key].length<=max && languageTextMatches(language,item[key]))) throw Error('Invalid translation edits');
    result[language]={title:item.title.trim(),text:item.text.trim(),question:item.question.trim()};
  }
  return result;
}
