import React,{lazy,Suspense} from 'react';
import {RefreshCw} from 'lucide-react';
import type {WorkerOfflineEntry,WorkerOfflineSave} from './WorkerOffline';
import {workerBrowserLanguage,type WorkerUiLanguage} from './worker-ui-language';
const Entry=lazy(()=>import('./WorkerOffline').then(module=>({default:module.WorkerOfflineEntry})));
const Save=lazy(()=>import('./WorkerOffline').then(module=>({default:module.WorkerOfflineSave})));
const copy:Record<WorkerUiLanguage,{loading:string;failed:string;retry:string}>={
  en:{loading:'Loading private saved-data view...',failed:'Private saved-data view is unavailable.',retry:'Reload'},
  ar:{loading:'جارٍ تحميل عرض البيانات الخاصة المحفوظة...',failed:'عرض البيانات الخاصة المحفوظة غير متاح.',retry:'إعادة التحميل'},
  ur:{loading:'محفوظ نجی ڈیٹا کا منظر لوڈ ہو رہا ہے...',failed:'محفوظ نجی ڈیٹا کا منظر دستیاب نہیں۔',retry:'دوبارہ لوڈ کریں'},
  hi:{loading:'निजी सहेजा डेटा दृश्य लोड हो रहा है...',failed:'निजी सहेजा डेटा दृश्य उपलब्ध नहीं है।',retry:'पुनः लोड करें'},
  bn:{loading:'ব্যক্তিগত সংরক্ষিত ডেটা ভিউ লোড হচ্ছে...',failed:'ব্যক্তিগত সংরক্ষিত ডেটা ভিউ পাওয়া যাচ্ছে না।',retry:'পুনরায় লোড করুন'},
  ml:{loading:'സ്വകാര്യ സേവ് ചെയ്ത ഡാറ്റ കാഴ്ച ലോഡ് ചെയ്യുന്നു...',failed:'സ്വകാര്യ സേവ് ചെയ്ത ഡാറ്റ കാഴ്ച ലഭ്യമല്ല.',retry:'വീണ്ടും ലോഡ് ചെയ്യുക'},
  ta:{loading:'தனிப்பட்ட சேமித்த தரவு காட்சி ஏற்றப்படுகிறது...',failed:'தனிப்பட்ட சேமித்த தரவு காட்சி கிடைக்கவில்லை.',retry:'மீண்டும் ஏற்று'},
  te:{loading:'ప్రైవేట్ సేవ్ చేసిన డేటా వీక్షణ లోడ్ అవుతోంది...',failed:'ప్రైవేట్ సేవ్ చేసిన డేటా వీక్షణ అందుబాటులో లేదు.',retry:'మళ్లీ లోడ్ చేయండి'},
  ne:{loading:'निजी सुरक्षित डाटा दृश्य लोड हुँदै छ...',failed:'निजी सुरक्षित डाटा दृश्य उपलब्ध छैन।',retry:'पुनः लोड गर्नुहोस्'},
  fil:{loading:'Nilo-load ang pribadong naka-save na data view...',failed:'Hindi available ang pribadong naka-save na data view.',retry:'I-reload'},
  si:{loading:'පෞද්ගලික සුරකින ලද දත්ත දර්ශනය පූරණය වෙමින්...',failed:'පෞද්ගලික සුරකින ලද දත්ත දර්ශනය ලබා ගත නොහැක.',retry:'නැවත පූරණය කරන්න'},
  ru:{loading:'Загрузка приватного просмотра сохранённых данных...',failed:'Приватный просмотр сохранённых данных недоступен.',retry:'Перезагрузить'},
  'pa-Guru':{loading:'ਨਿੱਜੀ ਸੰਭਾਲਿਆ ਡੇਟਾ ਦ੍ਰਿਸ਼ ਲੋਡ ਹੋ ਰਿਹਾ ਹੈ...',failed:'ਨਿੱਜੀ ਸੰਭਾਲਿਆ ਡੇਟਾ ਦ੍ਰਿਸ਼ ਉਪਲਬਧ ਨਹੀਂ ਹੈ।',retry:'ਦੁਬਾਰਾ ਲੋਡ ਕਰੋ'},
  'pa-Arab':{loading:'نجی محفوظ ڈیٹا دا وکھالہ لوڈ ہو رہیا اے...',failed:'نجی محفوظ ڈیٹا دا وکھالہ دستیاب نہیں اے۔',retry:'دوبارہ لوڈ کرو'},
  id:{loading:'Memuat tampilan data tersimpan privat...',failed:'Tampilan data tersimpan privat tidak tersedia.',retry:'Muat ulang'},
};
class Boundary extends React.Component<{language:WorkerUiLanguage;children:React.ReactNode},{failed:boolean}>{
  state={failed:false};static getDerivedStateFromError(){return {failed:true};}
  render(){const t=copy[this.props.language];return this.state.failed?<section role="alert"><p>{t.failed}</p><button className="button outline" onClick={()=>location.reload()}><RefreshCw size={18}/>{t.retry}</button></section>:<Suspense fallback={<p role="status">{t.loading}</p>}>{this.props.children}</Suspense>;}
}
export function WorkerOfflineEntryView(props:React.ComponentProps<typeof WorkerOfflineEntry>){return <Boundary language={workerBrowserLanguage()}><Entry {...props}/></Boundary>;}
export function WorkerOfflineSaveView(props:React.ComponentProps<typeof WorkerOfflineSave>){return <Boundary language={props.language}><Save {...props}/></Boundary>;}
