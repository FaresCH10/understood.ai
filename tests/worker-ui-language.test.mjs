import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readWorkerLockLanguage,readWorkerUiLanguage,saveWorkerUiLanguage,workerBrowserLanguage,workerUiDirection,workerUiFallbackLanguage,workerUiLanguageKey,workerUiLanguageText,workerUiLanguages,workerUiNativeName} from '../src/worker-ui-language.ts';
import {sameWorkerSession,validWorkerSession} from '../src/session-state.ts';
import {clearWorkerLocalData} from '../src/worker-local-data.ts';
import {WORKER_LANGUAGE_CODES} from '../server/languages.mjs';

const now=Date.parse('2026-10-08T12:00:00.000Z');
const session={authenticated:true,role:'worker',clientContext:'a'.repeat(64),workerId:'worker-14',language:'en',mode:'synthetic-credential',expiresAt:'2026-10-08T13:00:00.000Z'};
function store(){const data={};return {data,getItem:key=>data[key]??null,setItem:(key,value)=>{data[key]=value;}};}

test('only a supervisor-approved session language controls the worker interface, including locked views',()=>{
  const storage=store();
  for(const language of WORKER_LANGUAGE_CODES){
    const approved={...session,language};saveWorkerUiLanguage(storage,approved,language,now);
    assert.equal(readWorkerUiLanguage(storage,approved,now),language);
    assert.equal(readWorkerLockLanguage(storage,approved),language);
    for(const changed of WORKER_LANGUAGE_CODES.filter(code=>code!==language))assert.throws(()=>saveWorkerUiLanguage(storage,approved,changed,now),/Language selection unavailable/);
  }
  storage.setItem(workerUiLanguageKey,JSON.stringify({context:session.clientContext,expiresAt:session.expiresAt,language:'ur'}));
  assert.equal(readWorkerUiLanguage(storage,session,now),'en');assert.equal(readWorkerLockLanguage(storage,session),'en');
  assert.equal(readWorkerUiLanguage(storage,{...session,language:'hi'},now),'hi');
  assert.throws(()=>saveWorkerUiLanguage(storage,session,'en',now+3600000));
  assert.equal(readWorkerUiLanguage(storage,session,now+3600000),'en');
});
test('malformed/denied storage falls back; unsuccessful writes do not report persistence',()=>{
  const storage=store();for(const raw of ['{','null','[]',JSON.stringify({context:session.clientContext,expiresAt:session.expiresAt,language:'xyz'}),'x'.repeat(301)]){storage.setItem(workerUiLanguageKey,raw);assert.equal(readWorkerUiLanguage(storage,session,now),'en');}
  assert.equal(readWorkerUiLanguage({getItem:()=>{throw Error();}},session,now),'en');
  assert.throws(()=>saveWorkerUiLanguage({setItem:()=>{},getItem:()=>null},session,'en',now));
  for(const language of WORKER_LANGUAGE_CODES)for(const text of Object.values(workerUiLanguageText[language]))assert.ok(text.trim());
});
test('every UI locale has a direction, native name and complete interface copy',()=>{
  assert.equal(workerUiLanguages.length,15);
  const keys=Object.keys(workerUiLanguageText.en).sort();
  for(const locale of workerUiLanguages){
    assert.equal(workerUiDirection(locale.code),locale.direction);
    assert.ok(workerUiNativeName(locale.code).trim());
    assert.deepEqual(Object.keys(workerUiLanguageText[locale.code]).sort(),keys);
    for(const value of Object.values(workerUiLanguageText[locale.code]))assert.ok(value.trim().length>3);
  }
  assert.equal(workerUiFallbackLanguage({...session,language:'hi'}),'hi');
  assert.equal(workerUiFallbackLanguage({...session,language:'tl'}),'en');
  assert.equal(workerBrowserLanguage(['pa']),'en');
  assert.equal(workerBrowserLanguage(['pa-PK']),'pa-Arab');
  assert.equal(workerBrowserLanguage(['pa-IN']),'pa-Guru');
  assert.equal(workerBrowserLanguage(['tl-PH']),'fil');
  assert.equal(workerBrowserLanguage(['hi-IN']),'hi');
});
test('worker shell dictionaries declare every selectable locale and avoid three-language direction checks',async()=>{
  const source=await readFile(new URL('../src/main.tsx',import.meta.url),'utf8');
  for(const name of ['workerPagingText','workerText','workerAux','workerLanguageText']){
    const start=source.indexOf(`const ${name}:Record<WorkerUiLanguage,`);
    assert.ok(start>0,`${name} declaration`);
    const body=source.slice(start,source.indexOf('\n};',start));
    const locales=[...body.matchAll(/^ {2}(?:'([^']+)'|(\w+)):\s*\{/gm)].map(match=>match[1]??match[2]);
    assert.deepEqual([...new Set(locales)].sort(),[...WORKER_LANGUAGE_CODES].sort(),name);
  }
  assert.doesNotMatch(source,/dir=\{(?<![.\w])language\s*===?\s*'en'\s*\?/);
  assert.doesNotMatch(source,/dir=\{(?<![.\w])language\s*!==?\s*'en'/);
  for(const name of ['WorkerAccessEntry.tsx','WorkerEntryRecovery.tsx','WorkerHelpHub.tsx','WorkerSubmissionReceipt.tsx']){
    const component=await readFile(new URL('../src/'+name,import.meta.url),'utf8');
    assert.doesNotMatch(component,/(?<![.\w])language\s*===?\s*'en'/,name);
  }
});
test('shared-device cleanup removes the interface language preference',async()=>{
  const storage=store();saveWorkerUiLanguage(storage,session,'en',now);
  const cleanup={...storage.data,removeItem:key=>{delete storage.data[key];}};
  let audio=0,briefings=0;
  assert.equal(await clearWorkerLocalData(session.clientContext,cleanup,async()=>{audio++;},async()=>{briefings++;}),true);
  assert.equal(audio,1);assert.equal(briefings,1);
  assert.equal(readWorkerUiLanguage(storage,session,now),'en');
  assert.equal(readWorkerLockLanguage(storage,session),'en');
});
