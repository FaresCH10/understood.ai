import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../server/db.mjs';
import { createAppServer } from '../server/index.mjs';
import { seed } from '../server/seed.mjs';
import { metrics } from '../server/domain.mjs';
import { ensureRecordingSchema } from '../server/recordings.mjs';
import { ensureClarificationSchema,requestHelp,workerHelpCases,listClarifications,getClarification,assignClarification,resolveClarification } from '../server/clarifications.mjs';
import {checkedClarificationPage,checkedClarificationDetail,checkedClarificationActionReceipt} from '../src/clarification-contract.ts';
import {clarificationActionHash} from '../src/clarification-action-recovery.ts';
import {checkedCaseTimeline} from '../src/case-timeline.ts';
import {sqliteApp,loginRoute,principalLoginBody} from './helpers/sqlite-app.mjs';


const maya={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
const worker={principal_type:'worker',principal_id:'worker-30',org_id:'cedar',site_id:'beirut'};
const foreign={principal_type:'staff',principal_id:'harbor-owner',org_id:'harbor',site_id:'harbor-yard',role:'owner'};
function fixture() {const db=openDatabase(':memory:');seed(db);ensureRecordingSchema(db);ensureClarificationSchema(db);return db;}

test('help has immutable independent text, exact replay and private-note isolation without an answer receipt',() => {
  const db=fixture();
  try {
    const before=metrics(db,'cedar','shelf-v3'),input={requestId:randomUUID(),text:'I need help with the second shelf.'};
    db.prepare("UPDATE assignments SET due_at='2000-01-01T00:00:00.000Z' WHERE id='assignment-30'").run();
    const result=requestHelp(db,worker,'assignment-30',input);assert.equal(result.duplicate,false);
    assert.deepEqual(metrics(db,'cedar','shelf-v3'),before);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM submission_receipts WHERE assignment_id=?').get('assignment-30').n,0);
    assert.equal(requestHelp(db,worker,'assignment-30',input).duplicate,true);
    assert.throws(() => requestHelp(db,worker,'assignment-30',{...input,text:'Changed help text'}),/Help request conflict/);
    assert.equal(getClarification(db,maya,result.id).helpRequest.text,input.text);
    const notes='Private follow-up notes must not be in worker DTOs.';
    resolveClarification(db,maya,result.id,{notes});
    assert.equal(resolveClarification(db,maya,result.id,{notes}).duplicate,true);
    assert.equal(getClarification(db,maya,result.id).helpRequest.text,input.text);
    assert.throws(() => resolveClarification(db,maya,result.id,{notes:'Different resolution'}),/Resolution conflict/);
    const publicCase=workerHelpCases(db,worker,'assignment-30')[0];
    assert.equal(publicCase.helpText,input.text);assert.equal(publicCase.status,'resolved');
    assert.equal(Object.hasOwn(publicCase,'notes'),false);assert.equal(Object.hasOwn(publicCase,'reason'),false);
    assert.equal(JSON.stringify(publicCase).includes(notes),false);
    db.prepare("UPDATE publications SET state='withdrawn' WHERE id='shelf-v3'").run();
    assert.equal(requestHelp(db,worker,'assignment-30',input).duplicate,true);
    assert.throws(() => requestHelp(db,worker,'assignment-30',{...input,requestId:randomUUID()}),/Assignment unavailable/);
    assert.throws(() => db.prepare("UPDATE help_requests SET text='tampered' WHERE case_id=?").run(result.id),/immutable/);
    assert.throws(() => db.prepare('DELETE FROM help_requests WHERE case_id=?').run(result.id),/immutable/);
    assert.throws(() => db.prepare("UPDATE clarifications SET status='open' WHERE id=?").run(result.id),/immutable/);
  } finally {db.close();}
});

test('case filters page frozen topics, enforce scope and preserve original assessments through ownership/resolution',() => {
  const db=fixture();
  try {
    db.prepare("UPDATE clarifications SET owner_staff_id=NULL WHERE status='open'").run();
    const initial=listClarifications(db,maya,{status:'open',pageSize:'2'});assert.equal(initial.total,3);assert.equal(initial.rows.length,2);
    const next=listClarifications(db,maya,{status:'open',page:'2',pageSize:'2'});assert.equal(next.rows.length,1);assert.ok(!initial.rows.some((row) => row.id===next.rows[0].id));
    const original=getClarification(db,maya,initial.rows[0].id),before=db.prepare('SELECT * FROM attempts WHERE id=?').get(db.prepare('SELECT attempt_id FROM clarifications WHERE id=?').get(original.id).attempt_id);
    db.prepare("UPDATE briefings SET title='New edited draft' WHERE id='shelf'").run();
    assert.equal(listClarifications(db,maya,{search:'Shelf colour'}).total,3);
    assert.equal(listClarifications(db,maya,{search:'New edited draft'}).total,0);
    assert.equal(listClarifications(db,maya,{search:'%'}).total,0);
    assignClarification(db,maya,original.id,{ownerId:'maya'});
    assert.equal(listClarifications(db,maya,{owner:'mine'}).total,1);
    assert.equal(listClarifications(db,maya,{owner:'unassigned'}).total,2);
    assert.equal(assignClarification(db,maya,original.id,{ownerId:'maya'}).duplicate,true);
    assert.throws(() => assignClarification(db,maya,original.id,{ownerId:'harbor-owner'}),/owner unavailable/);
    assert.throws(() => getClarification(db,foreign,original.id),/unavailable/);
    assert.throws(() => listClarifications(db,worker),/Forbidden/);
    assert.throws(() => getClarification(db,{...maya,site_id:'harbor-yard'},original.id),/Forbidden/);
    db.prepare("INSERT INTO staff VALUES('auditor','cedar','beirut','Audit Reader','auditor',1)").run();
    const auditor={...maya,principal_id:'auditor',role:'auditor'};
    assert.equal(getClarification(db,auditor,original.id).id,original.id);
    assert.throws(() => assignClarification(db,auditor,original.id,{ownerId:null}),/Forbidden/);
    resolveClarification(db,maya,original.id,{notes:'Reviewed together in person.'});
    assert.deepEqual(db.prepare('SELECT * FROM attempts WHERE id=?').get(before.id),before);
    for (const filters of [{page:0},{pageSize:51},{status:'closed'},{overdue:'maybe'},{search:'x'.repeat(81)},{org_id:'harbor'}]) assert.throws(() => listClarifications(db,maya,filters),/Invalid clarification filter/);
    db.prepare("UPDATE staff SET active=0 WHERE id='maya'").run();
    assert.throws(() => getClarification(db,maya,original.id),/Forbidden/);
  } finally {db.close();}
});

test('audit failure rolls back help, ownership and resolution; legacy open help survives later resolution',() => {
  const db=fixture();
  try {
    const id=randomUUID(),text='Legacy worker help with the yellow shelf.';
    db.prepare('INSERT INTO clarifications VALUES(?,?,?,?,?,?,?,?,?)').run(id,'cedar','assignment-30',null,'Help requested',null,'open',text,new Date().toISOString());
    ensureClarificationSchema(db);ensureClarificationSchema(db);
    assert.equal(getClarification(db,maya,id).helpRequest.text,text);
    assert.equal(getClarification(db,maya,id).notes,'');
    db.exec("CREATE TRIGGER fail_case_audit BEFORE INSERT ON audit WHEN NEW.action IN ('help.requested','clarification.assigned','clarification.resolved') BEGIN SELECT RAISE(ABORT,'Injected audit failure'); END;");
    assert.throws(() => requestHelp(db,worker,'assignment-30',{requestId:randomUUID(),text:'A new help message'}),/Injected/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM help_requests').get().n,1);
    assert.throws(() => assignClarification(db,maya,id,{ownerId:'maya'}),/Injected/);
    assert.equal(getClarification(db,maya,id).owner_staff_id,null);
    assert.throws(() => resolveClarification(db,maya,id,{notes:'Private supervisor resolution'}),/Injected/);
    assert.equal(getClarification(db,maya,id).status,'open');
    db.exec('DROP TRIGGER fail_case_audit');
    resolveClarification(db,maya,id,{notes:'Private supervisor resolution'});
    assert.equal(workerHelpCases(db,worker,'assignment-30')[0].helpText,text);
    assert.throws(() => workerHelpCases(db,{...worker,principal_id:'worker-29'},'assignment-30'),/Assignment unavailable/);
  } finally {db.close();}
});

test('clarification HTTP shares paged contract and denies worker/staff/foreign case authority correctly',async () => {
  const db=openDatabase(':memory:'),server=sqliteApp(db);
  await new Promise((resolve) => server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api`;
  const request=async(path,cookie,body) => {
    const headers={origin:'http://127.0.0.1:3020',...(cookie ? {cookie} : {}),'content-type':'application/json'};
    if(cookie && (body!==undefined && path.startsWith('/worker/') || path.startsWith('/clarifications')))headers['x-client-session-context']=(await (await fetch(base+'/session',{headers:{cookie}})).json()).clientContext || '';
    return fetch(base+path,{headers,...(body===undefined ? {} : {method:'POST',body:JSON.stringify(body)})});
  };
  const login=async (principal) => (await request(loginRoute(principal),null,principalLoginBody(principal))).headers.get('set-cookie').split(';')[0];
  try {
    const staff=await login('maya'),workerCookie=await login('worker-30'),other=await login('harbor-owner');
    assert.equal((await request('/clarifications')).status,401);
    const list=await (await request('/clarifications?status=open&pageSize=2',staff)).json();assert.equal(list.total,3);assert.equal(list.rows.length,2);
    const staffContext=(await (await request('/session',staff)).json()).clientContext;
    checkedClarificationPage(list,1,2,staffContext);
    const detail=await (await request(`/clarifications/${list.rows[1].id}`,staff)).json();checkedClarificationDetail(detail,detail.id,staffContext);
    const timelinePath=`/clarifications/${detail.id}/timeline`,timelineResponse=await request(timelinePath,staff),timeline=checkedCaseTimeline(await timelineResponse.json(),detail.id,1,staffContext);
    assert.equal(timelineResponse.status,200);assert.equal(timelineResponse.headers.get('cache-control'),'no-store');assert.ok(timeline.items.some(row=>row.kind==='response_received'));
    assert.equal((await request(timelinePath,workerCookie)).status,403);assert.equal((await request(timelinePath,other)).status,404);
    assert.equal((await fetch(base+timelinePath,{headers:{cookie:staff}})).status,409);
    assert.equal((await fetch(base+timelinePath,{headers:{cookie:staff,'x-client-session-context':'f'.repeat(64)}})).status,409);
    for(const query of ['?page=1&page=2','?pageSize=50','?org_id=harbor'])assert.equal((await request(timelinePath+query,staff)).status,400);
    const content={kind:'assign',ownerId:detail.owner_staff_id==='maya'?null:'maya',expectedOwnerId:detail.owner_staff_id},pending={id:randomUUID(),kind:'assign',hash:await clarificationActionHash(content)};
    const action=await request(`/clarifications/${detail.id}/assign`,staff,{requestId:pending.id,ownerId:content.ownerId,expectedOwnerId:content.expectedOwnerId});assert.equal(action.status,200);
    const accepted=checkedClarificationActionReceipt(await action.json(),detail.id,pending,staffContext);assert.equal(accepted.effect,'applied');
    const lookup=await request(`/clarifications/${detail.id}/actions/${pending.id}`,staff);assert.equal(lookup.status,200);assert.deepEqual(await lookup.json(),accepted);
    assert.equal((await request(`/clarifications/${detail.id}/actions/${pending.id}?unexpected=1`,staff)).status,400);
    assert.equal((await request('/clarifications?status=open&status=all',staff)).status,400);
    assert.equal((await fetch(base+'/clarifications',{headers:{cookie:staff}})).status,409);
    const id=list.rows[0].id;
    assert.equal((await request(`/clarifications/${id}`,workerCookie)).status,403);
    assert.equal((await request(`/clarifications/${id}`,other)).status,404);
    assert.equal((await request(`/clarifications/${id}/assign`,staff,{ownerId:'harbor-owner'})).status,404);
    assert.equal((await request('/clarifications?org_id=harbor',staff)).status,400);
    assert.equal((await request(`/clarifications/${id}/assign`,staff,{ownerId:'maya'})).status,200);
    assert.equal((await request(`/clarifications/${id}/resolve`,staff,{notes:'Helped in person.'})).status,200);
    assert.equal((await request(`/clarifications/${id}/resolve`,staff,{notes:'Changed notes.'})).status,409);
    const helpId=randomUUID();assert.equal((await request('/worker/briefings/assignment-30/help',workerCookie,{requestId:helpId,text:'Please help me'})).status,201);
    const publicCases=await (await request('/worker/briefings/assignment-30/help',workerCookie)).json();assert.equal(publicCases[0].helpText,'Please help me');assert.equal(Object.hasOwn(publicCases[0],'notes'),false);
    const context=(await (await request('/session',workerCookie)).json()).clientContext;
    const historyResponse=await request('/worker/briefings/assignment-30/help-history?page=1&pageSize=5',workerCookie),history=await historyResponse.json();
    assert.equal(historyResponse.status,200);assert.equal(historyResponse.headers.get('cache-control'),'no-store');assert.equal(history.clientContext,context);
    assert.equal(history.assignment.id,'assignment-30');assert.equal(history.assignment.version,3);assert.equal(history.cases[0].helpText,'Please help me');assert.equal(history.total,1);
    assert.equal((await request('/worker/briefings/assignment-30/help-history?pageSize=50',workerCookie)).status,400);
    assert.equal((await request('/worker/briefings/assignment-29/help-history',workerCookie)).status,404);
    assert.equal((await request('/worker/briefings/assignment-30/help-history',staff)).status,403);
    assert.equal((await fetch(base+'/worker/briefings/assignment-30/help-history',{headers:{cookie:workerCookie,'x-client-session-context':'f'.repeat(64)}})).status,409);
    assert.equal((await request('/worker/briefings/assignment-29/help',workerCookie)).status,404);
    assert.equal((await request('/worker/briefings/assignment-30/help',staff)).status,403);
    assert.equal((await (await request('/session',staff)).json()).staffRole,'owner');
  } finally {await new Promise((resolve) => server.close(resolve));db.close();}
});
