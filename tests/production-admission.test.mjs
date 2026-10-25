import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {productionAdmissionBlockers,productionAdmissionConfig} from '../server/postgres/production-admission.mjs';

const fingerprint='a'.repeat(64);
const future=new Date(Date.now()+30*86400000).toISOString();
const past=new Date(Date.now()-86400000).toISOString();
const roles=['product','engineering','security','privacy','accessibility','operations','provider'];
const gates=Object.fromEntries(Array.from({length:19},(_,index)=>[`G${index}`,
  {status:'passed-for-specified-scope',evidence:`release evidence for G${index}`} ]));
const approvals=Object.fromEntries(roles.map(role=>[role,{reviewer:'Named Reviewer',reference:`approval-${role}`,approvedAt:past}]));
const manifest=Object.freeze({format:'understood-production-approval-v1',candidateFingerprint:fingerprint,
  approvedAt:past,validUntil:future,scope:Object.freeze({customer:'Approved Pilot Customer',languages:Object.freeze(['en','ar']),
    workerCapacity:25,dataClass:'real',freeTierDispatch:'none'}),gates,approvals});
const caFile=process.platform==='win32'?'C:\\certs\\understood-production-ca.pem':'/etc/understood/production-ca.pem';
const baseEnv=Object.freeze({
  UNDERSTOOD_TIER:'production',UNDERSTOOD_AI_MODE:'live',UNDERSTOOD_ACCESS_MODE:'credential',UNDERSTOOD_DATA_CLASS:'real',
  UNDERSTOOD_PUBLIC_ORIGIN:'https://app.understood.co',UNDERSTOOD_RELEASE_CANDIDATE_FINGERPRINT:fingerprint,
  UNDERSTOOD_POSTGRES_SCHEMA:'understood_prod_release',
  UNDERSTOOD_POSTGRES_URL:'postgres://understood_api_runtime:fixture-password@db.understood.co/understood',
  UNDERSTOOD_POSTGRES_TLS:'true',UNDERSTOOD_POSTGRES_CA_FILE:caFile,UNDERSTOOD_POSTGRES_ROLE_PROFILE:'application',
  UNDERSTOOD_TRUSTED_PROXY_NETWORKS:'["192.0.2.10/32"]',PORT:'10000',
  UNDERSTOOD_STORAGE_ADAPTER:'neon',UNDERSTOOD_STORAGE_CHECKS:'true',
  UNDERSTOOD_NEON_STORAGE_ENDPOINT:'https://br-production.storage.c-1.eu-central-1.aws.neon.tech',
  UNDERSTOOD_NEON_STORAGE_REGION:'eu-central-1',UNDERSTOOD_NEON_STORAGE_BUCKET:'understood-private-production',
  UNDERSTOOD_NEON_STORAGE_ACCESS_KEY_ID:'fixture-access-key',UNDERSTOOD_NEON_STORAGE_SECRET_ACCESS_KEY:'fixture-secret-key',
  UNDERSTOOD_EMAIL_MODE:'resend',UNDERSTOOD_EMAIL_FROM:'no-reply@understood.co',
  UNDERSTOOD_RESEND_KEY:`re_${'a'.repeat(20)}`,UNDERSTOOD_AUTH_MAIL_KEY:'b'.repeat(64),
  UNDERSTOOD_PUSH_ADAPTER:'webpush',UNDERSTOOD_PUSH_VAPID_PUBLIC_KEY:'c'.repeat(87),
  UNDERSTOOD_PUSH_VAPID_PRIVATE_KEY:'d'.repeat(43),UNDERSTOOD_PUSH_VAPID_SUBJECT:'https://app.understood.co',
  UNDERSTOOD_SOURCE_TRANSCRIPTION:'managed-transcription-live',UNDERSTOOD_PREPARATION_ADAPTER:'managed-preparation-live',
  UNDERSTOOD_SPEECH_ADAPTER:'managed-speech-live',UNDERSTOOD_ASSESSMENT_ADAPTER:'managed-assessment-live',
  UNDERSTOOD_RECORDING_ADAPTER:'managed-recording-live',UNDERSTOOD_CASE_FOLLOWUP_ADAPTER:'managed-followup-live',
  UNDERSTOOD_PROVIDER_FALLBACK:'disabled',UNDERSTOOD_FREE_TIER_DISPATCH:'disabled',
});
const blockersFor=(patch={},options={})=>productionAdmissionBlockers({...baseEnv,...patch},
  {service:'api',approvalManifest:manifest,...options});
