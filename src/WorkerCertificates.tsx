import {useEffect,useRef,useState} from 'react';
import {Award,RefreshCw} from 'lucide-react';
import {workerUiDirection,type WorkerUiLanguage} from './worker-ui-language';
import type {PageSession} from './session-state';

type WorkerCertificate={id:string;briefingId:string;briefingTitle:string;publicationVersion:number;title:string;language:string;source:string;awardedAt:string;expiresAt:string;status:'active'|'expiring'|'expired'};
type Props={session:PageSession;language:WorkerUiLanguage;refresh:number;current:()=>boolean;onSessionLost:()=>void;timezone?:string};

export const workerCertificateText:Record<WorkerUiLanguage,{nav:string;title:string;subtitle:string;loading:string;loadFailed:string;empty:string;awarded:string;expires:string;active:string;expiring:string;expired:string;note:string;refresh:string}>={
  en:{nav:'Certificates',title:'My certificates',subtitle:'Certificates recorded when your answer matched the key facts.',loading:'Loading certificates...',loadFailed:'Your certificates could not be loaded. Check your connection and try again.',empty:'No certificates have been recorded yet.',awarded:'Awarded',expires:'Expires',active:'Valid',expiring:'Expiring soon',expired:'Expired',note:'A certificate records a matched answer. It is not proof of safe work.',refresh:'Refresh certificates'},
  ar:{nav:'الشهادات',title:'شهاداتي',subtitle:'شهادات تُسجَّل عندما تطابق إجابتك المعلومات المطلوبة.',loading:'جارٍ تحميل الشهادات...',loadFailed:'تعذّر تحميل شهاداتك. تحقق من الاتصال وحاول مجدداً.',empty:'لم تُسجَّل أي شهادة بعد.',awarded:'تاريخ المنح',expires:'تنتهي الصلاحية',active:'سارية',expiring:'تنتهي قريباً',expired:'منتهية',note:'الشهادة تسجّل تطابق الإجابة. وهي ليست دليلاً على العمل الآمن.',refresh:'تحديث الشهادات'},
  ur:{nav:'اسنادیں',title:'میرے اسناد',subtitle:'اسناد جو آپ کے جواب کے اہم حقائق سے میل کھانے پر درج ہوتے ہیں۔',loading:'اسناد لوڈ ہو رہی ہیں...',loadFailed:'آپ کے اسناد لوڈ نہیں ہو سکے۔ کنکشن چیک کریں اور دوبارہ کوشش کریں۔',empty:'ابھی کوئی سند درج نہیں ہوئی۔',awarded:'جاری',expires:'میعاد ختم',active:'کارآمد',expiring:'جلد ختم ہوگی',expired:'ختم شدہ',note:'سند صرف جواب کے میل کھانے کا ریکارڈ ہے۔ یہ محفوظ کام کا ثبوت نہیں۔',refresh:'اسناد تازہ کریں'},
  hi:{nav:'प्रमाणपत्र',title:'मेरे प्रमाणपत्र',subtitle:'जब आपका उत्तर मुख्य तथ्यों से मेल खाता है तब दर्ज प्रमाणपत्र।',loading:'प्रमाणपत्र लोड हो रहे हैं...',loadFailed:'आपके प्रमाणपत्र लोड नहीं हो सके। कनेक्शन जाँचें और फिर कोशिश करें।',empty:'अभी कोई प्रमाणपत्र दर्ज नहीं हुआ।',awarded:'दिया गया',expires:'समाप्ति',active:'मान्य',expiring:'जल्द समाप्त',expired:'समाप्त',note:'प्रमाणपत्र मेल खाते उत्तर का रिकॉर्ड है। यह सुरक्षित कार्य का प्रमाण नहीं है।',refresh:'प्रमाणपत्र रीफ़्रेश करें'},
  bn:{nav:'সনদ',title:'আমার সনদ',subtitle:'আপনার উত্তর মূল তথ্যের সাথে মিললে যে সনদ রেকর্ড হয়।',loading:'সনদ লোড হচ্ছে...',loadFailed:'আপনার সনদ লোড করা যায়নি। সংযোগ যাচাই করে আবার চেষ্টা করুন।',empty:'এখনও কোনো সনদ রেকর্ড হয়নি।',awarded:'প্রদান',expires:'মেয়াদ শেষ',active:'বৈধ',expiring:'শীঘ্রই শেষ',expired:'মেয়াদোত্তীর্ণ',note:'সনদ মিলে যাওয়া উত্তরের রেকর্ড। এটি নিরাপদ কাজের প্রমাণ নয়।',refresh:'সনদ রিফ্রেশ করুন'},
  ml:{nav:'സർട്ടിഫിക്കറ്റുകൾ',title:'എന്റെ സർട്ടിഫിക്കറ്റുകൾ',subtitle:'നിങ്ങളുടെ ഉത്തരം പ്രധാന വസ്തുതകളുമായി പൊരുത്തപ്പെടുമ്പോൾ രേഖപ്പെടുത്തുന്ന സർട്ടിഫിക്കറ്റുകൾ.',loading:'സർട്ടിഫിക്കറ്റുകൾ ലോഡ് ചെയ്യുന്നു...',loadFailed:'നിങ്ങളുടെ സർട്ടിഫിക്കറ്റുകൾ ലോഡ് ചെയ്യാനായില്ല. കണക്ഷൻ പരിശോധിച്ച് വീണ്ടും ശ്രമിക്കുക.',empty:'ഇതുവരെ സർട്ടിഫിക്കറ്റുകളൊന്നും രേഖപ്പെടുത്തിയിട്ടില്ല.',awarded:'നൽകിയത്',expires:'കാലാവധി',active:'സാധുവാണ്',expiring:'ഉടൻ കാലാവധി തീരും',expired:'കാലാവധി തീർന്നു',note:'സർട്ടിഫിക്കറ്റ് പൊരുത്തപ്പെട്ട ഉത്തരത്തിന്റെ രേഖയാണ്. സുരക്ഷിത ജോലിയുടെ തെളിവല്ല.',refresh:'സർട്ടിഫിക്കറ്റുകൾ പുതുക്കുക'},
  ta:{nav:'சான்றிதழ்கள்',title:'எனது சான்றிதழ்கள்',subtitle:'உங்கள் பதில் முக்கிய தகவல்களுடன் பொருந்தும்போது பதிவு செய்யப்படும் சான்றிதழ்கள்.',loading:'சான்றிதழ்கள் ஏற்றப்படுகின்றன...',loadFailed:'உங்கள் சான்றிதழ்களை ஏற்ற முடியவில்லை. இணைப்பைச் சரிபார்த்து மீண்டும் முயற்சிக்கவும்.',empty:'இதுவரை சான்றிதழ்கள் எதுவும் பதிவாகவில்லை.',awarded:'வழங்கப்பட்டது',expires:'காலாவதி',active:'செல்லுபடியாகும்',expiring:'விரைவில் காலாவதி',expired:'காலாவதியானது',note:'சான்றிதழ் பொருந்திய பதிலின் பதிவு. இது பாதுகாப்பான வேலைக்கான ஆதாரம் அல்ல.',refresh:'சான்றிதழ்களைப் புதுப்பி'},
  te:{nav:'ధృవపత్రాలు',title:'నా ధృవపత్రాలు',subtitle:'మీ సమాధానం ముఖ్య అంశాలతో సరిపోలినప్పుడు నమోదయ్యే ధృవపత్రాలు.',loading:'ధృవపత్రాలు లోడ్ అవుతున్నాయి...',loadFailed:'మీ ధృవపత్రాలు లోడ్ చేయలేకపోయాం. కనెక్షన్ తనిఖీ చేసి మళ్లీ ప్రయత్నించండి.',empty:'ఇంకా ధృవపత్రాలు నమోదు కాలేదు.',awarded:'ఇవ్వబడింది',expires:'గడువు',active:'చెల్లుబాటు',expiring:'త్వరలో ముగుస్తుంది',expired:'గడువు ముగిసింది',note:'ధృవపత్రం సరిపోలిన సమాధానం యొక్క నమోదు. ఇది సురక్షిత పనికి రుజువు కాదు.',refresh:'ధృవపత్రాలను రిఫ్రెష్ చేయండి'},
  ne:{nav:'प्रमाणपत्रहरू',title:'मेरा प्रमाणपत्रहरू',subtitle:'तपाईंको जवाफ मुख्य तथ्यहरूसँग मिल्दा रेकर्ड हुने प्रमाणपत्रहरू।',loading:'प्रमाणपत्रहरू लोड हुँदै...',loadFailed:'तपाईंका प्रमाणपत्रहरू लोड गर्न सकिएन। जडान जाँचेर फेरि प्रयास गर्नुहोस्।',empty:'अहिलेसम्म कुनै प्रमाणपत्र रेकर्ड भएको छैन।',awarded:'प्रदान',expires:'अवधि सकिने',active:'मान्य',expiring:'चाँडै सकिँदै',expired:'सकिएको',note:'प्रमाणपत्र मिलेको जवाफको रेकर्ड हो। यो सुरक्षित कामको प्रमाण होइन।',refresh:'प्रमाणपत्रहरू ताजा गर्नुहोस्'},
  fil:{nav:'Mga sertipiko',title:'Mga sertipiko ko',subtitle:'Mga sertipikong naitala kapag tumugma ang sagot mo sa mahalagang detalye.',loading:'Nilo-load ang mga sertipiko...',loadFailed:'Hindi na-load ang mga sertipiko mo. Suriin ang koneksyon at subukan muli.',empty:'Wala pang naitalang sertipiko.',awarded:'Iginawad',expires:'Mag-expire',active:'Valid',expiring:'Malapit nang mag-expire',expired:'Nag-expire',note:'Ang sertipiko ay tala ng tumugmang sagot. Hindi ito patunay ng ligtas na trabaho.',refresh:'I-refresh ang mga sertipiko'},
  si:{nav:'සහතික',title:'මගේ සහතික',subtitle:'ඔබේ පිළිතුර ප්‍රධාන කරුණු සමඟ ගැළපුණු විට සටහන් වන සහතික.',loading:'සහතික පූරණය වෙමින්...',loadFailed:'ඔබේ සහතික පූරණය කළ නොහැකි විය. සම්බන්ධතාවය පරීක්ෂා කර නැවත උත්සාහ කරන්න.',empty:'තවම සහතික සටහන් වී නැත.',awarded:'පිරිනැමුණි',expires:'කල් ඉකුත් වේ',active:'වලංගු',expiring:'ළඟදී කල් ඉකුත් වේ',expired:'කල් ඉකුත් විය',note:'සහතිකය ගැළපුණු පිළිතුරේ වාර්තාවකි. එය ආරක්ෂිත වැඩ සඳහා සාක්ෂියක් නොවේ.',refresh:'සහතික නැවුම් කරන්න'},
  ru:{nav:'Сертификаты',title:'Мои сертификаты',subtitle:'Сертификаты, записанные при совпадении ответа с ключевыми фактами.',loading:'Загрузка сертификатов...',loadFailed:'Не удалось загрузить сертификаты. Проверьте соединение и повторите попытку.',empty:'Сертификаты пока не записаны.',awarded:'Выдан',expires:'Действует до',active:'Действителен',expiring:'Скоро истекает',expired:'Истёк',note:'Сертификат фиксирует совпадение ответа. Это не доказательство безопасной работы.',refresh:'Обновить сертификаты'},
  'pa-Guru':{nav:'ਸਰਟੀਫਿਕੇਟ',title:'ਮੇਰੇ ਸਰਟੀਫਿਕੇਟ',subtitle:'ਜਦੋਂ ਤੁਹਾਡਾ ਜਵਾਬ ਮੁੱਖ ਤੱਥਾਂ ਨਾਲ ਮਿਲਦਾ ਹੈ ਤਾਂ ਦਰਜ ਹੋਣ ਵਾਲੇ ਸਰਟੀਫਿਕੇਟ।',loading:'ਸਰਟੀਫਿਕੇਟ ਲੋਡ ਹੋ ਰਹੇ ਹਨ...',loadFailed:'ਤੁਹਾਡੇ ਸਰਟੀਫਿਕੇਟ ਲੋਡ ਨਹੀਂ ਹੋ ਸਕੇ। ਕਨੈਕਸ਼ਨ ਜਾਂਚੋ ਅਤੇ ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।',empty:'ਹਾਲੇ ਕੋਈ ਸਰਟੀਫਿਕੇਟ ਦਰਜ ਨਹੀਂ ਹੋਇਆ।',awarded:'ਦਿੱਤਾ ਗਿਆ',expires:'ਮਿਆਦ ਖ਼ਤਮ',active:'ਵੈਧ',expiring:'ਜਲਦੀ ਖ਼ਤਮ ਹੋਵੇਗਾ',expired:'ਖ਼ਤਮ ਹੋਇਆ',note:'ਸਰਟੀਫਿਕੇਟ ਮਿਲਦੇ ਜਵਾਬ ਦਾ ਰਿਕਾਰਡ ਹੈ। ਇਹ ਸੁਰੱਖਿਅਤ ਕੰਮ ਦਾ ਸਬੂਤ ਨਹੀਂ।',refresh:'ਸਰਟੀਫਿਕੇਟ ਤਾਜ਼ਾ ਕਰੋ'},
  'pa-Arab':{nav:'سرٹیفکیٹ',title:'میرے سرٹیفکیٹ',subtitle:'جدوں تہاڈا جواب اہم حقائق نال میل کھاندا اے تے درج ہون والے سرٹیفکیٹ۔',loading:'سرٹیفکیٹ لوڈ ہو رہے نیں...',loadFailed:'تہاڈے سرٹیفکیٹ لوڈ نئیں ہو سکے۔ کنکشن چیک کرو تے فیر کوشش کرو۔',empty:'ہالے کوئی سرٹیفکیٹ درج نئیں ہویا۔',awarded:'دتا گیا',expires:'میعاد ختم',active:'درست',expiring:'جلدی ختم ہوگا',expired:'ختم شدہ',note:'سرٹیفکیٹ میل کھاندے جواب دا ریکارڈ اے۔ ایہ محفوظ کم دا ثبوت نئیں۔',refresh:'سرٹیفکیٹ تازہ کرو'},
  id:{nav:'Sertifikat',title:'Sertifikat saya',subtitle:'Sertifikat yang dicatat saat jawaban Anda cocok dengan fakta kunci.',loading:'Memuat sertifikat...',loadFailed:'Sertifikat Anda tidak dapat dimuat. Periksa koneksi dan coba lagi.',empty:'Belum ada sertifikat yang dicatat.',awarded:'Diberikan',expires:'Berakhir',active:'Berlaku',expiring:'Segera berakhir',expired:'Kedaluwarsa',note:'Sertifikat mencatat jawaban yang cocok. Ini bukan bukti kerja yang aman.',refresh:'Muat ulang sertifikat'},
};

