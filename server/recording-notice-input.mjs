import {WORKER_LANGUAGE_CODES} from './languages.mjs';

const inputKeys=(input,allowed)=>{
  if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>!allowed.includes(key)))throw Error('Invalid input');
};

export const noticeLanguages=WORKER_LANGUAGE_CODES;
const legacyLanguages=['en','ar','ur'];
export function recordingNoticeLanguage(params,session,method){
  const keys=[...params.keys()];if(!keys.length)return undefined;
  if(method!=='GET' || session?.principal_type!=='worker' || keys.length!==1 || keys[0]!=='language' || !noticeLanguages.includes(params.get('language')))throw Error('Invalid recording notice request');
  return params.get('language');
}
export function noticeRequestId(value){
  if(typeof value!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))throw Error('Invalid recording notice request');
  return value;
}
export function recordingNoticeInput(input){
  inputKeys(input,['requestId','revision','notices','confirmed','scope']);noticeRequestId(input.requestId);
  if(input.confirmed!==true || !Number.isSafeInteger(input.revision) || input.revision<0 || input.revision>1000000000)throw Error('Invalid recording notice request');
  if(typeof input.scope!=='string' || input.scope.length>500)throw Error('Invalid recording notice request');
  let scope;try{scope=JSON.parse(input.scope);}catch{throw Error('Invalid recording notice request');}
  if(!Array.isArray(scope) || scope.length!==3 || scope.some(value=>typeof value!=='string' || !value || value.length>100)
    || input.scope!==JSON.stringify(scope))throw Error('Invalid recording notice request');
  inputKeys(input.notices,noticeLanguages);
  const notices={};
  for(const language of noticeLanguages){
    const text=input.notices[language];
    if(text===undefined && !legacyLanguages.includes(language))continue;
    if(typeof text!=='string' || text.length>2000 || /[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(text))throw Error('Invalid recording notice text');
    notices[language]=text.trim();
  }
  if(noticeLanguages.some(language=>notices[language] && notices[language].length<20))throw Error('Recording notice requires every supported language');
  return {revision:input.revision,notices,scope:input.scope};
}
export const sameNoticeRequest=(left,right)=>left?.revision===right.revision && left.scope===right.scope && noticeLanguages.every(language=>(left.notices?.[language]??'')===(right.notices[language]??''));
export function noticeView(row,session,language){
  if(language!==undefined && (session.principal_type!=='worker' || !noticeLanguages.includes(language)))throw Error('Invalid recording notice language');
  const notices=row ? typeof row.notices_json==='string' ? JSON.parse(row.notices_json) : row.notices_json : {en:'',ar:'',ur:''};
  const available=language=>typeof notices[language]==='string' && notices[language].length>=20;
  const configured=noticeLanguages.some(available);
  if(session.principal_type==='worker'){
    const selected=language??session.language;
    if(!noticeLanguages.includes(selected))throw Error('Recording notice language unavailable');
    return {revision:row?.revision || 0,configured:available(selected),language:selected,notice:available(selected)?notices[selected]:null};
  }
  return {revision:row?.revision || 0,configured,notices,canWrite:['owner','administrator'].includes(session.role)};
}