const has=(blockers,code)=>assert.ok(blockers.includes(code),`expected ${code}; received ${blockers.join(', ')}`);
const operatorEnv=Object.freeze({UNDERSTOOD_TIER:'production',UNDERSTOOD_AI_MODE:'live',UNDERSTOOD_ACCESS_MODE:'credential',
  UNDERSTOOD_DATA_CLASS:'real',UNDERSTOOD_PUBLIC_ORIGIN:'https://ops.understood.co',UNDERSTOOD_CUSTOMER_ORIGIN:'https://app.understood.co',
  UNDERSTOOD_RELEASE_CANDIDATE_FINGERPRINT:fingerprint,UNDERSTOOD_OPERATOR_ACCESS:'true',
  UNDERSTOOD_POSTGRES_SCHEMA:'understood_prod_release',
  UNDERSTOOD_POSTGRES_URL:'postgres://understood_operator_runtime:fixture-password@db.understood.co/understood',
  UNDERSTOOD_POSTGRES_TLS:'true',UNDERSTOOD_POSTGRES_CA_FILE:caFile,UNDERSTOOD_POSTGRES_ROLE_PROFILE:'operator',
  UNDERSTOOD_TRUSTED_PROXY_NETWORKS:'["192.0.2.11/32"]',PORT:'10001'});

test('production admission rejects staging, demo identities, synthetic modes and fixture redirection',()=>{
  const staging=productionAdmissionBlockers({...baseEnv,UNDERSTOOD_TIER:'staging',UNDERSTOOD_AI_MODE:'synthetic',
    UNDERSTOOD_ACCESS_MODE:'demo',UNDERSTOOD_DATA_CLASS:'synthetic'},{service:'api',approvalManifest:manifest});
  for(const code of ['tier_not_production','ai_mode_not_live','demo_identities_forbidden','data_class_not_real'])
    has(staging,code);
  has(blockersFor({UNDERSTOOD_ACCESS_MODE:'public'}),'access_mode_not_credential');
  has(blockersFor({UNDERSTOOD_PILOT_TO:'pilot@understood.co'}),'fixture_or_demo_setting_present:UNDERSTOOD_PILOT_TO');
  has(blockersFor({UNDERSTOOD_PROVIDER_TESTS:'gemini-free'}),'provider_test_mode_forbidden');
  has(blockersFor({UNDERSTOOD_MODE:'demo'}),'fixture_or_demo_setting_present:UNDERSTOOD_MODE');
  has(blockersFor({UNDERSTOOD_DEMO_HOSTS:'understood-demo.vercel.app'}),'fixture_or_demo_setting_present:UNDERSTOOD_DEMO_HOSTS');
  has(blockersFor({UNDERSTOOD_NEON_TEST_URL:'postgres://fixture:fixture@db.example.test/understood'}),'fixture_or_demo_setting_present:UNDERSTOOD_NEON_TEST_URL');
  has(blockersFor({UNDERSTOOD_NEON_STORAGE_TEST_BUCKET:'synthetic'}),'fixture_or_demo_setting_present:UNDERSTOOD_NEON_STORAGE_TEST_BUCKET');
  has(blockersFor({UNDERSTOOD_BACKUP_TEST_SOURCE_URL:'postgres://fixture:fixture@db.example.test/understood'}),'fixture_or_demo_setting_present:UNDERSTOOD_BACKUP_TEST_SOURCE_URL');
  has(blockersFor({UNDERSTOOD_SYNTHETIC_AUDIO_HASHES:'[]'}),'fixture_or_demo_setting_present:UNDERSTOOD_SYNTHETIC_AUDIO_HASHES');
});

test('production admission requires an exact candidate, complete gates, named approvals and bounded scope',()=>{
  has(productionAdmissionBlockers(baseEnv,{service:'api',approvalManifest:null}),'release_approval_manifest_missing');
  has(blockersFor({UNDERSTOOD_RELEASE_CANDIDATE_FINGERPRINT:'b'.repeat(64)}),'candidate_fingerprint_mismatch');
  has(blockersFor({UNDERSTOOD_RELEASE_CANDIDATE_FINGERPRINT:''}),'candidate_fingerprint_missing');
  const wrongFormat={...manifest,format:'other'};has(blockersFor({}, {approvalManifest:wrongFormat}),'release_approval_format_invalid');
  const missingGate={...manifest,gates:{...gates}};delete missingGate.gates.G4;
  has(blockersFor({}, {approvalManifest:missingGate}),'release_gate_not_passed:G4');
  const awaitingGate={...manifest,gates:{...gates,G9:{status:'awaiting-external-approval',evidence:'not reviewed'}}};
  has(blockersFor({}, {approvalManifest:awaitingGate}),'release_gate_not_passed:G9');
  const missingApproval={...manifest,approvals:{...approvals}};delete missingApproval.approvals.security;
  has(blockersFor({}, {approvalManifest:missingApproval}),'release_approval_missing:security');
  has(blockersFor({}, {approvalManifest:{...manifest,validUntil:past}}),'approval_validity_invalid');
  has(blockersFor({}, {approvalManifest:{...manifest,scope:{...manifest.scope,languages:['en','xx']}}}),'release_scope_languages_invalid');
  has(blockersFor({}, {approvalManifest:{...manifest,scope:{...manifest.scope,workerCapacity:0}}}),'release_scope_capacity_invalid');
  has(blockersFor({}, {approvalManifest:{...manifest,scope:{...manifest.scope,dataClass:'synthetic'}}}),'release_scope_data_class_invalid');
  has(blockersFor({}, {approvalManifest:{...manifest,scope:{...manifest.scope,freeTierDispatch:'later'}}}),'release_scope_free_tier_invalid');
  const error=(()=>{try{productionAdmissionConfig(baseEnv,{service:'api',approvalManifest:null});}catch(caught){return caught;}})();
  assert.ok(error instanceof Error);assert.match(error.message,/Production admission blocked/);
  assert.match(error.message,/release_approval_manifest_missing/);
  assert.doesNotMatch(error.message,/fixture-secret-key|fixture-password/);
});

