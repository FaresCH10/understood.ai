// Canonical worker-locale and capability registry shared by server validation and UI.
// Punjabi is one required language with two scripts; both are selectable locales and
// the bare "pa" tag is deliberately not accepted because it hides the script choice.
export const WORKER_LOCALES = Object.freeze([
  Object.freeze({code:'en',base:'en',name:'English',englishName:'English',direction:'ltr',script:'Latin'}),
  Object.freeze({code:'ar',base:'ar',name:'العربية',englishName:'Arabic',direction:'rtl',script:'Arabic'}),
  Object.freeze({code:'hi',base:'hi',name:'हिन्दी',englishName:'Hindi',direction:'ltr',script:'Devanagari'}),
  Object.freeze({code:'ur',base:'ur',name:'اردو',englishName:'Urdu',direction:'rtl',script:'Arabic'}),
  Object.freeze({code:'bn',base:'bn',name:'বাংলা',englishName:'Bengali',direction:'ltr',script:'Bengali'}),
  Object.freeze({code:'ml',base:'ml',name:'മലയാളം',englishName:'Malayalam',direction:'ltr',script:'Malayalam'}),
  Object.freeze({code:'ta',base:'ta',name:'தமிழ்',englishName:'Tamil',direction:'ltr',script:'Tamil'}),
  Object.freeze({code:'te',base:'te',name:'తెలుగు',englishName:'Telugu',direction:'ltr',script:'Telugu'}),
  Object.freeze({code:'ne',base:'ne',name:'नेपाली',englishName:'Nepali',direction:'ltr',script:'Devanagari'}),
  Object.freeze({code:'fil',base:'fil',name:'Filipino',englishName:'Filipino',direction:'ltr',script:'Latin'}),
  Object.freeze({code:'si',base:'si',name:'සිංහල',englishName:'Sinhala',direction:'ltr',script:'Sinhala'}),
  Object.freeze({code:'ru',base:'ru',name:'Русский',englishName:'Russian',direction:'ltr',script:'Cyrillic'}),
  Object.freeze({code:'pa-Guru',base:'pa',name:'ਪੰਜਾਬੀ',englishName:'Punjabi (Gurmukhi)',direction:'ltr',script:'Gurmukhi'}),
  Object.freeze({code:'pa-Arab',base:'pa',name:'پنجابی',englishName:'Punjabi (Shahmukhi)',direction:'rtl',script:'Arabic'}),
  Object.freeze({code:'id',base:'id',name:'Bahasa Indonesia',englishName:'Indonesian',direction:'ltr',script:'Latin'}),
]);
export const WORKER_LANGUAGE_CODES = Object.freeze(WORKER_LOCALES.map(locale=>locale.code));
export const RTL_LANGUAGE_CODES = Object.freeze(WORKER_LOCALES.filter(locale=>locale.direction==='rtl').map(locale=>locale.code));
const localeByCode = new Map(WORKER_LOCALES.map(locale=>[locale.code,locale]));
export function workerLocale(code){ return localeByCode.get(code) ?? null; }
export function isWorkerLanguage(code){ return localeByCode.has(code); }
export function languageDirection(code){ return localeByCode.get(code)?.direction ?? null; }
export function sqlLanguageList(){ return WORKER_LANGUAGE_CODES.map(code=>`'${code.replaceAll("'","''")}'`).join(','); }

// Current runtime evidence, not a wish list. UI is available for every locale; the
// synthetic bundle fixture stores text for en/ar/ur, speech and transcription exist
// only for en/ar, and live provider language coverage is still unverified.
export const LANGUAGE_CAPABILITIES = Object.freeze(Object.fromEntries(WORKER_LOCALES.map(locale=>[locale.code,Object.freeze({
  ui:true,
  translation:['en','ar','ur'].includes(locale.code),
  transcription:['en','ar'].includes(locale.code),
  speech:['en','ar'].includes(locale.code),
  assessment:['en','ar','ur'].includes(locale.code),
})])));
export function languageCapability(code,stage){ return LANGUAGE_CAPABILITIES[code]?.[stage]===true; }
export const UI_LANGUAGE_CODES = Object.freeze(WORKER_LOCALES.filter(locale=>languageCapability(locale.code,'ui')).map(locale=>locale.code));
export const CONTENT_LANGUAGE_CODES = Object.freeze(WORKER_LOCALES.filter(locale=>languageCapability(locale.code,'translation')).map(locale=>locale.code));
export const TRANSCRIPTION_LANGUAGE_CODES = Object.freeze(WORKER_LOCALES.filter(locale=>languageCapability(locale.code,'transcription')).map(locale=>locale.code));
export const SPEECH_LANGUAGE_CODES = Object.freeze(WORKER_LOCALES.filter(locale=>languageCapability(locale.code,'speech')).map(locale=>locale.code));
export const ASSESSMENT_LANGUAGE_CODES = Object.freeze(WORKER_LOCALES.filter(locale=>languageCapability(locale.code,'assessment')).map(locale=>locale.code));
// Supervisor source capture and the staff interface remain English/Arabic by product scope.
export const SOURCE_LANGUAGE_CODES = Object.freeze(['en','ar']);
export const STAFF_LANGUAGE_CODES = Object.freeze(['en','ar']);
