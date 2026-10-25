import {sameWorkerSession,validWorkerSession,type PageSession} from './session-state.ts';
import {checkedWorkerReceipt,readWorkerRequestReceipt} from './worker-request.ts';
import {workerResponseState} from './worker-state.ts';

export type RecordingScope={assignmentId:string;publicationId:string;version:number;language:'en'|'ar'|'ur'};
type Failure='input'|'session'|'unavailable'|'conflict'|'receipt';
export class WorkerAudioRetryError extends Error {
  readonly code:Failure;
  constructor(code:Failure){super(code);this.code=code;}
}
export const workerAudioRetryText={
  en:{input:'The recording identity or payload is invalid. Nothing new was sent.',session:'The worker session could not be verified. Nothing new was sent.',unavailable:'The receipt or briefing could not be checked. Nothing new was sent; keep your preview.',conflict:'This recording cannot be sent to the current briefing. Its version, deadline or response status changed. Keep the preview and check your history.',receipt:'The upload acknowledgement could not be verified. Delivery is unknown; keep the preview and check its receipt before retrying.'},
  ar:{input:'هوية التسجيل أو محتواه غير صالحين. لم يُرسل شيء جديد.',session:'تعذر التحقق من جلسة العامل. لم يُرسل شيء جديد.',unavailable:'تعذر التحقق من الاستلام أو التعليمات. لم يُرسل شيء جديد؛ احتفظ بالمعاينة.',conflict:'لا يمكن إرسال التسجيل إلى التعليمات الحالية. تغيّر الإصدار أو الموعد النهائي أو حالة الإجابة. احتفظ بالمعاينة وتحقق من السجل.',receipt:'تعذر التحقق من تأكيد رفع التسجيل. الإرسال غير مؤكد؛ احتفظ بالمعاينة وتحقق من الاستلام قبل إعادة المحاولة.'},
  hi:{input:'रिकॉर्डिंग की पहचान या सामग्री अमान्य है। कुछ नया नहीं भेजा गया।',session:'कर्मचारी सत्र सत्यापित नहीं हो सका। कुछ नया नहीं भेजा गया।',unavailable:'प्राप्ति या ब्रीफिंग जाँची नहीं जा सकी। कुछ नया नहीं भेजा गया; अपना पूर्वावलोकन रखें।',conflict:'यह रिकॉर्डिंग मौजूदा ब्रीफिंग को नहीं भेजी जा सकती। उसका संस्करण, समय-सीमा या प्रतिक्रिया स्थिति बदल गई है। पूर्वावलोकन रखें और इतिहास जाँचें।',receipt:'अपलोड की पुष्टि सत्यापित नहीं हो सकी। डिलीवरी अज्ञात है; पूर्वावलोकन रखें और फिर प्रयास से पहले प्राप्ति जाँचें।'},
  ur:{input:'ریکارڈنگ کی شناخت یا مواد درست نہیں۔ کچھ نیا نہیں بھیجا گیا۔',session:'کارکن کے سیشن کی تصدیق نہیں ہو سکی۔ کچھ نیا نہیں بھیجا گیا۔',unavailable:'وصولی یا ہدایات چیک نہیں ہو سکیں۔ کچھ نیا نہیں بھیجا گیا؛ پیش نظارہ محفوظ رکھیں۔',conflict:'یہ ریکارڈنگ موجودہ ہدایات پر نہیں بھیجی جا سکتی۔ ورژن، آخری وقت یا جواب کی حالت بدل گئی ہے۔ پیش نظارہ رکھیں اور تاریخ چیک کریں۔',receipt:'اپ لوڈ کی تصدیق نہیں ہو سکی۔ ترسیل نامعلوم ہے؛ پیش نظارہ رکھیں اور دوبارہ کوشش سے پہلے وصولی چیک کریں۔'},
  bn:{input:'রেকর্ডিংয়ের পরিচয় বা বিষয়বস্তু অবৈধ। নতুন কিছু পাঠানো হয়নি।',session:'কর্মী সেশন যাচাই করা যায়নি। নতুন কিছু পাঠানো হয়নি।',unavailable:'প্রাপ্তি বা ব্রিফিং যাচাই করা যায়নি। নতুন কিছু পাঠানো হয়নি; পূর্বরূপ রাখুন।',conflict:'এই রেকর্ডিং বর্তমান ব্রিফিংয়ে পাঠানো যায় না। এর সংস্করণ, সময়সীমা বা প্রতিক্রিয়ার অবস্থা বদলেছে। পূর্বরূপ রাখুন ও ইতিহাস দেখুন।',receipt:'আপলোডের নিশ্চিতকরণ যাচাই করা যায়নি। ডেলিভারি অজানা; পূর্বরূপ রাখুন এবং আবার চেষ্টার আগে প্রাপ্তি যাচাই করুন।'},
  ml:{input:'റെക്കോർഡിംഗിന്റെ ഐഡന്റിറ്റിയോ ഉള്ളടക്കമോ അസാധുവാണ്. പുതിയതൊന്നും അയച്ചില്ല.',session:'തൊഴിലാളി സെഷൻ സ്ഥിരീകരിക്കാനായില്ല. പുതിയതൊന്നും അയച്ചില്ല.',unavailable:'ലഭ്യതയോ ബ്രീഫിംഗോ പരിശോധിക്കാനായില്ല. പുതിയതൊന്നും അയച്ചില്ല; പ്രിവ്യൂ സൂക്ഷിക്കുക.',conflict:'ഈ റെക്കോർഡിംഗ് നിലവിലെ ബ്രീഫിംഗിലേക്ക് അയയ്ക്കാനാകില്ല. അതിന്റെ പതിപ്പ്, സമയപരിധി അല്ലെങ്കിൽ പ്രതികരണ നില മാറി. പ്രിവ്യൂ സൂക്ഷിച്ച് ചരിത്രം പരിശോധിക്കുക.',receipt:'അപ്‌ലോഡ് സ്ഥിരീകരണം പരിശോധിക്കാനായില്ല. ഡെലിവറി അജ്ഞാതമാണ്; പ്രിവ്യൂ സൂക്ഷിച്ച് വീണ്ടും ശ്രമിക്കുന്നതിന് മുമ്പ് ലഭ്യത പരിശോധിക്കുക.'},
  ta:{input:'பதிவின் அடையாளம் அல்லது உள்ளடக்கம் தவறானது. புதிதாக எதுவும் அனுப்பப்படவில்லை.',session:'தொழிலாளர் அமர்வைச் சரிபார்க்க முடியவில்லை. புதிதாக எதுவும் அனுப்பப்படவில்லை.',unavailable:'பெறுதல் அல்லது வழிமுறையைச் சரிபார்க்க முடியவில்லை. புதிதாக எதுவும் அனுப்பப்படவில்லை; முன்னோட்டத்தை வைத்திருங்கள்.',conflict:'இந்தப் பதிவை தற்போதைய வழிமுறைக்கு அனுப்ப முடியாது. அதன் பதிப்பு, காலக்கெடு அல்லது பதில் நிலை மாறிவிட்டது. முன்னோட்டத்தை வைத்து வரலாற்றைப் பாருங்கள்.',receipt:'பதிவேற்ற உறுதிப்படுத்தலைச் சரிபார்க்க முடியவில்லை. வழங்கல் தெரியவில்லை; முன்னோட்டத்தை வைத்து மீண்டும் முயலும் முன் பெறுதலைச் சரிபாருங்கள்.'},
  te:{input:'రికార్డింగ్ గుర్తింపు లేదా కంటెంట్ చెల్లదు. కొత్తది ఏమీ పంపబడలేదు.',session:'కార్మిక సెషన్ ధృవీకరించలేకపోయాం. కొత్తది ఏమీ పంపబడలేదు.',unavailable:'స్వీకరణ లేదా బ్రీఫింగ్ తనిఖీ చేయలేకపోయాం. కొత్తది ఏమీ పంపబడలేదు; ప్రివ్యూ ఉంచుకోండి.',conflict:'ఈ రికార్డింగ్ ప్రస్తుత బ్రీఫింగ్‌కు పంపలేము. దాని వెర్షన్, గడువు లేదా ప్రతిస్పందన స్థితి మారింది. ప్రివ్యూ ఉంచి చరిత్రను తనిఖీ చేయండి.',receipt:'అప్‌లోడ్ నిర్ధారణను ధృవీకరించలేకపోయాం. డెలివరీ తెలియదు; ప్రివ్యూ ఉంచి మళ్లీ ప్రయత్నించే ముందు స్వీకరణ తనిఖీ చేయండి.'},
  ne:{input:'रेकर्डिङको पहिचान वा सामग्री अमान्य छ। नयाँ केही पठाइएन।',session:'कर्मचारी सत्र प्रमाणित गर्न सकिएन। नयाँ केही पठाइएन।',unavailable:'प्राप्ति वा ब्रिफिङ जाँच्न सकिएन। नयाँ केही पठाइएन; पूर्वावलोकन राख्नुहोस्।',conflict:'यो रेकर्डिङ हालको ब्रिफिङमा पठाउन सकिँदैन। यसको संस्करण, समयसीमा वा प्रतिक्रिया स्थिति बदलियो। पूर्वावलोकन राखेर इतिहास जाँच्नुहोस्।',receipt:'अपलोड पुष्टि प्रमाणित गर्न सकिएन। डेलिभरी अज्ञात छ; पूर्वावलोकन राखेर फेरि प्रयास गर्नु अघि प्राप्ति जाँच्नुहोस्।'},
  fil:{input:'Hindi wasto ang pagkakakilanlan o nilalaman ng rekording. Walang bagong naipadala.',session:'Hindi ma-verify ang session ng manggagawa. Walang bagong naipadala.',unavailable:'Hindi masuri ang resibo o briefing. Walang bagong naipadala; itago ang preview.',conflict:'Hindi maipadala ang rekording na ito sa kasalukuyang briefing. Nagbago ang bersyon, deadline o status ng sagot. Itago ang preview at tingnan ang kasaysayan.',receipt:'Hindi ma-verify ang kumpirmasyon ng upload. Hindi alam ang paghahatid; itago ang preview at suriin ang resibo bago subukang muli.'},
  si:{input:'පටිගත කිරීමේ අනන්‍යතාව හෝ අන්තර්ගතය වලංගු නැත. අලුතින් කිසිවක් යවා නැත.',session:'සේවක සැසිය තහවුරු කළ නොහැකි විය. අලුතින් කිසිවක් යවා නැත.',unavailable:'ලැබීම හෝ බ්‍රීෆිං පරීක්ෂා කළ නොහැකි විය. අලුතින් කිසිවක් යවා නැත; පෙරදසුන තබා ගන්න.',conflict:'මෙම පටිගත කිරීම වත්මන් බ්‍රීෆිං වෙත යැවිය නොහැක. එහි අනුවාදය, අවසන් දිනය හෝ ප්‍රතිචාර තත්ත්වය වෙනස් විය. පෙරදසුන තබා ඉතිහාසය බලන්න.',receipt:'උඩුගත කිරීමේ තහවුරු කිරීම පරීක්ෂා කළ නොහැකි විය. බෙදාහැරීම නොදනී; පෙරදසුන තබා නැවත උත්සාහ කිරීමට පෙර ලැබීම පරීක්ෂා කරන්න.'},
  ru:{input:'Идентификатор или содержимое записи недействительны. Ничего нового не отправлено.',session:'Не удалось проверить сеанс работника. Ничего нового не отправлено.',unavailable:'Не удалось проверить получение или инструкцию. Ничего нового не отправлено; сохраните предпросмотр.',conflict:'Эту запись нельзя отправить в текущую инструкцию. Её версия, срок или статус ответа изменились. Сохраните предпросмотр и проверьте историю.',receipt:'Подтверждение загрузки не удалось проверить. Доставка неизвестна; сохраните предпросмотр и проверьте получение перед повтором.'},
  'pa-Guru':{input:'ਰਿਕਾਰਡਿੰਗ ਦੀ ਪਛਾਣ ਜਾਂ ਸਮੱਗਰੀ ਅਵੈਧ ਹੈ। ਕੁਝ ਨਵਾਂ ਨਹੀਂ ਭੇਜਿਆ ਗਿਆ।',session:'ਕਰਮਚਾਰੀ ਸੈਸ਼ਨ ਪ੍ਰਮਾਣਿਤ ਨਹੀਂ ਹੋ ਸਕਿਆ। ਕੁਝ ਨਵਾਂ ਨਹੀਂ ਭੇਜਿਆ ਗਿਆ।',unavailable:'ਪ੍ਰਾਪਤੀ ਜਾਂ ਬ੍ਰੀਫਿੰਗ ਜਾਂਚੀ ਨਹੀਂ ਜਾ ਸਕੀ। ਕੁਝ ਨਵਾਂ ਨਹੀਂ ਭੇਜਿਆ ਗਿਆ; ਪੂਰਵਦਰਸ਼ਨ ਰੱਖੋ।',conflict:'ਇਹ ਰਿਕਾਰਡਿੰਗ ਮੌਜੂਦਾ ਬ੍ਰੀਫਿੰਗ ਨੂੰ ਨਹੀਂ ਭੇਜੀ ਜਾ ਸਕਦੀ। ਇਸ ਦਾ ਵਰਜਨ, ਸਮਾਂ-ਸੀਮਾ ਜਾਂ ਜਵਾਬ ਦੀ ਸਥਿਤੀ ਬਦਲ ਗਈ ਹੈ। ਪੂਰਵਦਰਸ਼ਨ ਰੱਖੋ ਤੇ ਇਤਿਹਾਸ ਦੇਖੋ।',receipt:'ਅੱਪਲੋਡ ਦੀ ਪੁਸ਼ਟੀ ਪ੍ਰਮਾਣਿਤ ਨਹੀਂ ਹੋ ਸਕੀ। ਡਿਲੀਵਰੀ ਅਣਜਾਣ ਹੈ; ਪੂਰਵਦਰਸ਼ਨ ਰੱਖੋ ਤੇ ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਤੋਂ ਪਹਿਲਾਂ ਪ੍ਰਾਪਤੀ ਜਾਂਚੋ।'},
  'pa-Arab':{input:'ریکارڈنگ دی پچھان یا مواد درست نئیں۔ کجھ نواں نئیں بھیجیا گیا۔',session:'ورکر سیشن دی تصدیق نئیں ہو سکی۔ کجھ نواں نئیں بھیجیا گیا۔',unavailable:'وصولی یا بریفنگ چیک نئیں ہو سکی۔ کجھ نواں نئیں بھیجیا گیا؛ پیش نظارہ رکھو۔',conflict:'ایہ ریکارڈنگ موجودہ بریفنگ تے نئیں بھیجی جا سکدی۔ ایہدا ورژن، آخری وقت یا جواب دی حالت بدل گئی اے۔ پیش نظارہ رکھو تے تاریخ ویکھو۔',receipt:'اپ لوڈ دی تصدیق نئیں ہو سکی۔ ترسیل نامعلوم اے؛ پیش نظارہ رکھو تے دوبارہ کوشش توں پہلاں وصولی چیک کرو۔'},
  id:{input:'Identitas atau isi rekaman tidak valid. Tidak ada yang baru dikirim.',session:'Sesi pekerja tidak dapat diverifikasi. Tidak ada yang baru dikirim.',unavailable:'Tanda terima atau instruksi tidak dapat diperiksa. Tidak ada yang baru dikirim; simpan pratinjau.',conflict:'Rekaman ini tidak dapat dikirim ke instruksi saat ini. Versi, tenggat, atau status responsnya berubah. Simpan pratinjau dan periksa riwayat.',receipt:'Konfirmasi unggahan tidak dapat diverifikasi. Pengiriman tidak diketahui; simpan pratinjau dan periksa tanda terima sebelum mencoba lagi.'},
};

