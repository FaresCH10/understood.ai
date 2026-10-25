import {readFileSync,writeFileSync} from 'node:fs';
import {createPostgresPool} from '../server/postgres/db.mjs';
import {inSchema} from '../server/postgres/auth.mjs';
const settings=JSON.parse(readFileSync('artifacts/pc-demo/runtime.json','utf8'));
const pool=await createPostgresPool({connectionString:settings.apiUrl,tls:true,caFile:settings.caFile});
try{
  const state=await inSchema(pool,settings.schema,async client=>({
    registrations:(await client.query('SELECT state,count(*)::int AS count FROM organization_registrations GROUP BY state ORDER BY state')).rows,
    mail:(await client.query(`SELECT state,attempts,(provider_id IS NOT NULL) AS provider_confirmed,count(*)::int AS count
      FROM registration_mail GROUP BY state,attempts,(provider_id IS NOT NULL) ORDER BY state,attempts`)).rows,
    tokens:(await client.query(`SELECT (used_at IS NOT NULL) AS used,(revoked_at IS NOT NULL) AS revoked,count(*)::int AS count
      FROM registration_tokens GROUP BY (used_at IS NOT NULL),(revoked_at IS NOT NULL)`)).rows
  }));
  const result={checkedAt:new Date().toISOString(),...state};
  writeFileSync('artifacts/pc-demo/registration-status.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch{console.error('Registration status unavailable; secret and message contents are not logged.');process.exitCode=1;}finally{await pool.end();}
