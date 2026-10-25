import React,{lazy,Suspense} from 'react';
import {RefreshCw} from 'lucide-react';
import type {RecorderProps} from './WorkerRecorder';
import {conversationRecorderText,type RecordingLanguage} from './recording-notice';
import type {WorkerUiLanguage} from './worker-ui-language';

const Recorder=lazy(()=>import('./WorkerRecorder').then(module=>({default:module.WorkerRecorder})));
export const recorderViewText:Record<WorkerUiLanguage,{loading:string;failed:string;reload:string}>={
  en:{loading:'Loading recorder...',failed:'Recording is unavailable. Unsent audio may be lost. Type your answer or reload this page.',reload:'Reload'},
  ar:{loading:'جارٍ تحميل التسجيل...',failed:'التسجيل غير متاح. قد يُفقد الصوت غير المرسل. اكتب إجابتك أو أعد تحميل هذه الصفحة.',reload:'إعادة التحميل'},
  ur:{loading:'ریکارڈر لوڈ ہو رہا ہے...',failed:'ریکارڈنگ دستیاب نہیں۔ نہ بھیجی گئی آڈیو ضائع ہو سکتی ہے۔ اپنا جواب لکھیں یا یہ صفحہ دوبارہ لوڈ کریں۔',reload:'دوبارہ لوڈ کریں'},
  hi:{loading:'रिकॉर्डर लोड हो रहा है...',failed:'रिकॉर्डिंग उपलब्ध नहीं है। बिना भेजी ऑडियो खो सकती है। अपना उत्तर लिखें या यह पृष्ठ पुनः लोड करें।',reload:'पुनः लोड करें'},
  bn:{loading:'রেকর্ডার লোড হচ্ছে...',failed:'রেকর্ডিং পাওয়া যাচ্ছে না। না পাঠানো অডিও হারিয়ে যেতে পারে। আপনার উত্তর লিখুন বা এই পৃষ্ঠা পুনরায় লোড করুন।',reload:'পুনরায় লোড করুন'},
  ml:{loading:'റെക്കോർഡർ ലോഡ് ചെയ്യുന്നു...',failed:'റെക്കോർഡിംഗ് ലഭ്യമല്ല. അയക്കാത്ത ഓഡിയോ നഷ്ടപ്പെടാം. ഉത്തരം ടൈപ്പ് ചെയ്യുക അല്ലെങ്കിൽ ഈ പേജ് വീണ്ടും ലോഡ് ചെയ്യുക.',reload:'വീണ്ടും ലോഡ് ചെയ്യുക'},
  ta:{loading:'பதிவி ஏற்றப்படுகிறது...',failed:'பதிவு கிடைக்கவில்லை. அனுப்பப்படாத ஒலி இழக்கப்படலாம். பதிலைத் தட்டச்சு செய்யவும் அல்லது இந்தப் பக்கத்தை மீண்டும் ஏற்றவும்.',reload:'மீண்டும் ஏற்று'},
  te:{loading:'రికార్డర్ లోడ్ అవుతోంది...',failed:'రికార్డింగ్ అందుబాటులో లేదు. పంపని ఆడియో పోవచ్చు. మీ సమాధానాన్ని టైప్ చేయండి లేదా ఈ పేజీని మళ్లీ లోడ్ చేయండి.',reload:'మళ్లీ లోడ్ చేయండి'},
  ne:{loading:'रेकर्डर लोड हुँदै छ...',failed:'रेकर्डिङ उपलब्ध छैन। नपठाइएको अडियो हराउन सक्छ। आफ्नो उत्तर लेख्नुहोस् वा यो पृष्ठ पुनः लोड गर्नुहोस्।',reload:'पुनः लोड गर्नुहोस्'},
  fil:{loading:'Nilo-load ang recorder...',failed:'Hindi available ang pag-record. Maaaring mawala ang hindi naipadalang audio. I-type ang sagot mo o i-reload ang page na ito.',reload:'I-reload'},
  si:{loading:'පටිගත කරන්නා පූරණය වෙමින්...',failed:'පටිගත කිරීම ලබා ගත නොහැක. නොයැවූ ශ්‍රව්‍ය නැති විය හැක. ඔබේ පිළිතුර ටයිප් කරන්න හෝ මෙම පිටුව නැවත පූරණය කරන්න.',reload:'නැවත පූරණය කරන්න'},
  ru:{loading:'Загрузка записывающего устройства...',failed:'Запись недоступна. Неотправленное аудио может быть потеряно. Введите ответ или перезагрузите страницу.',reload:'Перезагрузить'},
  'pa-Guru':{loading:'ਰਿਕਾਰਡਰ ਲੋਡ ਹੋ ਰਿਹਾ ਹੈ...',failed:'ਰਿਕਾਰਡਿੰਗ ਉਪਲਬਧ ਨਹੀਂ ਹੈ। ਨਾ ਭੇਜੀ ਆਡੀਓ ਗੁੰਮ ਹੋ ਸਕਦੀ ਹੈ। ਆਪਣਾ ਜਵਾਬ ਲਿਖੋ ਜਾਂ ਇਹ ਪੰਨਾ ਦੁਬਾਰਾ ਲੋਡ ਕਰੋ।',reload:'ਦੁਬਾਰਾ ਲੋਡ ਕਰੋ'},
  'pa-Arab':{loading:'ریکارڈر لوڈ ہو رہیا اے...',failed:'ریکارڈنگ دستیاب نہیں اے۔ نہ بھیجیا آڈیو ضائع ہو سکدا اے۔ اپنا جواب لکھو یا ایہ صفحہ دوبارہ لوڈ کرو۔',reload:'دوبارہ لوڈ کرو'},
  id:{loading:'Memuat perekam...',failed:'Perekaman tidak tersedia. Audio yang belum terkirim dapat hilang. Ketik jawaban Anda atau muat ulang halaman ini.',reload:'Muat ulang'},
};

export class WorkerRecorderView extends React.Component<RecorderProps,{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){
    const base=recorderViewText[this.props.language],staffLanguage:RecordingLanguage=this.props.language==='ar'||this.props.language==='ur'?this.props.language:'en';
    const staff={en:'Recording is unavailable. Unsent audio may be lost. Add written resolution notes or reload this page.',ar:'التسجيل غير متاح. قد تفقد الصوت غير المرسل. أضف ملاحظات حل مكتوبة أو أعد تحميل الصفحة.',ur:'ریکارڈنگ دستیاب نہیں۔ نہ بھیجی گئی آڈیو ضائع ہو سکتی ہے۔ تحریری حل کے نوٹس شامل کریں یا صفحہ دوبارہ لوڈ کریں۔'};
    const text={...base,...(this.props.purpose==='in_person'?{failed:staff[staffLanguage]}:this.props.purpose==='help'||this.props.purpose==='reply'?{failed:conversationRecorderText[this.props.language].failed}:{})};
    return this.state.failed ? <div role="alert"><p>{text.failed}</p><button className="button outline" onClick={()=>location.reload()}><RefreshCw size={18}/>{text.reload}</button></div>
      : <Suspense fallback={<p role="status">{text.loading}</p>}><Recorder {...this.props}/></Suspense>;
  }
}
