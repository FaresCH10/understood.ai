import {APPROVED_GEMINI_ADAPTER} from '../ai/provider-policy.mjs';
import {productionGeminiSettings,productionGeminiAdapters} from '../ai/production-gemini.mjs';
import {BlockList,isIP} from 'node:net';
import {isAbsolute} from 'node:path';
import {resolveMailConfig} from '../auth-mail.mjs';
import {validateNeonStorageConfig} from '../neon-storage-config.mjs';
import {resolvePushAdapter} from '../push-adapter.mjs';
import {WORKER_LANGUAGE_CODES} from '../languages.mjs';

// Production adapters have a separate implementation. Runtime admission still requires the release and provider approvals.
export const LIVE_PROVIDER_ADAPTERS=Object.freeze({
  sourceTranscription:Object.freeze([APPROVED_GEMINI_ADAPTER]),preparation:Object.freeze([APPROVED_GEMINI_ADAPTER]),speech:Object.freeze([APPROVED_GEMINI_ADAPTER]),
  assessment:Object.freeze([APPROVED_GEMINI_ADAPTER]),recording:Object.freeze([APPROVED_GEMINI_ADAPTER]),followup:Object.freeze([APPROVED_GEMINI_ADAPTER]),
});

export const PRODUCTION_RELEASE_GATES=Object.freeze(Array.from({length:19},(_,index)=>`G${index}`));
const REQUIRED_APPROVALS=Object.freeze(['product','engineering','security','privacy','accessibility','operations','provider']);
const PROVIDER_STAGES=Object.freeze({
  sourceTranscription:'UNDERSTOOD_SOURCE_TRANSCRIPTION',preparation:'UNDERSTOOD_PREPARATION_ADAPTER',
  speech:'UNDERSTOOD_SPEECH_ADAPTER',assessment:'UNDERSTOOD_ASSESSMENT_ADAPTER',
  recording:'UNDERSTOOD_RECORDING_ADAPTER',followup:'UNDERSTOOD_CASE_FOLLOWUP_ADAPTER',
});
const FIXTURE_KEYS=Object.freeze(['UNDERSTOOD_MODE','UNDERSTOOD_DEMO_HOSTS','UNDERSTOOD_PILOT_TO',
  'UNDERSTOOD_NEON_TEST_URL','UNDERSTOOD_NEON_TEST_ISOLATED','UNDERSTOOD_NEON_WORKER_CHILD_RUN',
  'UNDERSTOOD_REHEARSAL_PORT','UNDERSTOOD_REHEARSAL_AUDIO_ROOT',
  'UNDERSTOOD_SYNTHETIC_AUDIO_HASHES','UNDERSTOOD_SYNTHETIC_PREPARATION_HASHES','UNDERSTOOD_SYNTHETIC_ASSESSMENT_HASHES']);
const OWNER_LOGINS=new Set(['neondb_owner','understood_owner','postgres','cloud_admin','supabase_admin']);
const RESERVED_SUFFIXES=Object.freeze(['.test','.example','.invalid','.localhost','.local','.internal','.home.arpa']);
const RESERVED_HOSTS=new Set(['example.com','example.net','example.org','localhost']);
const FREE_TOKEN=/(?:^|[-_])(?:free)(?:$|[-_])/i;
const FORBIDDEN_ADAPTER_TOKEN=/(?:^|[-_])(?:synthetic|mock|stub|fixture|test|demo|fake|disabled|none|local)(?:$|[-_])/i;
const FIXTURE_NAME=/(?:^|[-_])(?:fixture|synthetic|test|demo|example)(?:$|[-_])/i;
const STORAGE_KEYS=Object.freeze(['UNDERSTOOD_NEON_STORAGE_ENDPOINT','UNDERSTOOD_NEON_STORAGE_REGION',
  'UNDERSTOOD_NEON_STORAGE_BUCKET','UNDERSTOOD_NEON_STORAGE_ACCESS_KEY_ID','UNDERSTOOD_NEON_STORAGE_SECRET_ACCESS_KEY',
  'UNDERSTOOD_R2_ACCOUNT_ID','UNDERSTOOD_R2_BUCKET','UNDERSTOOD_R2_ACCESS_KEY_ID','UNDERSTOOD_R2_SECRET_ACCESS_KEY']);
