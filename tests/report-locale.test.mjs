import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {reportTranslations,reportLocale,reportsRoute,reportText,reportErrorText,reportState,reportLanguage,reportTimestamp} from '../src/report-locale.ts';
import {pendingExportSignature,savePendingExport,readPendingExport,checkedExportReceipt} from '../src/export-recovery.ts';

test('every Reports control, recovery notice and status has Arabic/Urdu with identical placeholders',()=>{
  const placeholders=value=>[...value.matchAll(/\{([A-Za-z]+)\}/g)].map(match=>match[1]).sort();
  assert.ok(Object.keys(reportTranslations).length>90);
  for(const [english,translated] of Object.entries(reportTranslations)){
    assert.equal(translated.length,2,english);assert.equal(reportText('en',english),english);
    for(const text of translated){assert.match(text,/[\u0600-\u06ff]/u,english);assert.notEqual(text,english);assert.equal(text.includes('\ufffd'),false);assert.deepEqual(placeholders(text),placeholders(english),english);}
  }
});

test('Reports locale remains route-scoped without claiming unrelated Audit pages are translated',()=>{
  assert.equal(reportsRoute('reports'),true);
  for(const route of ['reports/','reports/activity','reports-other','reports/../people','overview','settings','operations',''])assert.equal(reportsRoute(route),false);
  for(const value of [undefined,null,'AR','fr',{},true])assert.equal(reportLocale(value),'en');
  assert.equal(reportLocale('ar'),'ar');assert.equal(reportLocale('ur'),'ur');
});

test('report states and generic failures never display unrecognized transport diagnostics or invent success',()=>{
  for(const locale of ['en','ar','ur']){
    assert.notEqual(reportState(locale,'queued'),reportState(locale,'ready'));
    for(const value of ['unknown','__proto__','constructor','toString'])assert.equal(reportState(locale,value),reportText(locale,'Status unavailable'));
    assert.equal(reportLanguage(locale,'ar'),reportText(locale,'Arabic (AR)'));assert.equal(reportLanguage(locale,'__proto__'),'__proto__');
    for(const message of ['PRIVATE_TRANSPORT_DIAGNOSTIC','__proto__','toString'])assert.equal(reportErrorText(locale,message,'The export outcome is not confirmed. Check the saved request before retrying.'),reportText(locale,'The export outcome is not confirmed. Check the saved request before retrying.'));
    assert.equal(reportErrorText(locale,'','The report could not be loaded. Try again.'),'');
    assert.equal(reportErrorText(locale,'Saved export request changed.','The export request could not be completed.'),reportText(locale,'The saved export request changed. Reload before continuing.'));
    assert.equal(reportErrorText(locale,'This tab cannot retain the export request. No request was sent.','The export request could not be completed.'),reportText(locale,'This tab cannot retain the export request. No request was sent.'));
  }
});

test('switching presentation language cannot change captured export identity, filters or exact receipt recovery',()=>{
  const scope='["qa","site","owner"]',id=randomUUID(),values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const pending={kind:'create',requestId:id,exportId:null,body:{publicationId:'published-3',filters:{crewId:'crew-14',responseFrom:'2026-10-24',responseThrough:'2026-10-25'}}};
  const signature=pendingExportSignature(pending);savePendingExport(storage,scope,pending);const bytes=[...values.values()][0];
  const row={id,status:'queued',createdAt:'2026-10-21T10:00:00.000Z',expiresAt:'2026-10-22T10:00:00.000Z',filename:`briefing-activity-${id}.csv`,attempts:0,error:null,filters:{...pending.body.filters,timezone:'Asia/Beirut'}};
  const receipt={found:true,request:{requestId:id,publicationId:'published-3',filters:pending.body.filters},result:row};
  for(const locale of ['en','ar','ur']){
    assert.match(reportText(locale,'Page {page} of {pages}',{page:2,pages:7}),/2/);
    reportText(locale,'Export request accepted. Check export history for its current status.');reportState(locale,row.status);reportLanguage(locale,'ur');
    assert.equal(pendingExportSignature(readPendingExport(storage,scope)),signature);assert.equal([...values.values()][0],bytes);assert.equal(checkedExportReceipt(receipt,pending).id,id);
  }
});

test('localized report times retain exact offsets for ambiguous DST instants and do not rewrite evidence',()=>{
  for(const locale of ['en','ar','ur']){
    const first=reportTimestamp(locale,'2026-11-01T05:30:00.000Z','America/New_York'),second=reportTimestamp(locale,'2026-11-01T06:30:00.000Z','America/New_York');
    assert.equal(first.text,second.text);assert.equal(first.offset,'GMT-4');assert.equal(second.offset,'GMT-5');
    assert.equal(reportTimestamp(locale,'2026-10-21T12:00:00.000Z','Asia/Beirut').offset,'GMT+3');
  }
});

test('Reports keeps language outside read/intent dependencies and translates saved notices at render time',async()=>{
  const source=await readFile(new URL('../src/Reports.tsx',import.meta.url),'utf8'),main=await readFile(new URL('../src/main.tsx',import.meta.url),'utf8');
  assert.ok(source.includes('useState<ReportTextKey|null>(null)'));
  assert.ok(source.includes('{message && <p role="status">{t(message)}</p>}'));
  assert.ok(source.includes('readPendingExport(sessionStorage,checkedArtifactScope(scope,authority.session,definition.roles))'));
  assert.ok(source.includes('body:{publicationId:report.publicationId,filters:structuredClone(filters)}'));
  assert.ok(source.includes('operation.write(operation.pending.current!)'));
  assert.ok(source.includes('[publicationId, refresh,filters,reportRefresh,request,current]'));
  assert.ok(source.includes('[filters,page,tick,request,current]'));
  assert.ok(main.includes('caseUiLanguage=siteInterfaceLanguage,reportUiLanguage=siteInterfaceLanguage'));
  assert.ok(main.includes('fallbackCopy={{loading:reportText(language'));
  assert.equal(/key=\{(?:locale|language|reportUiLanguage)\b/.test(source),false);
});

test('publication paging retains a persistent focus target while unverified history stays hidden',async()=>{
  const source=await readFile(new URL('../src/Reports.tsx',import.meta.url),'utf8');
  assert.ok(source.includes('ref={historyHeading} tabIndex={-1}'));
  assert.ok(source.includes('historyHeading.current?.focus();setPage(next)'));
  assert.ok(source.includes('aria-busy={loading}'));
  assert.ok(source.includes('onClick={()=>changePage(page+1)}'));
  assert.ok(source.includes('setExports([]);setExportError((err as Error).message)'));
  assert.match(source,/exportLoading\?<p\b[^>]*role="status"/);
  assert.ok(source.includes('date(item.createdAt,item.filters?.timezone||report?.timezone)'));
});
