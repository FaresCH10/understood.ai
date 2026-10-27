import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {checkedWorkerNotificationItem,checkedWorkerNotificationPage,workerNotificationRoute,workerNotificationText} from '../src/worker-notifications.ts';
import {workerUiLanguages} from '../src/worker-ui-language.ts';

const now='2026-10-24T10:00:00.000Z',since='2026-07-26T10:00:00.000Z';
const kinds=['instruction.available','clarification.followup','repeat.available','language.decided','language.approved','language.rejected','deadline.reminder'];
const item=(overrides={})=>({id:randomUUID(),kind:'instruction.available',label:'New instruction',destination:'inbox',objectType:'assignment',objectId:randomUUID(),occurredAt:now,readAt:null,...overrides});
const page=(overrides={})=>({items:[item()],total:1,unread:1,page:1,pageSize:10,asOf:now,since,...overrides});

test('worker notification pages accept only the exact bounded inbox shape',()=>{
  const valid=page();
  assert.deepEqual(checkedWorkerNotificationPage(valid),valid);
  assert.deepEqual(checkedWorkerNotificationPage(page({items:[],total:0,unread:0})),page({items:[],total:0,unread:0}));
  for(const value of [null,[],{},
    page({pageSize:20}),page({items:'none'}),page({total:1.5}),page({unread:-1}),page({page:0}),page({page:5001}),
    page({asOf:'not a date'}),page({since:null}),page({items:[item({kind:'instruction.unknown'})]}),
    page({items:[item({id:'../foreign'})]}),page({items:[item({label:''})]}),page({items:[item({label:'x'.repeat(81)})]}),
    page({items:[item({destination:'reports'})]}),page({items:[item({objectType:'x'.repeat(41)})]}),
    page({items:[item({objectId:''})]}),page({items:[item({objectId:'x'.repeat(121)})]}),
    page({items:[item({occurredAt:'not a date'})]}),page({items:[item({readAt:42})]}),
  ])assert.throws(()=>checkedWorkerNotificationPage(value),/could not be verified/);
});

test('a saved read receipt is validated as one page item before it can replace local state',()=>{
  const saved=item({readAt:now});
  assert.deepEqual(checkedWorkerNotificationItem(saved),saved);
  assert.deepEqual(checkedWorkerNotificationItem({...saved,extra:'ignored'}),saved);
  for(const value of [null,{}, {...saved,kind:'foreign.kind'}, {...saved,id:'not-a-uuid'}])
    assert.throws(()=>checkedWorkerNotificationItem(value),/could not be verified/);
});

test('worker notification destinations never accept a foreign assignment or message route',()=>{
  const assignment=randomUUID();
  assert.equal(workerNotificationRoute({kind:'instruction.available',destination:'inbox',objectType:'assignment',objectId:assignment}),`worker/${assignment}`);
  assert.equal(workerNotificationRoute({kind:'deadline.reminder',destination:'inbox',objectType:'assignment',objectId:assignment}),`worker/${assignment}`);
  assert.equal(workerNotificationRoute({kind:'repeat.available',destination:'inbox',objectType:'case_repeat',objectId:randomUUID()}),'inbox');
  assert.equal(workerNotificationRoute({kind:'repeat.available',destination:'inbox',objectType:'assignment',objectId:assignment}),'inbox');
  assert.equal(workerNotificationRoute({kind:'clarification.followup',destination:'help',objectType:'case_message',objectId:randomUUID()}),'help');
  assert.equal(workerNotificationRoute({kind:'language.decided',destination:'inbox',objectType:'language_request',objectId:randomUUID()}),'inbox');
  assert.equal(workerNotificationRoute({kind:'instruction.available',destination:'inbox',objectType:'assignment',objectId:'../foreign'}),'inbox');
});

test('every worker locale has complete notification, kind and push copy',()=>{
  const required=['title','subtitle','loading','all','unread','markRead','read','unreadState','open','empty','emptyUnread','loadFailed','previous','next','page','refresh','kindOther','pushTitle','pushBody','pushEnable','pushBusy','pushDenied','pushUnsupported','pushDisabled','pushSynthetic','pushRegistered','pushThisDevice','pushRemove','pushNoGuarantee','pushFailed','pushEnabled','pushRemoved','pushLoading','pushSaveFailed','markFailed'];
  assert.deepEqual(Object.keys(workerNotificationText).sort(),workerUiLanguages.map(locale=>locale.code).sort());
  for(const locale of workerUiLanguages){
    const text=workerNotificationText[locale.code];
    assert.ok(text,`missing ${locale.code}`);
    for(const key of required)assert.ok(typeof text[key]==='string' && text[key].trim().length>0,`${locale.code}.${key}`);
    for(const kind of kinds)assert.ok(text.kinds[kind]?.trim(),`${locale.code}.kinds.${kind}`);
    assert.deepEqual(Object.keys(text.kinds).sort(),[...kinds].sort());
  }
});