export async function sendWorkerRecording(
  send:typeof fetch,session:PageSession,scope:RecordingScope,bytes:Uint8Array,submissionId:string,
  current:()=>boolean=()=>true,presentationId:string|null=null,
) {
  const expected={...session},captured={...scope};
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(submissionId)
    || presentationId!==null && !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(presentationId)
    || ![captured.assignmentId,captured.publicationId].every(value=>typeof value==='string' && value.trim().length>0 && value.length<=100)
    || !Number.isSafeInteger(captured.version) || captured.version<1 || !['en','ar','ur'].includes(captured.language)
    || !(bytes instanceof Uint8Array) || bytes.length<8044 || bytes.length>2880044 || bytes.length%2!==0)throw new WorkerAudioRetryError('input');
  const payload=new Uint8Array(bytes);
  const guard=()=>current() && sameWorkerSession(expected,session) && expected.expiresAt===session.expiresAt;
  if(!validWorkerSession(expected) || !guard())throw new WorkerAudioRetryError('session');
  let verified;
  try {
    const response=await send('/api/session',{method:'GET',credentials:'include',cache:'no-store',signal:AbortSignal.timeout(15000),headers:{'x-client-session-context':expected.clientContext!}});
    if(!response.ok)throw Error();
    verified=await response.json();
  }catch {throw new WorkerAudioRetryError('session');}
  if(!guard() || !sameWorkerSession(expected,verified) || verified.expiresAt!==expected.expiresAt)throw new WorkerAudioRetryError('session');

  let receipt;
  try {
    receipt=await readWorkerRequestReceipt((path,options)=>send(path,{...options,signal:AbortSignal.timeout(15000)}),expected,captured.assignmentId,'audio',submissionId,guard);
  }catch {throw new WorkerAudioRetryError(guard()?'unavailable':'session');}
  // Accepted immutable history wins even if the publication has since closed.
  if(receipt)return receipt;

  let detail;
  try {
    const response=await send(`/api/worker/briefings/${encodeURIComponent(captured.assignmentId)}`,{method:'GET',credentials:'include',cache:'no-store',signal:AbortSignal.timeout(15000),headers:{'x-client-session-context':expected.clientContext!}});
    if([403,404,409,410].includes(response.status))throw new WorkerAudioRetryError('conflict');
    if(!response.ok)throw Error();
    detail=await response.json();
  }catch(error){if(error instanceof WorkerAudioRetryError)throw error;throw new WorkerAudioRetryError('unavailable');}
  if(!guard())throw new WorkerAudioRetryError('session');
  if(!detail || detail.id!==captured.assignmentId || detail.publicationId!==captured.publicationId
    || detail.version!==captured.version || detail.language!==captured.language
    || (detail.dueAt!=null && (typeof detail.dueAt!=='string' || !Number.isFinite(Date.parse(detail.dueAt))))
    || !workerResponseState(detail).canRespond)throw new WorkerAudioRetryError('conflict');
  if(!guard())throw new WorkerAudioRetryError('session');

  try {
    const response=await send(`/api/worker/briefings/${encodeURIComponent(captured.assignmentId)}/audio`,{
      method:'POST',credentials:'include',cache:'no-store',signal:AbortSignal.timeout(45000),
      headers:{'content-type':'audio/wav','x-submission-id':submissionId,'x-client-session-context':expected.clientContext!,
        ...(presentationId?{'x-presentation-id':presentationId}:{})},
      body:new Blob([payload],{type:'audio/wav'}),
    });
    const result=await response.json();
    if(!response.ok || !guard())throw Error();
    return checkedWorkerReceipt(result,'audio',{requestId:submissionId,assignmentId:captured.assignmentId,clientContext:expected.clientContext!});
  }catch {throw new WorkerAudioRetryError('receipt');}
}