test('production admission rejects insecure origins, proxies, database, storage, mail and push shortcuts',()=>{
  for(const origin of ['http://app.understood.co','https://app.understood.example.test','https://*.understood.co','https://127.0.0.1'])
    has(blockersFor({UNDERSTOOD_PUBLIC_ORIGIN:origin}),'public_origin_invalid');
  has(blockersFor({UNDERSTOOD_TRUSTED_PROXY_NETWORKS:'["0.0.0.0/0"]'}),'trusted_proxy_wildcard');
  has(blockersFor({UNDERSTOOD_TRUSTED_PROXY_NETWORKS:'["192.0.2.0/24"]'}),'trusted_proxy_not_exact');
  has(blockersFor({UNDERSTOOD_TRUSTED_PROXY_NETWORKS:'[]'}),'trusted_proxy_invalid');
  has(blockersFor({UNDERSTOOD_TRUSTED_PROXY_NETWORKS:'["198.51.100.0*"]'}),'trusted_proxy_wildcard');
  has(blockersFor({UNDERSTOOD_POSTGRES_TLS:'false'}),'postgres_tls_required');
  has(blockersFor({UNDERSTOOD_POSTGRES_CA_FILE:''}),'postgres_ca_required');
  has(blockersFor({UNDERSTOOD_POSTGRES_SCHEMA:'public'}),'schema_not_production');
  has(blockersFor({UNDERSTOOD_POSTGRES_URL:'postgres://neondb_owner:fixture-password@db.understood.co/understood'}),'postgres_owner_login_forbidden');
  has(blockersFor({UNDERSTOOD_POSTGRES_URL:'postgres://understood_api_runtime:fixture-password@db.understood.co/understood?sslmode=require'}),'postgres_url_tls_parameter_forbidden');
  has(blockersFor({UNDERSTOOD_POSTGRES_ROLE_PROFILE:'worker'}),'database_profile_mismatch');
  has(blockersFor({UNDERSTOOD_STORAGE_ADAPTER:'local'}),'storage_adapter_invalid');
  has(blockersFor({UNDERSTOOD_STORAGE_CHECKS:'false'}),'storage_checks_required');
  has(blockersFor({UNDERSTOOD_NEON_STORAGE_BUCKET:'understood-fixture-bucket'}),'storage_fixture_named');
  has(blockersFor({UNDERSTOOD_EMAIL_MODE:'disabled'}),'mail_not_configured');
  has(blockersFor({UNDERSTOOD_EMAIL_FROM:'fixture@understood.co'}),'mail_fixture_address');
  has(blockersFor({UNDERSTOOD_EMAIL_FROM:'no-reply@example.test'}),'mail_fixture_address');
  has(blockersFor({UNDERSTOOD_PUSH_ADAPTER:'synthetic'}),'push_synthetic_forbidden');
  has(blockersFor({UNDERSTOOD_PUSH_ADAPTER:'disabled'}),'push_not_webpush');
  has(blockersFor({UNDERSTOOD_PUSH_VAPID_PUBLIC_KEY:'short'}),'push_config_invalid');
  has(blockersFor({UNDERSTOOD_PUSH_VAPID_SUBJECT:'https://app.understood.example'}),'push_subject_invalid');
  has(blockersFor({PORT:'80'}),'port_invalid');
  has(blockersFor({UNDERSTOOD_FREE_TIER_DISPATCH:''}),'free_tier_dispatch_not_declared');
  has(blockersFor({UNDERSTOOD_PROVIDER_FALLBACK:''}),'provider_fallback_not_declared');
  has(blockersFor({UNDERSTOOD_PROVIDER_FALLBACK:'auto'}),'provider_fallback_forbidden');
});

