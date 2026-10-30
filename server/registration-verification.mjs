import {sendAuthMail} from './auth-mail.mjs';

// Neon proves email possession; Understood still owns credentials, sessions and trial activation.
export function resolveRegistrationVerification(env={},mail={available:false},publicOrigin=mail.publicOrigin){
  const provider=env.UNDERSTOOD_REGISTRATION_PROVIDER ?? ((env.UNDERSTOOD_NEON_AUTH_URL || env.NEON_AUTH_BASE_URL)?'neon':'resend');
  if(provider==='resend')return mail;
  if(provider!=='neon')throw Error('Invalid registration verification provider');
  const secret=env.UNDERSTOOD_AUTH_MAIL_KEY;
  const key=typeof secret==='string'&&/^[a-f0-9]{64}$/i.test(secret)?Buffer.from(secret,'hex'):null;
  const value=env.UNDERSTOOD_NEON_AUTH_URL || env.NEON_AUTH_BASE_URL;
  if(!value)return {provider:'neon',available:false,key,publicOrigin};
  let url,origin;try{url=new URL(value);origin=new URL(publicOrigin);}catch{throw Error('Invalid Neon verification configuration');}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.port
    || !/^[a-z0-9-]+\.neonauth\.(?:[a-z0-9-]+\.)*neon\.tech$/.test(url.hostname)
    || !/^\/[A-Za-z0-9_-]+\/auth\/?$/.test(url.pathname)||!key
    || origin.origin!==publicOrigin||!['http:','https:'].includes(origin.protocol)
    || (origin.protocol==='http:'&&!['127.0.0.1','localhost'].includes(origin.hostname)))throw Error('Invalid Neon verification configuration');
  return {provider:'neon',available:true,key,publicOrigin,authUrl:url.href.replace(/\/$/,'')};
}
export const registrationAcceptance=config=>config.provider==='neon'?{accepted:true,delivery:'queued',verification:'neon-code'}:{accepted:true,delivery:'queued'};
const verificationError=code=>Object.assign(Error('Registration verification unavailable'),{code});
export function registrationVerificationHttpError(error){
  const codes={REGISTRATION_CODE_REJECTED:[400,'The verification code is incorrect.'],REGISTRATION_CODE_EXPIRED:[400,'The verification code has expired. Request a new code.'],
    REGISTRATION_CODE_RATE_LIMITED:[429,'Too many verification attempts. Please wait before trying again.'],
    REGISTRATION_PROVIDER_UNAVAILABLE:[503,'Email verification is temporarily unavailable. Please try again.']};
  const entry=codes[error?.code];return entry?{status:entry[0],error:entry[1],code:error.code}:null;
}

async function neonPost(config,path,body,fetchImpl,validate=result=>result?.success===true){
  if(config.provider!=='neon'||!config.available||!config.authUrl)throw Error('Email delivery unavailable');
  let response;
  try{
    response=await fetchImpl(config.authUrl+path,{method:'POST',redirect:'error',credentials:'omit',signal:AbortSignal.timeout(10000),
      headers:{'content-type':'application/json',origin:config.publicOrigin},body:JSON.stringify(body)});
    let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>16384)throw Error();chunks.push(chunk);}
    const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(!response.ok){
      const code=result?.code;
      throw verificationError(response.status===429||['TOO_MANY_ATTEMPTS','RATE_LIMITED'].includes(code)?'REGISTRATION_CODE_RATE_LIMITED':
        ['OTP_EXPIRED','OTP_HAS_EXPIRED'].includes(code)?'REGISTRATION_CODE_EXPIRED':
        ['INVALID_OTP','INVALID_VERIFICATION_CODE','OTP_NOT_FOUND'].includes(code)?'REGISTRATION_CODE_REJECTED':'REGISTRATION_PROVIDER_UNAVAILABLE');
    }
    if(!validate(result))throw verificationError('REGISTRATION_PROVIDER_UNAVAILABLE');
    return true;
  }catch(error){if(registrationVerificationHttpError(error))throw error;throw verificationError('REGISTRATION_PROVIDER_UNAVAILABLE');}
}
export async function sendRegistrationVerification(config,id,message,fetchImpl=fetch){
  if(config.provider!=='neon')return sendAuthMail(config,id,message,fetchImpl);
  if(typeof message?.email!=='string'||message.email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(message.email))throw Error('Invalid private email');
  await neonPost(config,'/email-otp/send-verification-otp',{email:message.email,type:'sign-in'},fetchImpl);
  // A local dispatch receipt, not a provider delivery ID or confirmation of inbox delivery.
  return {providerId:'neon-otp-'+id};
}
export function checkRegistrationCode(config,email,code,fetchImpl=fetch){
  if(typeof code!=='string'||!/^\d{6}$/.test(code))throw Error('Registration verification unavailable');
  // Neon check-verification-otp requires an existing user, even though sending a
  // sign-in OTP works for a new address. Complete the supported OTP flow instead.
  // Its verified identity is email proof only: discard the provider session/token;
  // Understood still creates its own credentials and requires a separate sign-in.
  return neonPost(config,'/sign-in/email-otp',{email,otp:code},fetchImpl,
    result=>result?.user?.emailVerified===true && typeof result.user.email==='string'
      && result.user.email.toLowerCase()===email.toLowerCase());
}
