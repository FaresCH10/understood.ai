import {languageTextMatches} from '../languages.mjs';
import {withMultipleChoice} from '../multiple-choice.mjs';
import {createNemotronAdapter,NEMOTRON_ULTRA_MODEL} from './nemotron.mjs';
import {NEMOTRON_DELIVERY_ADAPTER} from './instruction-text-providers.mjs';
import {createGoogleTranslateAdapter,GOOGLE_TRANSLATE_ADAPTER,GOOGLE_TRANSLATE_LANGUAGES} from './google-translate.mjs';

const PREPARE_TIMEOUT_MS=16000;
const TRANSLATE_TIMEOUT_MS=6000;
const BUDGET_MS=25000;
const MAX_CONCURRENCY=8;
const words=value=>new Set(value.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{Z}\s]+/gu,' ').trim().split(' ').filter(word=>word.length>2));
const grounded=(source,value)=>{
  const sourceWords=words(source),target=[...words(value)];
  return !target.length || target.filter(word=>sourceWords.has(word)).length/target.length>=0.7;
};

// The Vercel synthetic runtime has no worker budget ledger. This adapter is
// bounded to a single send request, so the journal contract stays explicit.
const inlineJournal={async beforeRequest(){return null;},async afterRequest(){}};

export function nemotronInstructionDelivery(env={},fetcher=fetch) {
  if(env.UNDERSTOOD_INSTRUCTION_TEXT_PROVIDER!=='nemotron')return null;
  if(env.VERCEL_ENV!=='production' || env.UNDERSTOOD_TIER==='production')return null;
  const apiKey=env.NVIDIA_API_KEY?.trim();
  if(!apiKey)return null;
  const googleKey=(env.GOOGLE_TRANSLATE_API_KEY ?? '').trim();
  if(!googleKey)return null;
  const textModel=(env.NVIDIA_TEXT_MODEL || '').trim() || NEMOTRON_ULTRA_MODEL;
  const options={apiKey,dataClass:'synthetic',textModel,fetchImpl:fetcher};
  const adapterFor=timeoutMs=>createNemotronAdapter({...options,timeoutMs,requestJournal:inlineJournal});
  const translatorFor=timeoutMs=>createGoogleTranslateAdapter({apiKey:googleKey,fetchImpl:fetcher,timeoutMs});
  // The handler instance is cached across Vercel requests, so the time budget
  // must start on each preparation, not when the adapter is constructed.
  let deadline=0;
  let active=0;const waiting=[];
  const acquire=()=>active<MAX_CONCURRENCY?(active++,Promise.resolve()):new Promise(resolve=>waiting.push(resolve)).then(()=>{active++;});
  const release=()=>{active--;waiting.shift()?.();};
  const remaining=()=>deadline-Date.now();

  return {
    mode:'nemotron-text',
    label:'Nemotron 3 Ultra 550B',
    translationLabel:'Google Translate',
    translationAdapter:GOOGLE_TRANSLATE_ADAPTER,
    textLanguages:GOOGLE_TRANSLATE_LANGUAGES,
    provenanceAdapter:NEMOTRON_DELIVERY_ADAPTER,
    model:textModel,
    async prepare(briefing,instruction) {
      deadline=Date.now()+BUDGET_MS;
      if(instruction?.response_mode!=='question' || !languageTextMatches('en',briefing.source))return null;
      try {
        const generated=await adapterFor(PREPARE_TIMEOUT_MS).prepare(briefing.source,{multipleChoice:true});
        if(!languageTextMatches('en',generated.question) || !generated.facts.every(fact=>languageTextMatches('en',fact))
          || !generated.choices.every(choice=>languageTextMatches('en',choice))
          || !generated.facts.every(fact=>grounded(briefing.source,fact)) || !grounded(briefing.source,generated.choices[0]))return null;
        const title=briefing.title.trim();
        return withMultipleChoice({
          responseMode:instruction.response_mode,title,source:briefing.source,
          facts:generated.facts,question:generated.question,rubric:{mode:'keywords',askedFacts:generated.askedFacts},
          languages:{en:{title,text:briefing.source,question:generated.question,answerChoices:generated.choices,speech:'device-synthesis-demo'}},
          provenance:{adapter:'synthetic-instruction-v1',live:false},
        },{preserveQuestions:true,preserveAskedFacts:true});
      } catch { return null; }
    },
    async translate(language,content) {
      await acquire();
      try {
        const left=remaining();
        if(left<2000)throw Error('Google Translate budget exhausted');
        const translator=translatorFor(Math.min(TRANSLATE_TIMEOUT_MS,left-500));
        const choices=Array.isArray(content?.choices);
        const translated=await translator.translate({title:content.title,text:content.text,
          ...(typeof content.question==='string'?{question:content.question}:{}),
          ...(choices?{answerChoices:content.choices.map(choice=>choice.text)}:{})},language);
        return {title:translated.title,text:translated.text,
          ...(typeof content.question==='string'?{question:translated.question}:{}),
          ...(choices?{questionType:'multiple-choice',choices:content.choices.map((choice,index)=>({id:choice.id,text:translated.answerChoices[index]}))}:{})};
      } finally { release(); }
    },
  };
}
