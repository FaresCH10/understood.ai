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

async function translationResponse(response){
  const limit=128*1024,declared=response.headers?.get?.('content-length');
  if(declared && /^\d+$/.test(declared) && Number(declared)>limit){await response.body?.cancel();throw Error('DeepL response too large');}
  let raw='';
  if(response.body?.getReader){
    const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let size=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw Error('DeepL response too large');raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}
    catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  }else{raw=await response.text();if(Buffer.byteLength(raw)>limit)throw Error('DeepL response too large');}
  try{return JSON.parse(raw);}catch{throw Error('DeepL response was malformed');}
}

export function createDeepLTranslateAdapter({apiKey,fetchImpl=fetch,timeoutMs=8000,sourceLanguage='EN'}={}) {
  if(!apiKey || typeof apiKey!=='string' || apiKey.length>300 || /[\s\x00-\x1f\x7f]/.test(apiKey))
    throw Error('DeepL credentials are required');
  if(!Number.isInteger(timeoutMs) || timeoutMs<1000 || timeoutMs>30000) throw Error('Invalid translation timeout');
  const endpoint=apiKey.endsWith(':fx')?FREE_ENDPOINT:PRO_ENDPOINT;

  async function request(target,segments,detectedSource=sourceLanguage) {
    const response=await fetchImpl(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(timeoutMs),
      headers:{authorization:`DeepL-Auth-Key ${apiKey}`,'content-type':'application/json',accept:'application/json'},
      body:JSON.stringify({text:segments,...(detectedSource?{source_lang:detectedSource}:{}),target_lang:target})});
    if(!response.ok){await response.body?.cancel();throw Error(`DeepL request failed (${response.status})`);}
    const value=await translationResponse(response);
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
      const [title,text]=translated;
      const translatedQuestion=question?translated[2]:undefined,translatedChoices=translated.slice(question?3:2);
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