const MAIL_KEYS=Object.freeze(['UNDERSTOOD_EMAIL_MODE','UNDERSTOOD_RESEND_KEY','UNDERSTOOD_EMAIL_FROM','UNDERSTOOD_AUTH_MAIL_KEY','UNDERSTOOD_PILOT_TO']);
const PUSH_KEYS=Object.freeze(['UNDERSTOOD_PUSH_ADAPTER','UNDERSTOOD_PUSH_VAPID_PUBLIC_KEY','UNDERSTOOD_PUSH_VAPID_PRIVATE_KEY','UNDERSTOOD_PUSH_VAPID_SUBJECT']);
const PROVIDER_KEYS=Object.freeze(['GEMINI_API_KEY','OPENROUTER_API_KEY']);

const blocker=(list,code,detail)=>list.push(detail?`${code}:${detail}`:code);

function publicHostname(hostname) {
  const host=String(hostname).toLowerCase().replace(/\.$/,'');
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)
    && !isIP(host.replace(/^\[|\]$/g,'')) && !RESERVED_HOSTS.has(host)
    && !RESERVED_SUFFIXES.some(suffix=>host.endsWith(suffix));
}
function publicHttpsOrigin(value) {
  if(typeof value!=='string' || value.length>300 || value!==value.trim()) return null;
  let url;
  try { url=new URL(value); } catch { return null; }
  return url.origin===value && url.protocol==='https:' && !url.username && !url.password && !url.port
    && publicHostname(url.hostname) ? url : null;
}
function fixtureMailbox(value) {
  if(typeof value!=='string' || value.length>254) return true;
  const match=/^([^@\s]+)@([^@\s]+)$/.exec(value);
  return !match || !publicHostname(match[2])
    || /^(?:test|fixture|demo|example|synthetic|mock)(?:[+._-]|$)/i.test(match[1]);
}
function trustedProxyPolicy(env,blockers) {
  let parsed;
  try { parsed=JSON.parse(env.UNDERSTOOD_TRUSTED_PROXY_NETWORKS ?? '[]'); }
  catch { blocker(blockers,'trusted_proxy_invalid'); return null; }
  if(!Array.isArray(parsed) || !parsed.length || parsed.length>32) { blocker(blockers,'trusted_proxy_invalid'); return null; }
  const trusted=new BlockList();
  let valid=true;
  for(const value of parsed) {
    if(typeof value!=='string') { blocker(blockers,'trusted_proxy_invalid'); valid=false; continue; }
    if(value.includes('*')) { blocker(blockers,'trusted_proxy_wildcard'); valid=false; continue; }
    const parts=value.split('/'),version=isIP(parts[0]),max=version===4?32:128;
    const prefix=parts.length===1?max:Number(parts[1]);
    if(!version || parts.length>2 || !Number.isInteger(prefix) || prefix<0 || prefix>max) {
      blocker(blockers,'trusted_proxy_invalid'); valid=false; continue;
    }
    if(prefix===0) { blocker(blockers,'trusted_proxy_wildcard'); valid=false; continue; }
    if(prefix!==max) { blocker(blockers,'trusted_proxy_not_exact'); valid=false; continue; }
    trusted.addSubnet(parts[0],prefix,version===4?'ipv4':'ipv6');
  }
  return valid?trusted:null;
}
function reviewApprovalManifest(env,manifest,blockers) {
  if(manifest===null || manifest===undefined) { blocker(blockers,'release_approval_manifest_missing'); return null; }
  if(typeof manifest!=='object' || Array.isArray(manifest)) { blocker(blockers,'release_approval_manifest_invalid'); return null; }
  if(manifest.format!=='understood-production-approval-v1') blocker(blockers,'release_approval_format_invalid');
  const fingerprint=env.UNDERSTOOD_RELEASE_CANDIDATE_FINGERPRINT;
  if(typeof fingerprint!=='string' || !/^[a-f0-9]{64}$/.test(fingerprint)) blocker(blockers,'candidate_fingerprint_missing');
  if(manifest.candidateFingerprint!==fingerprint) blocker(blockers,'candidate_fingerprint_mismatch');
  const approvedAt=Date.parse(manifest.approvedAt),validUntil=Date.parse(manifest.validUntil);
  if(!Number.isFinite(approvedAt) || !Number.isFinite(validUntil) || approvedAt>Date.now() || validUntil<=Date.now())
    blocker(blockers,'approval_validity_invalid');
  const gates=manifest.gates;
  if(!gates || typeof gates!=='object' || Array.isArray(gates)) blocker(blockers,'release_gates_missing');
  else for(const id of PRODUCTION_RELEASE_GATES) {
    const gate=gates[id];
    if(!gate || gate.status!=='passed-for-specified-scope' || typeof gate.evidence!=='string' || gate.evidence.trim().length<8)
      blocker(blockers,'release_gate_not_passed',id);
  }
  const approvals=manifest.approvals;
  for(const role of REQUIRED_APPROVALS) {
    const approval=approvals?.[role];
    if(!approval || typeof approval.reviewer!=='string' || !approval.reviewer.trim()
      || typeof approval.reference!=='string' || !approval.reference.trim()) blocker(blockers,'release_approval_missing',role);
  }
  const scope=manifest.scope;
  if(!scope || typeof scope!=='object' || Array.isArray(scope)) { blocker(blockers,'release_scope_invalid'); return null; }
  if(typeof scope.customer!=='string' || !scope.customer.trim() || scope.customer.length>200 || /[<>]/.test(scope.customer))
    blocker(blockers,'release_scope_customer_invalid');
  if(!Array.isArray(scope.languages) || !scope.languages.length || scope.languages.length>WORKER_LANGUAGE_CODES.length
    || new Set(scope.languages).size!==scope.languages.length
    || !scope.languages.every(code=>WORKER_LANGUAGE_CODES.includes(code))) blocker(blockers,'release_scope_languages_invalid');
  if(!Number.isInteger(scope.workerCapacity) || scope.workerCapacity<1 || scope.workerCapacity>1000000)
    blocker(blockers,'release_scope_capacity_invalid');
  if(scope.dataClass!=='real') blocker(blockers,'release_scope_data_class_invalid');
  if(!['none','approved'].includes(scope.freeTierDispatch)) blocker(blockers,'release_scope_free_tier_invalid');
  return scope;
}
function reviewDatabase(env,service,blockers) {
  if(env.UNDERSTOOD_POSTGRES_TLS!=='true') blocker(blockers,'postgres_tls_required');
  if(typeof env.UNDERSTOOD_POSTGRES_CA_FILE!=='string' || !env.UNDERSTOOD_POSTGRES_CA_FILE.trim()
    || !isAbsolute(env.UNDERSTOOD_POSTGRES_CA_FILE)) blocker(blockers,'postgres_ca_required');
  let url=null;
  try { url=new URL(env.UNDERSTOOD_POSTGRES_URL ?? ''); } catch { url=null; }
  if(!url || !['postgres:','postgresql:'].includes(url.protocol) || !url.username || !url.password || !url.hostname)
    blocker(blockers,'postgres_url_invalid');
  else {
    if(['localhost','127.0.0.1','::1','[::1]'].includes(url.hostname)) blocker(blockers,'postgres_host_local');
    if(OWNER_LOGINS.has(decodeURIComponent(url.username))) blocker(blockers,'postgres_owner_login_forbidden');
    if(['sslmode','sslcert','sslkey','sslrootcert'].some(key=>url.searchParams.has(key)))
      blocker(blockers,'postgres_url_tls_parameter_forbidden');
  }
  if(!/^understood_prod_[a-z0-9_]{1,46}$/.test(env.UNDERSTOOD_POSTGRES_SCHEMA ?? '')) blocker(blockers,'schema_not_production');
  const expected=service==='operator'?'operator':service==='worker'?'worker':'application';
  if(env.UNDERSTOOD_POSTGRES_ROLE_PROFILE!==expected) blocker(blockers,'database_profile_mismatch');
}
function reviewStorage(env,service,blockers) {
  if(service==='operator') {
    if(STORAGE_KEYS.some(key=>env[key]) || env.UNDERSTOOD_STORAGE_CHECKS==='true')
      blocker(blockers,'operator_secret_separation_failed','storage');
    return null;
  }
  if(env.UNDERSTOOD_STORAGE_CHECKS!=='true') blocker(blockers,'storage_checks_required');
  const adapter=env.UNDERSTOOD_STORAGE_ADAPTER;
  if(!['r2','neon'].includes(adapter)) { blocker(blockers,'storage_adapter_invalid'); return null; }
  let storageConfig;
  try {
    storageConfig=adapter==='neon'
      ? validateNeonStorageConfig({endpoint:env.UNDERSTOOD_NEON_STORAGE_ENDPOINT,region:env.UNDERSTOOD_NEON_STORAGE_REGION,
        bucket:env.UNDERSTOOD_NEON_STORAGE_BUCKET,accessKeyId:env.UNDERSTOOD_NEON_STORAGE_ACCESS_KEY_ID,
        secretAccessKey:env.UNDERSTOOD_NEON_STORAGE_SECRET_ACCESS_KEY})
      : {accountId:env.UNDERSTOOD_R2_ACCOUNT_ID,bucket:env.UNDERSTOOD_R2_BUCKET,jurisdiction:env.UNDERSTOOD_R2_JURISDICTION ?? 'eu',
        accessKeyId:env.UNDERSTOOD_R2_ACCESS_KEY_ID,secretAccessKey:env.UNDERSTOOD_R2_SECRET_ACCESS_KEY};
  } catch { blocker(blockers,'storage_config_invalid'); return null; }
  if(adapter==='r2' && (!/^[a-f0-9]{32}$/i.test(storageConfig.accountId ?? '')
    || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(storageConfig.bucket ?? '')
    || !['default','eu'].includes(storageConfig.jurisdiction) || !storageConfig.accessKeyId || !storageConfig.secretAccessKey))
    blocker(blockers,'storage_config_invalid');
  if(FIXTURE_NAME.test(storageConfig.bucket ?? '')) blocker(blockers,'storage_fixture_named');
  return {adapter,config:storageConfig};
}
function reviewMail(env,origin,service,blockers) {
  if(service==='operator') {
    if((env.UNDERSTOOD_EMAIL_MODE ?? 'disabled')!=='disabled' || MAIL_KEYS.some(key=>key!=='UNDERSTOOD_EMAIL_MODE' && env[key]))
      blocker(blockers,'operator_secret_separation_failed','mail');
    return Object.freeze({available:false});
  }
  if(env.UNDERSTOOD_EMAIL_MODE!=='resend') blocker(blockers,'mail_not_configured');
  let mail=null;
  try {
    mail=resolveMailConfig({mode:env.UNDERSTOOD_EMAIL_MODE,apiKey:env.UNDERSTOOD_RESEND_KEY,
      from:env.UNDERSTOOD_EMAIL_FROM,key:env.UNDERSTOOD_AUTH_MAIL_KEY,publicOrigin:origin});
  } catch { mail=null; }
  if(!mail?.available) blocker(blockers,'mail_config_invalid');
  if(env.UNDERSTOOD_EMAIL_MODE==='resend' && fixtureMailbox(env.UNDERSTOOD_EMAIL_FROM)) blocker(blockers,'mail_fixture_address');
  return mail ? Object.freeze(mail) : Object.freeze({available:false});
}
function reviewPush(env,service,blockers) {
  if(service==='operator') {
    if((env.UNDERSTOOD_PUSH_ADAPTER ?? 'disabled')!=='disabled'
      || PUSH_KEYS.some(key=>key!=='UNDERSTOOD_PUSH_ADAPTER' && env[key]))
      blocker(blockers,'operator_secret_separation_failed','push');
    return null;
  }
  const mode=env.UNDERSTOOD_PUSH_ADAPTER ?? 'disabled';
  if(mode==='synthetic') { blocker(blockers,'push_synthetic_forbidden'); return null; }
  if(mode!=='webpush') { blocker(blockers,'push_not_webpush'); return null; }
  let adapter=null;
  try { adapter=resolvePushAdapter(env); } catch { blocker(blockers,'push_config_invalid'); return null; }
  const publicKey=env.UNDERSTOOD_PUSH_VAPID_PUBLIC_KEY?.trim(),privateKey=env.UNDERSTOOD_PUSH_VAPID_PRIVATE_KEY?.trim();
  const subject=env.UNDERSTOOD_PUSH_VAPID_SUBJECT?.trim();
  if(!/^[A-Za-z0-9_-]{80,120}$/.test(publicKey ?? '') || !/^[A-Za-z0-9_-]{40,60}$/.test(privateKey ?? ''))
    blocker(blockers,'push_config_invalid');
  if(typeof subject!=='string' || (!/^https:\/\//.test(subject) && !/^mailto:[^@\s]+@[^@\s]+$/.test(subject))
    || /\.(?:test|example|invalid|localhost)(?::|\/|$)/i.test(subject) || /example\.(?:com|net|org)/i.test(subject))
    blocker(blockers,'push_subject_invalid');
  return adapter;
}
function reviewProviders(env,service,scope,blockers) {
  if(service==='operator') {
    if(PROVIDER_KEYS.some(key=>env[key])) blocker(blockers,'operator_secret_separation_failed','provider');
    return Object.freeze({});
  }
  if(service==='api' && PROVIDER_KEYS.some(key=>env[key]))
    blocker(blockers,'provider_secret_separation_failed','api');
  const fallback=env.UNDERSTOOD_PROVIDER_FALLBACK;
  if(fallback===undefined || fallback==='') blocker(blockers,'provider_fallback_not_declared');
  else if(fallback!=='disabled') blocker(blockers,'provider_fallback_forbidden');
  const dispatch=env.UNDERSTOOD_FREE_TIER_DISPATCH;
  if(dispatch===undefined || dispatch==='') blocker(blockers,'free_tier_dispatch_not_declared');
  else if(!['disabled','approved'].includes(dispatch)) blocker(blockers,'free_tier_dispatch_invalid');
  else if(dispatch==='approved' && scope?.freeTierDispatch!=='approved') blocker(blockers,'free_tier_dispatch_unapproved');
  else if(dispatch==='disabled' && scope?.freeTierDispatch==='approved') blocker(blockers,'free_tier_dispatch_scope_mismatch');
  const selected={};
  for(const [stage,key] of Object.entries(PROVIDER_STAGES)) {
    const value=env[key];
    if(typeof value!=='string' || !value.trim()) { blocker(blockers,'provider_adapter_missing',stage); continue; }
    if(FREE_TOKEN.test(value)) { blocker(blockers,'free_tier_dispatch_unapproved',stage); continue; }
    if(FORBIDDEN_ADAPTER_TOKEN.test(value)) { blocker(blockers,'provider_adapter_forbidden',stage); continue; }
    if(!LIVE_PROVIDER_ADAPTERS[stage]?.includes(value)) { blocker(blockers,'provider_adapter_not_registered',stage); continue; }
    selected[stage]=value;
  }
  return Object.freeze(selected);
}

const admittedConfigs=new WeakSet();
export function assertProductionAdmission(config){if(!admittedConfigs.has(config)||Date.parse(config.approvalValidUntil)<=Date.now())throw Error('Production release approval unavailable or expired');}

function review(env,{service='api',approvalManifest=null}={}) {
  if(!['api','worker','operator'].includes(service)) throw Error('Invalid production service');
  const blockers=[];
  if(env.UNDERSTOOD_TIER!=='production') blocker(blockers,'tier_not_production');
  if(env.UNDERSTOOD_AI_MODE!=='live') blocker(blockers,'ai_mode_not_live');
  if(env.UNDERSTOOD_ACCESS_MODE==='demo') blocker(blockers,'demo_identities_forbidden');
  else if(env.UNDERSTOOD_ACCESS_MODE!=='credential') blocker(blockers,'access_mode_not_credential');
  if(env.UNDERSTOOD_DATA_CLASS!=='real') blocker(blockers,'data_class_not_real');
  for(const key of FIXTURE_KEYS) if(env[key]!==undefined && env[key]!=='') blocker(blockers,'fixture_or_demo_setting_present',key);
  for(const key of Object.keys(env)) if(key.startsWith('UNDERSTOOD_NEON_STORAGE_TEST_') || key.startsWith('UNDERSTOOD_BACKUP_TEST_'))
    blocker(blockers,'fixture_or_demo_setting_present',key);
  if((env.UNDERSTOOD_PROVIDER_TESTS ?? 'disabled')!=='disabled') blocker(blockers,'provider_test_mode_forbidden');
  for(const [key,value] of Object.entries(env)) if(key.startsWith('UNDERSTOOD_') && typeof value==='string'
    && /[*?]/.test(value) && /(?:ALLOW|HOST|ORIGIN|NETWORK|DOMAIN|PROXY)/.test(key))
    blocker(blockers,'wildcard_setting_forbidden',key);
  const operatorFlag=env.UNDERSTOOD_OPERATOR_ACCESS;
  if(operatorFlag!==undefined && !['true','false'].includes(operatorFlag)) blocker(blockers,'operator_access_invalid');
  if(service==='operator' ? operatorFlag!=='true' : operatorFlag==='true') blocker(blockers,'operator_access_mismatch');
  const origin=publicHttpsOrigin(env.UNDERSTOOD_PUBLIC_ORIGIN);
  if(!origin) blocker(blockers,'public_origin_invalid');
  let customerOrigin=null;
  if(service==='operator') {
    customerOrigin=publicHttpsOrigin(env.UNDERSTOOD_CUSTOMER_ORIGIN);
    if(!customerOrigin) blocker(blockers,'customer_origin_invalid');
    else if(origin && customerOrigin.origin===origin.origin) blocker(blockers,'operator_origin_not_separate');
  }
  const port=Number(env.PORT ?? 10000);
  if(!Number.isInteger(port) || port<1024 || port>65535) blocker(blockers,'port_invalid');
  const trusted=trustedProxyPolicy(env,blockers);
  reviewDatabase(env,service,blockers);
  const storage=reviewStorage(env,service,blockers);
  const mail=reviewMail(env,origin?.origin,service,blockers);
  const push=reviewPush(env,service,blockers);
  const scope=reviewApprovalManifest(env,approvalManifest,blockers);
  const providers=reviewProviders(env,service,scope,blockers);
  const requestAddress=req=>{
    assertProductionAdmission(config);
    let remote=req.socket.remoteAddress;
    if(remote?.startsWith('::ffff:')) remote=remote.slice(7);
    const version=isIP(remote ?? '');
    if(!trusted || !version || !trusted.check(remote,version===4?'ipv4':'ipv6')
      || req.headers['x-forwarded-proto']!=='https' || !origin || req.headers.host!==origin.host)
      throw Error('Forbidden transport');
    const address=req.headers['x-forwarded-for'];
    if(typeof address!=='string' || !isIP(address) || address.length>45) throw Error('Forbidden transport');
    return address;
  };
  let geminiSettings;
  if(service!=='operator' && Object.values(providers).some(value=>value===APPROVED_GEMINI_ADAPTER)){try{geminiSettings=productionGeminiSettings(env,scope);}catch{blocker(blockers,'production_gemini_configuration_invalid');}if(service==='worker'&&!env.GEMINI_API_KEY)blocker(blockers,'production_gemini_credentials_missing');}
  const config={
    service,tier:'production',aiMode:'live',accessMode:'credential',dataClass:'real',integrationMode:'live',
    publicOrigin:origin?.origin,schema:env.UNDERSTOOD_POSTGRES_SCHEMA,port,requestAddress,
    runtimePermissionsRequired:true,operatorAccess:service==='operator',
    runtimeRoleProfile:service==='operator'?'operator':service==='worker'?'worker':'application',
    providerFallback:'disabled',freeTierDispatch:env.UNDERSTOOD_FREE_TIER_DISPATCH,
    geminiSettings,providerAdapters:providers,storageAdapter:storage?.adapter,storageConfig:storage?Object.freeze(storage.config):undefined,
    storageChecks:service!=='operator',mail,pushAdapter:push,
    releaseScope:scope?Object.freeze({customer:scope.customer,languages:Object.freeze([...scope.languages]),
      workerCapacity:scope.workerCapacity,dataClass:'real',freeTierDispatch:scope.freeTierDispatch}):null,
    candidateFingerprint:env.UNDERSTOOD_RELEASE_CANDIDATE_FINGERPRINT,approvalValidUntil:approvalManifest?.validUntil ?? null,
  };
  if(service==='operator') Object.assign(config,{customerOrigin:customerOrigin?.origin,pilotDestination:null});
  if(!blockers.length){Object.freeze(config);admittedConfigs.add(config);}
  return {blockers,config:blockers.length?null:config};
}

export function productionAdmissionBlockers(env=process.env,options={}) {
  return Object.freeze(review(env,options).blockers);
}

export function productionAdmissionConfig(env=process.env,options={}) {
  const {blockers,config}=review(env,options);
  if(blockers.length) throw Error(`Production admission blocked: ${blockers.join(', ')}`);
  return config;
}

export function productionServiceConfig(env=process.env,options={},providerOptions={}){
  const config=productionAdmissionConfig(env,options);
  const handles=config.service==='worker'?productionGeminiAdapters(env,config,providerOptions):config.service==='api'?{
    preparationAdapter:Object.freeze({provenance:Object.freeze({adapter:APPROVED_GEMINI_ADAPTER,dataClass:'real'}),capabilities:Object.freeze({textLanguages:config.geminiSettings.textLanguages,speechLanguages:config.geminiSettings.speechLanguages})}),
    caseFollowupAdapter:Object.freeze({provenance:Object.freeze({adapter:APPROVED_GEMINI_ADAPTER,dataClass:'real'}),capabilities:Object.freeze({speechLanguages:config.geminiSettings.speechLanguages})}),
  }:{};
  const runtime=Object.freeze({...config,...handles});admittedConfigs.add(runtime);return runtime;
}
