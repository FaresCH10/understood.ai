import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('supervisor case keeps one conversation surface in a sticky chat rail',async()=>{
  const source=await readFile(new URL('../src/Clarifications.tsx',import.meta.url),'utf8');
  assert.match(source,/<aside className="cd-chat-rail" aria-label=\{t\('Follow-up conversation'\)\}>/);
  assert.match(source,/<section className="cd-chat-panel" aria-labelledby="cd-chat-title">/);
  assert.equal(source.match(/<CaseConversation /g).length,1);
  assert.match(source,/<CaseConversation embedded /);
  assert.equal(source.match(/<CaseTimeline /g)?.length??0,0,'The duplicated timeline must not render on the case page');
  assert.equal(source.match(/afterComposer=/g)?.length??0,0,'Recordings move to the chat header, not a second composer');
});

test('case settings and review fold into one disclosure below the answer',async()=>{
  const source=await readFile(new URL('../src/Clarifications.tsx',import.meta.url),'utf8');
  const start=source.indexOf("<CaseDisclosure title={t('Case details')}");
  assert.ok(start>0);
  assert.ok(source.indexOf('<ClarificationActions',start)>start);
  assert.ok(source.indexOf('capabilities.current.review&&<CaseReviews',start)>start);
  assert.ok(source.indexOf('</CaseDisclosure>',start)>source.indexOf('<ClarificationActions',start));
});

test('hero actions open ancestor disclosures before scrolling',async()=>{
  const source=await readFile(new URL('../src/Clarifications.tsx',import.meta.url),'utf8');
  assert.match(source,/for\(let parent=section\.parentElement;parent;parent=parent\.parentElement\)if\(parent instanceof HTMLDetailsElement\)parent\.open=true/);
  assert.match(source,/section\.scrollIntoView\(\{block:'center'\}\)/);
});

test('recording access moves into the chat header with an accessible compact trigger',async()=>{
  const page=await readFile(new URL('../src/Clarifications.tsx',import.meta.url),'utf8');
  const header=page.indexOf('<div className="cd-chat-actions">');
  assert.ok(header>0);
  assert.ok(page.indexOf('<StaffCaseRecordings compact ',header)>header);
  const source=await readFile(new URL('../src/StaffCaseRecordings.tsx',import.meta.url),'utf8');
  assert.match(source,/className=\{compact\?'icon-button':'button outline'\}/);
  assert.match(source,/aria-label=\{compact\?canWrite\?t\.action:t\.history:undefined\}/);
  assert.match(source,/title=\{compact\?canWrite\?t\.action:t\.history:undefined\}/);
});

test('chat rail is sticky on desktop and stacks before mobile widths',async()=>{
  const css=await readFile(new URL('../src/clarification-detail.css',import.meta.url),'utf8');
  assert.match(css,/\.cd-chat-rail \{ position: sticky; top: 20px; min-width: 0; \}/);
  assert.match(css,/@media \(max-width: 960px\) \{[\s\S]*?\.cd-chat-rail \{ position: static; top: auto; \}/);
  assert.match(css,/\.cd-workspace\.case-workflow \{ display: grid; grid-template-columns: minmax\(0, 1fr\) 380px;/);
  assert.match(css,/\.cd-workspace\.case-workflow>\.cd-chat-rail \{ grid-column: 2; grid-row: 1 \/ span 999; \}/);
  assert.match(css,/@media \(max-width: 960px\) \{[\s\S]*?\.cd-workspace\.case-workflow \{ display: block; \}/);
  assert.match(css,/\.cd-chat-panel-body :is\(\.worker-card,\.panel\)/);
  assert.match(css,/@media \(forced-colors: active\) \{[\s\S]*?\.cd-chat-panel \{ border: 1px solid CanvasText; \}/);
});

test('mobile offers a jump to the follow-up conversation',async()=>{
  const source=await readFile(new URL('../src/Clarifications.tsx',import.meta.url),'utf8');
  assert.match(source,/<button type="button" className="cd-chat-jump" onClick=\{\(\)=>\{const input=document\.querySelector<HTMLTextAreaElement>\('\.cd-chat-panel \.chat-input'\)/);
  assert.ok(source.includes("{t('Message worker')}"));
  const css=await readFile(new URL('../src/clarification-detail.css',import.meta.url),'utf8');
  assert.match(css,/\.cd-chat-jump \{ display: none; \}/);
  assert.match(css,/@media \(max-width: 960px\) \{[\s\S]*?\.cd-workspace \.cd-chat-jump \{ display: inline-flex;/);
});

test('saved-message confirmation reads as a chat system chip, not thread text',async()=>{
  const css=await readFile(new URL('../src/instruction-chat.css',import.meta.url),'utf8');
  assert.match(css,/\.chat-notices>p\[role="status"\]:not\(\.chat-closed\)\{justify-self:center;/);
});

test('new case copy is translated for Arabic and Urdu',async()=>{
  const source=await readFile(new URL('../src/clarification-locale.ts',import.meta.url),'utf8');
  for(const key of ["'Case details'","'Owner, review, and case resolution.'","'Follow-up conversation'","'Refresh conversation'","'Message worker'"])
    assert.ok(source.includes(`${key}:[`),`${key} needs a translated entry`);
});
