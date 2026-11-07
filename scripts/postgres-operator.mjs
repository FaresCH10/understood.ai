import {createPostgresPool} from '../server/postgres/db.mjs';
import {schemaName,verifyMigrations} from '../server/postgres/migrate.mjs';
import {rehearsalConfig} from '../server/postgres/runtime.mjs';
import {provisionOperator} from '../server/postgres/operators.mjs';
import {hostedSyntheticConfig} from '../server/postgres/hosted-config.mjs';
import {bootstrapWorkspace} from '../server/postgres/workspace-bootstrap.mjs';
import {fileURLToPath} from 'node:url';

export function operatorMaintenanceConfig(env=process.env,action) {
  if(action==='--provision-vercel-operator') {
    const url=new URL(env.UNDERSTOOD_POSTGRES_URL);
    if(env.UNDERSTOOD_POSTGRES_TLS!=='true' || url.hostname.includes('-pooler.') || env.VERCEL)
      throw Error('Use a direct database owner connection outside Vercel');
    return {schema:schemaName(env.UNDERSTOOD_POSTGRES_SCHEMA),operatorAccess:true};
  }
  const service=action==='--provision-operator'?'operator':'api';
  return env.UNDERSTOOD_TIER==='staging'?hostedSyntheticConfig(env,{service}):rehearsalConfig();
}
async function main() {
  const action=process.argv[2];
  const vercel=action==='--provision-vercel-operator',provision=vercel||action==='--provision-operator';
  if(process.argv.length!==3 || (!provision && action!=='--bootstrap-workspace'))throw Error('Explicit maintenance action is required');
  const config=operatorMaintenanceConfig(process.env,action);
  if(provision && !config.operatorAccess)throw Error('Operator access is disabled');
  const chunks=[];let size=0,input,pool;
  try{
    for await(const chunk of process.stdin){size+=chunk.length;if(size>4096)throw Error('Provisioning input is too large');chunks.push(Buffer.from(chunk));}
    const bytes=Buffer.concat(chunks,size);
    try{input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}finally{bytes.fill(0);}
    if(!input || typeof input!=='object' || Array.isArray(input) || (provision && Object.keys(input).sort().join(',')!=='email,id,name,password'))throw Error('Invalid maintenance input');
    pool=await createPostgresPool();
    await verifyMigrations(pool,{schema:config.schema});
    if(vercel) {
      const {rows}=await pool.query('SELECT nspowner=to_regrole(current_user)::oid AS owns FROM pg_namespace WHERE nspname=$1',[config.schema]);
      if(!rows[0]?.owns)throw Error('Use the schema maintenance owner to provision an operator');
    }
    if(action==='--bootstrap-workspace') {
      const result=await bootstrapWorkspace(pool,input,config);
      console.log(JSON.stringify({...result,dataClass:'synthetic'}));
    }else {
      await provisionOperator(pool,input,{schema:config.schema});
      console.log('Operator credential provisioned. Prior operator sessions were revoked.');
    }
  }finally{
    if(input && typeof input==='object'){input.password='';if(input.owner && typeof input.owner==='object')input.owner.password='';}
    for(const chunk of chunks)chunk.fill(0);if(pool)await pool.end();
  }
}
if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1])main().catch(()=>{
  console.error('Operator maintenance failed. Credential and connection details are not logged.');process.exitCode=1;
});
