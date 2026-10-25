import {validWorkerSession,type PageSession} from './session-state.ts';
import {WORKER_LOCALES,isWorkerLanguage,languageDirection,workerLocale,type LanguageDirection,type WorkerLocaleCode} from '../server/languages.mjs';

export type WorkerUiLanguage=WorkerLocaleCode;
export const workerUiLanguageKey='understood:worker-ui-language';
export const workerUiLanguages=WORKER_LOCALES;
export const workerUiDirection=(language:WorkerUiLanguage):LanguageDirection=>languageDirection(language)??'ltr';
export const workerUiLocaleTag=(language:WorkerUiLanguage):string=>language;
export const workerUiNativeName=(language:WorkerUiLanguage):string=>workerLocale(language)?.name??language;
export const workerUiFallbackLanguage=(session:PageSession):WorkerUiLanguage=>isWorkerLanguage(session.language)?session.language:'en';
function storedLanguage(storage:Pick<Storage,'getItem'>,session:PageSession):WorkerUiLanguage|null{
  try{
    const raw=storage.getItem(workerUiLanguageKey);if(!raw||raw.length>300)return null;
    const value=JSON.parse(raw);
    return value&&Object.keys(value).sort().join(',')==='context,expiresAt,language'&&value.context===session.clientContext&&value.expiresAt===session.expiresAt&&isWorkerLanguage(value.language)?value.language:null;
  }catch{return null;}
}
export function readWorkerUiLanguage(storage:Pick<Storage,'getItem'>,session:PageSession,now=Date.now()):WorkerUiLanguage {
  const fallback=workerUiFallbackLanguage(session);
  if(!validWorkerSession(session,now))return fallback;
  return storedLanguage(storage,session)??fallback;
}
// Presentation only: this locale never authorizes expired-session reads or writes.
export function readWorkerLockLanguage(storage:Pick<Storage,'getItem'>,session:PageSession):WorkerUiLanguage{
  const fallback=workerUiFallbackLanguage(session);
  if(!session.authenticated||session.role!=='worker'||typeof session.clientContext!=='string'||!/^[a-f0-9]{64}$/.test(session.clientContext)||typeof session.expiresAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(session.expiresAt)||!Number.isFinite(Date.parse(session.expiresAt)))return fallback;
  return storedLanguage(storage,session)??fallback;
}
export function saveWorkerUiLanguage(storage:Pick<Storage,'getItem'|'setItem'>,session:PageSession,language:WorkerUiLanguage,now=Date.now()) {
  if(!validWorkerSession(session,now) || !isWorkerLanguage(language))throw Error('Language selection unavailable');
  const raw=JSON.stringify({context:session.clientContext,expiresAt:session.expiresAt,language});
  storage.setItem(workerUiLanguageKey,raw);
  if(storage.getItem(workerUiLanguageKey)!==raw)throw Error('Language selection was not saved');
}
// A first suggestion only. Ambiguous bare "pa" is skipped rather than forcing a script.
export function workerBrowserLanguage(languages:readonly string[]|undefined=typeof navigator!=='undefined'?navigator.languages:undefined):WorkerUiLanguage{
  for(const tag of languages??[]){
    const normalized=String(tag).replace('_','-');
    if(isWorkerLanguage(normalized))return normalized;
    const lower=normalized.toLowerCase();
    if(lower==='pa'||lower.startsWith('pa-')){if(/-pk\b/i.test(normalized))return 'pa-Arab';if(/-in\b/i.test(normalized))return 'pa-Guru';continue;}
    if(lower==='tl'||lower.startsWith('tl-'))return 'fil';
    const base=lower.split('-')[0];
    if(isWorkerLanguage(base))return base;
  }
  return 'en';
}
export const workerUiLanguageText={
  en:{label:'Interface language',failed:'The interface language could not be saved. Your current language is unchanged.',content:'Assigned briefing languages stay unchanged.'},
  ar:{label:'لغة الواجهة',failed:'تعذر حفظ لغة الواجهة. لم تتغير اللغة الحالية.',content:'تبقى لغات التعليمات المسندة دون تغيير.'},
  hi:{label:'इंटरफ़ेस की भाषा',failed:'इंटरफ़ेस की भाषा सहेजी नहीं जा सकी। आपकी वर्तमान भाषा नहीं बदली है।',content:'सौंपी गई निर्देश भाषाएँ नहीं बदलतीं।'},
  ur:{label:'انٹرفیس کی زبان',failed:'انٹرفیس کی زبان محفوظ نہیں ہو سکی۔ موجودہ زبان تبدیل نہیں ہوئی۔',content:'تفویض شدہ ہدایات کی زبانیں تبدیل نہیں ہوں گی۔'},
  bn:{label:'ইন্টারফেসের ভাষা',failed:'ইন্টারফেসের ভাষা সংরক্ষণ করা যায়নি। আপনার বর্তমান ভাষা বদলায়নি।',content:'বরাদ্দ করা নির্দেশনার ভাষা অপরিবর্তিত থাকবে।'},
  ml:{label:'ഇന്റർഫേസ് ഭാഷ',failed:'ഇന്റർഫേസ് ഭാഷ സംരക്ഷിക്കാനായില്ല. നിങ്ങളുടെ നിലവിലെ ഭാഷ മാറിയിട്ടില്ല.',content:'നൽകിയ നിർദ്ദേശങ്ങളുടെ ഭാഷകൾ മാറില്ല.'},
  ta:{label:'இடைமுக மொழி',failed:'இடைமுக மொழியைச் சேமிக்க முடியவில்லை. உங்கள் தற்போதைய மொழி மாறவில்லை.',content:'ஒதுக்கப்பட்ட அறிவுறுத்தல் மொழிகள் மாறாது.'},
  te:{label:'ఇంటర్‌ఫేస్ భాష',failed:'ఇంటర్‌ఫేస్ భాషను సేవ్ చేయలేకపోయాం. మీ ప్రస్తుత భాష మారలేదు.',content:'కేటాయించిన సూచనల భాషలు మారవు.'},
  ne:{label:'इन्टरफेस भाषा',failed:'इन्टरफेस भाषा सुरक्षित गर्न सकिएन। तपाईंको हालको भाषा परिवर्तन भएको छैन।',content:'तोकिएका निर्देशन भाषाहरू परिवर्तन हुँदैनन्।'},
  fil:{label:'Wika ng interface',failed:'Hindi na-save ang wika ng interface. Hindi nagbago ang kasalukuyang wika mo.',content:'Hindi nagbabago ang mga wikang nakatalaga sa mga tagubilin.'},
  si:{label:'අතුරුමුහුණත් භාෂාව',failed:'අතුරුමුහුණත් භාෂාව සුරැකිය නොහැකි විය. ඔබේ වර්තමාන භාෂාව වෙනස් වී නැත.',content:'පවරන ලද උපදෙස් භාෂා වෙනස් නොවේ.'},
  ru:{label:'Язык интерфейса',failed:'Не удалось сохранить язык интерфейса. Ваш текущий язык не изменён.',content:'Языки назначенных инструкций остаются прежними.'},
  'pa-Guru':{label:'ਇੰਟਰਫ਼ੇਸ ਦੀ ਭਾਸ਼ਾ',failed:'ਇੰਟਰਫ਼ੇਸ ਦੀ ਭਾਸ਼ਾ ਸੰਭਾਲੀ ਨਹੀਂ ਜਾ ਸਕੀ। ਤੁਹਾਡੀ ਮੌਜੂਦਾ ਭਾਸ਼ਾ ਨਹੀਂ ਬਦਲੀ।',content:'ਸੌਂਪੀਆਂ ਹਦਾਇਤਾਂ ਦੀਆਂ ਭਾਸ਼ਾਵਾਂ ਨਹੀਂ ਬਦਲਦੀਆਂ।'},
  'pa-Arab':{label:'انٹرفیس دی بولی',failed:'انٹرفیس دی بولی محفوظ نہیں ہو سکی۔ تہاڈی موجودہ بولی نہیں بدلی۔',content:'سونپیاں ہدایتاں دیاں بولیاں نہیں بدلدیاں۔'},
  id:{label:'Bahasa antarmuka',failed:'Bahasa antarmuka tidak dapat disimpan. Bahasa Anda saat ini tidak berubah.',content:'Bahasa instruksi yang ditugaskan tetap sama.'},
} as const;
