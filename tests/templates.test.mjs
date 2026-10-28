import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {CANONICAL_SOURCE} from '../server/domain.mjs';
import {processOne} from '../server/worker.mjs';
import {ensureTemplateSchema,changeTemplate,listTemplates,getTemplate,templateReceipt} from '../server/templates.mjs';
import {templateInput,templateFilters,templateHistoryInput} from '../server/template-input.mjs';
import {changeTemplate as pgChange,listTemplates as pgList,getTemplate as pgGet,templateReceipt as pgReceipt} from '../server/postgres/templates.mjs';
import {processOnePreparation,editDraft as pgEdit} from '../server/postgres/preparation.mjs';
import {editDraft} from '../server/preparation.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {createAppServer} from '../server/index.mjs';
import {createPostgresRehearsalServer} from '../server/postgres/http.mjs';
import {provisionStaffCredential} from '../server/postgres/auth.mjs';
import {createSessionContextFetch} from './helpers/session-http.mjs';
import {principalLoginBody,seedCredentials} from './helpers/sqlite-app.mjs';

const fetch=createSessionContextFetch();
const owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
const content={title:'Shelf handover template',description:'Shelf handover',source:CANONICAL_SOURCE,question:'',facts:[],askedFacts:[]};
const input=patch=>({requestId:randomUUID(),confirmed:true,...patch});
test('template inputs strictly bound scope, defaults, history and literal filters',()=>{
  for(const patch of [{confirmed:false},{requestId:'bad'},{source:'short'},{title:'x'},{description:null},{question:null},{facts:['a',' a']},{askedFacts:Array(7).fill('a')},{state:'ready'},{org_id:'foreign'}]) assert.throws(()=>templateInput('create',null,input({...content,...patch})),/Invalid|invalid/);
  assert.equal(templateInput('create',null,input({...content,title:'  Trimmed template  '})).title,'Trimmed template');
  for(const filter of [{page:0},{pageSize:101},{status:'ready'},{unknown:true},{search:'x'.repeat(81)}]) assert.throws(()=>templateFilters(filter),/Invalid/);
  for(const filter of [{page:0},{version:0},{version:1.2},{org_id:'foreign'}]) assert.throws(()=>templateHistoryInput(filter),/Invalid/);
});
async function fixture(pg) {
  if(!pg) {
    const db=openDatabase(':memory:');seed(db);ensureTemplateSchema(db);db.prepare('INSERT INTO staff VALUES(?,?,?,?,?,1)').run('auditor','cedar','beirut','Auditor','auditor');
    return {db,change:(s,k,id,v)=>changeTemplate(db,s,k,id,v),list:(s,v)=>listTemplates(db,s,v),get:(s,id,v)=>getTemplate(db,s,id,v),process:()=>processOne(db),edit:(id,v)=>editDraft(db,owner,id,v),raw:async(sql,v=[])=>({rows:db.prepare(sql).all(...v)}),fail(){db.exec("CREATE TRIGGER reject_template_audit BEFORE INSERT ON audit WHEN NEW.action LIKE 'template.%' BEGIN SELECT RAISE(ABORT,'Injected template audit failure'); END");},reset(){db.exec('DROP TRIGGER reject_template_audit');},close:async()=>db.close()};
  }
  const db=new PGlite(),options={schema:'understood_test_templates'};let fail=false,lost=false;
  const pool={async connect(){return {async query(sql,v){if(fail && sql.includes('INSERT INTO audit')) throw new Error('Injected template audit failure');const r=v?.length ? await db.query(sql,v) : (await db.exec(sql)).at(-1) || {rows:[]};if(lost && sql==='COMMIT') {lost=false;throw new Error('Lost template commit receipt');}return r;},release(){}};}};
  await db.exec(`CREATE SCHEMA ${options.schema};SET search_path TO ${options.schema},pg_catalog`);await runMigrations(pool,options);
  await db.query("INSERT INTO organizations VALUES('cedar','Cedar Works'),('foreign','Foreign')");await db.query("INSERT INTO sites VALUES('beirut','cedar','Beirut','Asia/Beirut'),('foreign','foreign','Foreign','UTC')");
  await db.query("INSERT INTO staff(id,org_id,site_id,name,role) VALUES('maya','cedar','beirut','Maya','owner'),('auditor','cedar','beirut','Auditor','auditor'),('foreign','foreign','foreign','Foreign','owner')");
  return {db,pool,options,change:(s,k,id,v)=>pgChange(pool,s,k,id,v,options),list:(s,v)=>pgList(pool,s,v,options),get:(s,id,v)=>pgGet(pool,s,id,v,options),process:()=>processOnePreparation(pool,{...options,integrationMode:'synthetic'}),edit:(id,v)=>pgEdit(pool,owner,id,v,options),raw:(sql,v)=>db.query(sql,v),fail(){fail=true;},reset(){fail=false;},lose(){lost=true;},close:()=>db.close()};
}
for(const pg of [false,true]) test(`${pg ? 'PostgreSQL' : 'SQLite'} template lifecycle preserves versions, exact receipts and fresh processing with scoped HTTP`,async()=>{
  const f=await fixture(pg),auditor={...owner,principal_id:'auditor',role:'auditor'};
  try {
    const original=JSON.stringify((await f.raw('SELECT * FROM publications ORDER BY id')).rows),create=input(content);
    for(const s of [auditor,{...owner,principal_type:'worker'},{...owner,site_id:'foreign'},{...owner,principal_id:'missing'}]) await assert.rejects(async()=>f.change(s,'create',null,create),/Forbidden/);
    f.fail();await assert.rejects(async()=>f.change(owner,'create',null,create),/Injected/);f.reset();assert.equal((await f.list(owner)).total,0);
    if(pg) {f.lose();await assert.rejects(f.change(owner,'create',null,create),/Lost template/);}else await f.change(owner,'create',null,create);
    const id=create.requestId;assert.equal((await f.change(owner,'create',null,create)).duplicate,true);assert.equal((await f.get(auditor,id)).revision,1);
    const receipt=(s,requestId)=>pg ? pgReceipt(f.pool,s,requestId,f.options) : templateReceipt(f.db,s,requestId);
    assert.deepEqual(await receipt(owner,randomUUID()),{found:false});await assert.rejects(async()=>receipt(owner,'bad'),/Invalid/);
    for(const s of [auditor,{...owner,principal_type:'worker'},{...owner,site_id:'foreign'}]) await assert.rejects(async()=>receipt(s,id),/Forbidden/);
    assert.equal((await receipt(owner,id)).result.revision,1);
    const colleague={...owner,principal_id:'colleague',role:'supervisor'};
    await f.raw("INSERT INTO staff(id,org_id,site_id,name,role) VALUES('colleague','cedar','beirut','Synthetic colleague','supervisor')");
    assert.deepEqual(await receipt(colleague,id),{found:false});
    await assert.rejects(async()=>f.change(colleague,'create',null,create),/conflict/);
    await assert.rejects(async()=>f.change(owner,'create',null,{...create,title:'Conflicting template'}),/conflict/);
    const edit=input({...content,revision:1,title:'Revised shelf template',question:'Unsupported question'});await f.change(owner,'edit',id,edit);
    assert.equal((await f.get(owner,id,{version:1})).selected.content.title,content.title);assert.equal((await f.get(owner,id)).revision,2);
    assert.equal((await receipt(owner,id)).result.revision,1);assert.equal((await receipt(owner,id)).request.title,content.title);
    await assert.rejects(async()=>f.change(owner,'edit',id,input({...content,revision:1})),/revision changed/);
    const use=input({revision:2,title:'New unsupported briefing'});f.fail();await assert.rejects(async()=>f.change(owner,'use',id,use),/Injected/);f.reset();assert.equal((await f.raw('SELECT COUNT(*) n FROM briefings WHERE id='+ (pg ? '$1' : '?'),[use.requestId])).rows[0].n,0);
    await f.change(owner,'use',id,use);assert.equal((await f.raw('SELECT prepared_json,state,revision,next_version FROM briefings WHERE id='+ (pg ? '$1' : '?'),[use.requestId])).rows[0].state,'processing');
    assert.equal((await f.raw('SELECT COUNT(*) n FROM assignments WHERE publication_id='+ (pg ? '$1' : '?'),[use.requestId])).rows[0].n,0);
    await f.process();assert.equal((await f.raw('SELECT state FROM briefings WHERE id='+ (pg ? '$1' : '?'),[use.requestId])).rows[0].state,'failed');
    await f.edit(use.requestId,{revision:1,title:'Later source edit',source:CANONICAL_SOURCE});assert.equal((await f.change(owner,'use',id,use)).duplicate,true);
    assert.equal((await f.raw('SELECT revision FROM briefings WHERE id='+ (pg ? '$1' : '?'),[use.requestId])).rows[0].revision,2);
    const archive=input({revision:2});await f.change(owner,'archive',id,archive);
    assert.equal((await f.list(owner)).total,0);assert.equal((await f.list(owner,{status:'archived'})).total,1);
    await assert.rejects(async()=>f.change(owner,'use',id,input({revision:3,title:'No archived use'})),/archived/);
    const dup=await f.change(owner,'duplicate',id,input({revision:3,title:'Copied shelf template'}));assert.equal(dup.revision,1);assert.equal((await f.get(owner,dup.id)).selected.content.question,'Unsupported question');
    await f.change(owner,'restore',id,input({revision:3}));assert.equal((await f.change(owner,'archive',id,archive)).revision,3);assert.equal((await f.get(owner,id)).revision,4);
    await f.change(owner,'edit',id,input({...content,revision:4}));const fresh=input({revision:5,title:'Fresh template briefing'});await f.change(owner,'use',id,fresh);await f.process();
    const ready=(await f.raw('SELECT prepared_json,state FROM briefings WHERE id='+ (pg ? '$1' : '?'),[fresh.requestId])).rows[0];assert.equal(ready.state,'ready');assert.equal((typeof ready.prepared_json==='string' ? JSON.parse(ready.prepared_json) : ready.prepared_json).provenance.reviewRevision,1);
    assert.equal((await f.get(owner,id,{version:2})).selected.content.question,'Unsupported question');
    for(let revision=5;revision<26;revision++) await f.change(owner,'edit',id,input({...content,revision,title:`Template revision ${revision+1}`}));
    const history=await f.get(owner,id,{page:2,version:1});assert.equal(history.history.total,26);assert.equal(history.history.items.length,6);assert.equal(history.selected.content.title,content.title);
    assert.equal(JSON.stringify((await f.raw('SELECT * FROM publications ORDER BY id')).rows),original);
    for(const table of ['template_versions','template_requests']) {await assert.rejects(f.raw(`DELETE FROM ${table}`),/immutable/);await assert.rejects(f.raw(`UPDATE ${table} SET created_by='auditor'`),/immutable/);}
    for(let n=0;n<22;n++) await f.change(owner,'create',null,input({...content,title:`Paged template ${String(n).padStart(2,'0')}`}));
    const page=await f.list(owner,{search:'Paged template',page:2,pageSize:20});assert.equal(page.total,22);assert.equal(page.items.length,2);assert.equal((await f.list(owner,{search:'%'})).total,0);
    const foreign={...owner,principal_id:pg ? 'foreign' : 'harbor-owner',org_id:pg ? 'foreign' : 'harbor',site_id:pg ? 'foreign' : 'harbor-yard'};
    assert.equal((await f.list(foreign)).total,0);await assert.rejects(async()=>f.get(foreign,id),/unavailable/);
    assert.deepEqual(await receipt(foreign,id),{found:false});
    await assert.rejects(async()=>f.change(foreign,'use',id,input({revision:5,title:'Foreign use denied'})),/unavailable/);
    // A forged site is denied rather than used to widen the owner's scope.
    await assert.rejects(async()=>f.get({...owner,site_id:'foreign'},id),/Forbidden/);
    const config={tier:'local',aiMode:'synthetic',accessMode:'credential',dataClass:'synthetic',publicOrigin:'http://127.0.0.1:3020',...(pg ? f.options : {})};
    if(pg) await provisionStaffCredential(f.pool,{staffId:'maya',orgId:'cedar',siteId:'beirut',email:'templates@example.test',password:'Synthetic-templates-password-123'},f.options);
    else seedCredentials(f.db);
    const server=pg ? createPostgresRehearsalServer(f.pool,config) : createAppServer(f.db,config);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api`;
    const call=(path,cookie,body)=>fetch(base+path,{method:body ? 'POST' : 'GET',headers:{origin:config.publicOrigin,'content-type':'application/json',...(cookie ? {cookie} : {})},body:body ? JSON.stringify(body) : undefined});
    try {
      assert.equal((await call('/templates')).status,401);
      const login=await call('/auth/staff/login',null,pg ? {email:'templates@example.test',password:'Synthetic-templates-password-123'} :principalLoginBody('maya')),cookie=login.headers.get('set-cookie').split(';')[0];
      const list=await call('/templates?page=2&pageSize=20',cookie);assert.equal(list.status,200);assert.match(list.headers.get('cache-control'),/no-store/);
      const saved=await call('/templates/receipts/'+id,cookie);assert.equal(saved.status,200);assert.match(saved.headers.get('cache-control'),/no-store/);assert.equal((await saved.json()).result.revision,1);
      assert.equal((await call('/templates/receipts/bad',cookie)).status,400);assert.equal((await call('/templates/receipts/'+id+'?scope=foreign',cookie)).status,400);
      assert.equal((await call('/templates?scope=foreign',cookie)).status,400);assert.equal((await call('/templates/'+id+'/archive',cookie,input({revision:1}))).status,409);
      assert.equal((await call('/templates/'+id+'/use?scope=foreign',cookie,input({revision:26,title:'Blocked query'}))).status,400);
      assert.equal((await call('/templates/'+id+'?version=1',cookie)).status,200);assert.equal((await call('/templates/missing',cookie)).status,404);
      assert.equal((await call('/templates',cookie,{...input(content),confirmed:false})).status,400);
      const next=input({...content,title:'HTTP created template'}),accepted=await call('/templates',cookie,next);assert.equal(accepted.status,201);assert.equal((await call('/templates',cookie,next)).status,200);
    } finally {await new Promise(resolve=>server.close(resolve));}
    await f.raw(pg ? "UPDATE staff SET active=false WHERE id='maya'" : "UPDATE staff SET active=0 WHERE id='maya'");await assert.rejects(async()=>f.change(owner,'create',null,create),/Forbidden/);await assert.rejects(async()=>f.list(owner),/Forbidden/);
  } finally {await f.close();}
});
