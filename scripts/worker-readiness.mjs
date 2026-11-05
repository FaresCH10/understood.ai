import {neonEnvironment} from '../server/neon-env.mjs';
import {createPostgresPool} from '../server/postgres/db.mjs';
import {productionServiceConfig} from '../server/postgres/production-admission.mjs';
import {readProductionApproval} from '../server/postgres/production-approval.mjs';
import {domainTransaction} from '../server/postgres/domain.mjs';

Object.assign(process.env,neonEnvironment(process.env));
let pool;
try{
 const config=productionServiceConfig(process.env,{service:'worker',approvalManifest:readProductionApproval(process.env)});
 pool=await createPostgresPool();
 const observed=await domainTransaction(pool,config.schema,client=>client.query("SELECT 1 FROM worker_health WHERE seen_at>clock_timestamp()-interval '30 seconds' AND state IN ('idle','busy') AND failure_stages='[]'::jsonb LIMIT 1"));
 if(!observed.rows.length)throw Error();
 console.log('Production queue worker heartbeat is current.');
}catch{console.error('Production queue worker readiness unavailable.');process.exitCode=1;}
finally{await pool?.end();}
