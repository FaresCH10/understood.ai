export async function clearWorkerLocalData(context?:string,storage?:Storage,clearAudio?:()=>Promise<void>,clearBriefings?:()=>Promise<void>){
  let cleared=true;
  try {const tab=storage ?? sessionStorage;for(const key of Object.keys(tab))if(key.startsWith('understood:'))tab.removeItem(key);}catch {cleared=false;}
  try {
    if(clearAudio)await clearAudio();
    else {const {clearAudioDraft}=await import('./worker-audio-draft.ts');await clearAudioDraft(undefined,context);}
  }catch {cleared=false;}
  try {
    if(clearBriefings)await clearBriefings();
    else {const {clearOfflineBriefings}=await import('./worker-offline.ts');await clearOfflineBriefings(context);}
  }catch {cleared=false;}
  return cleared;
}
export const localCleanupText={
  en:{failed:'Session ended, but local cleanup could not be confirmed. Remove saved data before sharing this device.',remove:'Remove local saved data'},
  ar:{failed:'انتهت الجلسة، لكن تعذر تأكيد تنظيف البيانات المحلية. احذف البيانات المحفوظة قبل مشاركة هذا الجهاز.',remove:'احذف البيانات المحلية المحفوظة'},
  ur:{failed:'سیشن ختم ہو گیا، مگر مقامی صفائی کی تصدیق نہیں ہو سکی۔ آلہ مشترک کرنے سے پہلے محفوظ ڈیٹا ہٹائیں۔',remove:'مقامی محفوظ ڈیٹا ہٹائیں'},
  hi:{failed:'सत्र समाप्त हुआ, लेकिन स्थानीय सफ़ाई की पुष्टि नहीं हो सकी। यह डिवाइस साझा करने से पहले सहेजा डेटा हटाएँ।',remove:'स्थानीय सहेजा डेटा हटाएँ'},
  bn:{failed:'সেশন শেষ হয়েছে, কিন্তু স্থানীয় পরিষ্কার নিশ্চিত হয়নি। এই ডিভাইস শেয়ার করার আগে সংরক্ষিত ডেটা মুছে ফেলুন।',remove:'স্থানীয় সংরক্ষিত ডেটা মুছুন'},
  ml:{failed:'സെഷൻ അവസാനിച്ചു, പക്ഷേ പ്രാദേശിക വൃത്തിയാക്കൽ സ്ഥിരീകരിക്കാനായില്ല. ഈ ഉപകരണം പങ്കിടുന്നതിന് മുമ്പ് സംരക്ഷിച്ച ഡാറ്റ നീക്കുക.',remove:'പ്രാദേശിക സംരക്ഷിത ഡാറ്റ നീക്കുക'},
  ta:{failed:'அமர்வு முடிந்தது, ஆனால் உள்ளூர் சுத்தம் உறுதிப்படுத்தப்படவில்லை. இந்தச் சாதனத்தைப் பகிரும் முன் சேமித்த தரவை நீக்கவும்.',remove:'உள்ளூர் சேமித்த தரவை நீக்கவும்'},
  te:{failed:'సెషన్ ముగిసింది, కానీ స్థానిక శుభ్రత నిర్ధారించబడలేదు. ఈ పరికరాన్ని పంచుకునే ముందు సేవ్ చేసిన డేటాను తొలగించండి.',remove:'స్థానిక సేవ్ చేసిన డేటాను తొలగించండి'},
  ne:{failed:'सत्र समाप्त भयो, तर स्थानीय सफाई पुष्टि हुन सकेन। यो यन्त्र साझा गर्नुअघि सुरक्षित डाटा हटाउनुहोस्।',remove:'स्थानीय सुरक्षित डाटा हटाउनुहोस्'},
  fil:{failed:'Nagwakas ang session, ngunit hindi makumpirma ang lokal na paglilinis. Alisin ang naka-save na data bago ibahagi ang device na ito.',remove:'Alisin ang lokal na naka-save na data'},
  si:{failed:'සැසිය අවසන් විය, නමුත් දේශීය පිරිසිදු කිරීම තහවුරු කළ නොහැක. මෙම උපාංගය බෙදාගැනීමට පෙර සුරකින ලද දත්ත ඉවත් කරන්න.',remove:'දේශීය සුරකින ලද දත්ත ඉවත් කරන්න'},
  ru:{failed:'Сеанс завершён, но локальную очистку подтвердить не удалось. Удалите сохранённые данные, прежде чем передавать это устройство.',remove:'Удалить локальные сохранённые данные'},
  'pa-Guru':{failed:'ਸੈਸ਼ਨ ਖ਼ਤਮ ਹੋਇਆ, ਪਰ ਸਥਾਨਕ ਸਫ਼ਾਈ ਦੀ ਪੁਸ਼ਟੀ ਨਹੀਂ ਹੋ ਸਕੀ। ਇਹ ਡਿਵਾਈਸ ਸਾਂਝੀ ਕਰਨ ਤੋਂ ਪਹਿਲਾਂ ਸੰਭਾਲਿਆ ਡੇਟਾ ਹਟਾਓ।',remove:'ਸਥਾਨਕ ਸੰਭਾਲਿਆ ਡੇਟਾ ਹਟਾਓ'},
  'pa-Arab':{failed:'سیشن ختم ہو گیا، پر مقامی صفائی دی تصدیق نہیں ہو سکی۔ ایہہ آلہ سانجھا کرن توں پہلے محفوظ ڈیٹا ہٹاؤ۔',remove:'مقامی محفوظ ڈیٹا ہٹاؤ'},
  id:{failed:'Sesi berakhir, tetapi pembersihan lokal tidak dapat dikonfirmasi. Hapus data tersimpan sebelum membagikan perangkat ini.',remove:'Hapus data lokal yang tersimpan'},
};
