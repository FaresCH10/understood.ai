import React,{lazy,Suspense} from 'react';
import {RefreshCw} from 'lucide-react';
import type {PageSession} from './session-state';
import type {DraftScope,TextDraft} from './worker-text-draft';
import {workerUiFallbackLanguage,type WorkerUiLanguage} from './worker-ui-language';
const Draft=lazy(()=>import('./WorkerTextDraft').then(module=>({default:module.WorkerTextDraft})));
const copy:Record<WorkerUiLanguage,{loading:string;failed:string;reload:string}>={
  en:{loading:'Loading saved text...',failed:'Saved text controls are unavailable. Current text remains.',reload:'Reload'},
  ar:{loading:'جارٍ تحميل النص المحفوظ...',failed:'أدوات النص المحفوظ غير متاحة. يبقى النص الحالي.',reload:'إعادة التحميل'},
  ur:{loading:'محفوظ متن لوڈ ہو رہا ہے...',failed:'محفوظ متن کے اختیارات دستیاب نہیں۔ موجودہ متن باقی ہے۔',reload:'دوبارہ لوڈ کریں'},
  hi:{loading:'सहेजा गया टेक्स्ट लोड हो रहा है...',failed:'सहेजे गए टेक्स्ट के नियंत्रण उपलब्ध नहीं हैं। मौजूदा टेक्स्ट बना रहता है।',reload:'पुनः लोड करें'},
  bn:{loading:'সংরক্ষিত লেখা লোড হচ্ছে...',failed:'সংরক্ষিত লেখার নিয়ন্ত্রণ পাওয়া যাচ্ছে না। বর্তমান লেখা থাকছে।',reload:'পুনরায় লোড করুন'},
  ml:{loading:'സേവ് ചെയ്ത ടെക്സ്റ്റ് ലോഡ് ചെയ്യുന്നു...',failed:'സേവ് ചെയ്ത ടെക്സ്റ്റ് നിയന്ത്രണങ്ങൾ ലഭ്യമല്ല. നിലവിലെ ടെക്സ്റ്റ് തുടരും.',reload:'വീണ്ടും ലോഡ് ചെയ്യുക'},
  ta:{loading:'சேமித்த உரை ஏற்றப்படுகிறது...',failed:'சேமித்த உரை கட்டுப்பாடுகள் கிடைக்கவில்லை. தற்போதைய உரை தொடர்கிறது.',reload:'மீண்டும் ஏற்று'},
  te:{loading:'సేవ్ చేసిన టెక్స్ట్ లోడ్ అవుతోంది...',failed:'సేవ్ చేసిన టెక్స్ట్ నియంత్రణలు అందుబాటులో లేవు. ప్రస్తుత టెక్స్ట్ కొనసాగుతుంది.',reload:'మళ్లీ లోడ్ చేయండి'},
  ne:{loading:'सुरक्षित पाठ लोड हुँदै छ...',failed:'सुरक्षित पाठका नियन्त्रणहरू उपलब्ध छैनन्। हालको पाठ रहन्छ।',reload:'पुनः लोड गर्नुहोस्'},
  fil:{loading:'Nilo-load ang naka-save na teksto...',failed:'Hindi available ang mga kontrol ng naka-save na teksto. Nananatili ang kasalukuyang teksto.',reload:'I-reload'},
  si:{loading:'සුරකින ලද පෙළ පූරණය වෙමින්...',failed:'සුරකින ලද පෙළ පාලක ලබා ගත නොහැක. වත්මන් පෙළ රැඳේ.',reload:'නැවත පූරණය කරන්න'},
  ru:{loading:'Загрузка сохранённого текста...',failed:'Элементы сохранённого текста недоступны. Текущий текст остаётся.',reload:'Перезагрузить'},
  'pa-Guru':{loading:'ਸੰਭਾਲਿਆ ਪਾਠ ਲੋਡ ਹੋ ਰਿਹਾ ਹੈ...',failed:'ਸੰਭਾਲੇ ਪਾਠ ਦੇ ਕੰਟਰੋਲ ਉਪਲਬਧ ਨਹੀਂ ਹਨ। ਮੌਜੂਦਾ ਪਾਠ ਬਣਿਆ ਰਹਿੰਦਾ ਹੈ।',reload:'ਦੁਬਾਰਾ ਲੋਡ ਕਰੋ'},
  'pa-Arab':{loading:'محفوظ متن لوڈ ہو رہیا اے...',failed:'محفوظ متن دے کنٹرول دستیاب نہیں نیں۔ موجودہ متن باقی رہندا اے۔',reload:'دوبارہ لوڈ کرو'},
  id:{loading:'Memuat teks tersimpan...',failed:'Kontrol teks tersimpan tidak tersedia. Teks saat ini tetap ada.',reload:'Muat ulang'},
};
export class WorkerTextDraftView extends React.Component<{session:PageSession;interfaceLanguage?:WorkerUiLanguage;scope:DraftScope;draft:TextDraft;disabled:boolean;restoreBlocked:boolean;current:()=>boolean;onRestore:(value:TextDraft)=>void},{failed:boolean}>{
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){
    const t=copy[this.props.interfaceLanguage ?? workerUiFallbackLanguage(this.props.session)];
    return this.state.failed ? <section role="alert"><p>{t.failed}</p><button className="button outline" onClick={()=>location.reload()}><RefreshCw size={18}/>{t.reload}</button></section>
      : <Suspense fallback={<p role="status">{t.loading}</p>}><Draft {...this.props}/></Suspense>;
  }
}
