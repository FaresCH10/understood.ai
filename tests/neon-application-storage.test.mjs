import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {mkdtemp,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {rehearseNeonApplicationStorage} from '../evaluation/neon-storage-rehearsal.mjs';
import {runPrivateStorageApplicationRehearsal} from '../evaluation/rehearsal.mjs';
import {runNeonApplicationStorage} from '../scripts/neon-application-storage.mjs';
import {encodeWav} from '../src/audio.ts';
import {inspectWav} from '../server/audio.mjs';

const P='UNDERSTOOD_NEON_STORAGE_TEST_',env=Object.fromEntries(Object.entries({ISOLATED:'true',BUCKET:'understood-synthetic-test',
  ENDPOINT:'https://br-synthetic-fixture.storage.c-1.eu-central-1.aws.neon.tech',REGION:'eu-central-1',ACCESS_KEY_ID:'PRIVATE_TEST_ACCESS',SECRET_ACCESS_KEY:'PRIVATE_TEST_SECRET'}).map(([key,value])=>[P+key,value]));
const httpError=status=>Object.assign(Error('PRIVATE_TEST_SECRET'),{$metadata:{httpStatusCode:status}});
function fixture({nonempty=false,anonymousStatus=403,losePutAck=false,loseDeleteAck=false,foreignMetadata=false,corrupt=false,conditionalStatus=412,deleteFails=false,postCleanupForeign=false}={}){
  const objects=new Map(),commands=[],anonymous=[],clientOptions=[];let destroyed=0;
  const dependencies={confirmed:true,makeClient(options){clientOptions.push(options);return {
    async send(command,request){
      commands.push({kind:command.constructor.name,input:{...command.input}});assert.ok(request.abortSignal instanceof AbortSignal);request.abortSignal.throwIfAborted();
      const {Key,Body,Metadata}=command.input,kind=command.constructor.name;assert.equal(command.input.Bucket,'understood-synthetic-test');
      if(kind==='ListObjectsV2Command')return {KeyCount:nonempty||objects.size||postCleanupForeign&&commands.some(row=>row.kind==='DeleteObjectCommand')?1:0,IsTruncated:false};
      assert.match(Key,/^audio\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.(wav|source-original)$/);
      if(kind==='PutObjectCommand'){
        assert.equal(command.input.IfNoneMatch,'*');assert.equal(command.input.ACL,undefined);assert.equal(command.input.CacheControl,'private, no-store');
        if(objects.has(Key)){if(conditionalStatus!==200)throw httpError(conditionalStatus);return {};}
        assert.equal(inspectWav(Body).bytes,32044);objects.set(Key,{bytes:Buffer.from(Body),metadata:{...Metadata}});
        if(losePutAck&&commands.filter(row=>row.kind==='PutObjectCommand').length===1)throw httpError(undefined);return {};
      }
      if(kind==='DeleteObjectCommand'){if(deleteFails)throw httpError(503);objects.delete(Key);if(loseDeleteAck)throw httpError(undefined);return {};}
      const object=objects.get(Key);if(!object)throw httpError(404);
      const metadata=foreignMetadata?{sha256:object.metadata.sha256}:object.metadata;
      if(kind==='HeadObjectCommand')return {Metadata:metadata,ContentLength:object.bytes.length};
      if(kind==='GetObjectCommand'){const bytes=Buffer.from(object.bytes);if(corrupt)bytes[bytes.length-1]^=255;return {Metadata:metadata,ContentLength:bytes.length,Body:Readable.from([bytes])};}
      throw Error('Unexpected fixture command');
    },destroy(){destroyed++;},
  };},async readAnonymous(url,signal){signal.throwIfAborted();anonymous.push(url);return anonymousStatus;}};
  return {dependencies,objects,commands,anonymous,clientOptions,get destroyed(){return destroyed;}};
}

test('six-family cloud runner requires exact authorization, isolated settings and UUID before creating a client',async()=>{
  let clients=0;const makeClient=()=>{clients++;throw Error('No client expected');};
  await assert.rejects(rehearseNeonApplicationStorage(env,{makeClient}),/authorization/);
  for(const patch of [{[P+'ISOLATED']:'false'},{[P+'BUCKET']:'real-audio'},{[P+'SECRET_ACCESS_KEY']:''},{[P+'ENDPOINT']:'https://foreign.invalid'}])
    await assert.rejects(rehearseNeonApplicationStorage({...env,...patch},{confirmed:true,makeClient}),/configuration/);
  await assert.rejects(rehearseNeonApplicationStorage(env,{confirmed:true,runId:'../escape',makeClient}),/identity/);
  assert.equal(clients,0);await assert.rejects(runPrivateStorageApplicationRehearsal({}),/Complete private/);
});

test('actual six-family application workflow uses the real Neon adapter, normal receipts/playback and ownership-scoped branch cleanup; mocked S3 is not live proof',async()=>{
  const f=fixture(),checkpoints=[],result=await rehearseNeonApplicationStorage(env,{...f.dependencies,checkpoint:async value=>checkpoints.push(structuredClone(value))});
  assert.equal(checkpoints[0].state,'checking');
  assert.equal(result.state,'passed',JSON.stringify(result));assert.equal(result.cleanup,'owned-objects-absent-from-current-branch');assert.equal(result.objects.length,9);
  assert.equal(result.workflow.checks.length,11);assert.equal(result.workflow.privateStorage.objects,9);assert.equal(result.applicationCloudStorageVerified,true);assert.equal(result.bucketEmptyAfterCleanup,true);
  assert.deepEqual(result.workflow.privateStorage.families,{'case-followup':1,'case-voice':1,generated:4,recording:1,source:1,'source-original':1});
  for(const row of result.objects){assert.equal(row.putAttempted,true);assert.equal(row.writeAcknowledged,true);assert.equal(row.anonymousReadDenied,true);assert.equal(row.conditionalOverwriteRejected,true);assert.equal(row.originalBytesPreserved,true);assert.equal(row.cleanup,'removed-from-current-branch');}
  assert.equal(f.objects.size,0);assert.equal(f.anonymous.length,9);assert.equal(f.destroyed,1);
  assert.equal(f.commands.filter(row=>row.kind==='PutObjectCommand').length,18);assert.equal(f.commands.filter(row=>row.kind==='DeleteObjectCommand').length,9);
  assert.equal(new Set(result.objects.map(row=>row.key.split('/').slice(0,3).join('/'))).size,1);
  assert.ok(checkpoints.some(value=>value.objects.length===1&&value.objects[0].putAttempted&&!value.objects[0].writeAcknowledged));
  assert.equal(result.workflow.providerEvidence.externalRequests,0);assert.equal(result.cloudDatabaseWrites,0);assert.equal(result.aiProviderCalls,0);assert.equal(result.mailCalls,0);
  for(const field of ['realDataUsed','nativePostgresVerified','runningApplicationStorageChanged','irreversibleErasureVerified','productionReady'])assert.equal(result[field],false);
  assert.equal(f.clientOptions[0].forcePathStyle,true);assert.equal(f.clientOptions[0].maxAttempts,1);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_TEST|neon\.tech|br-synthetic|understood_session|token_hash|pipeline-owner@/);
});

