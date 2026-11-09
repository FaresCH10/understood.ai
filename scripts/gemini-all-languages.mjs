import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {createGeminiAdapter,GEMINI_MODELS} from '../server/ai/gemini.mjs';
import {assertGeminiKey} from '../server/ai/gemini-key.mjs';
import {CANONICAL_SOURCE,QUESTION,syntheticPrepare} from '../server/domain.mjs';
import {translatedContent,translationCheck} from '../server/ai/prepared-bundle.mjs';
import {WORKER_LANGUAGE_CODES,workerLocale} from '../server/languages.mjs';
import {inspectWav} from '../server/audio.mjs';

// Local synthetic verification of every worker language against the live Gemini API.
// Never point this at real worker data, and never print the credential.
const MODES=new Set(['translate','speech','all']);
const SOURCE=Object.freeze({title:'Shelf colour handover',text:CANONICAL_SOURCE,question:QUESTION});
const FIXTURE=syntheticPrepare(CANONICAL_SOURCE).languages;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function verificationPlan(mode) {
  if(!MODES.has(mode))throw Error('Unsupported verification mode');
  const languages=WORKER_LANGUAGE_CODES.map(code=>({code,name:workerLocale(code).englishName,
    translation:mode!=='speech'&&code!=='en',speech:mode!=='translate'}));
  return Object.freeze({mode,languages:languages.length,perLanguage:Object.freeze(languages.map(item=>Object.freeze(item))),
    maxRequests:languages.reduce((total,item)=>total+(item.translation?2:0)+(item.speech?1:0),0),
    models:GEMINI_MODELS,dataClass:'synthetic',realDataAllowed:false,productionReady:false,
    fixtureHash:hash({version:'all-languages-v1',source:SOURCE,fixture:FIXTURE})});
}

function loadKey() {
  for(const file of ['.env','.env.production.worker','.env.production.local']) {
    const path=resolve(file);
    if(!existsSync(path))continue;
    const value=parseEnv(readFileSync(path,'utf8')).GEMINI_API_KEY;
    if(value)return value;
  }
  throw Error('Gemini credential not found. Add GEMINI_API_KEY to a gitignored .env or .env.production.local.');
}

export async function verifyAllLanguages({apiKey,mode,persist=()=>{}}) {
  assertGeminiKey(apiKey);
  const plan=verificationPlan(mode),requests=[],results=[];
  const report={runId:randomUUID(),startedAt:new Date().toISOString(),...plan,requests,results,state:'pending'};
  const save=()=>persist(structuredClone(report));
  let currentLanguage=null;
  const journal={
    async beforeRequest({cleanup=false}={}) {
      if(cleanup || requests.length>=plan.maxRequests)throw Error('Synthetic request budget exhausted');
      const id=randomUUID();requests.push({id,language:currentLanguage,state:'pending',httpStatus:null});save();return id;
    },
    async afterRequest(id,{httpStatus}) {
      const row=requests.find(item=>item.id===id);if(!row)throw Error('Synthetic request journal unavailable');
      if(row.state==='pending') {
        row.httpStatus=httpStatus;
        row.state=httpStatus===null?'uncertain':httpStatus>=200&&httpStatus<300?'accepted':'rejected';save();
      }
    },
  };
  const diagnostic=()=>{
    const status=[...requests].reverse().find(item=>item.language===currentLanguage)?.httpStatus;
    return status===401||status===403?'credential_or_access_denied':status===404?'model_unavailable'
      :status===429?'quota_unavailable':status===400?'request_rejected':status===null?'transport_uncertain':'invalid_output';
  };
  const adapter=createGeminiAdapter({apiKey,dataClass:'synthetic',timeoutMs:90000,requestJournal:journal});
  for(const code of WORKER_LANGUAGE_CODES) {
    let translated=null;
    if(mode!=='speech') {
      if(code==='en')results.push({code,stage:'translation',state:'not_required'});
      else {
        currentLanguage=code;
        try {
          translated=translatedContent(await adapter.translate(structuredClone(SOURCE),code),code);
          const check=await adapter.checkTranslation(structuredClone(SOURCE),structuredClone(translated),code);
          translationCheck(check);
          results.push({code,stage:'translation',state:'passed',outputHash:hash(translated),chars:translated.text.length,
            checks:check,title:translated.title,text:translated.text,question:translated.question});
        }catch(error) {
          results.push({code,stage:'translation',state:'failed',code:error.code||'translation_failed',
            message:error.message,diagnostic:diagnostic()});
        }
      }
    }
    if(mode!=='translate') {
      currentLanguage=code;
      try {
        const bytes=await adapter.speech(translated?.text ?? FIXTURE[code].text,code),info=inspectWav(bytes);
        if(info.durationSeconds<0.25)throw Error('Synthetic speech test too short');
        results.push({code,stage:'speech',state:'passed',bytes:info.bytes,durationSeconds:info.durationSeconds,outputHash:info.sha256});
      }catch(error) {
        results.push({code,stage:'speech',state:'failed',code:error.code||'speech_failed',
          message:error.message,diagnostic:diagnostic()});
      }
    }
    save();
  }
  report.state=results.every(item=>item.state==='passed'||item.state==='not_required')?'passed':'failed';
  report.completedAt=new Date().toISOString();save();return report;
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [flag,mode]=process.argv.slice(2);
  if(flag==='--plan' && process.argv.length===4 && MODES.has(mode)) {
    console.log(JSON.stringify(verificationPlan(mode),null,2));
  } else if(flag==='--live-synthetic' && process.argv.length===4 && MODES.has(mode)) {
    try {
      const path=resolve('artifacts',`gemini-all-languages-${mode}-${Date.now()}.json`);
      const report=await verifyAllLanguages({apiKey:loadKey(),mode,persist:value=>writeFileSync(path,JSON.stringify(value,null,2)+'\n')});
      console.log(JSON.stringify({...report,evidencePath:path}));
      if(report.state!=='passed')process.exitCode=1;
    } catch {
      console.error('All-language verification configuration unavailable. No credential or provider payload was printed.');
      process.exitCode=1;
    }
  } else {
    console.error('Explicit invocation required: node scripts/gemini-all-languages.mjs --plan translate|speech|all');
    console.error('Live run: node scripts/gemini-all-languages.mjs --live-synthetic translate|speech|all');
    process.exitCode=1;
  }
}
