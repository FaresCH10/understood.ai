import {languageTextMatches} from '../languages.mjs';

export const GOOGLE_TRANSLATE_ADAPTER='google-translate-v2';
const ENDPOINT='https://translation.googleapis.com/language/translate/v2';
// Google's Basic (v2) API has no Shahmukhi Punjabi variant: `pa` is Gurmukhi.
const googleLanguage=Object.freeze({
  en:'en',ar:'ar',hi:'hi',ur:'ur',bn:'bn',ml:'ml',ta:'ta',te:'te',ne:'ne',
  fil:'fil',si:'si',ru:'ru','pa-Guru':'pa',id:'id',
});
export const GOOGLE_TRANSLATE_LANGUAGES=Object.freeze(Object.keys(googleLanguage));

const nonempty=(value,max)=>typeof value==='string' && value.trim().length>0 && value.length<=max;
const DIGIT_ZEROS=[0x30,0x660,0x6f0,0x966,0x9e6,0xa66,0xae6,0xb66,0xbe6,0xc66,0xce6,0xd66,0xde6,0xe50,0xed0,0xf20,0x1040,0x1090,0x17e0,0x1810,0xff10];
const asciiDigits=value=>value.replace(/\p{Nd}/gu,character=>{
  const point=character.codePointAt(0),zero=DIGIT_ZEROS.find(base=>point>=base && point<base+10);
  return zero===undefined?character:String(point-zero);
});
const numbers=value=>(asciiDigits(value).match(/[0-9]+(?:[.,][0-9]+)*/g)??[]).sort().join(' ');
// Translation v2 always HTML-escapes its output, even with format=text.
const unescape=value=>value
  .replace(/&#x([0-9a-f]+);/gi,(_,code)=>String.fromCodePoint(Number.parseInt(code,16)))
  .replace(/&#([0-9]+);/g,(_,code)=>String.fromCodePoint(Number.parseInt(code,10)))
  .replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');

function validateField(value,language,max,original){
  if(!nonempty(value,5000) || !languageTextMatches(language,value) || numbers(value)!==numbers(original))
    throw Error(`Google Translate returned an invalid ${max===120?'title':max===500?'question':'text'} translation`);
  if(value.length>max) throw Error('Google Translate returned an overlong translation');
  return value.trim();
}

export function createGoogleTranslateAdapter({apiKey,fetchImpl=fetch,timeoutMs=8000}={}) {
  if(!apiKey || typeof apiKey!=='string' || apiKey.length>300 || /[\s\x00-\x1f\x7f]/.test(apiKey))
    throw Error('Google Translate credentials are required');
  if(!Number.isInteger(timeoutMs) || timeoutMs<1000 || timeoutMs>30000) throw Error('Invalid translation timeout');

  async function request(target,segments) {
    const response=await fetchImpl(ENDPOINT,{method:'POST',redirect:'error',signal:AbortSignal.timeout(timeoutMs),
      headers:{'x-goog-api-key':apiKey,'content-type':'application/json',accept:'application/json'},
      body:JSON.stringify({q:segments,source:'en',target,format:'text'})});
    if(!response.ok) throw Error(`Google Translate request failed (${response.status})`);
    const value=await response.json();
    const translations=value?.data?.translations;
    if(!Array.isArray(translations) || translations.length!==segments.length
      || !translations.every(item=>typeof item?.translatedText==='string'))
      throw Error('Google Translate response was malformed');
    return translations.map(item=>unescape(item.translatedText));
  }

  return {
    provenance:Object.freeze({adapter:GOOGLE_TRANSLATE_ADAPTER,model:'google-translate-v2'}),
    languages:GOOGLE_TRANSLATE_LANGUAGES,
    async translate(content,language) {
      const target=googleLanguage[language];
      if(!target) throw Error(`Google Translate does not support ${language}`);
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
        title:validateField(title,language,120,content.title),
        text:validateField(text,language,5000,content.text),
        ...(question?{question:validateField(translatedQuestion,language,500,content.question)}:{}),
      };
      if(choices) {
        if(translatedChoices.length!==choices.length
          || translatedChoices.some((choice,index)=>!nonempty(choice,1000) || !languageTextMatches(language,choice)
            || numbers(choice)!==numbers(choices[index])))
          throw Error('Google Translate changed the answer choices');
        value.answerChoices=translatedChoices.map(choice=>choice.trim());
      }
      return value;
    },
  };
}
