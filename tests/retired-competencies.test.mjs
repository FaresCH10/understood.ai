import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {submitAnswer} from '../server/domain.mjs';
import {instructionModes} from '../server/instruction-schema.mjs';
import {runtimeTablePolicy} from '../server/postgres/runtime-permissions.mjs';
import {createAppServer} from '../server/index.mjs';
import {createSession,provisionStaffCredential} from '../server/auth.mjs';
import {createSessionContextFetch} from './helpers/session-http.mjs';

test('historical certificate configuration cannot enable awards or alter current instruction modes',()=>{
  const db=openDatabase(':memory:');
  try{
    seed(db);
    db.prepare('UPDATE briefings SET competency_validity_days=365 WHERE id=?').run('shelf');
    const publication=db.prepare('SELECT * FROM publications WHERE id=?').get('shelf-v3');
    const snapshot={...JSON.parse(publication.snapshot_json),competency:{title:'Historical certificate',validityDays:365}};
    db.prepare('INSERT INTO publications VALUES(?,?,?,?,?,?,?,?)').run('retired-v4','cedar','beirut','shelf',4,JSON.stringify(snapshot),publication.published_at||new Date().toISOString(),'published');
    db.prepare('INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,due_at,created_at,language) VALUES(?,?,?,?,?,?,?,?)').run('retired-assignment','cedar','beirut','retired-v4','worker-30',null,new Date().toISOString(),'en');
    const result=submitAnswer(db,{principal_type:'worker',principal_id:'worker-30',org_id:'cedar',site_id:'beirut'},'retired-assignment','retired-submission','Finished items go on the blue shelf and unfinished items on the yellow shelf.');
    assert.equal(result.outcome,'matched');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM worker_competencies').get().n,0);
    assert.deepEqual(instructionModes(db,'shelf','cedar','beirut'),{responseMode:'question',deliveryMode:'both',evidenceMode:'none'});
    for(const profile of ['application','worker']){
      const policy=runtimeTablePolicy(profile).find(row=>row.table==='worker_competencies');
      assert.equal(policy.writable,false);assert.equal(policy.insertable,false);
    }
  }finally{db.close();}
});

test('retired competency read and settings endpoints are unavailable',async()=>{
  const db=openDatabase(':memory:');seed(db);
  provisionStaffCredential(db,'maya','retired-feature-test@example.test','Synthetic fixture password only');
  const server=createAppServer(db,{tier:'local',aiMode:'synthetic',accessMode:'credential',dataClass:'synthetic'});
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${server.address().port}`;
    const session=createSession(db,db.prepare('SELECT * FROM staff WHERE id=?').get('maya'),'staff','credential');
    const fetchScoped=createSessionContextFetch();
    for(const path of ['/api/competencies','/api/worker/competencies'])assert.equal((await fetchScoped(base+path,{headers:{cookie:`understood_session=${session.token}`}})).status,404,path);
    assert.equal((await fetchScoped(base+'/api/briefings/shelf/competency',{method:'POST',headers:{cookie:`understood_session=${session.token}`,'content-type':'application/json'},body:JSON.stringify({revision:1,validityDays:365})})).status,404);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
