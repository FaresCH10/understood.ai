import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {createPostgresPool} from '../server/postgres/db.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {configureRuntimePermissions} from '../server/postgres/runtime-permissions.mjs';
import {bootstrapWorkspace} from '../server/postgres/workspace-bootstrap.mjs';

// Explicit maintenance operation for a new, isolated synthetic demo only.
async function main(){
  const root=resolve('artifacts/pc-demo'),runtime=join(root,'runtime.json');
  if(existsSync(runtime))throw Error('Demo configuration already exists; refusing to overwrite credentials');
  const source=resolve('artifacts/pg18-user-2026-10-25/env/.env.admin');
  const env=Object.fromEntries(readFileSync(source,'utf8').split(/\r?\n/).filter(v=>v&&!v.startsWith('#')).map(v=>{const n=v.indexOf('=');return [v.slice(0,n),v.slice(n+1)];}));
  const base=new URL(env.UNDERSTOOD_POSTGRES_URL);
  if(!['127.0.0.1','localhost'].includes(base.hostname))throw Error('Local PostgreSQL required');
  const caFile=env.UNDERSTOOD_POSTGRES_CA_FILE;
  const admin=await createPostgresPool({connectionString:base.href,tls:true,caFile});
  let pool;const database='understood_pc_demo',schema='understood_stage_pc_demo';
  try{
    if((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[database])).rowCount)throw Error('Demo database already exists; inspect before reusing');
    for(const role of ['understood_pc_api','understood_pc_worker'])if((await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount)throw Error('Demo role already exists');
    await admin.query(`CREATE DATABASE ${database}`);
    base.pathname='/'+database;
    pool=await createPostgresPool({connectionString:base.href,tls:true,caFile});
    await pool.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
    await pool.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    await pool.query(`CREATE SCHEMA ${schema}`);
    await runMigrations(pool,{schema});
    const urls={};
    for(const [service,role,profile] of [['api','understood_pc_api','application'],['worker','understood_pc_worker','worker']]){
      const password=randomBytes(32).toString('hex');
      await pool.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 12`);
      await configureRuntimePermissions(pool,{schema,role,profile,dedicatedDatabase:true,writersStopped:true});
      const url=new URL(base);url.username=role;url.password=password;urls[service+'Url']=url.href;
    }
    const password=randomBytes(24).toString('base64url'),email='owner@understood.example.test';
    const workspace=await bootstrapWorkspace(pool,{requestId:randomUUID(),confirmed:true,synthetic:true,
      organizationName:'Understood Personal Demo',siteName:'Demo workplace',timezone:'Asia/Beirut',generationLanguages:['en','ar'],
      supportEmail:'support@understood.example.test',owner:{name:'Demo Owner',email,password}},
      {tier:'staging',schema,accessMode:'credential',aiMode:'synthetic',dataClass:'synthetic',integrationMode:'synthetic'});
    mkdirSync(root,{recursive:true});mkdirSync(join(root,'private-audio'),{recursive:true});
    writeFileSync(runtime,JSON.stringify({synthetic:true,schema,port:3045,audioRoot:join(root,'private-audio'),caFile,...urls,
      publicOrigin:'https://understood-pc-demo.vercel.app',tunnelOrigin:'https://not-started.trycloudflare.com',workspace},null,2),{flag:'wx',mode:0o600});
    writeFileSync(join(root,'LOGIN.private.txt'),`PERSONAL SYNTHETIC DEMO ONLY\nStaff email: ${email}\nPassword: ${password}\n`,{flag:'wx',mode:0o600});
    console.log('Created isolated PC demo database, two non-owner runtime roles, and synthetic owner. Credentials saved locally under artifacts/pc-demo.');
  }finally{if(pool)await pool.end();await admin.end();}
}
main().catch(error=>{console.error('PC demo setup failed:',error.message?.replace(/postgres(?:ql)?:\/\/[^\s]+/gi,'[redacted]'));process.exitCode=1;});
