import {createHash,randomUUID} from 'node:crypto';
import {inspectWav} from '../audio.mjs';
import {WORKER_LANGUAGE_CODES} from '../languages.mjs';
import {bundleHash,checkedPreparedBundle,questionWithChoices,reviewContent,PREPARED_BUNDLE_SCHEMA} from './prepared-bundle.mjs';

const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const confirmation={en:'Confirm that you have read or listened to this instruction.',ar:'أكد أنك قرأت هذه التعليمات أو استمعت إليها.'};

// Preserve the checked instruction and frozen choice order from the existing
// text path. Speech providers only narrate; they never write another question.
export async function instructionVoiceBundle(prepared,{source,title,revision,review,glossary,responseMode,textModel},speech,assertCurrent){
  const languages=['en',...WORKER_LANGUAGE_CODES.filter(code=>code!=='en'&&prepared.languages[code])];
  if(!languages.every(code=>speech.languages.includes(code)))throw Error('Instruction voice language unavailable');
  const questionMode=responseMode==='question';
  const provenance={adapter:speech.provenance?.adapter||'nemotron-deepl-groq-v1',dataClass:'synthetic',textModel:textModel||'checked-instruction-text',speechModel:speech.provenance?.speechModel||'canopylabs/orpheus-english-arabic',voice:speech.provenance?.voice||'austin/fahad',promptVersion:'instruction-voice-v1',schemaVersion:PREPARED_BUNDLE_SCHEMA};
  const dependencies={revision,titleHash:hash(title.trim()),sourceHash:hash(source),reviewHash:hash(reviewContent(review,revision)),glossaryHash:glossary.hash,glossaryRevision:glossary.revision,languages,provider:provenance,schemaVersion:PREPARED_BUNDLE_SCHEMA};
  const localized=Object.fromEntries(languages.map(code=>{const item=prepared.languages[code];return [code,{title:item.title,text:item.text,question:item.question||confirmation[code],...(questionMode?{questionType:item.questionType,choices:structuredClone(item.choices)}:{}),speech:{}}];}));
  const audio=[];
  const results=await Promise.allSettled(languages.flatMap(language=>['body','question'].map(async kind=>{
    const item=localized[language],includesChoices=kind==='question'&&questionMode;
    const text=kind==='body'?item.text:includesChoices?questionWithChoices(item):item.question;
    await assertCurrent();const bytes=await speech.speech(text,language,assertCurrent);await assertCurrent();
    const info=inspectWav(bytes),id=randomUUID(),textHash=hash(text);
    audio.push({id,language,textHash,sha256:info.sha256,durationSeconds:info.durationSeconds,bytes});
    item.speech[kind]={id,textHash,sha256:info.sha256,bytes:info.bytes,durationSeconds:info.durationSeconds,mimeType:'audio/wav',sampleRate:16000,...(includesChoices?{includesChoices:true}:{})};
  })));
  const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;
  const facts=questionMode?prepared.facts:[localized.en.text.slice(0,500)];
  const manifest={title:prepared.title,source,question:questionMode?prepared.question:confirmation.en,facts,
    rubric:questionMode?{mode:'multiple-choice',correctChoiceId:prepared.rubric.correctChoiceId,askedFacts:prepared.rubric.askedFacts}:{askedFacts:facts},
    languages:localized,dependencies,dependencyHash:bundleHash(dependencies),checks:{preparation:'passed',translations:Object.fromEntries(languages.map(code=>[code,'passed'])),...(questionMode?{choices:'passed'}:{})},provenance};
  return checkedPreparedBundle({manifest,audio});
}
