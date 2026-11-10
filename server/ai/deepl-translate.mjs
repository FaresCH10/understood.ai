import {languageTextMatches} from '../languages.mjs';

export const DEEPL_TRANSLATE_ADAPTER='deepl-v2';
const FREE_ENDPOINT='https://api-free.deepl.com/v2/translate';
const PRO_ENDPOINT='https://api.deepl.com/v2/translate';
// DeepL has no Sinhala or Shahmukhi Punjabi target. Its Tagalog target is the
// supported match for Filipino, and `pa` is Gurmukhi.
const deeplLanguage=Object.freeze({
  en:'EN-GB',ar:'AR',hi:'HI',ur:'UR',bn:'BN',ml:'ML',ta:'TA',te:'TE',ne:'NE',
  fil:'TL',ru:'RU','pa-Guru':'PA',id:'ID',
});
export const DEEPL_TRANSLATE_LANGUAGES=Object.freeze(Object.keys(deeplLanguage));

const nonempty=(value,max)=>typeof value==='string' && value.trim().length>0 && value.length<=max;

function validateField(value,language,max,label){
  if(!nonempty(value,5000) || value.length>max || !languageTextMatches(language,value))
    throw Error(`DeepL returned an invalid ${label} translation`);
  return value.trim();
}

export function createDeepLTranslateAdapter({apiKey,fetchImpl=fetch,timeoutMs=8000}={}) {
  if(!apiKey || typeof apiKey!=='string' || apiKey.length>300 || /[\s\x00-\x1f\x7f]/.test(apiKey))
    throw Error('DeepL credentials are required');
  if(!Number.isInteger(timeoutMs) || timeoutMs<1000 || timeoutMs>30000) throw Error('Invalid translation timeout');
  const endpoint=apiKey.endsWith(':fx')?FREE_ENDPOINT:PRO_ENDPOINT;

  async function request(target,segments,sourceLanguage='EN') {
    const response=await fetchImpl(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(timeoutMs),
      headers:{authorization:`DeepL-Auth-Key ${apiKey}`,'content-type':'application/json',accept:'application/json'},
      body:JSON.stringify({text:segments,...(sourceLanguage?{source_lang:sourceLanguage}:{}),target_lang:target})});
    if(!response.ok) throw Error(`DeepL request failed (${response.status})`);
    const value=await response.json();
    const translations=value?.translations;
    if(!Array.isArray(translations) || translations.length!==segments.length
      || !translations.every(item=>typeof item?.text==='string'))
      throw Error('DeepL response was malformed');
    return translations.map(item=>item.text);
  }

  return {
    provenance:Object.freeze({adapter:DEEPL_TRANSLATE_ADAPTER,model:'deepl-v2'}),
    languages:DEEPL_TRANSLATE_LANGUAGES,
    // Question generation is English-only, so the original staff source is
    // normalized before generation; DeepL detects the source language itself.
    async translateToEnglish(content) {
      if(!nonempty(content?.title,120) || !nonempty(content?.text,5000))
        throw Error('Invalid translation input');
      const [title,text]=await request('EN-GB',[content.title,content.text],null);
      return {title:validateField(title,'en',120,'title'),text:validateField(text,'en',5000,'text')};
    },
    async translate(content,language) {
      const target=deeplLanguage[language];
      if(!target) throw Error(`DeepL does not support ${language}`);
      const question=typeof content?.question==='string';
      if(!nonempty(content?.title,120) || !nonempty(content?.text,5000) || (question && !nonempty(content.question,500)))
        throw Error('Invalid translation input');
      const choices=content.answerChoices===undefined ? null
        :Array.isArray(content.answerChoices) && content.answerChoices.length===4
          && content.answerChoices.every(choice=>nonempty(choice,1000)) ? content.answerChoices : null;
      if(content.answerChoices!==undefined && !choices) throw Error('Invalid translation input');
      const segments=[content.title,content.text,...(question?[content.question]:[]),...(choices??[])];
      const translated=await request(target,segments);
      const [title,text,translatedQuestion,...translatedChoices]=translated;
      const value={
        title:validateField(title,language,120,'title'),
        text:validateField(text,language,5000,'text'),
        ...(question?{question:validateField(translatedQuestion,language,500,'question')}:{}),
      };
      if(choices) {
        if(translatedChoices.length!==choices.length
          || translatedChoices.some(choice=>!nonempty(choice,1000) || !languageTextMatches(language,choice)))
          throw Error('DeepL changed the answer choices');
        value.answerChoices=translatedChoices.map(choice=>choice.trim());
      }
      return value;
    },
  };
}
