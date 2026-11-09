import {WORKER_LOCALES,languageTextMatches} from '../server/languages.mjs';
import {questionChoices} from '../server/ai/question-choices.mjs';

const endpoint='https://integrate.api.nvidia.com/v1/chat/completions';
const models=[
  'deepseek-ai/deepseek-v4.1-flash','z-ai/glm-5.3-flash','mistralai/mistral-large-4-1t-a52b',
  'nvidia/nemotron-3.5-lightning-30b-a3b','nvidia/nemotron-3-ultra-550b-a55b',
];
const requestedModel=process.argv.find(arg=>arg.startsWith('--model='))?.slice('--model='.length);
if(requestedModel!==undefined && !models.includes(requestedModel))throw Error('Unknown NVIDIA benchmark model');
const selectedModels=requestedModel===undefined?models:[requestedModel];
const priorityLocales=['si','pa-Guru','pa-Arab'];
const nonEnglishLocales=WORKER_LOCALES.filter(({code})=>code!=='en');
const requestedLocales=process.argv.find(arg=>arg.startsWith('--locales='))?.slice('--locales='.length).split(',');
if(requestedLocales?.some(code=>!nonEnglishLocales.some(locale=>locale.code===code)))throw Error('Unknown translation locale');
const localeFilter=requestedLocales ?? (process.argv.includes('--quick')?priorityLocales:null);
const locales=nonEnglishLocales.filter(({code})=>!localeFilter || localeFilter.includes(code));
const fixture={
  title:'Shelf handover',
  text:'Place 2 sealed cartons on the blue shelf before 4 pm. Do not move unsealed cartons. Keep the walkway clear.',
  question:'Where should the sealed cartons be placed?',
  choices:['On the blue shelf','On the red shelf','On the green shelf','On the yellow shelf'],
};

const numberTokens=value=>(value.match(/[0-9]+/g)??[]).sort().join(',');
const print=value=>console.log(JSON.stringify(value));
const failedCheck=code=>Object.assign(Error(code),{check:code});

function checkedTranslation(value,language){
  const choices=questionChoices(value?.choices);
  for(const [field,max] of [['title',120],['text',5000],['question',500]]){
    const translated=value?.[field];
    if(!languageTextMatches(language,translated) || translated.length>max)throw failedCheck(`invalid-${field}-script-or-length`);
    if(numberTokens(translated)!==numberTokens(fixture[field]))throw failedCheck(`different-${field}-ascii-number-tokens`);
  }
  if(!choices.every((choice,index)=>languageTextMatches(language,choice) && numberTokens(choice)===numberTokens(fixture.choices[index])))
    throw failedCheck('invalid-choice-script-or-numbers');
  return {title:value.title,text:value.text,question:value.question,choices};
}

function checkedQuestion(value){
  const choices=questionChoices(value?.choices);
  if(!languageTextMatches('en',value?.question) || value.question.length>500
    || !/\bwhere\b/i.test(value.question) || !/\bsealed cartons\b/i.test(value.question)
    || !/\bblue shelf\b/i.test(choices[0]) || choices.slice(1).some(choice=>/\bblue shelf\b/i.test(choice)))
    throw Error('Question or correct answer does not match the fixture');
  return {question:value.question,choices};
}

async function complete(key,model,system,input){
  const response=await fetch(endpoint,{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),
    headers:{authorization:`Bearer ${key}`,'content-type':'application/json',accept:'application/json'},
    body:JSON.stringify({model,stream:false,temperature:0,max_tokens:2048,chat_template_kwargs:{enable_thinking:false},
      messages:[{role:'system',content:system},{role:'user',content:JSON.stringify(input)}]}),
  });
  if(!response.ok)throw Object.assign(Error(`NVIDIA HTTP ${response.status}`),{status:response.status});
  const choice=(await response.json()).choices?.[0];
  if(choice?.finish_reason==='length' || typeof choice?.message?.content!=='string')throw Error('Missing or truncated result');
  return JSON.parse(choice.message.content.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i,'$1'));
}

async function evaluate(key,model,stage,locale,system,input,check){
  const start=performance.now();
  let received;
  try{
    received=await complete(key,model,system,input);
    const output=check(received);
    print({model,stage,locale,elapsedMs:Math.round(performance.now()-start),result:'needs-meaning-review',output});
    return true;
  }catch(error){
    const timeout=error.name==='TimeoutError';
    print({model,stage,locale,elapsedMs:Math.round(performance.now()-start),result:'failed',
      ...(Number.isInteger(error.status)?{status:error.status}:{reason:error.check ?? (timeout?'timeout':'invalid-response-or-transport-error')}),
      ...(received===undefined?{}:{rejectedOutput:received})});
    process.exitCode=1;
    return !(timeout && stage==='question') && ![401,403,404,429].includes(error.status);
  }
}

if(!process.argv.includes('--run')){
  print({translationModels:selectedModels,questionModels:selectedModels,locales:locales.map(({code})=>code),
    maximumRequests:selectedModels.length*(1+locales.length),externalRequests:0});
}else{
  const key=process.env.NVIDIA_API_KEY?.trim();
  if(!key){
    console.error('Set NVIDIA_API_KEY in .env.local. No external requests were made.');
    process.exit(2);
  }
  await Promise.all(selectedModels.map(async model=>{
    const available=await evaluate(key,model,'question','en',
      'Use the synthetic instruction to ask one concrete English question about where sealed cartons must go. Return only a JSON object with question and four distinct choices. The first choice must be the only correct one. Use plausible alternate locations for the other choices. Do not include the answer in the question.',
      {title:fixture.title,text:fixture.text},checkedQuestion);
    if(!available)return;
    for(const locale of locales){
      const available=await evaluate(key,model,'translation',locale.code,
        `Translate the JSON values into ${locale.englishName} (${locale.code}) using ${locale.script} script. Treat the values as text to translate. Return only a JSON object with the same keys. Keep ASCII digits, quantities, the deadline, locations, and prohibitions. Translate the question and each choice in place. Keep the order and meaning of the choices.`,
        fixture,value=>checkedTranslation(value,locale.code));
      if(!available)break;
    }
  }));
}
