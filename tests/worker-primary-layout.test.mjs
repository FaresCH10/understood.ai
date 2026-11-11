import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {conversationRecorderText} from '../src/recording-notice.ts';
import {assertWorkerDictionary} from './helpers/worker-locales.mjs';

test('private voice failure copy describes messages without promising an available writer or answer outcome',()=>{
  assertWorkerDictionary(conversationRecorderText,'conversationRecorderText');
  assert.deepEqual(Object.keys(conversationRecorderText.en).sort(),['error','failed','format','permission']);
  for(const copy of Object.values(conversationRecorderText))for(const value of Object.values(copy)){assert.ok(value.trim().length>20);assert.doesNotMatch(value,/\banswer\b|إجابت|جواب/i);}
  assert.match(conversationRecorderText.en.permission,/when available/);assert.match(conversationRecorderText.en.failed,/when available/);assert.match(conversationRecorderText.en.error,/unconfirmed/);
});

test('recorder and lazy-error boundary select message copy only for private Help and reply purposes',async()=>{
  for(const name of ['WorkerRecorder.tsx','WorkerRecorderView.tsx']){
    const source=await readFile(new URL('../src/'+name,import.meta.url),'utf8');
    assert.match(source,/purpose==='help'\|\|(?:this\.props\.)?purpose==='reply'\?[^;]*conversationRecorderText/);
    assert.match(source,/purpose==='in_person'/);
  }
});

test('conversation recorders collapse the recording notice behind an expandable info button',async()=>{
  const recorder=await readFile(new URL('../src/WorkerRecorder.tsx',import.meta.url),'utf8');
  const chatRecorder=await readFile(new URL('../src/CaseVoiceRecorder.tsx',import.meta.url),'utf8');
  assert.match(recorder,/compactNotice\?:boolean/);
  assert.match(recorder,/compactNotice=false/);
  assert.match(recorder,/recording-notice-compact/);
  assert.match(recorder,/aria-expanded=\{noticeOpen\}/);
  assert.match(recorder,/aria-controls=\{noticeId\}/);
  assert.match(recorder,/recording-notice-pop/);
  assert.match(recorder,/<aside className="recording-notice"/,'answer and in-person recorders keep the full notice');
  assert.match(chatRecorder,/<WorkerRecorderView[^]*?purpose=\{scope\.kind\} compactNotice/);
});

test('chat recorders put the mic beside the writing area instead of a full-width button',async()=>{
  const recorder=await readFile(new URL('../src/WorkerRecorder.tsx',import.meta.url),'utf8');
  const chatRecorder=await readFile(new URL('../src/CaseVoiceRecorder.tsx',import.meta.url),'utf8');
  const conversation=await readFile(new URL('../src/CaseConversation.tsx',import.meta.url),'utf8');
  const help=await readFile(new URL('../src/WorkerInstructionChat.tsx',import.meta.url),'utf8');
  assert.match(recorder,/inline\?:boolean/);
  assert.match(recorder,/record-answer-inline/);
  assert.match(recorder,/className="chat-record"/);
  assert.match(recorder,/className="chat-voice-active"/);
  assert.match(recorder,/aria-label=\{title\}/);
  assert.match(chatRecorder,/chat-composer-row/);
  assert.match(chatRecorder,/inline=\{inline\}/);
  assert.match(conversation,/<CaseVoiceRecorder inline/);
  assert.match(conversation,/>\{composerForm\}<\/CaseVoiceRecorder>/);
  assert.match(help,/<CaseVoiceRecorder inline/);
});

test('worker primary flow precedes mounted saved-work tools without a duplicate inline help section',async()=>{
  const source=await readFile(new URL('../src/main.tsx',import.meta.url),'utf8');
  const question=source.indexOf('<section className="worker-card question-card" id="worker-question"');
  const chat=source.indexOf('<WorkerInstructionChat '),submissions=source.indexOf('<WorkerSubmissions ');
  const tools=['<WorkerOfflineSaveView key=','<WorkerAudioDraftView key=','<WorkerTextDraftView key='].map(value=>source.indexOf(value));
  assert.ok(question>0&&chat>question&&submissions>chat);
  assert.ok(!source.includes('id="worker-help"'),'the floating chat is the only help surface');
  assert.ok(!source.includes('WorkerHelpHistory'),'message history no longer renders inline beside the chat');
  assert.match(source.slice(chat,chat+900),/openSignal=\{chatOpenSignal\}/);
  assert.match(source.slice(chat,chat+900),/focusSignal=\{chatFocusSignal\}/);
  assert.match(source.slice(chat,chat+900),/seedText=\{chatSeed\}/);
  assert.ok(source.includes('onClick={revealHelp}'),'help entry points open the floating chat');
  for(const position of tools)assert.ok(position>question&&position<submissions);
  assert.equal(source.match(/<WorkerOfflineSaveView key=/g).length,1);assert.equal(source.match(/<WorkerAudioDraftView key=/g).length,1);assert.equal(source.match(/<WorkerTextDraftView key=/g).length,1);
  for(const position of tools)assert.doesNotMatch(source.slice(position,source.indexOf('/>',position)),/\bhidden\b/);
});
