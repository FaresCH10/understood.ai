import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {assignWorkerPassword,authenticateWorker,workerCredentialStatus} from '../server/worker-credentials.mjs';
import {issueWorkerGrant,requireSession,createSession} from '../server/auth.mjs';
import {tokenHash} from '../server/auth-crypto.mjs';
import {createAppServer} from '../server/index.mjs';
import {startInstructionSend,completeInstructionSend} from '../server/instructions.mjs';
import {processOne} from '../server/worker.mjs';
import {submitAnswer} from '../server/domain.mjs';
const owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
const password='Company-assigned test password';
const options={tier:'local',aiMode:'synthetic',accessMode:'credential',publicOrigin:'http://127.0.0.1:3020'};
function fixture(){const db=openDatabase(':memory:');seed(db);return db;}
const input=(workerId='TEAM-014')=>({company:'cedar',workerId,password});
const assign=(db,worker='worker-14',code='Worker 014',login='TEAM-014')=>assignWorkerPassword(db,owner,worker,{expectedCode:code,workerId:login,password,confirmed:true});

test('company-assigned IDs and hashed passwords enforce tenant authority, uniqueness and resets',()=>{
  const db=fixture();try{
    assert.throws(()=>assignWorkerPassword(db,{...owner,role:'auditor'},'worker-14',{expectedCode:'Worker 014',workerId:'TEAM-014',password,confirmed:true}),/Forbidden/);
    assert.throws(()=>assign(db,'harbor-worker'),/Worker unavailable/);
    assign(db);
    const row=db.prepare("SELECT * FROM worker_credentials WHERE worker_id='worker-14'").get();
    assert.equal(row.state,'active');assert.equal(row.login_id,'TEAM-014');assert.notEqual(row.password_hash,password);
    assert.equal(authenticateWorker(db,input()).workerId,'worker-14');
    assert.throws(()=>authenticateWorker(db,{...input(),password:'Incorrect password'}),/Invalid credentials/);
    assert.throws(()=>assign(db,'worker-15','Worker 015'),/Worker ID already in use/);
    const session=authenticateWorker(db,input()),grant=issueWorkerGrant(db,owner,'worker-14',30);
    assignWorkerPassword(db,owner,'worker-14',{expectedCode:'Worker 014',workerId:'TEAM-014',password:'New company assigned password',confirmed:true});
    assert.ok(db.prepare('SELECT revoked_at FROM sessions WHERE token_hash=?').get(tokenHash(session.token)).revoked_at);
    assert.ok(db.prepare('SELECT revoked_at FROM worker_grants WHERE id=?').get(grant.id).revoked_at);
    assert.throws(()=>authenticateWorker(db,input()),/Invalid credentials/);
    assert.equal(authenticateWorker(db,{...input(),password:'New company assigned password'}).workerId,'worker-14');
    assert.ok(!JSON.stringify(workerCredentialStatus(db,owner,'worker-14')).includes(password));
  }finally{db.close();}
});

test('invitations require the assigned credentials, expire at the boundary, and revoke redeemed sessions',async()=>{
  const db=fixture();assign(db);assign(db,'worker-15','Worker 015','TEAM-015');
  const server=createAppServer(db,options);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const redeem=body=>fetch(`http://127.0.0.1:${server.address().port}/api/auth/worker/redeem`,{method:'POST',headers:{origin:options.publicOrigin,'content-type':'application/json'},body:JSON.stringify(body)});
  try{
    const grant=issueWorkerGrant(db,owner,'worker-14',30);
    assert.ok([400,401].includes((await redeem({token:grant.token})).status));
    assert.equal(db.prepare('SELECT redeemed_at FROM worker_grants WHERE id=?').get(grant.id).redeemed_at,null);
    assert.equal((await redeem({...input('TEAM-015'),token:grant.token})).status,401);
    assert.equal((await redeem({...input(),password:'wrong password',token:grant.token})).status,401);
    const response=await redeem({...input(),token:grant.token});assert.equal(response.status,200);
    const cookie=response.headers.get('set-cookie').split(';')[0];
    assert.equal(requireSession(db,{headers:{cookie}},options).principal_id,'worker-14');
    assert.equal((await redeem({...input(),token:grant.token})).status,401);
    db.prepare('UPDATE worker_grants SET expires_at=? WHERE id=?').run(new Date().toISOString(),grant.id);
    assert.throws(()=>requireSession(db,{headers:{cookie}},options),/Sign in required/);
    const expired=issueWorkerGrant(db,owner,'worker-14',5);
    db.prepare('UPDATE worker_grants SET expires_at=? WHERE id=?').run(new Date().toISOString(),expired.id);
    assert.equal((await redeem({...input(),token:expired.token})).status,401);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});

test('instruction-specific choices reject invented IDs, record correct choices and notify wrong answers',()=>{
  const db=fixture();try{
    const requestId=randomUUID(),source='Move the red ladder to the north bay before the night shift.';
    startInstructionSend(db,owner,{requestId,title:'Night shift ladder',source,audience:{type:'all'},responseMode:'question',deliveryMode:'text'});
    for(let count=0;count<30 && processOne(db);count++){}
    const sent=completeInstructionSend(db,owner,requestId),snapshot=JSON.parse(db.prepare('SELECT snapshot_json FROM publications WHERE id=?').get(sent.publicationId).snapshot_json);
    const choices=snapshot.languages.en.choices;
    assert.match(snapshot.question,/red ladder.*when/);assert.equal(choices.length,4);
    assert.equal(choices.find(choice=>choice.id===snapshot.rubric.correctChoiceId).text,source);
    const assignment=db.prepare('SELECT * FROM assignments WHERE publication_id=? AND worker_id=?').get(sent.publicationId,'worker-1');
    const worker={principal_type:'worker',principal_id:'worker-1',org_id:'cedar',site_id:'beirut'};
    assert.throws(()=>submitAnswer(db,worker,assignment.id,randomUUID(),'invented-choice'),/published choices/);
    const wrong=choices.find(choice=>choice.id!==snapshot.rubric.correctChoiceId);
    assert.equal(submitAnswer(db,worker,assignment.id,randomUUID(),wrong.id).outcome,'clarification');
    assert.equal(db.prepare('SELECT count(*) n FROM clarifications WHERE assignment_id=?').get(assignment.id).n,1);
    assert.equal(db.prepare("SELECT count(*) n FROM audit WHERE action='answer.needs_attention' AND org_id='cedar'").get().n>0,true);
    assert.equal(submitAnswer(db,worker,assignment.id,randomUUID(),snapshot.rubric.correctChoiceId).outcome,'matched');
  }finally{db.close();}
});
