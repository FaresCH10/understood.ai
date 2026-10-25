import React,{lazy,Suspense} from 'react';
import type {AudioDraftProps} from './WorkerAudioDraft';
import {workerUiFallbackLanguage,type WorkerUiLanguage} from './worker-ui-language';
const Draft=lazy(()=>import('./WorkerAudioDraft').then(module=>({default:module.WorkerAudioDraft})));
const copy:Record<WorkerUiLanguage,{loading:string;failed:string}>={
  en:{loading:'Loading saved recording controls...',failed:'Saved recording controls are unavailable. Current recording remains in this page.'},
  ar:{loading:'جارٍ تحميل أدوات التسجيل المحفوظ...',failed:'أدوات التسجيل المحفوظ غير متاحة. يبقى التسجيل الحالي في هذه الصفحة.'},
  ur:{loading:'محفوظ ریکارڈنگ کے اختیارات لوڈ ہو رہے ہیں...',failed:'محفوظ ریکارڈنگ کے اختیارات دستیاب نہیں۔ موجودہ ریکارڈنگ اسی صفحے میں باقی ہے۔'},
  hi:{loading:'सहेजी गई रिकॉर्डिंग के नियंत्रण लोड हो रहे हैं...',failed:'सहेजी गई रिकॉर्डिंग के नियंत्रण उपलब्ध नहीं हैं। मौजूदा रिकॉर्डिंग इस पृष्ठ में बनी रहती है।'},
  bn:{loading:'সংরক্ষিত রেকর্ডিংয়ের নিয়ন্ত্রণ লোড হচ্ছে...',failed:'সংরক্ষিত রেকর্ডিংয়ের নিয়ন্ত্রণ পাওয়া যাচ্ছে না। বর্তমান রেকর্ডিং এই পৃষ্ঠায় থাকছে।'},
  ml:{loading:'സേവ് ചെയ്ത റെക്കോർഡിംഗ് നിയന്ത്രണങ്ങൾ ലോഡ് ചെയ്യുന്നു...',failed:'സേവ് ചെയ്ത റെക്കോർഡിംഗ് നിയന്ത്രണങ്ങൾ ലഭ്യമല്ല. നിലവിലെ റെക്കോർഡിംഗ് ഈ പേജിൽ തുടരും.'},
  ta:{loading:'சேமித்த பதிவு கட்டுப்பாடுகள் ஏற்றப்படுகின்றன...',failed:'சேமித்த பதிவு கட்டுப்பாடுகள் கிடைக்கவில்லை. தற்போதைய பதிவு இந்தப் பக்கத்தில் தொடர்கிறது.'},
  te:{loading:'సేవ్ చేసిన రికార్డింగ్ నియంత్రణలు లోడ్ అవుతున్నాయి...',failed:'సేవ్ చేసిన రికార్డింగ్ నియంత్రణలు అందుబాటులో లేవు. ప్రస్తుత రికార్డింగ్ ఈ పేజీలో కొనసాగుతుంది.'},
  ne:{loading:'सुरक्षित रेकर्डिङका नियन्त्रणहरू लोड हुँदै छन्...',failed:'सुरक्षित रेकर्डिङका नियन्त्रणहरू उपलब्ध छैनन्। हालको रेकर्डिङ यही पृष्ठमा रहन्छ।'},
  fil:{loading:'Nilo-load ang mga kontrol ng naka-save na recording...',failed:'Hindi available ang mga kontrol ng naka-save na recording. Nananatili sa page na ito ang kasalukuyang recording.'},
  si:{loading:'සුරකින ලද පටිගත කිරීමේ පාලක පූරණය වෙමින්...',failed:'සුරකින ලද පටිගත කිරීමේ පාලක ලබා ගත නොහැක. වත්මන් පටිගත කිරීම මෙම පිටුවේ රැඳේ.'},
  ru:{loading:'Загрузка элементов сохранённой записи...',failed:'Элементы сохранённой записи недоступны. Текущая запись остаётся на этой странице.'},
  'pa-Guru':{loading:'ਸੰਭਾਲੀ ਰਿਕਾਰਡਿੰਗ ਦੇ ਕੰਟਰੋਲ ਲੋਡ ਹੋ ਰਹੇ ਹਨ...',failed:'ਸੰਭਾਲੀ ਰਿਕਾਰਡਿੰਗ ਦੇ ਕੰਟਰੋਲ ਉਪਲਬਧ ਨਹੀਂ ਹਨ। ਮੌਜੂਦਾ ਰਿਕਾਰਡਿੰਗ ਇਸ ਪੰਨੇ ਤੇ ਰਹਿੰਦੀ ਹੈ।'},
  'pa-Arab':{loading:'محفوظ ریکارڈنگ دے کنٹرول لوڈ ہو رہے نیں...',failed:'محفوظ ریکارڈنگ دے کنٹرول دستیاب نہیں نیں۔ موجودہ ریکارڈنگ ایس صفحے تے رہندی اے۔'},
  id:{loading:'Memuat kontrol rekaman tersimpan...',failed:'Kontrol rekaman tersimpan tidak tersedia. Rekaman saat ini tetap ada di halaman ini.'},
};
export class WorkerAudioDraftView extends React.Component<AudioDraftProps,{failed:boolean}>{
  state={failed:false};static getDerivedStateFromError(){return {failed:true};}
  render(){const t=copy[this.props.interfaceLanguage ?? workerUiFallbackLanguage(this.props.session)];
    return this.state.failed?<p role="alert">{t.failed}</p>:<Suspense fallback={<p role="status">{t.loading}</p>}><Draft {...this.props}/></Suspense>;
  }
}
