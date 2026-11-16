import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {runMigrations} from '../../server/postgres/migrate.mjs';
import {submitAnswer} from '../../server/postgres/domain.mjs';
import {processOneAssessment} from '../../server/postgres/assessment-worker.mjs';
const worker={principal_type:'worker',principal_id:'worker',org_id:'org',site_id:'site'};
export async function clarificationFixture(){
 const db=new PGlite();let queue=Promise.resolve();
 const pool={async connect(){const previous=queue;let release;queue=new Promise(done=>{release=done;});await previous;return {release,async query(sql,args){return args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)??{rows:[]};}};}};
 await runMigrations(pool);
 const snapshot={title:'Sort items',question:'Where do finished items go?',responseMode:'question',deliveryMode:'text',rubric:{mode:'multiple-choice',correctChoiceId:'blue',askedFacts:['Finished items go on the blue shelf.']},languages:{
  en:{title:'Sort items',text:'Put finished items on the blue shelf.',question:'Where do finished items go?',questionType:'multiple-choice',choices:[{id:'blue',text:'Blue shelf'},{id:'red',text:'Red shelf'},{id:'yellow',text:'Yellow shelf'},{id:'green',text:'Green shelf'}]},
  ar:{title:'ترتيب العناصر',text:'ضع العناصر المكتملة على الرف الأزرق.',question:'أين تضع العناصر المكتملة؟',questionType:'multiple-choice',choices:[{id:'blue',text:'الرف الأزرق'},{id:'red',text:'الرف الأحمر'},{id:'yellow',text:'الرف الأصفر'},{id:'green',text:'الرف الأخضر'}]}}};
 await db.exec(`INSERT INTO organizations VALUES('org','Synthetic');INSERT INTO sites VALUES('site','org','Synthetic','UTC');
 INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','org','site','Supervisor','owner');
 INSERT INTO workers(id,org_id,site_id,code,language) VALUES('worker','org','site','Worker 001','ar'),('other','org','site','Worker 002','ar');
 INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES('instruction','org','site','Sort items','Put finished items on the blue shelf.','draft');`);
 await db.query("INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state) VALUES('published','org','site','instruction',1,$1,'published')",[JSON.stringify(snapshot)]);
 await db.exec("INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES('assignment','org','site','published','worker','ar')");
 await submitAnswer(pool,worker,'assignment',randomUUID(),'red');await processOneAssessment(pool,{async assess(){throw Error("Multiple choice must be assessed deterministically");}});
 const caseId=(await db.query('SELECT id FROM clarifications')).rows[0].id;
 return {db,pool,caseId,snapshot};
}
