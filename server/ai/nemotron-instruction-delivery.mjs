import {languageTextMatches} from '../languages.mjs';
import {withMultipleChoice} from '../multiple-choice.mjs';
import {createNemotronAdapter,NEMOTRON_ULTRA_MODEL} from './nemotron.mjs';
import {NEMOTRON_DELIVERY_ADAPTER} from './instruction-text-providers.mjs';
import {createDeepLTranslateAdapter,DEEPL_TRANSLATE_ADAPTER,DEEPL_TRANSLATE_LANGUAGES} from './deepl-translate.mjs';

const PREPARE_TIMEOUT_MS=20000;
const TRANSLATE_TIMEOUT_MS=6000;
const BUDGET_MS=25000;
const MAX_CONCURRENCY=8;
// Staff sources are English or Arabic by product scope. Any other worker-script
// source is normalized too, so generation always runs on English text.
const NON_LATIN_SCRIPT=/[\p{Script=Arabic}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Malayalam}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Sinhala}\p{Script=Cyrillic}\p{Script=Gurmukhi}]/u;
const tokens=value=>value.normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const words=value=>new Set(tokens(value).filter(word=>word.length>2||/\d/.test(word)));
// Paraphrases such as "User wants a chicken shawarma sandwich" are valid
// restatements of a source with typos; only the substantive nouns and values
// need to match. These link words carry no grounding evidence either way.
const paraphrase=new Set(['user','users','want','wants','wanted','need','needs','needed','must','should','shall',
  'include','includes','included','including','contain','contains','containing','request','requests','requested',
  'requesting','specify','specifies','specified','explicit','explicitly','make','makes','made','making','add','adds',
  'added','adding','use','uses','used','using','have','has','having','provide','provides','provided','ensure','ensures',
  'ensured','also','only','just','both','each','every','all','any','some','the','that','this','these','those','with',
  'and','plus','for','from','into','onto','then','than','will','would','can','could','may','might','its','was','were',
  'been','being']);
const editDistance=(left,right)=>{
  if(Math.abs(left.length-right.length)>2)return 3;
  let before=null,row=Array.from({length:right.length+1},(_,index)=>index);
  for(let i=1;i<=left.length;i++) {
    const next=[i];
    for(let j=1;j<=right.length;j++) {
      const cost=left[i-1]===right[j-1]?0:1;
      next[j]=Math.min(row[j]+1,next[j-1]+1,row[j-1]+cost);
      if(i>1&&j>1&&left[i-1]===right[j-2]&&left[i-2]===right[j-1])next[j]=Math.min(next[j],before[j-2]+1);
    }
    before=row;row=next;
  }
  return row[right.length];
};
// NIM normalizes misspellings ("chiken" -> "chicken") and inflections
// ("sandwiches" -> "sandwich"); exact token overlap rejected those valid
// corrections and failed otherwise good sends.
const close=(left,right)=>{
  if(left===right)return true;
  const short=Math.min(left.length,right.length);
  if(short<5)return false;
  if(short>=8&&Math.abs(left.length-right.length)<=3&&(left.startsWith(right)||right.startsWith(left)))return true;
  return editDistance(left,right)<=(short>=8?2:1);
};
const numbers=value=>new Set(tokens(value).filter(token=>/\d/.test(token)));
const grounded=(source,value)=>{
  const sourceWords=[...words(source)],target=[...words(value)];
  if(!target.length)return true;
  if([...numbers(value)].some(number=>!numbers(source).has(number)))return false;
  const substantive=target.filter(word=>!paraphrase.has(word));
  if(!substantive.length)return target.every(word=>sourceWords.some(candidate=>close(word,candidate)));
  return substantive.filter(word=>sourceWords.some(candidate=>close(word,candidate))).length/substantive.length>0.5;
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
// Staff see this code, and it is stored in the failed job, so it must stay a
// fixed, sanitized vocabulary: no provider bodies, keys or URLs.
const causeOf=error=>{
  const message=typeof error?.message==='string'?error.message:'';
  const status=/NVIDIA request failed \((\d{3})\)/.exec(message)?.[1];
  if(status)return `provider_http_${status}`;
  if(error?.name==='TimeoutError' || error?.name==='AbortError' || /timeout|abort/i.test(message))return 'provider_timeout';
  if(/was generic/.test(message))return 'question_generic';
  if(/was ungrounded/.test(message))return 'question_ungrounded';
  if(/malformed|blocked or incomplete|was empty|too large|failed validation/.test(message))return 'model_response_invalid';
  return 'generation_failed';
};

// The Vercel synthetic runtime has no worker budget ledger. This adapter is
// bounded to a single send request, so the journal contract stays explicit.
const inlineJournal={async beforeRequest(){return null;},async afterRequest(){}};

export function nemotronInstructionDelivery(env={},fetcher=fetch,sharedLimiter=null) {
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
  const failures=new WeakMap();
  const acquire=()=>active<MAX_CONCURRENCY?(active++,Promise.resolve()):new Promise(resolve=>waiting.push(resolve));
  // Transfer the reserved slot directly to a waiter; a new request cannot
  // steal it between resolve() and the waiter's next microtask.
  const release=()=>{const next=waiting.shift();if(next)next();else active--;};
  const limiter=sharedLimiter ?? {acquire,release};
  const remaining=()=>deadline-Date.now();

  return {
    forRequest:()=>nemotronInstructionDelivery(env,fetcher,limiter),
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
      const fail=code=>{if(briefing && typeof briefing==='object')failures.set(briefing,code);return null;};
      if(instruction?.response_mode!=='question')return null;
      try {
        const original={title:briefing?.title?.trim(),text:briefing?.source?.trim()};
        if(!original.title || !original.text)return fail('invalid_source');
        let english;
        try {
          english=NON_LATIN_SCRIPT.test(original.title) || NON_LATIN_SCRIPT.test(original.text)
            ? await translatorFor(Math.min(TRANSLATE_TIMEOUT_MS,remaining()-500)).translateToEnglish(original)
            : original;
        } catch { return fail('source_translation_failed'); }
        // NIM occasionally fails or returns the generic template. A retry
        // covers transient and content failures, but a timed-out attempt has
        // no budget left to be useful, so the caller sees that cause instead.
        let generated=null,cause=null;
        for(let attempt=0;attempt<2&&!generated;attempt++) {
          const left=remaining();
          if(left<3000){cause ??= 'budget_exhausted';break;}
          try { generated=checkedGeneration(english,await adapterFor(Math.min(PREPARE_TIMEOUT_MS,left-1000)).prepare(english.text,{multipleChoice:true})); }
          catch(error) { generated=null;cause=causeOf(error);if(cause==='provider_timeout')break; }
        }
        if(!generated)return fail(cause ?? 'budget_exhausted');
        const title=english.title;
        return withMultipleChoice({
          responseMode:instruction.response_mode,title,source:briefing.source,
          facts:generated.facts,question:generated.question,rubric:{mode:'keywords',askedFacts:generated.askedFacts},
          languages:{en:{title,text:english.text,question:generated.question,answerChoices:generated.choices,speech:'device-synthesis-demo'}},
          provenance:{adapter:'synthetic-instruction-v1',live:false},
        },{preserveQuestions:true,preserveAskedFacts:true});
      } catch { return fail('generation_failed'); }
    },
    failureCause(briefing) {
      return failures.get(briefing) ?? null;
    },
    async translate(language,content) {
      await limiter.acquire();
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
      } finally { limiter.release(); }
    },
  };
}
