import {credentialInput,normalizeEmail} from './auth-crypto.mjs';
import {isCountryCode} from './country-codes.mjs';
import {inputKeys} from './people.mjs';

export const REGISTRATION_TERMS_VERSION='terms-v1';
export const REGISTRATION_PRIVACY_VERSION='privacy-v1';
export const REGISTRATION_TRIAL_HOURS=14*24;
export const REGISTRATION_TRIAL_WORKER_LIMIT=25;

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invalid=()=>new Error('Invalid registration input');
const keys=(input,allowed)=>{try {inputKeys(input,allowed);}catch {throw invalid();}};
const text=(value,min,max)=>{
  const result=typeof value==='string' ? value.trim() : '';
  if(result.length<min || result.length>max || /[\u0000-\u001f\u007f]/.test(result)) throw invalid();
  return result;
};
function address(value) {
  if(typeof value!=='string' || value.length>128) throw invalid();
  return value;
}
export function registrationRequestInput(input,remoteAddress) {
  keys(input,['requestId','ownerName','email','password','companyName','country','phone','acceptTerms','acceptPrivacy']);
  if(typeof input.requestId!=='string' || !uuid.test(input.requestId)) throw invalid();
  address(remoteAddress);
  const ownerName=text(input.ownerName,2,100),companyName=text(input.companyName,2,120);
  const country=typeof input.country==='string' ? input.country.trim().toUpperCase() : '';
  if(!isCountryCode(country)) throw invalid();
  let phone=null;
  if(input.phone!==undefined && input.phone!==null && input.phone!=='') {
    if(typeof input.phone!=='string') throw invalid();
    phone=input.phone.trim();
    if(!/^\+?[0-9][0-9 ()-]{6,29}$/.test(phone)) throw invalid();
  }
  if(input.acceptTerms!==true || input.acceptPrivacy!==true) throw invalid();
  let email;try {email=credentialInput(input.email,input.password);}catch {throw invalid();}
  return {requestId:input.requestId,ownerName,companyName,country,phone,email,password:input.password};
}
export function registrationResendInput(input,remoteAddress) {
  keys(input,['requestId','email']);
  if(typeof input.requestId!=='string' || !uuid.test(input.requestId)) throw invalid();
  address(remoteAddress);
  const email=normalizeEmail(input.email);
  if(typeof input.email!=='string' || email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalid();
  return {requestId:input.requestId,email};
}
export function registrationVerifyInput(input) {
  keys(input,['token']);
  if(typeof input.token!=='string' || !/^[A-Za-z0-9_-]{43}$/.test(input.token)) throw new Error('Registration verification unavailable');
  return {token:input.token};
}
export const registrationEmailHash=email=>`registration-email:${email}`;
