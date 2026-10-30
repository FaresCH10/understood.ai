import React,{lazy,Suspense} from 'react';
import {RefreshCw,ArrowLeft,ArrowRight} from 'lucide-react';
import type {WorkerDeviceProps} from './WorkerDevice';
import {workerUiDirection,type WorkerUiLanguage} from './worker-ui-language';
const Device=lazy(()=>import('./WorkerDevice').then(module=>({default:module.WorkerDevice})));
const text:Record<WorkerUiLanguage,{loading:string;failed:string;reload:string;back:string}>={
  en:{loading:'Loading device settings...',failed:'Device settings are unavailable.',reload:'Reload',back:'Back to my instructions'},
  ar:{loading:'جارٍ تحميل إعدادات الجهاز...',failed:'إعدادات الجهاز غير متاحة.',reload:'إعادة التحميل',back:'العودة إلى تعليماتي'},
  ur:{loading:'آلے کی ترتیبات لوڈ ہو رہی ہیں...',failed:'آلے کی ترتیبات دستیاب نہیں۔',reload:'دوبارہ لوڈ کریں',back:'میری ہدایات پر واپس'},
  hi:{loading:'डिवाइस सेटिंग्स लोड हो रही हैं...',failed:'डिवाइस सेटिंग्स उपलब्ध नहीं हैं।',reload:'पुनः लोड करें',back:'मेरे निर्देशों पर वापस'},
  bn:{loading:'ডিভাইস সেটিংস লোড হচ্ছে...',failed:'ডিভাইস সেটিংস পাওয়া যাচ্ছে না।',reload:'পুনরায় লোড করুন',back:'আমার নির্দেশনায় ফিরে যান'},
  ml:{loading:'ഉപകരണ ക്രമീകരണങ്ങൾ ലോഡ് ചെയ്യുന്നു...',failed:'ഉപകരണ ക്രമീകരണങ്ങൾ ലഭ്യമല്ല.',reload:'വീണ്ടും ലോഡ് ചെയ്യുക',back:'എന്റെ നിർദ്ദേശങ്ങളിലേക്ക് മടങ്ങുക'},
  ta:{loading:'சாதன அமைப்புகள் ஏற்றப்படுகின்றன...',failed:'சாதன அமைப்புகள் கிடைக்கவில்லை.',reload:'மீண்டும் ஏற்று',back:'என் வழிமுறைகளுக்குத் திரும்பு'},
  te:{loading:'పరికర సెట్టింగ్లు లోడ్ అవుతున్నాయి...',failed:'పరికర సెట్టింగ్లు అందుబాటులో లేవు.',reload:'మళ్లీ లోడ్ చేయండి',back:'నా సూచనలకు తిరిగి వెళ్లండి'},
  ne:{loading:'उपकरण सेटिङहरू लोड हुँदै छन्...',failed:'उपकरण सेटिङहरू उपलब्ध छैनन्।',reload:'पुनः लोड गर्नुहोस्',back:'मेरा निर्देशनहरूमा फर्कनुहोस्'},
  fil:{loading:'Nilo-load ang mga setting ng device...',failed:'Hindi available ang mga setting ng device.',reload:'I-reload',back:'Bumalik sa aking mga tagubilin'},
  si:{loading:'උපාංග සැකසුම් පූරණය වෙමින්...',failed:'උපාංග සැකසුම් ලබා ගත නොහැක.',reload:'නැවත පූරණය කරන්න',back:'මගේ උපදෙස් වෙත ආපසු'},
  ru:{loading:'Загрузка настроек устройства...',failed:'Настройки устройства недоступны.',reload:'Перезагрузить',back:'Назад к моим инструкциям'},
  'pa-Guru':{loading:'ਡਿਵਾਈਸ ਸੈਟਿੰਗਾਂ ਲੋਡ ਹੋ ਰਹੀਆਂ ਹਨ...',failed:'ਡਿਵਾਈਸ ਸੈਟਿੰਗਾਂ ਉਪਲਬਧ ਨਹੀਂ ਹਨ।',reload:'ਦੁਬਾਰਾ ਲੋਡ ਕਰੋ',back:'ਮੇਰੀਆਂ ਹਦਾਇਤਾਂ ਤੇ ਵਾਪਸ'},
  'pa-Arab':{loading:'ڈیوائس دیاں ترتیباں لوڈ ہو رہیاں نیں...',failed:'ڈیوائس دیاں ترتیباں دستیاب نہیں نیں۔',reload:'دوبارہ لوڈ کرو',back:'میریاں ہدایات تے واپس'},
  id:{loading:'Memuat pengaturan perangkat...',failed:'Pengaturan perangkat tidak tersedia.',reload:'Muat ulang',back:'Kembali ke instruksi saya'},
};
export class WorkerDeviceView extends React.Component<WorkerDeviceProps,{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){
    const t=text[this.props.language];
    return this.state.failed?<section role="alert"><p>{t.failed}</p><button className="back-link" onClick={this.props.onBack}>{workerUiDirection(this.props.language)==='rtl'?<ArrowRight size={18}/>:<ArrowLeft size={18}/>}{t.back}</button><button className="button outline" onClick={()=>location.reload()}><RefreshCw size={18}/>{t.reload}</button></section>
      :<Suspense fallback={<p role="status">{t.loading}</p>}><Device {...this.props}/></Suspense>;
  }
}