test('production admission rejects mocked speech, synthetic evaluators, free dispatch and unregistered live adapters',()=>{
  has(blockersFor({UNDERSTOOD_SPEECH_ADAPTER:'mock-speech'}),'provider_adapter_forbidden:speech');
  has(blockersFor({UNDERSTOOD_ASSESSMENT_ADAPTER:'synthetic-evaluator'}),'provider_adapter_forbidden:assessment');
  has(blockersFor({UNDERSTOOD_RECORDING_ADAPTER:'fixture-recorder'}),'provider_adapter_forbidden:recording');
  has(blockersFor({UNDERSTOOD_SOURCE_TRANSCRIPTION:'local-whisper'}),'provider_adapter_forbidden:sourceTranscription');
  has(blockersFor({UNDERSTOOD_PREPARATION_ADAPTER:'gemini-free'}),'free_tier_dispatch_unapproved:preparation');
  has(blockersFor({UNDERSTOOD_CASE_FOLLOWUP_ADAPTER:''}),'provider_adapter_missing:followup');
  has(blockersFor({UNDERSTOOD_FREE_TIER_DISPATCH:'approved'}),'free_tier_dispatch_unapproved');
  has(blockersFor({}, {approvalManifest:{...manifest,scope:{...manifest.scope,freeTierDispatch:'approved'}}}),'free_tier_dispatch_scope_mismatch');

  const blockers=blockersFor();
  for(const stage of ['sourceTranscription','preparation','speech','assessment','recording','followup'])
    has(blockers,`provider_adapter_not_registered:${stage}`);
  const error=(()=>{try{productionAdmissionConfig(baseEnv,{service:'api',approvalManifest:manifest});}catch(caught){return caught;}})();
  assert.ok(error instanceof Error);assert.match(error.message,/provider_adapter_not_registered:speech/);
  assert.doesNotMatch(error.message,/fixture-secret-key|fixture-password|fixture-access-key/);
});

test('operator admission is separately configured and never receives customer secrets',()=>{
  assert.equal(productionAdmissionBlockers(operatorEnv,{service:'operator',approvalManifest:manifest}).length,0);
  const config=productionAdmissionConfig(operatorEnv,{service:'operator',approvalManifest:manifest});
  assert.equal(config.runtimeRoleProfile,'operator');assert.equal(config.operatorAccess,true);
  assert.equal(config.storageConfig,undefined);assert.equal(config.mail.available,false);assert.equal(config.pushAdapter,null);
  assert.equal(config.customerOrigin,'https://app.understood.co');assert.equal(config.productionStartupAuthorized,undefined);
  has(productionAdmissionBlockers({...operatorEnv,UNDERSTOOD_CUSTOMER_ORIGIN:'https://ops.understood.co'},{service:'operator',approvalManifest:manifest}),'operator_origin_not_separate');
  has(productionAdmissionBlockers({...operatorEnv,UNDERSTOOD_OPERATOR_ACCESS:'false'},{service:'operator',approvalManifest:manifest}),'operator_access_mismatch');
  has(productionAdmissionBlockers({...operatorEnv,UNDERSTOOD_NEON_STORAGE_SECRET_ACCESS_KEY:'fixture-secret-key'},{service:'operator',approvalManifest:manifest}),'operator_secret_separation_failed:storage');
  has(productionAdmissionBlockers({...operatorEnv,UNDERSTOOD_RESEND_KEY:'re_fixturefixture'},{service:'operator',approvalManifest:manifest}),'operator_secret_separation_failed:mail');
  has(productionAdmissionBlockers({...operatorEnv,GEMINI_API_KEY:'fixture-provider-key'},{service:'operator',approvalManifest:manifest}),'operator_secret_separation_failed:provider');
  has(productionAdmissionBlockers({...operatorEnv,UNDERSTOOD_PUSH_VAPID_PRIVATE_KEY:'d'.repeat(43)},{service:'operator',approvalManifest:manifest}),'operator_secret_separation_failed:push');
  has(productionAdmissionBlockers({...baseEnv,GEMINI_API_KEY:'fixture-provider-key'},{service:'api',approvalManifest:manifest}),'provider_secret_separation_failed:api');
});

test('the admission check command is read-only, reports blockers and never authorizes deployment',()=>{
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('UNDERSTOOD_')));
  env.UNDERSTOOD_TIER='staging';env.UNDERSTOOD_HOSTED_SERVICE='api';
  const script=fileURLToPath(new URL('../scripts/production-admission-check.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[script],{env,encoding:'utf8',timeout:30000});
  assert.equal(result.status,1,result.stderr);
  const report=JSON.parse(result.stdout);
  assert.equal(report.admitted,false);assert.equal(report.productionStartupAuthorized,false);
  assert.equal(report.deploymentAuthorized,false);assert.ok(report.blockers.includes('tier_not_production'));
  assert.doesNotMatch(result.stdout,/fixture-secret-key|fixture-password/);
});
