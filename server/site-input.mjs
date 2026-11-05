import {settingsInput} from './settings-input.mjs';
import {staffFilters} from './staff-input.mjs';
export function createSiteInput(input) {
  if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).sort().join(',')!=='confirmed,generationLanguages,name,requestId,timezone')throw Error('Invalid site creation');
  const {revision,...value}=settingsInput('site',{...input,revision:0});return {...value,confirmed:true};
}
export function siteFilters(input={}) {
  if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>!['search','page','pageSize'].includes(key)))throw Error('Invalid site filter');
  return staffFilters(input);
}
export function siteRequestId(id) {
  if(typeof id!=='string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id))throw Error('Invalid site creation');return id;
}
export function siteAccessInput(input) {
  if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).sort().join(',')!=='confirmed,reason,requestId,revision,siteId,state')throw Error('Invalid site access request');
  siteRequestId(input.requestId);
  if(typeof input.siteId!=='string' || !input.siteId || input.siteId.length>100 || /[\x00-\x1f\x7f]/.test(input.siteId)
    || !Number.isSafeInteger(input.revision) || input.revision<0 || input.confirmed!==true
    || !['active','paused'].includes(input.state) || !['pilot_review','operational','security'].includes(input.reason))throw Error('Invalid site access request');
  return {siteId:input.siteId,revision:input.revision,state:input.state,reason:input.reason,confirmed:true};
}
export function siteHttpError(error) {
  const message=error?.message;
  if(['Sign in required','Forbidden','Forbidden origin','Workspace access paused','Worker access paused','Site archived'].includes(message))return {status:message==='Sign in required'?401:403,error:message};
  if(['Session context changed','Site creation request conflict','Site access request conflict','Site access revision changed','Site access unchanged','Site lifecycle request conflict','Site lifecycle revision changed','Site lifecycle unchanged','Site has active dependencies','Site name already exists','The pilot includes one site. Contact us to plan a multi-site rollout.','Account membership unavailable'].includes(message))return {status:409,error:message};
  if(['Invalid site lifecycle request','Invalid site access request','Invalid site creation','Invalid site filter','Invalid settings request','Invalid site timezone','Invalid generation languages','Invalid search','Invalid page','Invalid staff filter','Invalid input','Invalid JSON'].includes(message))return {status:400,error:message};
  if(message==='Request too large')return {status:413,error:message};
  return {status:503,error:'Site operation unavailable. Check the receipt before retrying.'};
}