export function WorkerCertificates({session,language,refresh,current,onSessionLost,timezone}:Props) {
  const text=workerCertificateText[language],context=session.clientContext || '';
  const latest=useRef({current,onSessionLost});latest.current={current,onSessionLost};
  const [items,setItems]=useState<WorkerCertificate[]|null>(null),[loading,setLoading]=useState(true),[failed,setFailed]=useState(false),[tick,setTick]=useState(0);
  useEffect(()=>{
    if(!/^[a-f0-9]{64}$/.test(context) || !latest.current.current())return;
    const controller=new AbortController();
    setLoading(true);setFailed(false);
    void (async()=>{
      try {
        const response=await fetch('/api/worker/competencies',{credentials:'include',cache:'no-store',redirect:'error',
          headers:{'x-client-session-context':context},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
        const body:any=await response.json().catch(()=>null);
        if(response.status===401 || [403,409].includes(response.status)){latest.current.onSessionLost();return;}
        if(!latest.current.current())return;
        if(!response.ok)throw Error('Certificate request failed');
        if(!Array.isArray(body?.items))throw Error('Certificate response could not be read');
        setItems(body.items);
      } catch {if(!controller.signal.aborted && latest.current.current())setFailed(true);}
      finally {if(!controller.signal.aborted)setLoading(false);}
    })();
    return()=>controller.abort();
  },[context,tick,refresh]);
  const date=(value:string)=>new Intl.DateTimeFormat(language,{timeZone:timezone || 'UTC',dateStyle:'medium'}).format(new Date(value));
  const label=(status:WorkerCertificate['status'])=>status==='expired'?text.expired:status==='expiring'?text.expiring:text.active;
  const titleId='worker-certificates-title';
  return <section className="worker-certificates" aria-labelledby={titleId} dir={workerUiDirection(language)}>
    <div className="worker-notifications-head"><div><h1 id={titleId}>{text.title}</h1><p className="worker-subtitle">{text.subtitle}</p></div><button type="button" className="icon-button" aria-label={text.refresh} title={text.refresh} disabled={loading} onClick={()=>setTick(value=>value+1)}><RefreshCw size={20}/></button></div>
    {loading ? <p role="status">{text.loading}</p> : failed ? <p className="notice notice-amber" role="alert">{text.loadFailed}</p> : items?.length ? <>
      {items.map(item=><article className="worker-card worker-certificate" key={item.id}>
        <div className="worker-certificate-head"><Award className="worker-certificate-icon" size={26} aria-hidden="true"/><div><h2>{item.title}</h2><p>{item.briefingTitle} · v{item.publicationVersion}</p></div><span className={`worker-certificate-status ${item.status}`}>{label(item.status)}</span></div>
        <dl><div><dt>{text.awarded}</dt><dd><time dateTime={item.awardedAt}>{date(item.awardedAt)}</time></dd></div><div><dt>{text.expires}</dt><dd><time dateTime={item.expiresAt}>{date(item.expiresAt)}</time></dd></div></dl>
      </article>)}
      <p className="worker-certificate-note">{text.note}</p>
    </> : <><p className="empty-state">{text.empty}</p><p className="worker-certificate-note">{text.note}</p></>}
  </section>;
}
