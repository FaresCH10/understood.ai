import {randomUUID} from 'node:crypto';
import {openDatabase} from '../../server/db.mjs';
import {sqliteApp,openPrincipalSession,TEST_PASSWORD} from './sqlite-app.mjs';
import {provisionStaffCredential} from '../../server/auth.mjs';
import {createSessionContextFetch} from './session-http.mjs';

export async function improvementFixture(postgres) {
  const fetch=createSessionContextFetch(),schema='understood_test_improvements',options={schema,integrationMode:'synthetic'};
  let db,pool,server,owner,process,answer,publishDraft,removeWorker,query,failAudit;
  if(postgres){
    const {PGlite}=await import('@electric-sql/pglite');db=new PGlite();
    query=async(sql,values=[])=>{let n=0;const text=sql.replaceAll('?',()=>`$${++n}`);return (values.length?await db.query(text,values):(await db.exec(text)).at(-1)||{rows:[]}).rows;};
    pool={async connect(){return {async query(sql,values){return values?.length?db.query(sql,values):(await db.exec(sql)).at(-1)||{rows:[]};},release(){}};}};
    await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);
    await (await import('../../server/postgres/migrate.mjs')).runMigrations(pool,{schema});
    await db.exec(`INSERT INTO organizations VALUES('a','Synthetic'),('b','Other');INSERT INTO sites VALUES('a','a','Site','UTC'),('b','b','Other','UTC');
      INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','a','a','Owner','owner'),('auditor','a','a','Auditor','auditor'),('foreign','b','b','Other','owner');
      INSERT INTO workers(id,org_id,site_id,code,language) VALUES('w1','a','a','001','en'),('w2','a','a','002','en'),('w3','a','a','003','en');`);
    owner={principal_type:'staff',principal_id:'owner',org_id:'a',site_id:'a',role:'owner'};
    const auth=await import('../../server/postgres/auth.mjs');
    for(const [id,org] of [['owner','a'],['auditor','a'],['foreign','b']])await auth.provisionStaffCredential(pool,{staffId:id,orgId:org,siteId:org,email:`${id}@improvement.test`,password:TEST_PASSWORD},{schema});
    server=(await import('../../server/postgres/http.mjs')).createPostgresRehearsalServer(pool,{schema,dataClass:'synthetic',tier:'local',aiMode:'synthetic',accessMode:'credential',publicOrigin:'http://127.0.0.1:3020'});
    process=()=>(import('../../server/postgres/self-healing.mjs')).then(m=>m.processOneInstructionImprovement(pool,options));
    answer=async(row,correct)=>{
      const briefing=await (await import('../../server/postgres/read-models.mjs')).workerBriefing(pool,{principal_type:'worker',principal_id:row.worker_id,org_id:'a',site_id:'a'},row.id,options);
      const pub=(await query('SELECT p.snapshot_json FROM publications p JOIN assignments a ON a.publication_id=p.id WHERE a.id=?',[row.id]))[0].snapshot_json;
      const id=briefing.content.choices.find(choice=>correct?choice.id===pub.rubric.correctChoiceId:choice.id!==pub.rubric.correctChoiceId).id;
      const received=await (await import('../../server/postgres/domain.mjs')).submitAnswer(pool,{principal_type:'worker',principal_id:row.worker_id,org_id:'a',site_id:'a'},row.id,randomUUID(),id,options);
      await (await import('../../server/postgres/assessment-worker.mjs')).processOneAssessment(pool,{async assess(){throw Error('Choice checks must use the local deterministic assessor');}},options);
      return received;
    };
    publishDraft=async(id,workerIds)=>{
      const prep=await import('../../server/postgres/preparation.mjs');await prep.queuePreparation(pool,owner,id,1,options);await prep.processOnePreparation(pool,options);
      return (await import('../../server/postgres/domain.mjs')).publish(pool,owner,id,{requestId:randomUUID(),revision:1,nextVersion:1,workerIds},options);
    };
    removeWorker=async(id)=>{
      const row=(await query('SELECT code FROM workers WHERE id=?',[id]))[0];
      await (await import('../../server/postgres/deletions.mjs')).requestWorkerDeletion(pool,owner,id,{requestId:randomUUID(),expectedCode:row.code,reason:'worker_request',confirmed:true},options);
      await (await import('../../server/postgres/deletion-redactions.mjs')).processOneDeletionRedaction(pool,options);
    };
    failAudit=async(on)=>{await db.exec(on?`CREATE FUNCTION reject_improvement_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='instruction.improvement_drafted' THEN RAISE EXCEPTION 'Injected failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_improvement_test BEFORE INSERT ON audit FOR EACH ROW EXECUTE FUNCTION reject_improvement_test();`:'DROP TRIGGER reject_improvement_test ON audit;DROP FUNCTION reject_improvement_test();');};
  }else{
    db=openDatabase(':memory:');server=sqliteApp(db);
    db.exec("INSERT INTO staff(id,org_id,site_id,name,role) VALUES('improvement-auditor','cedar','beirut','Auditor','auditor')");
    provisionStaffCredential(db,'improvement-auditor','auditor@improvement.test',TEST_PASSWORD);
    owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
    query=async(sql,values=[])=>/^\s*(SELECT|WITH)/i.test(sql)?db.prepare(sql).all(...values):(db.prepare(sql).run(...values),[]);
    process=()=>(import('../../server/self-healing.mjs')).then(m=>m.processOneInstructionImprovement(db));
    answer=async(row,correct)=>{
      const snapshot=JSON.parse(db.prepare('SELECT p.snapshot_json FROM publications p JOIN assignments a ON a.publication_id=p.id WHERE a.id=?').get(row.id).snapshot_json);
      const id=snapshot.languages.en.choices.find(choice=>correct?choice.id===snapshot.rubric.correctChoiceId:choice.id!==snapshot.rubric.correctChoiceId).id;
      return (await import('../../server/domain.mjs')).submitAnswer(db,{principal_type:'worker',principal_id:row.worker_id,org_id:'cedar',site_id:'beirut'},row.id,randomUUID(),id);
    };
    publishDraft=async(id,workerIds)=>{
      (await import('../../server/preparation.mjs')).queuePreparation(db,owner,id,1);
      (await import('../../server/worker.mjs')).processOne(db);
      return (await import('../../server/domain.mjs')).publish(db,owner,id,{requestId:randomUUID(),revision:1,nextVersion:1,workerIds});
    };
    removeWorker=async(id)=>{
      const row=db.prepare('SELECT code FROM workers WHERE id=?').get(id);
      (await import('../../server/deletions.mjs')).requestWorkerDeletion(db,owner,id,{requestId:randomUUID(),expectedCode:row.code,reason:'worker_request',confirmed:true});
      (await import('../../server/deletion-redactions.mjs')).processOneDeletionRedaction(db);
    };
    failAudit=async(on)=>db.exec(on?"CREATE TRIGGER reject_improvement_test BEFORE INSERT ON audit WHEN NEW.action='instruction.improvement_drafted' BEGIN SELECT RAISE(ABORT,'Injected failure');END;":'DROP TRIGGER reject_improvement_test');
  }
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api`,cookies={};
  for(const role of ['owner','auditor','foreign','worker']){
    if(postgres){
      let response;
      if(role==='worker'){
        const grant=await (await import('../../server/postgres/auth.mjs')).issueWorkerGrant(pool,owner,'w1',30,options);
        response=await fetch(base+'/auth/worker/redeem',{method:'POST',body:JSON.stringify({token:grant.token}),headers:{'content-type':'application/json'}});
      }else response=await fetch(base+'/auth/staff/login',{method:'POST',body:JSON.stringify({email:`${role}@improvement.test`,password:TEST_PASSWORD}),headers:{'content-type':'application/json'}});
      cookies[role]=response.headers.get('set-cookie').split(';')[0];
    }else{
      const id={owner:'maya',auditor:'improvement-auditor',foreign:'harbor-owner',worker:'worker-1'}[role],table=role==='worker'?'workers':'staff';
      cookies[role]=`understood_session=${openPrincipalSession(db,db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id)).token}`;
    }
  }
  const call=(role,path,body,context)=>fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(role?{cookie:cookies[role]}:{}),...(body===undefined?{}:{'content-type':'application/json'}),...(context?{'x-client-session-context':context}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const send=async()=>{const r=await call('owner','/instructions/send',{requestId:randomUUID(),title:'Gate instruction',source:'Close the north gate before the night shift. Keep the walkway clear.',responseMode:'question',deliveryMode:'text',audience:{type:'all'}});if(r.status!==201)throw Error(await r.text());return r.json();};
  return {org:owner.org_id,site:owner.site_id,query,call,send,process,answer,publishDraft,removeWorker,failAudit,
    async close(){await new Promise(resolve=>server.close(resolve));await db.close();}};
}