test('the runner refuses a populated bucket with zero object writes or deletes',async()=>{
  const f=fixture({nonempty:true}),result=await rehearseNeonApplicationStorage(env,f.dependencies);
  assert.equal(result.state,'failed');assert.equal(result.failedPhase,'empty-bucket');assert.equal(result.cleanup,'not-needed');assert.equal(f.commands.length,1);assert.equal(f.destroyed,1);
});

test('a lost private source PUT acknowledgement is reconciled by normal application readback, not another upload',async()=>{
  const f=fixture({losePutAck:true}),result=await rehearseNeonApplicationStorage(env,f.dependencies);
  assert.equal(result.state,'passed',JSON.stringify(result));assert.equal(result.cleanup,'owned-objects-absent-from-current-branch');assert.equal(f.objects.size,0);
  assert.equal(result.objects.length,9);assert.equal(result.objects.filter(row=>row.writeAcknowledged===false).length,1);
  assert.ok(result.objects.every(row=>['removed-from-current-branch','absent'].includes(row.cleanup)));
  for(const row of result.objects)assert.ok(f.commands.filter(command=>command.kind==='PutObjectCommand'&&command.input.Key===row.key).length<=2);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_TEST/);
});

test('anonymous access or non-412 conditional denial fails acceptance but still cleans only owned objects',async()=>{
  for(const mode of [{anonymousStatus:200},{conditionalStatus:403},{conditionalStatus:200}]){
    const f=fixture(mode),result=await rehearseNeonApplicationStorage(env,f.dependencies);
    assert.equal(result.state,'failed');assert.equal(result.failedPhase,'application-object-verification');assert.equal(result.cleanup,'owned-objects-absent-from-current-branch');assert.equal(f.objects.size,0);
    assert.doesNotMatch(JSON.stringify(result),/PRIVATE_TEST/);
  }
});

