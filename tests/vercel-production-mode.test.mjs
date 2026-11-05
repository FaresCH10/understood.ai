import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture} from './helpers/production-runtime.mjs';
import {productionServiceConfig,productionAdmissionBlockers} from '../server/postgres/production-admission.mjs';
import {readProductionApproval} from '../server/postgres/production-approval.mjs';
import {createVercelNeonHandler} from '../server/vercel-neon.mjs';

test('Vercel live runtime is explicitly admitted and rejects forged transport',()=>{
 const {env,approvalManifest}=productionFixture('api');
 const vercel={...env,VERCEL:'1',VERCEL_PROJECT_PRODUCTION_URL:'app.understood.co'};delete vercel.UNDERSTOOD_TRUSTED_PROXY_NETWORKS;
 const config=productionServiceConfig(vercel,{service:'api',transport:'vercel',approvalManifest});
 assert.equal(config.integrationMode,'live');assert.equal(config.dataClass,'real');assert.equal(config.attachmentScanner,null);
 assert.equal(config.requestAddress({headers:{host:'app.understood.co','x-forwarded-proto':'https','x-vercel-forwarded-for':'203.0.113.10'}}),'203.0.113.10');
 assert.throws(()=>config.requestAddress({headers:{host:'wrong.understood.co','x-forwarded-proto':'https','x-vercel-forwarded-for':'203.0.113.10'}}),/Forbidden/);
 assert.throws(()=>config.requestAddress({headers:{host:'app.understood.co','x-forwarded-proto':'https','x-vercel-forwarded-for':'203.0.113.10, 203.0.113.11'}}),/Forbidden/);
 assert.ok(productionAdmissionBlockers({...vercel,VERCEL:'0'},{service:'api',transport:'vercel',approvalManifest}).includes('invalid_vercel_transport'));
 assert.throws(()=>productionServiceConfig(vercel,{service:'api',transport:'vercel'}),/admission blocked/);
});

test('approval JSON uses the same bounded manifest and cannot silently shadow a file',()=>{
 const {approvalManifest}=productionFixture('api');
 assert.deepEqual(readProductionApproval({UNDERSTOOD_RELEASE_APPROVAL_JSON:JSON.stringify(approvalManifest)}),approvalManifest);
 for(const env of [{},{UNDERSTOOD_RELEASE_APPROVAL_JSON:'{'},{UNDERSTOOD_RELEASE_APPROVAL_JSON:' '.repeat(65537)},{UNDERSTOOD_RELEASE_APPROVAL_JSON:'{}',UNDERSTOOD_RELEASE_APPROVAL_FILE:'ignored'}])assert.throws(()=>readProductionApproval(env));
});

test('partial real-data configuration never enters the synthetic Vercel handler',async()=>{
 const env={VERCEL_PROJECT_PRODUCTION_URL:'app.understood.co',UNDERSTOOD_NEON_AUTH_URL:'https://ep-fixture.neonauth.c-8.eu-central-1.aws.neon.tech/neondb/auth',UNDERSTOOD_AUTH_MAIL_KEY:'a'.repeat(64),UNDERSTOOD_DATA_CLASS:'real'};
 await assert.rejects(createVercelNeonHandler({env}),/approved production runtime/);
 await assert.rejects(createVercelNeonHandler({env:{...env,VERCEL:'1',UNDERSTOOD_TIER:'production'}}),/approval unavailable/);
});

test('production Vercel handler verifies application role and reports a missing durable worker',async()=>{
 const {env,approvalManifest}=productionFixture('api');let permissions=0,heartbeats=[];
 Object.assign(env,{VERCEL:'1',VERCEL_PROJECT_PRODUCTION_URL:'app.understood.co',UNDERSTOOD_NEON_AUTH_URL:'https://ep-fixture.neonauth.c-8.eu-central-1.aws.neon.tech/neondb/auth',
   UNDERSTOOD_ATTACHMENT_SCANNER_URL:'https://scanner.understood.co/scan',UNDERSTOOD_ATTACHMENT_SCANNER_KEY:'fixture-scanner-token'});
 const pool={async connect(){return {release(){},async query(sql){return {rows:sql.includes('FROM worker_health')?heartbeats:[]};}};}};
 const runtime=await createVercelNeonHandler({env,pool,approvalManifest,verify:async()=>{},verifyPermissions:async(p,options)=>{permissions++;assert.equal(options.profile,'application');}});
 assert.equal(runtime.config.integrationMode,'live');assert.equal(permissions,1);
 const request={method:'GET',url:'/api/health/readiness',headers:{host:'app.understood.co','x-forwarded-proto':'https','x-vercel-forwarded-for':'203.0.113.10'}};
 let code,result;const response={writeHead(value){code=value;},end(value){result=JSON.parse(value);}};
 await runtime.handler(request,response);assert.equal(code,503);assert.equal(result.worker,'not responding');assert.equal(result.attachments,'configured');
 heartbeats=[{state:'idle',failure_stages:[]}];await runtime.handler(request,response);assert.equal(code,200);assert.equal(result.status,'ready');assert.deepEqual(Object.keys(result).sort(),['attachments','mode','status','worker']);
 heartbeats=[{state:'idle',failure_stages:['assessment']}];await runtime.handler(request,response);assert.equal(code,503);assert.equal(result.worker,'degraded');
});
