import {validWorkerSession,sameWorkerSession,type PageSession} from './session-state.ts';
type Store=Pick<Storage,'getItem'|'setItem'>;
type Ledger={context:string;expiresAt:string;entries:{fingerprint:string;requestId:string}[]};
const key='understood:worker-requests:v1';
const hash=/^[a-f0-9]{64}$/;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
type Failure='storage'|'corrupt'|'full'|'expired'|'input'|'receipt';
export class WorkerRequestError extends Error {
  readonly code:Failure;
  constructor(code:Failure){super(code);this.code=code;}
}
export const workerRequestText={
  en:{storage:'This tab could not retain the request identity. Nothing was sent.',corrupt:'The request record in this tab cannot be verified. Check your submitted answers before starting another request.',full:'The request limit for this tab has been reached. Nothing new was sent.',expired:'This worker session is no longer valid. Nothing was sent.',input:'This request is invalid. Nothing was sent.',receipt:'The server acknowledgement could not be verified. Your request may have been received. Check its history before retrying.'},
  ar:{storage:'تعذر حفظ هوية الطلب في هذه الصفحة. لم يُرسل شيء.',corrupt:'تعذر التحقق من سجل الطلبات في هذه الصفحة. تحقق من إجاباتك المرسلة قبل بدء طلب آخر.',full:'تم بلوغ حد الطلبات لهذه الصفحة. لم يُرسل شيء جديد.',expired:'جلسة العامل هذه لم تعد صالحة. لم يُرسل شيء.',input:'هذا الطلب غير صالح. لم يُرسل شيء.',receipt:'تعذر التحقق من تأكيد الخادم. ربما تم استلام طلبك. تحقق من سجله قبل إعادة المحاولة.'},
  hi:{storage:'यह टैब अनुरोध की पहचान सुरक्षित नहीं रख सका। कुछ नहीं भेजा गया।',corrupt:'इस टैब में अनुरोध रिकॉर्ड सत्यापित नहीं हो सकता। दूसरा अनुरोध शुरू करने से पहले अपने भेजे गए उत्तर देखें।',full:'इस टैब के लिए अनुरोध सीमा पूरी हो गई है। कुछ नया नहीं भेजा गया।',expired:'यह कर्मचारी सत्र अब मान्य नहीं है। कुछ नहीं भेजा गया।',input:'यह अनुरोध अमान्य है। कुछ नहीं भेजा गया।',receipt:'सर्वर की पुष्टि सत्यापित नहीं हो सकी। हो सकता है आपका अनुरोध प्राप्त हो गया हो। फिर से प्रयास करने से पहले उसका इतिहास जाँचें।'},
  ur:{storage:'یہ صفحہ درخواست کی شناخت محفوظ نہیں کر سکا۔ کچھ نہیں بھیجا گیا۔',corrupt:'اس صفحے کی درخواستوں کے ریکارڈ کی تصدیق نہیں ہو سکی۔ نئی درخواست سے پہلے اپنے بھیجے گئے جواب دیکھیں۔',full:'اس صفحے کی درخواستوں کی حد پوری ہو گئی ہے۔ کچھ نیا نہیں بھیجا گیا۔',expired:'کارکن کا یہ سیشن اب درست نہیں ہے۔ کچھ نہیں بھیجا گیا۔',input:'یہ درخواست درست نہیں ہے۔ کچھ نہیں بھیجا گیا۔',receipt:'سرور کی تصدیق کی جانچ نہیں ہو سکی۔ ممکن ہے آپ کی درخواست موصول ہو گئی ہو۔ دوبارہ کوشش سے پہلے اس کی تاریخ دیکھیں۔'},
  bn:{storage:'এই ট্যাব অনুরোধের পরিচয় সংরক্ষণ করতে পারেনি। কিছু পাঠানো হয়নি।',corrupt:'এই ট্যাবের অনুরোধ রেকর্ড যাচাই করা যায় না। আরেকটি অনুরোধ শুরুর আগে আপনার পাঠানো উত্তর দেখুন।',full:'এই ট্যাবের অনুরোধসীমা পূর্ণ হয়েছে। নতুন কিছু পাঠানো হয়নি।',expired:'এই কর্মী সেশন আর বৈধ নয়। কিছু পাঠানো হয়নি।',input:'এই অনুরোধ অবৈধ। কিছু পাঠানো হয়নি।',receipt:'সার্ভারের নিশ্চিতকরণ যাচাই করা যায়নি। আপনার অনুরোধ হয়তো গৃহীত হয়েছে। আবার চেষ্টার আগে এর ইতিহাস দেখুন।'},
  ml:{storage:'ഈ ടാബിന് അഭ്യർത്ഥനയുടെ ഐഡന്റിറ്റി സൂക്ഷിക്കാനായില്ല. ഒന്നും അയച്ചില്ല.',corrupt:'ഈ ടാബിലെ അഭ്യർത്ഥന രേഖ സ്ഥിരീകരിക്കാനാകുന്നില്ല. മറ്റൊരു അഭ്യർത്ഥന തുടങ്ങുന്നതിന് മുമ്പ് അയച്ച ഉത്തരങ്ങൾ പരിശോധിക്കുക.',full:'ഈ ടാബിന്റെ അഭ്യർത്ഥന പരിധി എത്തി. പുതിയതൊന്നും അയച്ചില്ല.',expired:'ഈ തൊഴിലാളി സെഷൻ ഇനി സാധുവല്ല. ഒന്നും അയച്ചില്ല.',input:'ഈ അഭ്യർത്ഥന അസാധുവാണ്. ഒന്നും അയച്ചില്ല.',receipt:'സെർവറിന്റെ സ്ഥിരീകരണം പരിശോധിക്കാനായില്ല. നിങ്ങളുടെ അഭ്യർത്ഥന ലഭിച്ചിരിക്കാം. വീണ്ടും ശ്രമിക്കുന്നതിന് മുമ്പ് ചരിത്രം പരിശോധിക്കുക.'},
  ta:{storage:'இந்த தாவலால் கோரிக்கை அடையாளத்தைச் சேமிக்க முடியவில்லை. எதுவும் அனுப்பப்படவில்லை.',corrupt:'இந்த தாவலில் உள்ள கோரிக்கைப் பதிவைச் சரிபார்க்க முடியாது. மற்றொரு கோரிக்கையைத் தொடங்கும் முன் அனுப்பிய பதில்களைப் பாருங்கள்.',full:'இந்த தாவலின் கோரிக்கை வரம்பு எட்டப்பட்டது. புதிதாக எதுவும் அனுப்பப்படவில்லை.',expired:'இந்த தொழிலாளர் அமர்வு இனி செல்லாது. எதுவும் அனுப்பப்படவில்லை.',input:'இந்த கோரிக்கை தவறானது. எதுவும் அனுப்பப்படவில்லை.',receipt:'சேவையகத்தின் உறுதிப்படுத்தலைச் சரிபார்க்க முடியவில்லை. உங்கள் கோரிக்கை பெறப்பட்டிருக்கலாம். மீண்டும் முயலும் முன் அதன் வரலாற்றைப் பாருங்கள்.'},
  te:{storage:'ఈ ట్యాబ్ అభ్యర్థన గుర్తింపును నిల్వ చేయలేకపోయింది. ఏమీ పంపబడలేదు.',corrupt:'ఈ ట్యాబ్‌లోని అభ్యర్థన రికార్డును ధృవీకరించలేము. మరో అభ్యర్థన ప్రారంభించే ముందు మీ పంపిన సమాధానాలను తనిఖీ చేయండి.',full:'ఈ ట్యాబ్ అభ్యర్థన పరిమితి చేరుకుంది. కొత్తది ఏమీ పంపబడలేదు.',expired:'ఈ కార్మిక సెషన్ ఇకపై చెల్లదు. ఏమీ పంపబడలేదు.',input:'ఈ అభ్యర్థన చెల్లదు. ఏమీ పంపబడలేదు.',receipt:'సర్వర్ నిర్ధారణను ధృవీకరించలేకపోయాం. మీ అభ్యర్థన అంది ఉండవచ్చు. మళ్లీ ప్రయత్నించే ముందు దాని చరిత్రను తనిఖీ చేయండి.'},
  ne:{storage:'यो ट्याबले अनुरोधको पहिचान राख्न सकेन। केही पठाइएन।',corrupt:'यो ट्याबको अनुरोध रेकर्ड प्रमाणित गर्न सकिएन। अर्को अनुरोध सुरु गर्नु अघि पठाएका उत्तर हेर्नुहोस्।',full:'यो ट्याबको अनुरोध सीमा पुग्यो। नयाँ केही पठाइएन।',expired:'यो कर्मचारी सत्र अब मान्य छैन। केही पठाइएन।',input:'यो अनुरोध अमान्य छ। केही पठाइएन।',receipt:'सर्भरको पुष्टि प्रमाणित गर्न सकिएन। तपाईंको अनुरोध प्राप्त भएको हुन सक्छ। फेरि प्रयास गर्नु अघि यसको इतिहास जाँच्नुहोस्।'},
  fil:{storage:'Hindi ma-save ng tab na ito ang pagkakakilanlan ng kahilingan. Walang naipadala.',corrupt:'Hindi ma-verify ang talaan ng kahilingan sa tab na ito. Tingnan ang mga naipadalang sagot bago magsimula ng panibagong kahilingan.',full:'Naabot na ang limitasyon ng kahilingan para sa tab na ito. Walang bagong naipadala.',expired:'Hindi na wasto ang session ng manggagawang ito. Walang naipadala.',input:'Hindi wasto ang kahilingang ito. Walang naipadala.',receipt:'Hindi ma-verify ang kumpirmasyon ng server. Maaaring natanggap ang kahilingan mo. Tingnan ang kasaysayan bago subukang muli.'},
  si:{storage:'මෙම ටැබයට ඉල්ලීමේ අනන්‍යතාව තබා ගැනීමට නොහැකි විය. කිසිවක් යවා නැත.',corrupt:'මෙම ටැබයේ ඉල්ලීම් වාර්තාව තහවුරු කළ නොහැක. තවත් ඉල්ලීමක් ආරම්භ කිරීමට පෙර යැවූ පිළිතුරු පරීක්ෂා කරන්න.',full:'මෙම ටැබයේ ඉල්ලීම් සීමාව ළඟා විය. අලුතින් කිසිවක් යවා නැත.',expired:'මෙම සේවක සැසිය තවදුරටත් වලංගු නැත. කිසිවක් යවා නැත.',input:'මෙම ඉල්ලීම වලංගු නැත. කිසිවක් යවා නැත.',receipt:'සේවාදායක තහවුරු කිරීම පරීක්ෂා කළ නොහැකි විය. ඔබේ ඉල්ලීම ලැබී තිබිය හැක. නැවත උත්සාහ කිරීමට පෙර එහි ඉතිහාසය බලන්න.'},
  ru:{storage:'Этой вкладке не удалось сохранить идентификатор запроса. Ничего не отправлено.',corrupt:'Запись запросов в этой вкладке не удаётся проверить. Проверьте отправленные ответы, прежде чем начинать новый запрос.',full:'Достигнут лимит запросов для этой вкладки. Ничего нового не отправлено.',expired:'Сеанс работника больше не действителен. Ничего не отправлено.',input:'Этот запрос недействителен. Ничего не отправлено.',receipt:'Подтверждение сервера не удалось проверить. Возможно, ваш запрос получен. Проверьте историю перед повторной попыткой.'},
  'pa-Guru':{storage:'ਇਹ ਟੈਬ ਬੇਨਤੀ ਦੀ ਪਛਾਣ ਸੰਭਾਲ ਨਹੀਂ ਸਕੀ। ਕੁਝ ਨਹੀਂ ਭੇਜਿਆ ਗਿਆ।',corrupt:'ਇਸ ਟੈਬ ਦਾ ਬੇਨਤੀ ਰਿਕਾਰਡ ਪ੍ਰਮਾਣਿਤ ਨਹੀਂ ਹੋ ਸਕਦਾ। ਨਵੀਂ ਬੇਨਤੀ ਸ਼ੁਰੂ ਕਰਨ ਤੋਂ ਪਹਿਲਾਂ ਭੇਜੇ ਜਵਾਬ ਦੇਖੋ।',full:'ਇਸ ਟੈਬ ਲਈ ਬੇਨਤੀਆਂ ਦੀ ਸੀਮਾ ਪੂਰੀ ਹੋ ਗਈ ਹੈ। ਕੁਝ ਨਵਾਂ ਨਹੀਂ ਭੇਜਿਆ ਗਿਆ।',expired:'ਇਹ ਕਰਮਚਾਰੀ ਸੈਸ਼ਨ ਹੁਣ ਵੈਧ ਨਹੀਂ ਹੈ। ਕੁਝ ਨਹੀਂ ਭੇਜਿਆ ਗਿਆ।',input:'ਇਹ ਬੇਨਤੀ ਅਵੈਧ ਹੈ। ਕੁਝ ਨਹੀਂ ਭੇਜਿਆ ਗਿਆ।',receipt:'ਸਰਵਰ ਦੀ ਪੁਸ਼ਟੀ ਪ੍ਰਮਾਣਿਤ ਨਹੀਂ ਹੋ ਸਕੀ। ਹੋ ਸਕਦਾ ਹੈ ਤੁਹਾਡੀ ਬੇਨਤੀ ਮਿਲ ਗਈ ਹੋਵੇ। ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਤੋਂ ਪਹਿਲਾਂ ਇਸ ਦਾ ਇਤਿਹਾਸ ਦੇਖੋ।'},
  'pa-Arab':{storage:'ایہ ٹیب درخواست دی پچھان سنبھال نئیں سکی۔ کجھ نئیں بھیجیا گیا۔',corrupt:'ایس ٹیب دا درخواست ریکارڈ تصدیق نئیں ہو سکدا۔ نویں درخواست توں پہلاں بھیجے جواب ویکھو۔',full:'ایس ٹیب لئی درخواستاں دی حد پوری ہو گئی اے۔ کجھ نواں نئیں بھیجیا گیا۔',expired:'ایہ ورکر سیشن ہن درست نئیں۔ کجھ نئیں بھیجیا گیا۔',input:'ایہ درخواست درست نئیں۔ کجھ نئیں بھیجیا گیا۔',receipt:'سرور دی تصدیق نئیں ہو سکی۔ ہو سکدا اے تہاڈی درخواست مل گئی ہووے۔ دوبارہ کوشش توں پہلاں ایہدا تاریخ ویکھو۔'},
  id:{storage:'Tab ini tidak dapat menyimpan identitas permintaan. Tidak ada yang dikirim.',corrupt:'Catatan permintaan di tab ini tidak dapat diverifikasi. Periksa jawaban terkirim sebelum memulai permintaan lain.',full:'Batas permintaan untuk tab ini telah tercapai. Tidak ada yang baru dikirim.',expired:'Sesi pekerja ini tidak lagi valid. Tidak ada yang dikirim.',input:'Permintaan ini tidak valid. Tidak ada yang dikirim.',receipt:'Konfirmasi server tidak dapat diverifikasi. Permintaan Anda mungkin telah diterima. Periksa riwayatnya sebelum mencoba lagi.'},
};
export function checkedWorkerReceipt(value:unknown,kind:'answer'|'help'|'audio',expected:{requestId:string;assignmentId:string;clientContext:string}) {
  const result=value as Record<string,unknown>|null;
  const allowed=[...(kind==='answer'?['id','outcome','assessmentStatus','duplicate']:kind==='help'?['id','status','duplicate']:['id','status','receivedAt','aiStatus','duplicate']),'requestId','assignmentId','clientContext'];
  if(!result || typeof result!=='object' || Array.isArray(result) || Object.keys(result).some(name=>!allowed.includes(name))
    || typeof result.id!=='string' || !uuid.test(result.id) || typeof result.duplicate!=='boolean'
    || !uuid.test(expected.requestId) || !expected.assignmentId || !hash.test(expected.clientContext)
    || result.requestId!==expected.requestId || result.assignmentId!==expected.assignmentId || result.clientContext!==expected.clientContext)throw new WorkerRequestError('receipt');
  if(kind==='audio'){
    if(!['received','processing','blocked','transcribed','failed'].includes(result.status as string)
      || typeof result.receivedAt!=='string' || !Number.isFinite(Date.parse(result.receivedAt))
      || new Date(result.receivedAt).toISOString()!==result.receivedAt
      || (result.aiStatus!==undefined && !['pending','blocked','transcribed','failed'].includes(result.aiStatus as string)))throw new WorkerRequestError('receipt');
  }else if(kind==='help'){
    if(result.id!==expected.requestId || !['open','resolved'].includes(result.status as string))throw new WorkerRequestError('receipt');
  }else {
    const complete=['matched','clarification','unassessable'].includes(result.outcome as string);
    if(!(complete && (result.assessmentStatus===undefined || result.assessmentStatus==='complete'))
      && !(result.outcome===null && result.assessmentStatus==='pending'))throw new WorkerRequestError('receipt');
  }
  return result;
}

