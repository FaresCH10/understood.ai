import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import * as localPeople from '../server/people.mjs';
import * as pgPeople from '../server/postgres/people.mjs';
import {instructionAudienceOverview as localAudience} from '../server/instructions.mjs';
import {instructionAudienceOverview as pgAudience} from '../server/postgres/instructions.mjs';
import {createDraft,queuePreparation} from '../server/preparation.mjs';
import {processOne} from '../server/worker.mjs';
import {publish,CANONICAL_SOURCE} from '../server/domain.mjs';
import {createPresentation} from '../server/presentations.mjs';
import {backupLocal} from '../scripts/local-backup.mjs';
import {importSqliteBackup} from '../server/postgres/import-sqlite.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {createAppServer} from '../server/index.mjs';
const localConfig={tier:'local',aiMode:'synthetic',accessMode:'demo',publicOrigin:'http://127.0.0.1:3030'};
const poolFor=db=>({async connect(){return {query:async(sql,args)=>args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)??{rows:[]},release(){}};}});
for(const postgres of [false,true])test(`${postgres?'PostgreSQL':'SQLite'} crew language totals exclude inactive and other-crew workers and retain pending selections`,async()=>{
  const db=postgres?new PGlite():openDatabase(':memory:'),pool=postgres?poolFor(db):db;
  try{
    if(postgres){await runMigrations(pool);await db.exec("INSERT INTO organizations VALUES('o','Org');INSERT INTO sites VALUES('s','o','Site','UTC');INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','o','s','Owner','owner')");}
    else {createAppServer(db,localConfig);db.exec("INSERT INTO organizations VALUES('o','Org');INSERT INTO sites VALUES('s','o','Site','UTC');INSERT INTO staff VALUES('owner','o','s','Owner','owner',1)");}
    const owner={principal_type:'staff',principal_id:'owner',org_id:'o',site_id:'s',role:'owner'},people=postgres?pgPeople:localPeople;
    const en=await people.createWorker(pool,owner,{code:'EN',language:'en'}),ar=await people.createWorker(pool,owner,{code:'AR',language:'ar'}),hi=await people.createWorker(pool,owner,{code:'HI',language:'hi'}),pending=await people.createWorker(pool,owner,{code:'PENDING'});
    const first=await people.createCrew(pool,owner,{name:'Arabic crew'}),second=await people.createCrew(pool,owner,{name:'Other crew'});
    await people.moveWorkerToCrew(pool,owner,ar.id,first.id);await people.moveWorkerToCrew(pool,owner,hi.id,second.id);await people.moveWorkerToCrew(pool,owner,pending.id,second.id);
    await people.disableWorker(pool,owner,hi.id);
    const audience=await (postgres?pgAudience:localAudience)(pool,owner),crew=audience.crews.find(row=>row.id===first.id),other=audience.crews.find(row=>row.id===second.id);
    assert.deepEqual(crew.byLanguage,{ar:1});assert.equal(crew.members,1);assert.equal(crew.notSelected,0);
    assert.deepEqual(other.byLanguage,{});assert.equal(other.members,0);assert.equal(other.notSelected,1);
    assert.equal(audience.workers.byLanguage.en,1);assert.equal(audience.workers.notSelected,1);assert.ok(en.id);
  }finally{await db.close();}
});
test('SQLite backup cutover preserves translated MCQ option text and IDs through exact PostgreSQL replay',async t=>{
  const parent=resolve(tmpdir()),root=await mkdtemp(join(parent,'understood-main-fixes-'));assert.ok(root.startsWith(join(parent,'understood-main-fixes-')));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const database=join(root,'source.sqlite'),audioRoot=join(root,'audio'),destination=join(root,'backup');await mkdir(audioRoot);
  const db=openDatabase(database);seed(db);createAppServer(db,localConfig);
  const owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'},worker={principal_type:'worker',principal_id:'worker-30',org_id:'cedar',site_id:'beirut'};
  let artifact,choices,hindiAssignment;
  try{
    const draft=createDraft(db,owner,{requestId:randomUUID(),title:'Translated choices',source:CANONICAL_SOURCE});queuePreparation(db,owner,draft.id,1);assert.equal(processOne(db),true);
    const publication=publish(db,owner,draft.id,{requestId:randomUUID(),revision:1,nextVersion:1,workerIds:['worker-30']},{integrationMode:'synthetic'});
    const assignment=db.prepare('SELECT id FROM assignments WHERE publication_id=?').get(publication.id);
    localPeople.updateWorker(db,owner,'worker-30',{language:'ar'});
    const presentation=await createPresentation(db,worker,assignment.id,{requestId:randomUUID(),sourceKind:'instruction'});
    assert.equal(presentation.status,'ready');artifact=presentation.presentation.id;choices=presentation.presentation.content.choices;assert.equal(choices.length,4);
    // Explicit synthetic Hindi fixture: exercise the expanded assignment locale
    // contract through a normal publication, not by mutating frozen history.
    const hiWorker=localPeople.createWorker(db,owner,{code:'HI-CUTOVER',language:'hi'});
    const hiDraft=createDraft(db,owner,{requestId:randomUUID(),title:'Hindi cutover',source:CANONICAL_SOURCE});queuePreparation(db,owner,hiDraft.id,1);assert.equal(processOne(db),true);
    const prepared=JSON.parse(db.prepare('SELECT prepared_json FROM briefings WHERE id=?').get(hiDraft.id).prepared_json);
    const text='तैयार सामान नीले शेल्फ पर रखें। अधूरा सामान पीले शेल्फ पर रखें। रास्ता साफ रखें।';
    prepared.languages.hi={...prepared.languages.en,title:'शेल्फ के रंग',text,question:'तैयार और अधूरा सामान कहाँ रखना है?',choices:prepared.languages.en.choices.map((choice,index)=>({...choice,text:choice.id===prepared.rubric.correctChoiceId?text:`सामान शेल्फ ${index+1} पर रखें।`}))};
    db.prepare('UPDATE briefings SET prepared_json=? WHERE id=?').run(JSON.stringify(prepared),hiDraft.id);
    const hiPublication=publish(db,owner,hiDraft.id,{requestId:randomUUID(),revision:1,nextVersion:1,workerIds:[hiWorker.id]},{integrationMode:'synthetic'});
    hindiAssignment=db.prepare('SELECT id FROM assignments WHERE publication_id=?').get(hiPublication.id).id;
    await backupLocal({database,audioRoot,destination});
  }finally{db.close();}
  const pg=new PGlite(),pool=poolFor(pg),schema='understood_test_main_import';
  try{
    await pg.exec(`CREATE SCHEMA ${schema}`);await runMigrations(pool,{schema});
    const input={source:destination,schema,requestId:randomUUID(),dataClass:'synthetic',dryRun:false};await importSqliteBackup(pool,input);
    assert.deepEqual((await pg.query(`SELECT choices_json FROM ${schema}.presentation_artifacts WHERE id=$1`,[artifact])).rows[0].choices_json,choices);
    assert.equal((await pg.query(`SELECT language FROM ${schema}.assignments WHERE id=$1`,[hindiAssignment])).rows[0].language,'hi');
    assert.equal((await importSqliteBackup(pool,input)).duplicate,true);
  }finally{await pg.close();}
});
