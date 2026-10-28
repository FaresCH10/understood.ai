import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import * as local from '../server/case-messages.mjs';
import * as pgMessages from '../server/postgres/case-messages.mjs';
import {requestHelp,resolveClarification} from '../server/clarifications.mjs';
import * as pgCases from '../server/postgres/clarifications.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {ensureDeletionRedactionSchema,processOneDeletionRedaction} from '../server/deletion-redactions.mjs';
import {requestWorkerDeletion} from '../server/deletions.mjs';
import {requestWorkerDeletion as pgDelete} from '../server/postgres/deletions.mjs';
import {processOneDeletionRedaction as pgRedact} from '../server/postgres/deletion-redactions.mjs';
import {caseMessageInput,caseMessageFilters} from '../server/case-message-input.mjs';
import {createAppServer} from '../server/index.mjs';
import {workerBriefings as localInbox} from '../server/responses.mjs';
import {workerBriefings as pgInbox} from '../server/postgres/read-models.mjs';
import {checkedConversationPage,checkedConversationReceipt,requestConversation} from '../src/conversation-request.ts';
import {createPostgresRehearsalServer} from '../server/postgres/http.mjs';
import {issueWorkerGrant,redeemWorkerGrant,provisionStaffCredential,authenticateStaff} from '../server/postgres/auth.mjs';
import {sqliteApp,loginRoute,principalLoginBody} from './helpers/sqlite-app.mjs';


const owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
const worker={principal_type:'worker',principal_id:'worker-1',org_id:'cedar',site_id:'beirut'};
async function fixture(pg,schema='public') {
  let db,pool;const options={schema};
  if(pg) {
    db=new PGlite();pool={async connect(){return {query:async(sql,args)=>args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)??{rows:[]},release(){}};}};
    if(schema!=='public')await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);
    await runMigrations(pool,options);
    await db.exec(`INSERT INTO organizations VALUES('cedar','Synthetic');INSERT INTO sites VALUES('beirut','cedar','Synthetic','UTC');
      INSERT INTO staff(id,org_id,site_id,name,role) VALUES('maya','cedar','beirut','Maya','owner'),('audit','cedar','beirut','Auditor','auditor');
      INSERT INTO workers(id,org_id,site_id,code,language) VALUES('worker-1','cedar','beirut','Worker 001','en'),('worker-2','cedar','beirut','Worker 002','en'),('worker-14','cedar','beirut','Worker 014','ar');
      INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES('shelf','cedar','beirut','Synthetic','Synthetic','draft');
      INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state) VALUES('shelf-v3','cedar','beirut','shelf',3,'{"languages":{"en":{"title":"Synthetic"},"ar":{"title":"Synthetic Arabic"}}}','published');
      INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES('assignment-1','cedar','beirut','shelf-v3','worker-1','en'),('assignment-14','cedar','beirut','shelf-v3','worker-14','ar');`);
  }else{db=openDatabase(':memory:');seed(db);ensureDeletionRedactionSchema(db);db.prepare("INSERT INTO staff VALUES('audit','cedar','beirut','Auditor','auditor',1)").run();}
  const q=async(sql,args=[])=>pg?db.query(sql,args):{rows:db.prepare(sql).all(...args)};
  const call=(name,...args)=>{if(name==='listCaseMessages' && args.length===2)args.push({});return pg?pgMessages[name](pool,...args,options):local[name](db,...args);};
  const help=(s,a,input)=>pg?pgCases.requestHelp(pool,s,a,input,options):requestHelp(db,s,a,input);
  const resolve=(id)=>pg?pgCases.resolveClarification(pool,owner,id,{notes:'Synthetic resolution'},options):resolveClarification(db,owner,id,{notes:'Synthetic resolution'});
  const id=randomUUID();await help(worker,'assignment-1',{requestId:id,text:'Synthetic help request'});
  const inbox=principal=>pg?pgInbox(pool,principal,options,{view:'followup'}):localInbox(db,principal,{view:'followup'});
  return {db,pool,q,call,help,resolve,inbox,id,p:n=>pg?`$${n}`:'?',close:()=>db.close()};
}

