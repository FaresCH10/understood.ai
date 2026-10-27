import {RefreshCw} from 'lucide-react';
import type {WorkerUiLanguage} from './worker-ui-language';
import {workerUiDirection} from './worker-ui-language';

const copy:Record<WorkerUiLanguage,[string,string,string]>={
  en:['Checking your connection','Your unsent work is kept on this page. Server actions are paused until your session can be verified.','Check again'],
  ar:['جارٍ التحقق من الاتصال','يبقى عملك غير المرسل في هذه الصفحة. تتوقف إجراءات الخادم حتى يتم التحقق من جلستك.','تحقق مجدداً'],
  ur:['کنکشن کی جانچ','آپ کا نہ بھیجا گیا کام اسی صفحے پر محفوظ ہے۔ سیشن کی تصدیق تک سرور کے کام رکے ہوئے ہیں۔','دوبارہ جانچیں'],
  hi:['कनेक्शन की जाँच','आपका बिना भेजा काम इसी पृष्ठ पर रखा है। सत्र सत्यापित होने तक सर्वर के कार्य रुके हैं।','फिर जाँचें'],
  bn:['সংযোগ পরীক্ষা হচ্ছে','আপনার না পাঠানো কাজ এই পৃষ্ঠায় আছে। সেশন যাচাই না হওয়া পর্যন্ত সার্ভারের কাজ বন্ধ আছে।','আবার পরীক্ষা করুন'],
  ml:['കണക്ഷൻ പരിശോധിക്കുന്നു','അയക്കാത്ത ജോലി ഈ പേജിൽ നിലനിൽക്കും. സെഷൻ സ്ഥിരീകരിക്കുന്നതുവരെ സർവർ പ്രവർത്തനങ്ങൾ നിർത്തിവച്ചിരിക്കുന്നു.','വീണ്ടും പരിശോധിക്കുക'],
  ta:['இணைப்பு சரிபார்க்கப்படுகிறது','அனுப்பாத வேலை இந்தப் பக்கத்தில் உள்ளது. அமர்வு உறுதியாகும் வரை சேவையகச் செயல்கள் நிறுத்தப்பட்டுள்ளன.','மீண்டும் சரிபார்'],
  te:['కనెక్షన్ తనిఖీ','పంపని పని ఈ పేజీలోనే ఉంటుంది. సెషన్ ధృవీకరించే వరకు సర్వర్ చర్యలు ఆగుతాయి.','మళ్లీ తనిఖీ చేయండి'],
  ne:['जडान जाँच हुँदैछ','नपठाइएको काम यही पृष्ठमा रहन्छ। सत्र प्रमाणित नभएसम्म सर्भरका कार्य रोकिएका छन्।','फेरि जाँच्नुहोस्'],
  fil:['Sinusuri ang koneksyon','Nananatili sa pahinang ito ang hindi pa naipadalang gawain. Nakahinto ang mga aksyon sa server hanggang makumpirma ang session.','Suriin muli'],
  si:['සම්බන්ධතාව පරීක්ෂා කරමින්','නොයැවූ වැඩ මෙම පිටුවේ පවතී. සැසිය තහවුරු වන තුරු සේවාදායක ක්‍රියා නවතා ඇත.','නැවත පරීක්ෂා කරන්න'],
  ru:['Проверка соединения','Неотправленная работа остаётся на этой странице. Действия на сервере приостановлены до проверки сеанса.','Проверить снова'],
  'pa-Guru':['ਕਨੈਕਸ਼ਨ ਦੀ ਜਾਂਚ','ਨਾ ਭੇਜਿਆ ਕੰਮ ਇਸ ਪੰਨੇ ਉੱਤੇ ਰਹਿੰਦਾ ਹੈ। ਸੈਸ਼ਨ ਦੀ ਪੁਸ਼ਟੀ ਤੱਕ ਸਰਵਰ ਦੇ ਕੰਮ ਰੁਕੇ ਹਨ।','ਮੁੜ ਜਾਂਚੋ'],
  'pa-Arab':['کنکشن دی جانچ','نہ بھیجیا کم ایس صفحے تے رہندا اے۔ سیشن دی تصدیق تک سرور دے کم رکے نیں۔','فیر جانچو'],
  id:['Memeriksa koneksi','Pekerjaan yang belum dikirim tetap ada di halaman ini. Tindakan server dijeda sampai sesi dapat diverifikasi.','Periksa lagi'],
};
export function SessionConnectionNotice({language,onRetry}:{language:WorkerUiLanguage;onRetry:()=>void}){
  const [title,body,retry]=copy[language];
  return <main className="entry-page" lang={language} dir={workerUiDirection(language)}><section role="alert"><h1>{title}</h1><p>{body}</p><button className="button primary" onClick={onRetry}><RefreshCw size={18}/>{retry}</button></section></main>;
}
