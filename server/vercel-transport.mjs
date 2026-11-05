import {isIP} from 'node:net';

// Only used by a Vercel Function. Vercel overwrites its forwarding headers;
// ordinary self-hosted servers must retain the exact-proxy-IP policy.
export function vercelTransport(env,publicOrigin){
  const hosts=new Set(['VERCEL_PROJECT_PRODUCTION_URL','VERCEL_URL','VERCEL_BRANCH_URL'].map(key=>env[key]).filter(Boolean));
  if(env.VERCEL!=='1'||!hosts.size||[...hosts].some(host=>!(/^[a-z0-9.-]+$/.test(host))))throw Error('Invalid Vercel production transport');
  const origin=new URL(publicOrigin);
  if(origin.origin!==publicOrigin||origin.protocol!=='https:'||!hosts.has(origin.host))throw Error('Invalid Vercel production transport');
  return req=>{
    if(req.headers.host!==origin.host||req.headers['x-forwarded-proto']!=='https')throw Error('Forbidden transport');
    const address=req.headers['x-vercel-forwarded-for']??req.headers['x-forwarded-for'];
    if(typeof address!=='string'||address.length>45||!isIP(address))throw Error('Forbidden transport');
    return address;
  };
}