test('changed ownership or corrupt bytes refuse deletion rather than erasing unverified content',async()=>{
  for(const mode of [{foreignMetadata:true},{corrupt:true}]){
    const f=fixture(mode),result=await rehearseNeonApplicationStorage(env,f.dependencies);
    assert.equal(result.state,'failed');assert.equal(result.cleanup,'unverified');assert.ok(result.objects.length>0);assert.ok(f.objects.size>0);
    assert.equal(f.commands.some(row=>row.kind==='DeleteObjectCommand'),false);assert.ok(result.objects.every(row=>row.cleanup==='refused-or-unverified'));
    assert.equal(f.destroyed,1);
  }
});

test('lost delete acknowledgement requires definite absence; failed delete and unrelated new objects never trigger broad cleanup',async()=>{
  for(const mode of [{loseDeleteAck:true},{deleteFails:true},{postCleanupForeign:true}]){
    const f=fixture(mode),result=await rehearseNeonApplicationStorage(env,f.dependencies);
    assert.equal(result.state,mode.loseDeleteAck?'passed':'failed');
    assert.equal(f.commands.filter(row=>row.kind==='DeleteObjectCommand').length,9);
    if(mode.deleteFails){assert.equal(result.cleanup,'unverified');assert.equal(f.objects.size,9);}else{assert.equal(result.cleanup,'owned-objects-absent-from-current-branch');assert.equal(f.objects.size,0);}
    if(mode.postCleanupForeign)assert.equal(result.failedPhase,'post-cleanup-inventory');
  }
});

test('interruption and checkpoint failure after the first write still attempt guarded cleanup without another provider or database',async()=>{
  for(const fault of ['interrupt','checkpoint']){
    const f=fixture(),controller=new AbortController();let triggered=false;
    const result=await rehearseNeonApplicationStorage(env,{...f.dependencies,signal:controller.signal,checkpoint:async value=>{
      if(!triggered&&value.objects.some(row=>row.writeAcknowledged)){triggered=true;if(fault==='interrupt')controller.abort();else throw Error('PRIVATE_TEST_SECRET disk fault');}
    }});
    assert.equal(triggered,true);assert.equal(result.state,'failed');assert.equal(result.cleanup,'owned-objects-absent-from-current-branch');assert.equal(f.objects.size,0);assert.equal(f.destroyed,1);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_TEST/);
  }
});

test('an injected workflow cannot write arbitrary bytes, exceed the object budget or cross an application scope',async()=>{
  const bytes=Buffer.from(encodeWav({duration:1,sampleRate:16000,numberOfChannels:1,getChannelData:()=>Float32Array.from({length:16000},(_,i)=>Math.sin(i/10)*.2)}));
  for(const mode of ['bytes','budget','scope']){
    const f=fixture(),scope={org_id:randomUUID(),site_id:randomUUID()};
    const result=await rehearseNeonApplicationStorage(env,{...f.dependencies,rehearse:async storage=>{
      for(let index=0;index<10;index++){
        const body=Buffer.from(bytes);if(mode==='bytes')body[44]^=255;
        await storage.save({...scope,...(mode==='scope'&&index===1?{site_id:randomUUID()}:{}),id:randomUUID(),...inspectWav(body)},body);
      }
      assert.fail('The guard must stop injected fixture content');
    }});
    assert.equal(result.state,'failed');assert.ok(result.objects.length<=9);assert.equal(f.objects.size,0);
    if(mode==='bytes')assert.equal(f.commands.some(row=>row.kind==='PutObjectCommand'),false);
    if(mode==='scope')assert.equal(result.objects.length,1);
    if(mode==='budget')assert.equal(result.objects.length,9);
  }
});

test('application storage CLI is explicit, reads only dedicated local settings and journals redacted scope before dispatch',async()=>{
  const root=await mkdtemp(join(tmpdir(),'understood-neon-application-'));
  try{
    for(const args of [[],['--confirm-synthetic-private-bucket'],['--confirm-six-family-synthetic-storage','extra']])await assert.rejects(runNeonApplicationStorage(root,args),/authorization/);
    assert.deepEqual(await readdir(root),[]);
    await writeFile(join(root,'.env.neon-storage-test'),Object.entries(env).map(([key,value])=>`${key}="${value}"`).join('\n'));
    const result=await runNeonApplicationStorage(root,['--confirm-six-family-synthetic-storage'],{rehearse:async(value,options)=>{
      assert.deepEqual(value,env);assert.equal(options.confirmed,true);assert.equal((await readdir(join(root,'artifacts'))).length,1);
      await options.checkpoint({state:'passed',cleanup:'owned-objects-absent-from-current-branch',productionReady:false});return {state:'passed',cleanup:'owned-objects-absent-from-current-branch'};
    }});
    assert.equal(result.passed,true);assert.doesNotMatch(await readFile(result.path,'utf8'),/PRIVATE_TEST|neon\.tech/);
  }finally{await rm(root,{recursive:true,force:true});}
});
