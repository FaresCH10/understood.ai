import test from 'node:test';
import assert from 'node:assert/strict';
import {caseTranslations,caseLocale,clarificationRoute,caseText,caseMessage,caseState,caseLanguage,caseReason,caseTimeError,caseTimestamp} from '../src/clarification-locale.ts';
import {peopleShellText} from '../src/people-locale.ts';
import {staffDate} from '../src/staff-policy.ts';
import {canonicalCreation,creationHash} from '../src/clarification-create.ts';
import {civilTimeChoices} from '../src/civil-time.ts';

test('every staff case label and warning has nonempty Arabic and Urdu with identical placeholders',()=>{
  const placeholders=value=>[...value.matchAll(/\{([A-Za-z]+)\}/g)].map(match=>match[1]).sort();
  assert.ok(Object.keys(caseTranslations).length>200);
  for(const [english,translations] of Object.entries(caseTranslations)){
    assert.equal(translations.length,2,english);
    for(const translated of translations){assert.match(translated,/[\u0600-\u06ff]/u,english);assert.notEqual(translated,english,english);assert.equal(translated.includes('\ufffd'),false,english);assert.deepEqual(placeholders(translated),placeholders(english),english);}
    assert.equal(caseText('en',english),english);
  }
  for(const locale of ['ar','ur']){assert.deepEqual(Object.keys(peopleShellText[locale]).sort(),Object.keys(peopleShellText.en).sort());for(const value of Object.values(peopleShellText[locale]))assert.match(value,/[\u0600-\u06ff]/u);}
});

test('clarification localization is explicitly route-scoped and has safe locale defaults',()=>{
  for(const route of ['clarifications','clarifications/new','clarifications/case-14','clarifications/20000000-0000-4000-8000-000000000001'])assert.equal(clarificationRoute(route),true);
  for(const route of ['clarifications/','clarifications/id/extra','clarifications-other','people','settings','operations','clarifications/../other',''])assert.equal(clarificationRoute(route),false);
  for(const value of [undefined,null,'AR','fr',{},true])assert.equal(caseLocale(value),'en');assert.equal(caseLocale('ar'),'ar');assert.equal(caseLocale('ur'),'ur');
});

test('localized counts, versions, states and receipt copy preserve exact evidence and uncertainty',()=>{
  for(const locale of ['en','ar','ur']){
    assert.match(caseText(locale,'Page {page} of {pages}',{page:2,pages:7}),/2/);
    assert.match(caseText(locale,'instruction v{version}',{version:14}),/14/);
    assert.notEqual(caseState(locale,'matched'),caseState(locale,'clarification'));
    assert.notEqual(caseState(locale,'unassessable'),caseState(locale,null));
    assert.equal(caseState(locale,'unknown'),caseText(locale,'Status unavailable'));
    assert.equal(caseState(locale,'expired'),caseText(locale,'Expired'));
    assert.equal(caseLanguage(locale,'ur'),caseText(locale,'Urdu'));
    assert.equal(caseMessage(locale,'The outcome is not confirmed. Check the repeat receipt before retrying.'),caseText(locale,'The outcome is not confirmed. Check the repeat receipt before retrying.'));
    assert.equal(caseMessage(locale,'PRIVATE_RAW_TRANSPORT_DIAGNOSTIC'),caseText(locale,'The operation could not be confirmed. Your draft and pending recovery are retained.'));
  }
});

test('locale formatting never translates or rewrites staff intent and leaves unknown assessment data as data',async()=>{
  const reason='Synthetic private reason with العربية and اردو',content={assignmentId:'assignment-14',publicationId:'publication-3',version:3,attemptId:null,reason};
  const canonical=canonicalCreation(content),hash=await creationHash(content);
  for(const locale of ['en','ar','ur']){
    const rendered=caseReason(locale,'Staff follow-up: '+reason);assert.ok(rendered.endsWith(reason));
    assert.equal(caseReason(locale,'Unrecognized synthetic provider reason'),'Unrecognized synthetic provider reason');
    assert.equal(caseReason(locale,'missing_asked_fact'),caseText(locale,'Missing fact'));
    assert.equal(caseReason(locale,'[Deleted]'),caseText(locale,'Deleted'));
    assert.deepEqual(canonicalCreation(content),canonical);assert.equal(await creationHash(content),hash);
  }
});

test('deadline DST errors and offsets localize without changing the selected instant or site zone',()=>{
  const timezone='America/New_York',gap='2026-03-08T02:30',repeated=civilTimeChoices('2026-11-01T01:30',timezone);
  let message;try{civilTimeChoices(gap,timezone);}catch(error){message=error.message;}
  assert.ok(message);assert.equal(repeated.length,2);assert.notEqual(repeated[0].instant,repeated[1].instant);
  for(const locale of ['ar','ur']){
    const translated=caseTimeError(locale,message,timezone);assert.match(translated,/[\u0600-\u06ff]/u);assert.ok(translated.includes(timezone));assert.notEqual(translated,message);
    for(const row of repeated)assert.ok(caseText(locale,'First ({offset})',{offset:row.offset}).includes(row.offset));
    assert.match(staffDate('Asia/Beirut',new Date('2026-10-20T12:00:00.000Z'),locale),/[\u0600-\u06ff]/u);
  }
});

test('case timestamps keep locale text separate from exact unbroken UTC offsets across DST and safe fallback',()=>{
  for(const locale of ['en','ar','ur']){
    const earlier=caseTimestamp(locale,'2026-11-01T05:30:00.000Z','America/New_York'),later=caseTimestamp(locale,'2026-11-01T06:30:00.000Z','America/New_York');
    assert.equal(earlier.text,later.text);assert.equal(earlier.offset,'GMT-4');assert.equal(later.offset,'GMT-5');
    assert.equal(caseTimestamp(locale,'2026-10-20T12:00:00.000Z','Asia/Beirut').offset,'GMT+3');
    assert.equal(caseTimestamp(locale,'2026-10-20T12:00:00.000Z','Invalid/Timezone').offset,'GMT');
    assert.throws(()=>caseTimestamp(locale,'invalid','UTC'),/timestamp/);
  }
});
