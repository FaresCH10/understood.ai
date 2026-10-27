import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {withMultipleChoice,assessMultipleChoice,choiceTextKey} from '../server/multiple-choice.mjs';
import {clarificationDetailView} from '../server/clarification-view.mjs';
import {noticeLanguages,noticeView,recordingNoticeInput,recordingNoticeLanguage} from '../server/recording-notice-input.mjs';
import {WORKER_LANGUAGE_CODES} from '../server/languages.mjs';
import {readWorkerRecordingNotice} from '../src/worker-recording-notice.ts';
import {syntheticInstructionPrepare} from '../server/instruction-prep.mjs';
import {createGeminiAdapter} from '../server/ai/gemini.mjs';
import {createOpenRouterAdapter} from '../server/ai/openrouter.mjs';

const prepared=text=>({source:text,title:'Waiting for help',question:'What must you do?',rubric:{askedFacts:[text]},languages:{en:{title:'Waiting for help',text,question:'What must you do?'}}});
test('synthetic mode refuses to label untranslated Arabic as English',()=>{
  assert.throws(()=>syntheticInstructionPrepare({title:'Walkway',source:'أبق الممر خالياً.'},{response_mode:'question'}),/configured translation provider/);
});
for(const provider of ['gemini','openrouter'])test(`${provider} can normalize Arabic into English and check against the original source`,async()=>{
  const source={title:'الممر',text:'أبق الممر خالياً.',question:'ما الذي يجب إبقاؤه خالياً؟'},english={title:'Walkway',text:'Keep the walkway clear.',question:'What must remain clear?'};
  let reply=english;
  const fetchImpl=async()=>provider==='gemini'?Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(reply)}]}}]}):Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(reply)}}]});
  const adapter=(provider==='gemini'?createGeminiAdapter:createOpenRouterAdapter)({apiKey:'synthetic-only-test-key',dataClass:'synthetic',fetchImpl});
  assert.deepEqual(await adapter.translate(source,'en'),english);
  reply={faithful:true,complete:true,languageCorrect:true,terminologyApplied:true,reasons:[]};
  assert.equal((await adapter.checkTranslation(source,english,'en')).languageCorrect,true);
});
test('stock distractors cannot duplicate the correct choice, including punctuation and case variants',()=>{
  for(const source of ['Wait for someone else to do the stated work.','  WAIT for someone else to do the stated work!','Skip the stated steps and continue as usual.']){
    const snapshot=withMultipleChoice(prepared(source)),choices=snapshot.languages.en.choices;
    assert.equal(new Set(choices.map(choice=>choiceTextKey(choice.text))).size,4);
    assert.equal(assessMultipleChoice(choices.find(choice=>choice.text===source).id,snapshot,'en').outcome,'matched');
    for(const choice of choices.filter(choice=>choice.text!==source))assert.equal(assessMultipleChoice(choice.id,snapshot,'en').outcome,'clarification');
  }
});
test('fresh publication choices cannot be derived from the public source and title',()=>{
  const input=prepared('Wait here.'),first=withMultipleChoice(input),second=withMultipleChoice(input);
  const hash=value=>createHash('sha256').update(value).digest('hex');
  const oldKey=hash(`${hash(JSON.stringify([input.source,input.title]))}:0`).slice(0,32);
  assert.notEqual(first.rubric.correctChoiceId,oldKey);
  assert.notEqual(first.rubric.correctChoiceId,second.rubric.correctChoiceId);
  assert.deepEqual(withMultipleChoice(first),first);
});
test('clarification detail resolves original and later choices without modifying stored attempts',()=>{
  const snapshot=withMultipleChoice(prepared('Wait here.')),choice=snapshot.languages.en.choices[0];
  const row={snapshot,language:'en',answer_text:choice.id,attempts:[{id:'later',answer_text:choice.id}],owners:[],reasons_json:[]};
  const dto=clarificationDetailView(row,'context');
  assert.equal(dto.answer_text,choice.text);assert.equal(dto.attempts[0].answer_text,choice.text);
  assert.equal(row.answer_text,choice.id);assert.equal(row.attempts[0].answer_text,choice.id);
  row.answer_text='A legacy written response';assert.equal(clarificationDetailView(row,'context').answer_text,row.answer_text);
});
test('every worker locale can retrieve its own custom recording notice without an English fallback',async()=>{
  assert.deepEqual(noticeLanguages,WORKER_LANGUAGE_CODES);
  const identity={clientContext:'a'.repeat(64),expiresAt:new Date(Date.now()+3600000).toISOString()};
  const notices=Object.fromEntries(WORKER_LANGUAGE_CODES.map(code=>[code,`${code}: Site-specific recording information for this language.`]));
  const request={requestId:crypto.randomUUID(),revision:0,confirmed:true,scope:JSON.stringify(['org','site','owner']),notices};
  assert.deepEqual(recordingNoticeInput(request).notices,notices);
  for(const language of WORKER_LANGUAGE_CODES){
    const worker={principal_type:'worker',language};
    assert.equal(recordingNoticeLanguage(new URLSearchParams({language}),worker,'GET'),language);
    const dto=noticeView({revision:1,notices_json:notices},worker);
    assert.equal(dto.notice,notices[language]);
    assert.equal(await readWorkerRecordingNotice(async url=>{assert.equal(new URL(url,'http://local').searchParams.get('language'),language);return Response.json(dto);},identity,language,new AbortController().signal,()=>true),notices[language]);
  }
  assert.deepEqual(noticeView({revision:1,notices_json:{en:notices.en,ar:notices.ar,ur:notices.ur}},{principal_type:'worker',language:'hi'}),{revision:1,configured:false,language:'hi',notice:null});
});
