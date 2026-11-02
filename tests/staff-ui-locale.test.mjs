import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {staffUiArabic,staffUiText,staffUiNumber,staffUiPercent,staffUiDate,staffUiLanguage,staffUiState,staffUiError,staffUiReason} from '../src/staff-ui-locale.ts';
import {staffStaticArabic} from '../src/staff-static-ar.ts';
import {createStaffText,staffStaticMessage} from '../src/staff-static-text.ts';
import {WORKER_LOCALES} from '../server/languages.mjs';
const placeholders=value=>[...value.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)].map(match=>match[1]).sort();

test('staff catalogues preserve every interpolation and include Arabic for response and improvement controls',()=>{
  assert.ok(Object.keys(staffStaticArabic).length>1400);
  for(const [key,value] of Object.entries({...staffStaticArabic,...staffUiArabic})){
    assert.equal(typeof value,'string',key);assert.ok(value.trim(),key);assert.ok(!value.includes('\ufffd'),key);
    assert.deepEqual(placeholders(value),placeholders(key),key);
    if(!['HTTP','{p0} · UTC{p1}'].includes(key))assert.match(value,/[\u0600-\u06ff]/u,key);
  }
  for(const key of ['Improve this instruction','Corrective title','Review corrective instruction','Create corrective draft','Responses','Accepted submissions','Published key facts','Close response history']){
    assert.notEqual(staffUiText('ar',key),key);assert.equal(staffUiText('en',key),key);
  }
});

test('Arabic counts distinguish zero results from missing assessment and preserve input identifiers',()=>{
  assert.equal(staffUiNumber('ar',1234),new Intl.NumberFormat('ar-LB').format(1234));
  assert.equal(staffUiPercent('ar',0),new Intl.NumberFormat('ar-LB',{style:'percent',maximumFractionDigits:0}).format(0));
  assert.notEqual(staffUiPercent('ar',0),staffUiText('ar','No assessed answers yet'));
  const ar=createStaffText('ar');assert.equal(ar('Version {p0}',{p0:12}),'الإصدار '+ar.number(12));
  assert.equal(ar('Fact {number}',{number:'ID-0012'}),'الحقيقة ID-0012');
});

test('staff timestamps use the selected site timezone and safely handle absent dates and invalid zones',()=>{
  const instant='2026-10-31T23:30:00.000Z';
  for(const locale of ['en','ar'])for(const timeZone of ['UTC','Asia/Beirut','Asia/Karachi']){
    const expected=new Intl.DateTimeFormat(locale==='ar'?'ar-LB':'en-GB',{timeZone,dateStyle:'medium',timeStyle:'short'}).format(new Date(instant));
    assert.equal(staffUiDate(locale,instant,timeZone),expected);assert.equal(createStaffText(locale,timeZone).date(instant),expected);
    assert.equal(createStaffText(locale,'Asia/Beirut').date(instant,'UTC'),staffUiDate(locale,instant,'UTC'));
    assert.ok(createStaffText(locale,timeZone).message(`Access link issued. Expires ${instant}.`).includes(expected));
  }
  assert.equal(staffUiDate('ar',null),staffUiText('ar','Not received'));
  assert.equal(staffUiDate('ar','invalid'),'التاريخ غير متاح');
  assert.notEqual(staffUiDate('ar','invalid'),staffUiDate('ar',null));
  assert.equal(staffUiDate('ar',instant,'invalid/zone'),staffUiDate('ar',instant,'UTC')+' (UTC)');
});

test('assessment reason codes and day units are localized while original free-form evidence stays unchanged',()=>{
  for(const code of ['missing_asked_fact','incorrect_choice','asked_facts_present','unclear_audio','uncertain_placement','contradictory_placement','unsupported_wording','empty_answer','instruction_like_answer','invalid_input','invalid_evidence','missing_evidence'])assert.match(staffUiReason('ar',code),/[\u0600-\u06ff]/u);
  const evidence='Supervisor note: verify valve A-12 — ملاحظة';assert.equal(staffUiReason('ar',evidence),evidence);
  for(const locale of ['en','ar'])for(const count of [0,1,2,3,11])assert.equal(createStaffText(locale).days(count),new Intl.NumberFormat(locale==='ar'?'ar-LB':'en-GB',{style:'unit',unit:'day',unitDisplay:'long'}).format(count));
  for(const stage of ['Worker process','preparation','grounding_check','translation','translation_check','speech','storage','finalization','completed','reused','preparation_failed','obsolete_or_unauthorized'])assert.match(createStaffText('ar').technical(stage),/[\u0600-\u06ff]/u);
  assert.equal(createStaffText('ar').technical('model-v0012'),'model-v0012');
  assert.equal(createStaffText('en').technical('grounding_check'),'grounding check');
});

