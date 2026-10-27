import {WORKER_LANGUAGE_CODES} from '../../server/languages.mjs';
// These approvals are fixtures for local, mocked-network tests. They are never deployment approvals.
export function productionFixture(service='worker'){
  const fingerprint='a'.repeat(64),past=new Date(Date.now()-60000).toISOString(),future=new Date(Date.now()+3600000).toISOString();
  const approvalManifest={format:'understood-production-approval-v1',candidateFingerprint:fingerprint,approvedAt:past,validUntil:future,
    scope:{customer:'Fixture Customer',languages:[...WORKER_LANGUAGE_CODES],workerCapacity:100,dataClass:'real',freeTierDispatch:'none'},
    gates:Object.fromEntries(Array.from({length:19},(_,i)=>[`G${i}`,{status:'passed-for-specified-scope',evidence:'Fixture-only release evidence'}])),
    approvals:Object.fromEntries(['product','engineering','security','privacy','accessibility','operations','provider'].map(role=>[role,{reviewer:'Fixture Reviewer',reference:'fixture-only-'+role}]))};
  const env={UNDERSTOOD_TIER:'production',UNDERSTOOD_AI_MODE:'live',UNDERSTOOD_ACCESS_MODE:'credential',UNDERSTOOD_DATA_CLASS:'real',
    UNDERSTOOD_PUBLIC_ORIGIN:'https://app.understood.co',UNDERSTOOD_RELEASE_CANDIDATE_FINGERPRINT:fingerprint,
    UNDERSTOOD_POSTGRES_SCHEMA:'understood_prod_fixture',UNDERSTOOD_POSTGRES_URL:`postgres://understood_${service}:fixture-password@db.understood.co/understood`,
    UNDERSTOOD_POSTGRES_TLS:'true',UNDERSTOOD_POSTGRES_CA_FILE:process.platform==='win32'?'C:\\certs\\ca.pem':'/etc/understood/ca.pem',UNDERSTOOD_POSTGRES_ROLE_PROFILE:service==='api'?'application':service,
    UNDERSTOOD_TRUSTED_PROXY_NETWORKS:'["192.0.2.10/32"]',UNDERSTOOD_STORAGE_ADAPTER:'neon',UNDERSTOOD_STORAGE_CHECKS:'true',
    UNDERSTOOD_NEON_STORAGE_ENDPOINT:'https://br-production.storage.c-1.eu-central-1.aws.neon.tech',UNDERSTOOD_NEON_STORAGE_REGION:'eu-central-1',UNDERSTOOD_NEON_STORAGE_BUCKET:'understood-private-production',UNDERSTOOD_NEON_STORAGE_ACCESS_KEY_ID:'fixture-access',UNDERSTOOD_NEON_STORAGE_SECRET_ACCESS_KEY:'fixture-secret',
    UNDERSTOOD_EMAIL_MODE:'resend',UNDERSTOOD_EMAIL_FROM:'no-reply@understood.co',UNDERSTOOD_RESEND_KEY:'re_'+ 'a'.repeat(20),UNDERSTOOD_AUTH_MAIL_KEY:'b'.repeat(64),
    UNDERSTOOD_PUSH_ADAPTER:'webpush',UNDERSTOOD_PUSH_VAPID_PUBLIC_KEY:'c'.repeat(87),UNDERSTOOD_PUSH_VAPID_PRIVATE_KEY:'d'.repeat(43),UNDERSTOOD_PUSH_VAPID_SUBJECT:'https://app.understood.co',
    UNDERSTOOD_PROVIDER_FALLBACK:'disabled',UNDERSTOOD_FREE_TIER_DISPATCH:'disabled',UNDERSTOOD_GEMINI_PAID_ACCOUNT:'true',
    UNDERSTOOD_GEMINI_TEXT_MODEL:'gemini-text-fixture',UNDERSTOOD_GEMINI_TRANSCRIPTION_MODEL:'gemini-transcription-fixture',UNDERSTOOD_GEMINI_SPEECH_MODEL:'gemini-speech-fixture',UNDERSTOOD_GEMINI_VOICE:'Kore',
    UNDERSTOOD_GEMINI_TEXT_LANGUAGES:JSON.stringify(WORKER_LANGUAGE_CODES),UNDERSTOOD_GEMINI_SPEECH_LANGUAGES:JSON.stringify(WORKER_LANGUAGE_CODES)};
  for(const key of ['UNDERSTOOD_SOURCE_TRANSCRIPTION','UNDERSTOOD_PREPARATION_ADAPTER','UNDERSTOOD_SPEECH_ADAPTER','UNDERSTOOD_ASSESSMENT_ADAPTER','UNDERSTOOD_RECORDING_ADAPTER','UNDERSTOOD_CASE_FOLLOWUP_ADAPTER'])env[key]='gemini-approved-v1';
  if(service==='worker')env.GEMINI_API_KEY='fixture-only-gemini-key';
  return {env,approvalManifest};
}
