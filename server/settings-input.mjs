const uuid=value=>typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function settingsRequestId(value){if(!uuid(value))throw Error('Invalid settings request');return value;}
import {staffFilters,staffReference} from './staff-input.mjs';
import {CONTENT_LANGUAGE_CODES} from './languages.mjs';
export function siteContactFilters(input={}) {
  const filters=staffFilters(input);
  if(Object.keys(input).some(key=>!['search','page','pageSize'].includes(key)))throw Error('Invalid settings request');
  return filters;
}
export const siteContactDto=row=>row?{id:row.id,name:row.name,role:row.role,available:!!row.active && ['owner','supervisor'].includes(row.role)}:null;
export function generationLanguages(value) {
  if(!Array.isArray(value) || !value.length || value.length>CONTENT_LANGUAGE_CODES.length || !value.includes('en')
    || !value.every(code=>CONTENT_LANGUAGE_CODES.includes(code)) || new Set(value).size!==value.length)throw Error('Invalid generation languages');
  return ['en',...CONTENT_LANGUAGE_CODES.filter(code=>code!=='en' && value.includes(code))];
}
export function settingsInput(kind,input) {
  const fields=kind==='organization' ? ['name','supportEmail'] : kind==='site' ? ['name','timezone','generationLanguages','primaryContactId','deputyContactId'] : [];
  if(!fields.length || !input || typeof input!=='object' || Array.isArray(input) || !uuid(input.requestId) || input.confirmed!==true
    || !Number.isSafeInteger(input.revision) || input.revision<0 || input.revision>1000000000
    || typeof input.name!=='string' || input.name.trim().length<2 || input.name.length>120 || /[\u0000-\u001f\u007f]/.test(input.name)
    || Object.keys(input).some(key=>!['requestId','revision','confirmed',...fields].includes(key))) throw new Error('Invalid settings request');
  const value={revision:input.revision,name:input.name.trim()};
  if(kind==='organization') {
    if(typeof input.supportEmail!=='string' || input.supportEmail.length>254 || (input.supportEmail.trim() && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(input.supportEmail.trim()))) throw new Error('Invalid support email');
    return {...value,supportEmail:input.supportEmail.trim()};
  }
  if(typeof input.timezone!=='string' || input.timezone.length>80) throw new Error('Invalid site timezone');
  try {new Intl.DateTimeFormat('en',{timeZone:input.timezone}).format();}catch {throw new Error('Invalid site timezone');}
  const contacts={};
  if(input.primaryContactId!==undefined || input.deputyContactId!==undefined) {
    for(const key of ['primaryContactId','deputyContactId']) {
      if(input[key]!==null) {try{staffReference(input[key]);}catch{throw Error('Invalid site contact');}if(/[\u0000-\u001f\u007f]/.test(input[key]))throw Error('Invalid site contact');}
      contacts[key]=input[key];
    }
    if(input.deputyContactId!==null && (!input.primaryContactId || input.primaryContactId===input.deputyContactId))throw Error('Invalid site contact');
  }
  return {...value,timezone:input.timezone,...(input.generationLanguages!==undefined ? {generationLanguages:generationLanguages(input.generationLanguages)} : {}),...contacts};
}
export const sameSettingsRequest=(old,value)=>old && Object.keys(old).length===Object.keys(value).length && Object.keys(value).every(key=>key==='generationLanguages' ? JSON.stringify(old[key])===JSON.stringify(value[key]) : old[key]===value[key]);