export async function readWorkerRequestReceipt(send:typeof fetch,session:PageSession,assignmentId:string,kind:'answer'|'help'|'audio',requestId:string,current:()=>boolean=()=>true) {
  const expected={...session};
  if(!validWorkerSession(expected) || !current() || typeof requestId!=='string' || !uuid.test(requestId) || typeof assignmentId!=='string' || !assignmentId || assignmentId.length>100 || !['answer','help','audio'].includes(kind))throw new WorkerRequestError('receipt');
  const response=await send(`/api/worker/briefings/${encodeURIComponent(assignmentId)}/receipts/${kind}/${requestId}`,{
    method:'GET',credentials:'include',cache:'no-store',headers:{'x-client-session-context':expected.clientContext!},
  });
  const result=response.ok ? await response.json() : null;
  if(!current() || !sameWorkerSession(expected,session) || expected.expiresAt!==session.expiresAt)throw new WorkerRequestError('receipt');
  // A missing receipt is unknown, not proof that a prior POST was never accepted.
  if(response.status===404)return null;
  if(!response.ok)throw new WorkerRequestError('receipt');
  return checkedWorkerReceipt(result,kind,{requestId,assignmentId,clientContext:expected.clientContext!});
}

export const workerReceiptCheckText={
  en:{answer:'Answer',help:'Help request',audio:'Recording',check:'Check receipt',unknown:'Receipt is not confirmed. Delivery remains unknown; your draft stays here.',received:'Receipt verified. Your draft remains here; nothing was resent.',failed:'Receipt could not be checked. Delivery remains unknown; nothing was resent.'},
  ar:{answer:'الإجابة',help:'طلب المساعدة',audio:'التسجيل',check:'تحقق من الاستلام',unknown:'لم يتم تأكيد الاستلام. الإرسال غير مؤكد؛ تبقى المسودة هنا.',received:'تم التحقق من الاستلام. تبقى المسودة هنا؛ لم يُعد إرسال شيء.',failed:'تعذر التحقق من الاستلام. الإرسال غير مؤكد؛ لم يُعد إرسال شيء.'},
  hi:{answer:'उत्तर',help:'सहायता अनुरोध',audio:'रिकॉर्डिंग',check:'प्राप्ति जाँचें',unknown:'प्राप्ति की पुष्टि नहीं हुई। डिलीवरी अज्ञात है; आपका ड्राफ़्ट यहीं रहेगा।',received:'प्राप्ति सत्यापित। आपका ड्राफ़्ट यहीं रहेगा; कुछ फिर से नहीं भेजा गया।',failed:'प्राप्ति जाँची नहीं जा सकी। डिलीवरी अज्ञात है; कुछ फिर से नहीं भेजा गया।'},
  ur:{answer:'جواب',help:'مدد کی درخواست',audio:'ریکارڈنگ',check:'وصولی چیک کریں',unknown:'وصولی کی تصدیق نہیں ہوئی۔ ترسیل نامعلوم ہے؛ مسودہ یہیں موجود ہے۔',received:'وصولی کی تصدیق ہو گئی۔ مسودہ یہیں موجود ہے؛ دوبارہ کچھ نہیں بھیجا گیا۔',failed:'وصولی چیک نہیں ہو سکی۔ ترسیل نامعلوم ہے؛ دوبارہ کچھ نہیں بھیجا گیا۔'},
  bn:{answer:'উত্তর',help:'সহায়তার অনুরোধ',audio:'রেকর্ডিং',check:'প্রাপ্তি যাচাই করুন',unknown:'প্রাপ্তি নিশ্চিত হয়নি। ডেলিভারি অজানা; আপনার খসড়া এখানেই থাকবে।',received:'প্রাপ্তি যাচাই হয়েছে। আপনার খসড়া এখানেই থাকবে; কিছু আবার পাঠানো হয়নি।',failed:'প্রাপ্তি যাচাই করা যায়নি। ডেলিভারি অজানা; কিছু আবার পাঠানো হয়নি।'},
  ml:{answer:'ഉത്തരം',help:'സഹായ അഭ്യർത്ഥന',audio:'റെക്കോർഡിംഗ്',check:'ലഭ്യത പരിശോധിക്കുക',unknown:'ലഭ്യത സ്ഥിരീകരിച്ചിട്ടില്ല. ഡെലിവറി അജ്ഞാതമാണ്; നിങ്ങളുടെ ഡ്രാഫ്റ്റ് ഇവിടെ തുടരും.',received:'ലഭ്യത സ്ഥിരീകരിച്ചു. നിങ്ങളുടെ ഡ്രാഫ്റ്റ് ഇവിടെ തുടരും; ഒന്നും വീണ്ടും അയച്ചില്ല.',failed:'ലഭ്യത പരിശോധിക്കാനായില്ല. ഡെലിവറി അജ്ഞാതമാണ്; ഒന്നും വീണ്ടും അയച്ചില്ല.'},
  ta:{answer:'பதில்',help:'உதவி கோரிக்கை',audio:'பதிவு',check:'பெறுதலைச் சரிபார்',unknown:'பெறுதல் உறுதிசெய்யப்படவில்லை. வழங்கல் தெரியவில்லை; உங்கள் வரைவு இங்கேயே இருக்கும்.',received:'பெறுதல் சரிபார்க்கப்பட்டது. உங்கள் வரைவு இங்கேயே இருக்கும்; எதுவும் மீண்டும் அனுப்பப்படவில்லை.',failed:'பெறுதலைச் சரிபார்க்க முடியவில்லை. வழங்கல் தெரியவில்லை; எதுவும் மீண்டும் அனுப்பப்படவில்லை.'},
  te:{answer:'సమాధానం',help:'సహాయ అభ్యర్థన',audio:'రికార్డింగ్',check:'స్వీకరణ తనిఖీ చేయండి',unknown:'స్వీకరణ నిర్ధారించబడలేదు. డెలివరీ తెలియదు; మీ డ్రాఫ్ట్ ఇక్కడే ఉంటుంది.',received:'స్వీకరణ ధృవీకరించబడింది. మీ డ్రాఫ్ట్ ఇక్కడే ఉంటుంది; ఏమీ మళ్లీ పంపబడలేదు.',failed:'స్వీకరణ తనిఖీ చేయలేకపోయాం. డెలివరీ తెలియదు; ఏమీ మళ్లీ పంపబడలేదు.'},
  ne:{answer:'उत्तर',help:'सहयोग अनुरोध',audio:'रेकर्डिङ',check:'प्राप्ति जाँच्नुहोस्',unknown:'प्राप्ति पुष्टि भएन। डेलिभरी अज्ञात छ; तपाईंको मस्यौदा यहीँ रहन्छ।',received:'प्राप्ति प्रमाणित भयो। तपाईंको मस्यौदा यहीँ रहन्छ; केही फेरि पठाइएन।',failed:'प्राप्ति जाँच्न सकिएन। डेलिभरी अज्ञात छ; केही फेरि पठाइएन।'},
  fil:{answer:'Sagot',help:'Kahilingan ng tulong',audio:'Rekording',check:'Suriin ang resibo',unknown:'Hindi nakumpirma ang resibo. Hindi alam ang paghahatid; mananatili rito ang iyong draft.',received:'Na-verify ang resibo. Mananatili rito ang iyong draft; walang muling naipadala.',failed:'Hindi masuri ang resibo. Hindi alam ang paghahatid; walang muling naipadala.'},
  si:{answer:'පිළිතුර',help:'උදව් ඉල්ලීම',audio:'පටිගත කිරීම',check:'ලැබීම පරීක්ෂා කරන්න',unknown:'ලැබීම තහවුරු වී නැත. බෙදාහැරීම නොදනී; ඔබේ කෙටුම්පත මෙහිම රැඳේ.',received:'ලැබීම තහවුරු විය. ඔබේ කෙටුම්පත මෙහිම රැඳේ; නැවත කිසිවක් යවා නැත.',failed:'ලැබීම පරීක්ෂා කළ නොහැකි විය. බෙදාහැරීම නොදනී; නැවත කිසිවක් යවා නැත.'},
  ru:{answer:'Ответ',help:'Запрос помощи',audio:'Запись',check:'Проверить получение',unknown:'Получение не подтверждено. Доставка неизвестна; черновик останется здесь.',received:'Получение подтверждено. Черновик останется здесь; ничего не отправлено повторно.',failed:'Не удалось проверить получение. Доставка неизвестна; ничего не отправлено повторно.'},
  'pa-Guru':{answer:'ਜਵਾਬ',help:'ਮਦਦ ਬੇਨਤੀ',audio:'ਰਿਕਾਰਡਿੰਗ',check:'ਪ੍ਰਾਪਤੀ ਜਾਂਚੋ',unknown:'ਪ੍ਰਾਪਤੀ ਦੀ ਪੁਸ਼ਟੀ ਨਹੀਂ ਹੋਈ। ਡਿਲੀਵਰੀ ਅਣਜਾਣ ਹੈ; ਤੁਹਾਡਾ ਡਰਾਫਟ ਇੱਥੇ ਹੀ ਰਹੇਗਾ।',received:'ਪ੍ਰਾਪਤੀ ਪ੍ਰਮਾਣਿਤ ਹੋਈ। ਤੁਹਾਡਾ ਡਰਾਫਟ ਇੱਥੇ ਹੀ ਰਹੇਗਾ; ਕੁਝ ਦੁਬਾਰਾ ਨਹੀਂ ਭੇਜਿਆ ਗਿਆ।',failed:'ਪ੍ਰਾਪਤੀ ਜਾਂਚੀ ਨਹੀਂ ਜਾ ਸਕੀ। ਡਿਲੀਵਰੀ ਅਣਜਾਣ ਹੈ; ਕੁਝ ਦੁਬਾਰਾ ਨਹੀਂ ਭੇਜਿਆ ਗਿਆ।'},
  'pa-Arab':{answer:'جواب',help:'مدد درخواست',audio:'ریکارڈنگ',check:'وصولی چیک کرو',unknown:'وصولی دی تصدیق نئیں ہوئی۔ ترسیل نامعلوم اے؛ تہاڈا ڈرافٹ ایتھے ای رہوے گا۔',received:'وصولی دی تصدیق ہو گئی۔ تہاڈا ڈرافٹ ایتھے ای رہوے گا؛ کجھ دوبارہ نئیں بھیجیا گیا۔',failed:'وصولی چیک نئیں ہو سکی۔ ترسیل نامعلوم اے؛ کجھ دوبارہ نئیں بھیجیا گیا۔'},
  id:{answer:'Jawaban',help:'Permintaan bantuan',audio:'Rekaman',check:'Periksa tanda terima',unknown:'Tanda terima belum terkonfirmasi. Pengiriman tidak diketahui; draf tetap di sini.',received:'Tanda terima terverifikasi. Draf tetap di sini; tidak ada yang dikirim ulang.',failed:'Tanda terima tidak dapat diperiksa. Pengiriman tidak diketahui; tidak ada yang dikirim ulang.'},
};
function read(storage:Store):Ledger|null {
  let raw:string|null;
  try {raw=storage.getItem(key);}catch {throw new WorkerRequestError('storage');}
  if(raw===null)return null;
  try {
    if(raw.length>20000)throw Error();
    const value=JSON.parse(raw) as Ledger;
    if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).sort().join(',')!=='context,entries,expiresAt'
      || typeof value.context!=='string' || !hash.test(value.context) || typeof value.expiresAt!=='string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.expiresAt) || !Number.isFinite(Date.parse(value.expiresAt))
      || !Array.isArray(value.entries) || value.entries.length>100)throw Error();
    const fingerprints=new Set<string>(),ids=new Set<string>();
    for(const entry of value.entries){
      if(!entry || typeof entry!=='object' || Array.isArray(entry) || Object.keys(entry).sort().join(',')!=='fingerprint,requestId'
        || typeof entry.fingerprint!=='string' || !hash.test(entry.fingerprint) || typeof entry.requestId!=='string' || !uuid.test(entry.requestId)
        || fingerprints.has(entry.fingerprint) || ids.has(entry.requestId))throw Error();
      fingerprints.add(entry.fingerprint);ids.add(entry.requestId);
    }
    return value;
  }catch {throw new WorkerRequestError('corrupt');}
}
export async function workerRequestId(storage:Store,session:PageSession,assignmentId:string,kind:'answer'|'help',text:string,now=Date.now,repeatId?:string) {
  if(!validWorkerSession(session,now()))throw new WorkerRequestError('expired');
  const expected={...session};
  if(typeof assignmentId!=='string' || !assignmentId || assignmentId.length>100 || !['answer','help'].includes(kind)
    || typeof text!=='string' || !text.trim() || text.length>(kind==='answer'?2000:500) || (kind==='help' && text.trim().length<3))throw new WorkerRequestError('input');
  if(repeatId!==undefined && (kind!=='answer' || !uuid.test(repeatId)))throw new WorkerRequestError('input');
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([session.clientContext,assignmentId,kind,text.trim(),...(repeatId?[repeatId]:[])])));
  if(!sameWorkerSession(expected,session,now()) || session.expiresAt!==expected.expiresAt)throw new WorkerRequestError('expired');
  const fingerprint=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  const old=read(storage);
  // The ledger contains request identifiers only, never a recoverable answer or audio payload.
  const ledger=old && old.context===session.clientContext ? old : {context:session.clientContext!,expiresAt:session.expiresAt!,entries:[]};
  if(ledger.expiresAt!==session.expiresAt)throw new WorkerRequestError('corrupt');
  const existing=ledger.entries.find(entry=>entry.fingerprint===fingerprint);
  if(existing)return existing.requestId;
  if(ledger.entries.length>=100)throw new WorkerRequestError('full');
  const requestId=crypto.randomUUID();ledger.entries.push({fingerprint,requestId});
  const raw=JSON.stringify(ledger);
  try {storage.setItem(key,raw);if(storage.getItem(key)!==raw)throw Error();}
  catch {throw new WorkerRequestError('storage');}
  return requestId;
}
