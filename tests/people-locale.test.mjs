import test from 'node:test';
import assert from 'node:assert/strict';
import {peopleText,peopleShellText,peopleRouteLocale,peopleLanguageNames,peoplePageText,peopleCountText,peopleShowingText,peopleDisableText,peopleMessageText,peopleErrorText} from '../src/people-locale.ts';
import {staffDate} from '../src/staff-policy.ts';

test('directory Arabic has every English control and notice, not empty or untranslated copies',()=>{
  for(const dictionary of [peopleText,peopleShellText]){
    assert.deepEqual(Object.keys(dictionary.ar).sort(),Object.keys(dictionary.en).sort());
    for(const [key,value] of Object.entries(dictionary.ar)){
      assert.equal(typeof value,'string',key);assert.match(value,/[\u0600-\u06ff]/u,key);
      assert.notEqual(value,dictionary.en[key],key);assert.ok(!value.includes('\ufffd'),key);
    }
  }
});

test('Arabic scope applies only to actual directory routes, never untranslated unrelated staff pages',()=>{
  for(const route of ['people','people/crews','people/new','people/new-crew','people/worker/worker-14','people/crew/crew-1'])assert.equal(peopleRouteLocale(route,'ar'),'ar');
  for(const route of ['people/import','people/import/receipt','people/crew','people/crew/id/extra','people-other','overview','briefings','settings','operations',''])assert.equal(peopleRouteLocale(route,'ar'),'en');
  assert.equal(peopleRouteLocale('people','en'),'en');
});

test('directory language and bounded-page descriptions retain exact numeric evidence',()=>{
  const english=peopleLanguageNames('en'),arabic=peopleLanguageNames('ar');
  assert.equal(Object.keys(english).length,15);assert.equal(Object.keys(arabic).length,15);
  assert.deepEqual({en:english.en,ar:english.ar,ur:english.ur},{en:'English',ar:'Arabic',ur:'Urdu'});
  assert.deepEqual({en:arabic.en,ar:arabic.ar,ur:arabic.ur},{en:'الإنجليزية',ar:'العربية',ur:'الأردية'});
  assert.equal(english.hi,'Hindi');assert.equal(english['pa-Guru'],'Punjabi (Gurmukhi)');assert.equal(english['pa-Arab'],'Punjabi (Shahmukhi)');
  assert.equal(arabic.hi,'हिन्दी');assert.equal(arabic['pa-Arab'],'پنجابی');
  assert.equal(peoplePageText('en',2,7),'Page 2 of 7');assert.equal(peoplePageText('ar',2,7),'الصفحة 2 من 7');
  assert.equal(peopleShowingText('en',5,30),'Showing 5 of 30 workers');assert.equal(peopleShowingText('ar',5,30),'عرض 5 من 30 عامل');
  assert.equal(peopleCountText('en',1,'workers'),'1 worker');assert.equal(peopleCountText('en',0,'workers'),'0 workers');
  assert.equal(peopleCountText('ar',11,'activeCrews'),'11 فريق نشط');assert.equal(peopleCountText('ar',2,'crews'),'2 فريق');
  assert.match(peopleDisableText('ar'),/ستُلغى/);assert.match(peopleDisableText('en'),/revoked/);
});

test('switching locale retranslates prior success notices without changing underlying outcomes',()=>{
  for(const key of ['crewRestored','restoreRecorded','crewArchived','crewRenamed','workerAdded','workerUpdated','membershipUpdated','crewCreated','workerDisabled','workerReenabled','reenableRecorded','cleanupQueued','cleanupComplete']){
    assert.equal(peopleMessageText('ar',peopleText.en[key]),peopleText.ar[key]);
    assert.equal(peopleMessageText('en',peopleText.ar[key]),peopleText.en[key]);
  }
  assert.match(peopleText.en.cleanupComplete,/unverified/);assert.match(peopleText.ar.cleanupComplete,/لم يُتحقق/);
});

test('Arabic failures preserve uncertainty and never display unknown raw server messages',()=>{
  for(const [message,key] of [['Invalid crew name','invalidName'],['Invalid worker code','invalidName'],['Crew name changed','changed'],['Crew is archived','crewUnavailable'],['Worker unavailable','workerUnavailable'],['Forbidden','forbidden'],['Sign in required','forbidden'],['UNIQUE constraint failed: crews.name','duplicateName']])
    assert.equal(peopleErrorText('ar',new Error(message)),peopleText.ar[key]);
  assert.equal(peopleErrorText('ar',new Error('Unrecognized English transport error with private detail')),peopleText.ar.requestUnknown);
  assert.equal(peopleErrorText('ar',null),peopleText.ar.requestUnknown);
  assert.equal(peopleErrorText('en',new Error('Crew name changed')),'Crew name changed');
});

test('localized staff date uses the site zone with explicit UTC fallback and stable English defaults',()=>{
  const instant=new Date('2026-10-04T22:30:00.000Z');
  assert.equal(staffDate('UTC',instant),'Sunday, 4 October 2026');
  assert.match(staffDate('Asia/Beirut',instant,'ar'),/[\u0600-\u06ff]/u);
  assert.notEqual(staffDate('UTC',instant,'ar'),staffDate('Asia/Beirut',instant,'ar'));
  assert.ok(staffDate('Invalid/Timezone',instant,'ar').endsWith('(UTC)'));
});
