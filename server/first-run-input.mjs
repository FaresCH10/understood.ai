const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invalid=()=>new Error('Invalid onboarding input');

export function firstRunInput(input) {
  if(!input || typeof input!=='object' || Array.isArray(input)
    || Object.keys(input).some(key=>!['requestId','siteName','timezone','staffInterfaceLanguage','confirmed'].includes(key))
    || typeof input.requestId!=='string' || !uuid.test(input.requestId) || input.confirmed!==true) throw invalid();
  const siteName=typeof input.siteName==='string' ? input.siteName.trim() : '';
  if(siteName.length<2 || siteName.length>120 || /[\u0000-\u001f\u007f]/.test(siteName)) throw invalid();
  if(typeof input.timezone!=='string' || input.timezone.length>80) throw invalid();
  try {new Intl.DateTimeFormat('en',{timeZone:input.timezone}).format();} catch {throw invalid();}
  if(!['en','ar'].includes(input.staffInterfaceLanguage)) throw invalid();
  return {requestId:input.requestId,siteName,timezone:input.timezone,staffInterfaceLanguage:input.staffInterfaceLanguage};
}
