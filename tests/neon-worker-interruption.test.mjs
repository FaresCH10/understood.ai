import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fork} from 'node:child_process';
import {interruptNeonAssessment} from '../server/postgres/neon-worker-interruption.mjs';
import {holdSyntheticAssessment} from '../server/postgres/neon-interrupted-worker.mjs';
import {runNeonRehearsal} from '../scripts/neon-synthetic-rehearsal.mjs';
const env={UNDERSTOOD_NEON_TEST_URL:'postgresql://owner:PRIVATE_PASSWORD@ep-synthetic-worker.eu-central-1.aws.neon.tech/neondb?sslmode=require',UNDERSTOOD_NEON_TEST_ISOLATED:'true',GEMINI_API_KEY:'must-not-inherit'};
const context=()=>{const runId=randomUUID();return {runId,schema:'understood_neon_test_'+runId.replaceAll('-',''),jobId:randomUUID()};};
function fakeWorker(context,mode='claim'){
  const child=new EventEmitter();child.pid=12345;child.kills=[];
  child.kill=signal=>{child.kills.push(signal);queueMicrotask(()=>{child.emit('exit',null,signal);child.emit('close',null,signal);});return true;};
  queueMicrotask(()=>{
    if(mode==='claim')child.emit('message',{type:'claimed',...context,pid:child.pid});
    else if(mode==='failed')child.emit('message',{type:'failed',detail:'PRIVATE_PASSWORD'});
    else {child.emit('exit',1,null);child.emit('close',1,null);}
  });return child;
}
test('worker interruption validates the isolated URL and exact owned run before spawning anything',async()=>{
  let calls=0;const input=context(),options={spawnWorker(){calls++;}};
  for(const change of [{schema:'public'},{runId:'other'},{jobId:'../escape'}])await assert.rejects(interruptNeonAssessment(env,{...input,...change},options));
  await assert.rejects(interruptNeonAssessment({...env,UNDERSTOOD_NEON_TEST_ISOLATED:'false'},input,options));assert.equal(calls,0);
  await assert.rejects(holdSyntheticAssessment({...env,UNDERSTOOD_NEON_WORKER_CHILD_RUN:'other'},{...input,send(){},makePool(){calls++;}}));assert.equal(calls,0);
});
test('interruption orchestration only kills its returned worker handle and waits for close; mock is not a native process proof',async()=>{
  const input=context();let child;
  const result=await interruptNeonAssessment(env,input,{spawnWorker(path,args,options){
    assert.equal(path.pathname.endsWith('/neon-interrupted-worker.mjs'),true);assert.deepEqual(args,[input.runId,input.jobId]);assert.equal(options.windowsHide,true);assert.deepEqual(options.execArgv,[]);
    assert.equal(options.env.GEMINI_API_KEY,undefined);assert.equal(options.env.NODE_OPTIONS,undefined);assert.equal(options.env.UNDERSTOOD_NEON_WORKER_CHILD_RUN,input.runId);
    return child=fakeWorker(input);
  }});
  assert.equal(result.childExited,true);assert.deepEqual(child.kills,['SIGKILL']);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_PASSWORD|postgresql/);
});
test('failed or early-exited owned workers cannot receive a process-interruption pass',async()=>{
  for(const mode of ['failed','exit']){
    const input=context();let child;await assert.rejects(interruptNeonAssessment(env,input,{spawnWorker(){return child=fakeWorker(input,mode);}}),/Synthetic worker/);
    assert.equal(child.kills.length,mode==='failed'?1:0);
  }
});
test('actual isolated child launcher refuses unconfirmed configuration over IPC before any database connection',async()=>{
  const input=context(),messages=[];
  const child=fork(new URL('../server/postgres/neon-interrupted-worker.mjs',import.meta.url),[input.runId,input.jobId],{env:{UNDERSTOOD_NEON_WORKER_CHILD_RUN:input.runId,UNDERSTOOD_NEON_TEST_ISOLATED:'false'},execArgv:[],windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
  child.on('message',message=>messages.push(message));
  let closed=false,timer;
  const exit=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>{closed=true;resolve(code);});});
  try{
    const code=await Promise.race([exit,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Offline child did not exit')),30000);})]);
    assert.equal(code,1);assert.deepEqual(messages,[{type:'failed'}]);
  }finally{clearTimeout(timer);if(!closed){child.kill('SIGKILL');await exit;}}
});
test('Neon CLI roles, concurrency and process interruption are independent explicit admissions',async()=>{
  const root=await mkdtemp(join(tmpdir(),'understood-neon-admission-'));
  try{
    await writeFile(join(root,'.env'),`UNDERSTOOD_NEON_TEST_URL="${env.UNDERSTOOD_NEON_TEST_URL}"\nUNDERSTOOD_NEON_TEST_ISOLATED=true\n`);
    let calls=0;
    for(const args of [[],['--confirm-owned-worker-interruption'],['--confirm-synthetic','--confirm-owned-worker-interruption'],['--confirm-synthetic','--unknown'],['--confirm-synthetic','--confirm-concurrency-extension','--confirm-concurrency-extension']])await assert.rejects(runNeonRehearsal(root,args,{rehearse:async()=>{calls++;}}));
    assert.equal(calls,0);
    for(const args of [['--confirm-synthetic'],['--confirm-synthetic','--confirm-concurrency-extension'],['--confirm-synthetic','--confirm-concurrency-extension','--confirm-owned-worker-interruption'],['--confirm-synthetic','--confirm-temporary-nologin-roles']]){
      const result=await runNeonRehearsal(root,args,{rehearse:async(_env,options)=>{
        calls++;assert.equal(options.temporaryNologinRoles,args.includes('--confirm-temporary-nologin-roles'));assert.equal(options.extendedConcurrency,args.includes('--confirm-concurrency-extension'));assert.equal(typeof options.interruptAssessment,args.includes('--confirm-owned-worker-interruption')?'function':'undefined');return {state:'passed',cleanup:'verified-removed'};
      }});assert.equal(result.passed,true);
    }
    assert.equal(calls,4);
  }finally{await rm(root,{recursive:true,force:true});}
});
