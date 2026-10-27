import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {S3Client,HeadObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {neonStorageTestConfig,neonStorageClientOptions} from '../server/neon-storage-test.mjs';
import {hostedPrivateAudioStore} from '../server/private-storage.mjs';
import {PIPELINE_AUDIO_HASHES,runPrivateStorageApplicationRehearsal} from './rehearsal.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const uuid='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const keyPattern=new RegExp(`^audio/(${uuid})/(${uuid})/(${uuid})\\.(wav|source-original)$`);
const families={'case-followup':1,'case-voice':1,generated:4,recording:1,source:1,'source-original':1};
const keyFor=row=>`audio/${row.org_id}/${row.site_id}/${row.id}.${row.format==='original'?'source-original':'wav'}`;
const missing=error=>error?.$metadata?.httpStatusCode===404;
async function anonymousRead(url,signal){
  const response=await fetch(url,{method:'GET',redirect:'manual',credentials:'omit',cache:'no-store',signal});
  await response.body?.cancel();return response.status;
}

// Only fixed generated tones go through normal application writes. Database and
// provider transports stay embedded/scripted; the running app is never switched.
export async function rehearseNeonApplicationStorage(env,{confirmed=false,runId=randomUUID(),signal,
  makeClient=options=>new S3Client(options),readAnonymous=anonymousRead,
  rehearse=runPrivateStorageApplicationRehearsal,checkpoint=async()=>{}}={}){
  if(confirmed!==true)throw Error('Explicit synthetic application storage authorization is required');
  const config=neonStorageTestConfig(env);
  if(!new RegExp(`^${uuid}$`).test(runId))throw Error('Invalid application storage run identity');
  const result={kind:'neon-six-family-application-storage-rehearsal',runId,state:'checking',phase:'empty-bucket',
    targetFingerprint:hash(`${config.endpoint}\n${config.bucket}`),objects:[],cleanup:'not-needed',
    cloudDatabaseWrites:0,aiProviderCalls:0,mailCalls:0,realDataUsed:false,
    runningApplicationStorageChanged:false,nativePostgresVerified:false,
    irreversibleErasureVerified:false,productionReady:false};
  const ledger=new Map(),main=AbortSignal.timeout(180000),client=makeClient(neonStorageClientOptions(config));
  let cleanupMode=false,cleanupBudget,scope,conditionalKey,conditionalStatus;
  const save=async()=>{
    result.objects=[...ledger.values()].map(row=>({...row}));
    try{await checkpoint({...result,objects:result.objects.map(row=>({...row}))});}
    catch{result.checkpointUnavailable=true;throw Error('Synthetic storage journal unavailable');}
  };
  const send=async command=>{
    const signals=[AbortSignal.timeout(10000),cleanupMode?cleanupBudget:main];
    if(!cleanupMode&&signal)signals.push(signal);
    if(!cleanupMode&&result.checkpointUnavailable)throw Error('Synthetic storage journal unavailable');
    const abortSignal=AbortSignal.any(signals);abortSignal.throwIfAborted();
    return client.send(command,{abortSignal});
  };
  const owned=(response,row)=>response?.Metadata?.['understood-test-run']===runId
    && response.Metadata.sha256===row.sha256&&response.ContentLength===row.bytes;
  const scopedClient={async send(command){
    const input=command.input,kind=command.constructor.name;
    if(input.Bucket!==config.bucket)throw Error('Synthetic storage scope mismatch');
    if(kind==='ListObjectsV2Command'){
      if(input.MaxKeys!==1||input.Prefix!==undefined||!['empty-bucket','finished'].includes(result.phase))throw Error('Unexpected storage inventory');
      return send(command);
    }
    const match=keyPattern.exec(input.Key??'');if(!match)throw Error('Unexpected application object key');
    if(scope&&scope!==`${match[1]}/${match[2]}`)throw Error('Synthetic application scope changed');
    let row=ledger.get(input.Key);
    if(kind==='PutObjectCommand'){
      if(!Buffer.isBuffer(input.Body)||input.Body.length!==32044||!PIPELINE_AUDIO_HASHES.includes(hash(input.Body))
        ||input.Metadata?.sha256!==hash(input.Body)||input.IfNoneMatch!=='*'||input.ACL!==undefined
        ||input.CacheControl!=='private, no-store')throw Error('Only fixed synthetic application audio may be written');
      if(!row){
        if(cleanupMode||ledger.size>=9||conditionalKey)throw Error('Synthetic object budget exceeded');
        try{await send(new HeadObjectCommand({Bucket:config.bucket,Key:input.Key}));throw Error('Synthetic object already exists');}
        catch(error){if(!missing(error))throw error;}
        scope=`${match[1]}/${match[2]}`;
        row={key:input.Key,sha256:hash(input.Body),bytes:input.Body.length,putAttempted:true,writeAcknowledged:false,cleanup:'pending'};
        ledger.set(input.Key,row);await save();
      }else if(conditionalKey!==input.Key||row.sha256!==hash(input.Body))throw Error('Unexpected repeated application write');
      input.Metadata={...input.Metadata,'understood-test-run':runId};
      try{
        const response=await send(command);row.writeAcknowledged=true;
        if(conditionalKey===input.Key)conditionalStatus=200;
        await save();return response;
      }catch(error){if(conditionalKey===input.Key)conditionalStatus=error?.$metadata?.httpStatusCode;throw error;}
    }
    if(!row||!['GetObjectCommand','HeadObjectCommand'].includes(kind))throw Error('Unexpected application storage operation');
    const response=await send(command);
    if(!owned(response,row)){response.Body?.destroy?.();throw Error('Synthetic object ownership or integrity changed');}
    return response;
  }};
  const storage=hostedPrivateAudioStore({storageAdapter:'neon',storageConfig:config},{client:scopedClient});
  try{
    await save();if(signal?.aborted)throw Error('Synthetic storage test interrupted');
    assert.equal(await storage.isEmpty(),true,'An empty isolated synthetic bucket is required');
    result.phase='application-workflow';await save();
    result.workflow=await rehearse(storage,{
      onStage:async stage=>{if(signal?.aborted||main.aborted)throw Error('Synthetic storage test interrupted');result.phase=stage;await save();},
      onInventory:async objects=>{
        result.phase='application-object-verification';await save();
        assert.equal(objects.length,9);assert.equal(ledger.size,9);assert.ok(objects.every(row=>row.retained));
        assert.deepEqual(objects.reduce((counts,row)=>({...counts,[row.family]:(counts[row.family]??0)+1}),{}),families);
        assert.deepEqual(objects.map(keyFor).sort(),[...ledger.keys()].sort());
        for(const reference of objects){
          const key=keyFor(reference),row=ledger.get(key);assert.equal(row.sha256,reference.sha256);assert.equal(row.bytes,reference.bytes);
          const original=reference.format==='original',bytes=await storage[original?'readOriginal':'read'](reference);
          assert.equal(hash(bytes),reference.sha256);assert.equal(bytes.length,reference.bytes);
          assert.ok([401,403].includes(await readAnonymous(`${config.endpoint}/${encodeURIComponent(config.bucket)}/${key}`,
            AbortSignal.any([main,AbortSignal.timeout(10000),...(signal?[signal]:[])]))));
          row.family=reference.family;row.authenticatedReadVerified=true;row.anonymousReadDenied=true;
          conditionalKey=key;conditionalStatus=undefined;
          try{await assert.rejects(storage[original?'saveOriginal':'save'](reference,bytes));assert.equal(conditionalStatus,412);}
          finally{conditionalKey=undefined;}
          assert.equal(hash(await storage[original?'readOriginal':'read'](reference)),reference.sha256);
          row.conditionalOverwriteRejected=true;row.originalBytesPreserved=true;await save();
        }
      },
    });
    assert.equal(result.workflow.checks.length,11);assert.ok(result.workflow.checks.every(row=>row.status==='passed'));
    assert.equal(result.workflow.providerEvidence.externalRequests,0);assert.equal(ledger.size,9);assert.equal(result.checkpointUnavailable,undefined);
    assert.ok([...ledger.values()].every(row=>row.authenticatedReadVerified&&row.anonymousReadDenied&&row.conditionalOverwriteRejected&&row.originalBytesPreserved));
    result.applicationCloudStorageVerified=true;result.state='passed';
  }catch{
    result.state='failed';result.failedPhase=result.phase;
  }finally{
    cleanupMode=true;cleanupBudget=AbortSignal.timeout(120000);result.cleanup=ledger.size?'unverified':'not-needed';
    for(const row of ledger.values()){
      try{
        let head;
        try{head=await send(new HeadObjectCommand({Bucket:config.bucket,Key:row.key}));}
        catch(error){if(!missing(error))throw error;row.cleanup='absent';}
        if(head){
          if(!owned(head,row))throw Error('Cleanup ownership unavailable');
          // Re-read exact bytes through the real adapter before deleting an owned key.
          const match=keyPattern.exec(row.key),reference={id:match[3],org_id:match[1],site_id:match[2],sha256:row.sha256,bytes:row.bytes};
          await storage[match[4]==='source-original'?'readOriginal':'read'](reference);
          try{await send(new DeleteObjectCommand({Bucket:config.bucket,Key:row.key}));}
          catch{/* Lost acknowledgements require a definite scoped absence, never a broad retry. */}
          try{await send(new HeadObjectCommand({Bucket:config.bucket,Key:row.key}));throw Error('Owned object still present');}
          catch(error){if(!missing(error))throw error;}
          row.cleanup='removed-from-current-branch';
        }
      }catch{row.cleanup='refused-or-unverified';result.state='failed';}
      try{await save();}catch{result.state='failed';result.checkpointUnavailable=true;}
    }
    if(ledger.size&&[...ledger.values()].every(row=>['absent','removed-from-current-branch'].includes(row.cleanup)))result.cleanup='owned-objects-absent-from-current-branch';
    if(result.state==='passed'){
      result.phase='finished';
      try{assert.equal(await storage.isEmpty(),true);result.bucketEmptyAfterCleanup=true;}
      catch{result.state='failed';result.failedPhase='post-cleanup-inventory';}
    }
    try{client.destroy?.();}catch{result.state='failed';}
    await save();
  }
  return result;
}
