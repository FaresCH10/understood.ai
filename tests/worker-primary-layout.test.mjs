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

test('worker primary flow precedes mounted saved-work tools without hiding recovery controls',async()=>{
  const source=await readFile(new URL('../src/main.tsx',import.meta.url),'utf8');
  const question=source.indexOf('<section className="worker-card question-card">'),help=source.indexOf('<section className="worker-card" id="worker-help">');
  const tools=['<WorkerOfflineSaveView key=','<WorkerAudioDraftView key=','<WorkerTextDraftView key='].map(value=>source.indexOf(value));
  const submissions=source.indexOf('<WorkerSubmissions ');
  assert.ok(question>0&&help>question);
  for(const position of tools)assert.ok(position>help&&position<submissions);
  assert.equal(source.match(/<WorkerOfflineSaveView key=/g).length,1);assert.equal(source.match(/<WorkerAudioDraftView key=/g).length,1);assert.equal(source.match(/<WorkerTextDraftView key=/g).length,1);
  for(const position of tools)assert.doesNotMatch(source.slice(position,source.indexOf('/>',position)),/\bhidden\b/);
});
