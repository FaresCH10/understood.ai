import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {normalizeEmail} from './auth-crypto.mjs';

export function resolveMailConfig(options={}) {
  const mode=options.mode ?? process.env.UNDERSTOOD_EMAIL_MODE ?? 'disabled';
  if(mode==='disabled') return {available:false};
  const apiKey=options.apiKey ?? process.env.UNDERSTOOD_RESEND_KEY;
  const from=options.from ?? process.env.UNDERSTOOD_EMAIL_FROM;
  const key=options.key ?? process.env.UNDERSTOOD_AUTH_MAIL_KEY;
  const publicOrigin=options.publicOrigin ?? process.env.UNDERSTOOD_PUBLIC_ORIGIN;
  let url;try {url=new URL(publicOrigin);}catch {throw new Error('Invalid email configuration');}
  if(mode!=='resend' || typeof apiKey!=='string' || !/^re_[A-Za-z0-9_-]{8,200}$/.test(apiKey)
    || typeof from!=='string' || from!==normalizeEmail(from) || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(from)
    || typeof key!=='string' || !/^[a-f0-9]{64}$/i.test(key) || url.origin!==publicOrigin
    || !(url.protocol==='https:' || (options.allowLocal===true && url.protocol==='http:' && ['localhost','127.0.0.1'].includes(url.hostname)))) throw new Error('Invalid email configuration');
  return {available:true,apiKey,from,key:Buffer.from(key,'hex'),publicOrigin};
}

export function sealMail(config,id,value) {
  const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',config.key,nonce);
  cipher.setAAD(Buffer.from(`understood-auth-mail:${id}`));
  const bytes=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  return Buffer.concat([nonce,cipher.getAuthTag(),bytes]).toString('base64url');
}
export function openMail(config,id,value) {
  if(typeof value!=='string' || value.length>12000) throw new Error('Private email unavailable');
  try {
    const bytes=Buffer.from(value,'base64url'),cipher=createDecipheriv('aes-256-gcm',config.key,bytes.subarray(0,12));
    cipher.setAAD(Buffer.from(`understood-auth-mail:${id}`));cipher.setAuthTag(bytes.subarray(12,28));
    return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString('utf8'));
  }catch {throw new Error('Private email unavailable');}
}

export async function sendAuthMail(config,id,message,fetchImpl=fetch) {
  if(!config.available) throw new Error('Email delivery unavailable');
  if(typeof id!=='string' || !/^[a-f0-9-]{36}$/i.test(id) || !message || typeof message.email!=='string'
    || message.email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(message.email)
    || !['Reset your Understood password','Your Understood password was changed','Your Understood invitation','New Understood pilot request','Verify your Understood account'].includes(message.subject)
    || typeof message.text!=='string' || message.text.length>3000) throw new Error('Invalid private email');
  try {
    const response=await fetchImpl('https://api.resend.com/emails',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
      headers:{authorization:`Bearer ${config.apiKey}`,'content-type':'application/json','idempotency-key':`${message.subject==='New Understood pilot request'?'pilot':'auth'}/${id}`},
      body:JSON.stringify({from:config.from,to:[message.email],subject:message.subject,text:message.text})});
    if(!response.ok) {await response.body?.cancel();throw new Error();}
    let bytes=0,chunks=[];for await(const chunk of response.body) {bytes+=chunk.length;if(bytes>4096) throw new Error();chunks.push(chunk);}
    const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(typeof result.id!=='string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(result.id)) throw new Error();
    return {providerId:result.id};
  }catch {throw new Error('Email delivery could not be confirmed');}
}