test('conversation trust boundary bounds content, IDs, scope and pagination',()=>{
  for(const input of [null,[],{}, {requestId:randomUUID(),text:' '},{requestId:randomUUID(),text:'x'.repeat(1001)},{requestId:randomUUID(),text:'ok',org_id:'foreign'}])assert.throws(()=>caseMessageInput(input),/Invalid/);
  for(const input of [null,[],{page:0},{pageSize:51},{site_id:'foreign'}])assert.throws(()=>caseMessageFilters(input),/Invalid/);
});
test('conversation HTTP fences current page identity, scopes receipts and redacts unexpected failures',async()=>{
  const db=openDatabase(':memory:'),server=sqliteApp(db);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const base=`http://127.0.0.1:${server.address().port}/api`;
  const request=(path,cookie,body,context)=>fetch(base+path,{headers:{origin:'http://127.0.0.1:3020',...(cookie?{cookie}:{}),'content-type':'application/json',...(context?{'x-client-session-context':context}:{})},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});
  const login=async principal=>{const cookie=(await request(loginRoute(principal),null,principalLoginBody(principal))).headers.get('set-cookie').split(';')[0];return {cookie,context:(await (await request('/session',cookie)).json()).clientContext};};
  try {
    const staff=await login('maya'),w=await login('worker-30'),other=await login('harbor-owner');
    const caseId=randomUUID();requestHelp(db,{...worker,principal_id:'worker-30'},'assignment-30',{requestId:caseId,text:'Synthetic HTTP help'});
    const path=`/clarifications/${caseId}/messages`,input={requestId:randomUUID(),text:'Synthetic HTTP message'};
    assert.equal((await request(path)).status,401);
    assert.equal((await request(path,other.cookie)).status,404);
    assert.equal((await request(path,staff.cookie,input)).status,409);
    assert.equal((await request(path,staff.cookie,input,w.context)).status,409);
    assert.equal((await request(path,staff.cookie,input,staff.context)).status,503);
    assert.equal((await request(path,w.cookie,input,w.context)).status,200);
    const receipt=await request(`${path}/${input.requestId}`,w.cookie);assert.equal(receipt.status,200);assert.match(receipt.headers.get('cache-control'),/no-store/);
    assert.equal(checkedConversationReceipt(await receipt.json(),caseId,input.requestId,w.context,'message').id,input.requestId);
    assert.equal((await request(`${path}/${input.requestId}`,staff.cookie)).status,404);
    assert.equal((await request(path+'?org_id=foreign',w.cookie)).status,400);
    assert.equal(checkedConversationPage(await (await request(path,w.cookie)).json(),caseId,1,w.context,true).total,1);
    db.exec("CREATE TRIGGER fail_message_audit BEFORE INSERT ON audit WHEN NEW.action='clarification.message' BEGIN SELECT RAISE(ABORT,'private database diagnostic'); END");
    const failed=await request(path,w.cookie,{...input,requestId:randomUUID()},w.context);
    assert.equal(failed.status,503);assert.equal(JSON.stringify(await failed.json()).includes('private database diagnostic'),false);
    assert.equal(db.prepare('SELECT count(*) n FROM case_messages').get().n,1);
  } finally {await new Promise(resolve=>server.close(resolve));db.close();}
});

