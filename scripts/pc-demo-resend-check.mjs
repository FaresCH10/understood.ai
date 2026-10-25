import {readFileSync,writeFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {setTimeout as sleep} from 'node:timers/promises';
const settings=JSON.parse(readFileSync('artifacts/pc-demo/runtime.json','utf8'));
const env=parseEnv(readFileSync(settings.mailSecretPath,'utf8'));
async function get(path){
  for(let attempt=0;attempt<2;attempt++){
    const response=await fetch('https://api.resend.com'+path,{headers:{Authorization:'Bearer '+env.UNDERSTOOD_RESEND_KEY},redirect:'error',signal:AbortSignal.timeout(20000)});
    if(response.status===429 && attempt===0){await response.body?.cancel();await sleep(1500);continue;}
    const body=await response.json();return {status:response.status,body};
  }
}
function reason(body){
  const message=JSON.stringify(body).toLowerCase();
  if(body?.name==='restricted_api_key')return 'send_only_key_read_access_denied';
  if(/testing emails|testing domain restriction|own email address|only.*send.*testing/.test(message))return 'test_sender_recipient_restriction';
  if(/domain.*not.*verified|verify.*domain/.test(message))return 'verified_sender_domain_required';
  if(/invalid.*api.*key|api.*key.*invalid|unauthorized/.test(message))return 'api_key_rejected';
  if(/rate.limit|too many requests/.test(message))return 'rate_limited';
  if(/quota|daily.*limit|monthly.*limit/.test(message))return 'sending_quota';
  return 'other_provider_response';
}
try{
  const emails=await get('/emails?limit=20');
  await sleep(600);
  const logs=await get('/logs?limit=20');
  const failures=[];
  if(logs.status===200){
    for(const item of (logs.body.data??[]).filter(item=>item.method==='POST'&&item.endpoint==='/emails'&&item.response_status>=400).slice(0,3)){
      if(!/^[a-f0-9-]{36}$/i.test(item.id))continue;
      await sleep(600);const detail=await get('/logs/'+item.id);
      failures.push({createdAt:item.created_at,httpStatus:item.response_status,reason:detail.status===200?reason(detail.body.response?.body??detail.body.response_body??detail.body):'log_detail_unavailable'});
    }
  }
  const result={checkedAt:new Date().toISOString(),testSender:env.UNDERSTOOD_EMAIL_FROM?.endsWith('@resend.dev')===true,
    providerEmailReadStatus:emails.status,providerLogReadStatus:logs.status,
    providerEmailReadReason:emails.status===200?null:reason(emails.body),
    providerErrorCode:typeof emails.body?.name==='string'&&/^[a-z_]+$/.test(emails.body.name)?emails.body.name:null,
    verificationEmails:emails.status===200?(emails.body.data??[]).filter(item=>item.subject==='Verify your Understood account').map(item=>({createdAt:item.created_at,lastEvent:item.last_event})):[],
    recentSendFailures:failures};
  writeFileSync('artifacts/pc-demo/resend-check.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch{console.error('Resend check unavailable; no secret or email contents were logged.');process.exitCode=1;}
