import {existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {S3Client,PutObjectCommand,GetObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {createRealtime,rawSql} from '@neon/realtime/server';
import {createPostgresPool} from '../server/postgres/db.mjs';
import {verifyMigrations} from '../server/postgres/migrate.mjs';
import {neonFunctionStatus} from '../server/neon-services.mjs';

if(existsSync('.env'))process.loadEnvFile('.env');
const pool=await createPostgresPool(),id=randomUUID(),table='neon_probe_'+id.replaceAll('-',''),results={};
let realtime,s3,created=false,uploaded=false;
const key=`service-checks/${id}.txt`,bucket=process.env.UNDERSTOOD_NEON_STORAGE_BUCKET||'assets';
try{
  results.postgres=await verifyMigrations(pool,{schema:'understood'});
  const auth=await fetch(process.env.NEON_AUTH_JWKS_URL,{signal:AbortSignal.timeout(15000)});
  if(!auth.ok||!(await auth.json()).keys?.length)throw Error('Auth key discovery failed');
  results.auth='JWKS discovery passed; live OTP dispatch tested separately';
  results.functions=await neonFunctionStatus();
  s3=new S3Client({endpoint:process.env.AWS_ENDPOINT_URL_S3,region:process.env.AWS_REGION,forcePathStyle:true,maxAttempts:1});
  await s3.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:'understood-service-check',ContentType:'text/plain'}));uploaded=true;
  const object=await s3.send(new GetObjectCommand({Bucket:bucket,Key:key}));
  if(await object.Body.transformToString()!=='understood-service-check')throw Error('Storage integrity failed');
  const anonymous=await fetch(`${process.env.AWS_ENDPOINT_URL_S3}/${bucket}/${key}`);
  if(anonymous.ok)throw Error('Private object was anonymously readable');
  results.storage='Authenticated upload/download matched; anonymous download denied';
  await pool.query(`CREATE TABLE public."${table}" (id text PRIMARY KEY,value text NOT NULL)`);created=true;
  await pool.query(`INSERT INTO public."${table}" VALUES($1,'before')`,[id]);
  realtime=createRealtime({secret:process.env.NEON_REALTIME_SECRET,url:process.env.NEON_REALTIME_URL,db:new URL(process.env.DATABASE_URL).pathname.slice(1)});
  const subscription=await realtime.subscribe(rawSql(`SELECT id,value FROM public."${table}" WHERE id=$1`,[id]));
  await subscription.awaitRows(rows=>rows.some(row=>row.value==='before'),25000);
  await pool.query(`UPDATE public."${table}" SET value='after' WHERE id=$1`,[id]);
  await subscription.awaitRows(rows=>rows.some(row=>row.value==='after'),25000);
  results.realtime='Initial snapshot and database update delivered over live subscription';
  results.ai='Existing Gemini retained by user request; Neon AI Gateway disabled on Free plan';
  console.log(JSON.stringify({passed:true,results},null,2));
}catch(error){console.error(JSON.stringify({passed:false,results,failed:error.message},null,2));process.exitCode=1;}
finally{
  realtime?.close();
  if(created)await pool.query(`DROP TABLE public."${table}"`);
  if(uploaded)await s3.send(new DeleteObjectCommand({Bucket:bucket,Key:key}));
  s3?.destroy();await pool.end();
}
