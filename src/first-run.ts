export type FirstRunLanguage='en'|'ar';
export type FirstRunState={completed:boolean;revision:number;site:{id:string;name:string;timezone:string};staffInterfaceLanguage:FirstRunLanguage};
export type FirstRunBody={requestId:string;siteName:string;timezone:string;staffInterfaceLanguage:FirstRunLanguage;confirmed:true};
export type FirstRunResult={completed:true;duplicate:boolean;revision:number;staffInterfaceLanguage:FirstRunLanguage};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const language=(value:unknown):value is FirstRunLanguage=>value==='en'||value==='ar';
function validZone(value:unknown):value is string {
  if(typeof value!=='string' || value.length<1 || value.length>80)return false;
  try {new Intl.DateTimeFormat('en',{timeZone:value}).format();return true;}catch{return false;}
}
export function checkedFirstRunState(value:unknown):FirstRunState {
  const row=value as FirstRunState;
  if(!row || typeof row!=='object' || typeof row.completed!=='boolean' || !Number.isSafeInteger(row.revision) || row.revision<0
    || !row.site || typeof row.site.id!=='string' || typeof row.site.name!=='string' || typeof row.site.timezone!=='string'
    || !language(row.staffInterfaceLanguage)) throw new Error('Workspace setup could not be read. Reload before continuing.');
  return {completed:row.completed,revision:row.revision,site:{id:row.site.id,name:row.site.name,timezone:row.site.timezone},staffInterfaceLanguage:row.staffInterfaceLanguage};
}
export function checkedFirstRunResult(value:unknown):FirstRunResult {
  const row=value as FirstRunResult;
  if(!row || typeof row!=='object' || row.completed!==true || typeof row.duplicate!=='boolean'
    || !Number.isSafeInteger(row.revision) || !language(row.staffInterfaceLanguage))
    throw new Error('Workspace setup could not be confirmed. Reload before continuing.');
  return {completed:true,duplicate:row.duplicate,revision:row.revision,staffInterfaceLanguage:row.staffInterfaceLanguage};
}
export function firstRunBody(input:{requestId:string;siteName:string;timezone:string;staffInterfaceLanguage:FirstRunLanguage}) {
  const siteName=input.siteName.trim();
  if(typeof input.requestId!=='string' || !uuid.test(input.requestId) || siteName.length<2 || siteName.length>120
    || /[\u0000-\u001f\u007f]/.test(siteName) || !validZone(input.timezone) || !language(input.staffInterfaceLanguage))
    throw new Error('Check the site name, timezone and language before continuing.');
  return {requestId:input.requestId,siteName,timezone:input.timezone,staffInterfaceLanguage:input.staffInterfaceLanguage,confirmed:true as const};
}
export function browserTimezone() {
  try {const zone=Intl.DateTimeFormat().resolvedOptions().timeZone;return validZone(zone)?zone:'UTC';}catch{return 'UTC';}
}
export function suggestedTimezone(stored:string) {
  if(validZone(stored) && stored!=='UTC')return stored;
  const local=browserTimezone();
  return validZone(local)?local:validZone(stored)?stored:'UTC';
}
