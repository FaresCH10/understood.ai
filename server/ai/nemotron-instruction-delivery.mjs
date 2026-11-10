import {languageTextMatches} from '../languages.mjs';
import {withMultipleChoice} from '../multiple-choice.mjs';
import {createNemotronAdapter,NEMOTRON_ULTRA_MODEL} from './nemotron.mjs';
import {NEMOTRON_DELIVERY_ADAPTER} from './instruction-text-providers.mjs';
import {createDeepLTranslateAdapter,DEEPL_TRANSLATE_ADAPTER,DEEPL_TRANSLATE_LANGUAGES} from './deepl-translate.mjs';

const PREPARE_TIMEOUT_MS=16000;
const TRANSLATE_TIMEOUT_MS=6000;
const BUDGET_MS=25000;
const MAX_CONCURRENCY=8;
// Staff sources are English or Arabic by product scope. Any other worker-script
// source is normalized too, so generation always runs on English text.
const NON_LATIN_SCRIPT=/[\p{Script=Arabic}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Malayalam}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Sinhala}\p{Script=Cyrillic}\p{Script=Gurmukhi}]/u;
const words=value=>new Set(value.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{Z}\s]+/gu,' ').trim().split(' ').filter(word=>word.length>2));
const grounded=(source,value)=>{
  const sourceWords=words(source),target=[...words(value)];
  return !target.length || target.filter(word=>sourceWords.has(word)).length/target.length>=0.7;
};
// "Follow the instruction" questionnaires are the ungrounded template the
// delivery path must never publish as a generated question. The full bundle
// pipeline rejects them with a model check; this inline path needs a
// deterministic gate because a failed generation used to be indistinguishable
// from a successful generic one.
const genericQuestion=[/\b(?:which|what) (?:action|step)s? (?:follows|comes (?:after|next)|is (?:required|needed|next)) (?:this|the) (?:instruction|command)\b/i,
  /\b(?:does|should) (?:this|the) (?:instruction|command) (?:require|need|involve)\b/i,
  /\b(?:following|follows) (?:this|the) (?:instruction|command)\b/i,
  /\baccording to (?:this|the) (?:instruction|command)\b/i];
const genericChoice=[/\b(?:without|not) following (?:this|the) (?:instruction|command)\b/i,
  /\bopposite of (?:this|the) (?:instruction|command)\b/i,
  /\breplace (?:this|the) (?:instruction|command) with\b/i,
  /\b(?:ignore|skip) (?:this|the) (?:instruction|command)\b/i,
  /\b(?:carry|continue) (?:on )?with (?:another|other|the next) (?:task|job|assignment|work)\b/i,
  /\byour own (?:steps|instructions)\b/i];
const checkedGeneration=(english,generated)=>{
  if(!Array.isArray(generated?.facts) || !Array.isArray(generated?.choices) || generated.choices.length!==4)
    throw Error('Generated question was malformed');
  if(genericQuestion.some(pattern=>pattern.test(generated.question))
    || generated.choices.some(choice=>genericChoice.some(pattern=>pattern.test(choice))))
    throw Error('Generated question was generic');
  if(!languageTextMatches('en',generated.question) || !generated.facts.every(fact=>languageTextMatches('en',fact))
    || !generated.choices.every(choice=>languageTextMatches('en',choice))
    || !generated.facts.every(fact=>grounded(english.text,fact)) || !grounded(english.text,generated.choices[0]))
    throw Error('Generated question was ungrounded');
  return generated;
};

// The Vercel synthetic runtime has no worker budget ledger. This adapter is
// bounded to a single send request, so the journal contract stays explicit.
const inlineJournal={async beforeRequest(){return null;},async afterRequest(){}};

export function nemotronInstructionDelivery(env={},fetcher=fetch) {
  if(env.UNDERSTOOD_INSTRUCTION_TEXT_PROVIDER!=='nemotron')return null;
  if(env.VERCEL_ENV!=='production' || env.UNDERSTOOD_TIER==='production')return null;
  const apiKey=env.NVIDIA_API_KEY?.trim();
  if(!apiKey)return null;
  const deeplKey=(env.DEEPL_API_KEY ?? '').trim();
  if(!deeplKey)return null;
  const textModel=(env.NVIDIA_TEXT_MODEL || '').trim() || NEMOTRON_ULTRA_MODEL;
  const options={apiKey,dataClass:'synthetic',textModel,fetchImpl:fetcher};
  const adapterFor=timeoutMs=>createNemotronAdapter({...options,timeoutMs,requestJournal:inlineJournal});
  const translatorFor=timeoutMs=>createDeepLTranslateAdapter({apiKey:deeplKey,fetchImpl:fetcher,timeoutMs});
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
    translationLabel:'DeepL',
    translationAdapter:DEEPL_TRANSLATE_ADAPTER,
    textLanguages:DEEPL_TRANSLATE_LANGUAGES,
    normalizesSource:true,
    provenanceAdapter:NEMOTRON_DELIVERY_ADAPTER,
    model:textModel,
    async prepare(briefing,instruction) {
      deadline=Date.now()+BUDGET_MS;
      if(instruction?.response_mode!=='question')return null;
      try {
        const original={title:briefing?.title?.trim(),text:briefing?.source?.trim()};
        if(!original.title || !original.text)return null;
        const english=NON_LATIN_SCRIPT.test(original.title) || NON_LATIN_SCRIPT.test(original.text)
          ? await translatorFor(Math.min(TRANSLATE_TIMEOUT_MS,remaining()-500)).translateToEnglish(original)
          : original;
        // NIM occasionally fails or returns the generic template. One retry
        // keeps a transient failure from costing the whole send.
        let generated=null;
        for(let attempt=0;attempt<2&&!generated;attempt++) {
          const left=remaining();
          if(left<3000)break;
          try { generated=checkedGeneration(english,await adapterFor(Math.min(PREPARE_TIMEOUT_MS,left-1000)).prepare(english.text,{multipleChoice:true})); }
          catch { generated=null; }
        }
        if(!generated)return null;
        const title=english.title;
        return withMultipleChoice({
          responseMode:instruction.response_mode,title,source:briefing.source,
          facts:generated.facts,question:generated.question,rubric:{mode:'keywords',askedFacts:generated.askedFacts},
          languages:{en:{title,text:english.text,question:generated.question,answerChoices:generated.choices,speech:'device-synthesis-demo'}},
          provenance:{adapter:'synthetic-instruction-v1',live:false},
        },{preserveQuestions:true,preserveAskedFacts:true});
      } catch { return null; }
    },
    async translate(language,content) {
      await acquire();
      try {
        const left=remaining();
        if(left<2000)throw Error('DeepL translation budget exhausted');
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