test('all fifteen staff language names and known publication states are localized',()=>{
  for(const language of WORKER_LOCALES){assert.match(staffUiLanguage('ar',language.code),/[\u0600-\u06ff]/u,language.code);assert.equal(staffUiLanguage('en',language.code),language.englishName);}
  assert.notEqual(staffUiLanguage('ar','pa-Guru'),staffUiLanguage('ar','pa-Arab'));
  for(const state of ['published','superseded','withdrawn','archived','draft','processing','ready','failed','open','resolved'])assert.match(staffUiState('ar',state),/[\u0600-\u06ff]/u);
  assert.equal(staffUiState('ar','unknown_new_state'),staffUiText('ar','Status unavailable'));
  for(const unknown of ['constructor','__proto__','toString']){
    assert.equal(staffUiState('ar',unknown),staffUiText('ar','Status unavailable'));
    assert.equal(createStaffText('ar').state(unknown),staffUiText('ar','Status unavailable'));
    assert.equal(staffUiLanguage('ar',unknown),unknown);
  }
});

test('errors remain localized across language switches without exposing unknown transport diagnostics',()=>{
  for(const message of ['Forbidden','Workspace is read-only','Improvement request conflict','Sign in required']){
    assert.equal(staffUiError('ar',Error(message),'Response unavailable'),staffUiText('ar',message));
    assert.equal(staffUiError('en',Error(message),'Response unavailable'),message);
  }
  assert.equal(staffUiError('ar',Error('PRIVATE_DIAGNOSTIC'),'Response unavailable'),staffUiText('ar','Response unavailable'));
  const ar=createStaffText('ar');assert.match(ar.error('Connection interrupted. The saved outcome is not confirmed.'),/لم تتأكد/);
  assert.equal(ar.error('PRIVATE_DIAGNOSTIC'),ar('The action could not be completed. Check the current status before trying again.'));
  assert.equal(createStaffText('en').error('PRIVATE_DIAGNOSTIC'),'PRIVATE_DIAGNOSTIC');
});

test('UI message interpolation preserves user-authored values and never cascades through translated text',()=>{
  const ar=createStaffText('ar');const name='EN-{p1}-اسم 0012';
  const result=ar('Copy translation of {p0}',{p0:name});assert.ok(result.includes(name));
  assert.equal(ar(name),name);assert.equal(ar('Use valve A-12. Keep pressure < 30 psi.'),'Use valve A-12. Keep pressure < 30 psi.');
  assert.equal(staffStaticMessage('ar','Saved template v12.'),ar('Saved template v{p0}.',{p0:'12'}));
  assert.equal(ar.message('Unexpected private diagnostic'),ar('Check the current status and details.'));
});

test('response and improvement render boundaries preserve canonical query, request and evidence fields',async()=>{
  const responses=await readFile(new URL('../src/PublicationResponses.tsx',import.meta.url),'utf8');
  const improvement=await readFile(new URL('../src/SelfHealingLoop.tsx',import.meta.url),'utf8');
  assert.match(responses,/URLSearchParams\(\{search,language,status,page:String\(page\),pageSize:'20'\}/);
  assert.match(responses,/ui\.date\(row\.receivedAt\)/);assert.match(responses,/ui\.language\(locale\.code\)/);
  assert.match(responses,/dir="auto">\{data\.question\}/);assert.match(responses,/dir="auto" key=\{index\}>\{fact\}/);
  assert.match(improvement,/\{requestId:requestId\.current,title,source\}/);
  assert.match(improvement,/data\.current\.matchRate===null/);assert.match(improvement,/data\.followup\.counts\.matchRate===null/);
  assert.match(improvement,/dir="auto" value=\{title\}/);assert.match(improvement,/dir="auto" rows=\{6\} value=\{source\}/);
  assert.match(improvement,/\[open,tick,path,request,current\]/);
});
