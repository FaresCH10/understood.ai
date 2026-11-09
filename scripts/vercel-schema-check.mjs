import {fileURLToPath} from 'node:url';
import {createPostgresPool} from '../server/postgres/db.mjs';
import {verifyMigrations,schemaName} from '../server/postgres/migrate.mjs';
import {vercelDatabaseOptions,vercelRequestsLiveMode} from '../server/vercel-database.mjs';

// Fail the build before a deployment can replace the working production site.
// Schema changes remain an explicit migration operation, never a startup side effect.
export async function checkVercelSchema({env=process.env,createPool=createPostgresPool,verify=verifyMigrations,log=console.log}={}){
  const live=vercelRequestsLiveMode(env);
  if(!live && !env.DATABASE_URL){
    if(env.VERCEL==='1'||env.VERCEL_ENV)throw Error('DATABASE_URL is required for a hosted deployment');
    log('Hosted schema check skipped: no DATABASE_URL in this environment.');return null;
  }
  const options=vercelDatabaseOptions(env);
  const schema=schemaName(env.UNDERSTOOD_POSTGRES_SCHEMA||(live?'':'understood'));
  const pool=await createPool(options);
  try{
    const result=await verify(pool,{schema});
    log(`Hosted database schema verified: ${result.migrations} migrations. No schema changes applied.`);
    return result;
  }finally{await pool.end();}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  checkVercelSchema().catch(error=>{
    const safe=new Set(['DATABASE_URL is required for a hosted deployment','UNDERSTOOD_POSTGRES_URL is required for a hosted deployment','Select the approved production runtime','Invalid Vercel PostgreSQL CA configuration','Invalid PostgreSQL schema name','PostgreSQL schema does not exist','PostgreSQL schema migrations are not current','PostgreSQL schema migration verification failed','No PostgreSQL migrations found']);
    console.error(`Hosted database schema check failed: ${safe.has(error.message)?error.message:'Database verification unavailable'}. Apply and verify the release migrations before deploying.`);
    process.exitCode=1;
  });
}