test('PostgreSQL HTTP conversation envelopes pass the actual captured client reader for pages, exact messages and queued follow-ups',async()=>{
  const schema='understood_test_conversation_http',options={schema},f=await fixture(true,schema),origin='http://127.0.0.1:3020';let server;
  try{
    const password='Synthetic-conversation-password-123';
    await provisionStaffCredential(f.pool,{staffId:'maya',orgId:'cedar',siteId:'beirut',email:'conversation@example.test',password},options);
    const staff=(await authenticateStaff(f.pool,'conversation@example.test',password,'synthetic-conversation',options)).session;
    const own=await redeemWorkerGrant(f.pool,(await issueWorkerGrant(f.pool,owner,'worker-1',30,options)).token,options);
    const adapter={provenance:{dataClass:'synthetic'},capabilities:{textLanguages:['en'],speechLanguages:['en']}};
    server=createPostgresRehearsalServer(f.pool,{...options,caseFollowupAdapter:adapter,dataClass:'synthetic',tier:'local',aiMode:'synthetic',accessMode:'credential',publicOrigin:origin});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const base=`http://127.0.0.1:${server.address().port}`;
    const transport=identity=>(path,init={})=>fetch(base+path,{...init,headers:{...init.headers,origin,cookie:`understood_pg_rehearsal=${identity.token}`}});
    const workerSession=await (await transport(own)('/api/session')).json(),staffSession=await (await transport(staff)('/api/session')).json();
    const call=(identity,s,isWorker,op)=>requestConversation(transport(identity),s,f.id,isWorker,op,new AbortController().signal,()=>true);
    const before=(await f.db.query('SELECT count(*)::int n FROM attempts')).rows[0].n;
    assert.equal((await call(own,workerSession,true,{kind:'page',page:1})).total,0);
    const requestId=randomUUID(),posted=await call(own,workerSession,true,{kind:'message',requestId,text:'Synthetic own reply'});
    assert.equal(posted.id,requestId);assert.deepEqual(await call(own,workerSession,true,{kind:'message',requestId}),posted);
    assert.equal((await call(own,workerSession,true,{kind:'page',page:1})).items[0].text,'Synthetic own reply');
    const staffPage=await call(staff,staffSession,false,{kind:'page',page:1});assert.equal(staffPage.canGenerate,true);assert.equal(staffPage.canVoice,false);
    const followupId=randomUUID(),queued=await call(staff,staffSession,false,{kind:'followup',requestId:followupId,text:'Synthetic generated follow-up'});
    assert.equal(queued.status,'queued');assert.equal(queued.deliveredAt,null);assert.deepEqual(await call(staff,staffSession,false,{kind:'followup',requestId:followupId}),queued);
    assert.equal((await f.db.query('SELECT count(*)::int n FROM case_followups')).rows[0].n,1);
    assert.equal((await f.db.query('SELECT count(*)::int n FROM attempts')).rows[0].n,before);
    await assert.rejects(call(own,workerSession,true,{kind:'message',requestId:randomUUID()}),e=>e.code==='unavailable');
    await assert.rejects(call(own,{...workerSession,clientContext:'f'.repeat(64)},true,{kind:'page',page:1}),e=>e.code==='session');
  }finally{if(server)await new Promise(resolve=>server.close(resolve));await f.close();}
});
for(const pg of [false,true])test(`${pg?'PostgreSQL':'SQLite'} conversation is scoped, append-only, exactly replayed and separate from assessment`,async()=>{
  const f=await fixture(pg);
  try {
    const before=(await f.q('SELECT * FROM attempts')).rows,receiptCount=(await f.q('SELECT count(*) n FROM submission_receipts')).rows;
    const input={requestId:randomUUID(),text:'Please explain where the unfinished items go.'};
    assert.equal((await f.inbox(worker)).total,0);
    const first=await f.call('sendCaseMessage',owner,f.id,input);
    assert.deepEqual(await f.call('sendCaseMessage',owner,f.id,input),first);
    assert.deepEqual(await f.call('caseMessageReceiptLookup',owner,f.id,input.requestId),first);
    await assert.rejects(async()=>f.call('sendCaseMessage',owner,f.id,{...input,text:'Changed'}),/conflict/);
    await assert.rejects(async()=>f.call('caseMessageReceiptLookup',worker,f.id,input.requestId),/unavailable/);
    await f.call('sendCaseMessage',worker,f.id,{requestId:randomUUID(),text:'Unfinished items go on the yellow shelf.'});
    const inbox=await f.inbox(worker);assert.equal(inbox.total,1);assert.equal(inbox.counts.followup,1);assert.equal(inbox.items[0].id,'assignment-1');
    assert.equal((await f.inbox({...worker,principal_id:'worker-2'})).total,0);
    const list=await f.call('listCaseMessages',worker,f.id,{pageSize:1});assert.equal(list.total,2);assert.equal(list.items.length,1);assert.equal(list.canReply,true);
    assert.equal((await f.call('listCaseMessages',worker,f.id,{page:2,pageSize:1})).items.length,1);
    for(const principal of [{...worker,principal_id:'worker-2'},{...owner,org_id:'foreign'}, {...worker,principal_type:'forged'}])
      await assert.rejects(async()=>f.call('listCaseMessages',principal,f.id),/Forbidden|unavailable|Workspace access paused/);
    const audit={...owner,principal_id:'audit',role:'auditor'};assert.equal((await f.call('listCaseMessages',audit,f.id)).total,2);
    await assert.rejects(async()=>f.call('sendCaseMessage',audit,f.id,{requestId:randomUUID(),text:'Forbidden'}),/Forbidden/);
    await assert.rejects(f.q("UPDATE case_messages SET text='forged'"),/immutable/);
    await assert.rejects(f.q('DELETE FROM case_messages'),/immutable/);
    assert.deepEqual((await f.q('SELECT * FROM attempts')).rows,before);assert.deepEqual((await f.q('SELECT count(*) n FROM submission_receipts')).rows,receiptCount);
    await f.resolve(f.id);assert.deepEqual(await f.call('sendCaseMessage',owner,f.id,input),first);
    assert.equal((await f.inbox(worker)).total,0);assert.equal((await f.call('listCaseMessages',worker,f.id)).total,2);
    await assert.rejects(async()=>f.call('sendCaseMessage',worker,f.id,{requestId:randomUUID(),text:'After closure'}),/closed/);
    assert.equal((await f.call('listCaseMessages',worker,f.id)).canReply,false);
  }finally{await f.close();}
});
for(const pg of [false,true])test(`${pg?'PostgreSQL':'SQLite'} conversation rolls back audit failures, fences untranslated delivery and redacts on worker deletion`,async()=>{
  const f=await fixture(pg);
  try {
    if(pg)await f.db.exec("CREATE FUNCTION deny_message_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='clarification.message' THEN RAISE EXCEPTION 'Injected audit failure'; END IF; RETURN NEW; END $$;CREATE TRIGGER deny_message_audit BEFORE INSERT ON audit FOR EACH ROW EXECUTE FUNCTION deny_message_audit()");
    else f.db.exec("CREATE TRIGGER deny_message_audit BEFORE INSERT ON audit WHEN NEW.action='clarification.message' BEGIN SELECT RAISE(ABORT,'Injected audit failure'); END");
    const input={requestId:randomUUID(),text:'Synthetic private follow-up'};
    await assert.rejects(async()=>f.call('sendCaseMessage',owner,f.id,input),/Injected/);
    assert.equal((await f.call('listCaseMessages',worker,f.id)).total,0);
    if(pg)await f.db.exec('DROP TRIGGER deny_message_audit ON audit');else f.db.exec('DROP TRIGGER deny_message_audit');
    await f.call('sendCaseMessage',owner,f.id,input);
    const arWorker={...worker,principal_id:'worker-14'},arId=randomUUID();await f.help(arWorker,'assignment-14',{requestId:arId,text:'Synthetic Arabic help'});
    await assert.rejects(async()=>f.call('sendCaseMessage',owner,arId,{requestId:randomUUID(),text:'English is not an Arabic translation'}),/translation unavailable/);
    const native=await f.call('sendCaseMessage',arWorker,arId,{requestId:randomUUID(),text:'أحتاج إلى المساعدة'});assert.equal(native.language,'ar');
    const before=(await f.q(`SELECT * FROM case_messages WHERE id=${f.p(1)}`,[input.requestId])).rows[0];
    const deletion={requestId:randomUUID(),expectedCode:'Worker 001',reason:'worker_request',confirmed:true};
    if(pg){await pgDelete(f.pool,owner,'worker-1',deletion);assert.equal(await pgRedact(f.pool),true);}
    else {requestWorkerDeletion(f.db,owner,'worker-1',deletion);assert.equal(processOneDeletionRedaction(f.db),true);}
    const after=(await f.q(`SELECT * FROM case_messages WHERE id=${f.p(1)}`,[input.requestId])).rows[0];
    assert.deepEqual({...after,text:before.text},{...before});assert.equal(after.text,'[Deleted]');
    await assert.rejects(f.q("UPDATE case_messages SET text='restored'"),/immutable/);
    await assert.rejects(async()=>f.call('sendCaseMessage',worker,f.id,{requestId:randomUUID(),text:'Revoked'}),/Forbidden/);
    assert.equal((await f.call('listCaseMessages',owner,arId)).items[0].text,'أحتاج إلى المساعدة');
  }finally{await f.close();}
});
