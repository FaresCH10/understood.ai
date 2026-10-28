import {resolveRegistrationVerification} from '../registration-verification.mjs';
import {isIP} from 'node:net';
import {isAbsolute,resolve,relative} from 'node:path';
import {disabledPushAdapter} from '../push-adapter.mjs';
import {resolveMailConfig} from '../auth-mail.mjs';

// An explicitly synthetic, loopback-only PC runtime. Production admission is unchanged.
export function pcDemoConfig(value,{service='api',mailEnv={}}={}) {
  if(value?.synthetic!==true || !['api','worker'].includes(service))throw Error('PC demo requires synthetic data');
  const origin=new URL(value.publicOrigin),tunnel=new URL(value.tunnelOrigin);
  if(origin.origin!==value.publicOrigin || origin.protocol!=='https:' || !/^[a-z0-9-]+\.vercel\.app$/.test(origin.hostname))throw Error('Use the exact Vercel demo origin');
  if(tunnel.origin!==value.tunnelOrigin || tunnel.protocol!=='https:' || !/^[a-z0-9-]+\.trycloudflare\.com$/.test(tunnel.hostname))throw Error('Use an exact temporary tunnel origin');
  if(!/^understood_stage_pc_[a-z0-9_]{1,35}$/.test(value.schema ?? ''))throw Error('Use an isolated PC demo schema');
  if(!Number.isInteger(value.port) || value.port<1024 || value.port>65535)throw Error('Invalid PC demo port');
  if(!isAbsolute(value.audioRoot ?? ''))throw Error('Use absolute private audio storage');
  const audioRoot=resolve(value.audioRoot),ordinary=resolve('data/private-audio');
  const contains=(a,b)=>{const p=relative(a,b);return p===''||(!p.startsWith('..')&&!isAbsolute(p));};
  if(contains(ordinary,audioRoot)||contains(audioRoot,ordinary))throw Error('PC audio must remain isolated');
  const requestAddress=req=>{
    const peer=req.socket.remoteAddress?.replace(/^::ffff:/,'');
    const address=req.headers['cf-connecting-ip'];
    if(!['127.0.0.1','::1'].includes(peer) || req.headers.host!==tunnel.host || req.headers['x-forwarded-proto']!=='https'
      || typeof address!=='string' || !isIP(address))throw Error('Forbidden transport');
    return address;
  };
  // Explicit file-loaded mail settings only; do not inherit unrelated process secrets.
  const mail=Object.freeze(resolveMailConfig({mode:mailEnv.UNDERSTOOD_EMAIL_MODE ?? 'disabled',
    apiKey:mailEnv.UNDERSTOOD_RESEND_KEY ?? '',from:mailEnv.UNDERSTOOD_EMAIL_FROM ?? '',
    key:mailEnv.UNDERSTOOD_AUTH_MAIL_KEY ?? '',publicOrigin:value.publicOrigin}));
  const registrationVerification=resolveRegistrationVerification(mailEnv,mail,value.publicOrigin);
  return Object.freeze({registrationVerification,service,tier:'staging',aiMode:'synthetic',dataClass:'synthetic',integrationMode:'synthetic',accessMode:'credential',
    publicOrigin:value.publicOrigin,schema:value.schema,port:value.port,audioRoot,requestAddress,operatorAccess:false,
    runtimePermissionsRequired:true,runtimeRoleProfile:service==='api'?'application':'worker',mail,
    storageChecks:false,pilotDestination:null,pushAdapter:disabledPushAdapter});
}
