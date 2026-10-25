export type WorkerLeaveAction='back'|'logout'|'type';
export type UnsentWork={answer:string;help:string;audio:boolean};
export function workerInputAvailability(work:UnsentWork&{helpVoice:boolean;conversation:boolean}){
  return {answerBlocked:!!work.help.trim()||work.helpVoice||work.conversation,
    helpBlocked:!!work.answer.trim()||work.audio||work.conversation,
    conversationBlocked:!!work.answer.trim()||work.audio||!!work.help.trim()||work.helpVoice};
}
export function recorderHasUnsent(phase:string){return ['requesting','recording','preview','uploading'].includes(phase);}
export function workerLeaveRequired(action:WorkerLeaveAction,work:UnsentWork){
  return work.audio || (action!=='type' && !!(work.answer.trim() || work.help.trim()));
}
export function workerNavigationDecision(current:string,next:string,unsent:boolean,busy:boolean) {
  if(current===next)return 'allow';
  if(busy)return 'hold';
  return unsent ? 'confirm' : 'allow';
}
export function retainWorkerDetail(currentId:string|null,loadedId:unknown,unsent:boolean,status:number|null) {
  return !!currentId && currentId===loadedId && unsent && (status===0 || (status!==null && status>=500 && status<=599));
}
export const workerRefreshText={
  en:{refresh:'Refresh briefing',failed:'The briefing could not be refreshed. Recheck before sending.'},
  ar:{refresh:'تحديث التعليمات',failed:'تعذر تحديث التعليمات. تحقق مجددًا قبل الإرسال.'},
  hi:{refresh:'ब्रीफिंग रीफ़्रेश करें',failed:'ब्रीफिंग रीफ़्रेश नहीं हो सकी। भेजने से पहले फिर जाँचें।'},
  ur:{refresh:'ہدایت تازہ کریں',failed:'ہدایت تازہ نہیں ہو سکی۔ بھیجنے سے پہلے دوبارہ چیک کریں۔'},
  bn:{refresh:'ব্রিফিং রিফ্রেশ করুন',failed:'ব্রিফিং রিফ্রেশ করা যায়নি। পাঠানোর আগে আবার যাচাই করুন।'},
  ml:{refresh:'ബ്രീഫിംഗ് പുതുക്കുക',failed:'ബ്രീഫിംഗ് പുതുക്കാനായില്ല. അയയ്ക്കുന്നതിന് മുമ്പ് വീണ്ടും പരിശോധിക്കുക.'},
  ta:{refresh:'வழிமுறையைப் புதுப்பி',failed:'வழிமுறையைப் புதுப்பிக்க முடியவில்லை. அனுப்பும் முன் மீண்டும் சரிபார்க்கவும்.'},
  te:{refresh:'బ్రీఫింగ్ రిఫ్రెష్ చేయండి',failed:'బ్రీఫింగ్ రిఫ్రెష్ చేయలేకపోయాం. పంపే ముందు మళ్లీ తనిఖీ చేయండి.'},
  ne:{refresh:'ब्रिफिङ रिफ्रेस गर्नुहोस्',failed:'ब्रिफिङ रिफ्रेस गर्न सकिएन। पठाउनु अघि फेरि जाँच्नुहोस्।'},
  fil:{refresh:'I-refresh ang briefing',failed:'Hindi na-refresh ang briefing. Suriin muli bago magpadala.'},
  si:{refresh:'බ්‍රීෆිං නැවුම් කරන්න',failed:'බ්‍රීෆිං නැවුම් කළ නොහැකි විය. යැවීමට පෙර නැවත පරීක්ෂා කරන්න.'},
  ru:{refresh:'Обновить инструкцию',failed:'Не удалось обновить инструкцию. Проверьте ещё раз перед отправкой.'},
  'pa-Guru':{refresh:'ਬ੍ਰੀਫਿੰਗ ਤਾਜ਼ਾ ਕਰੋ',failed:'ਬ੍ਰੀਫਿੰਗ ਤਾਜ਼ਾ ਨਹੀਂ ਹੋ ਸਕੀ। ਭੇਜਣ ਤੋਂ ਪਹਿਲਾਂ ਫਿਰ ਜਾਂਚੋ।'},
  'pa-Arab':{refresh:'بریفنگ تازہ کرو',failed:'بریفنگ تازہ نئیں ہو سکی۔ بھیجن توں پہلاں فیر چیک کرو۔'},
  id:{refresh:'Muat ulang instruksi',failed:'Instruksi tidak dapat dimuat ulang. Periksa lagi sebelum mengirim.'},
};
export const workerLeaveText={
  en:{title:'Leave unsent work?',body:'Leaving discards unsaved work on this page. Copies you explicitly saved may remain until removed, expired or session cleanup succeeds. Nothing new will be sent.',mode:'Switching to typing discards the current recording preview. An explicitly saved copy may remain. Nothing will be sent.',stay:'Keep working',leave:'Discard and leave',type:'Discard recording',end:'End session'},
  ar:{title:'مغادرة العمل غير المرسل؟',body:'المغادرة تحذف العمل غير المحفوظ في هذه الصفحة. قد تبقى النسخ التي حفظتها صراحة حتى حذفها أو انتهاء صلاحيتها أو نجاح تنظيف الجلسة. لن يُرسل شيء جديد.',mode:'الانتقال إلى الكتابة يحذف معاينة التسجيل الحالية. قد تبقى نسخة حفظتها صراحة. لن يُرسل شيء.',stay:'متابعة العمل',leave:'حذف ومغادرة',type:'حذف التسجيل',end:'إنهاء الجلسة'},
  hi:{title:'बिना भेजा काम छोड़ें?',body:'छोड़ने से इस पेज का असहेजा काम हट जाएगा। जो प्रतियाँ आपने स्पष्ट रूप से सहेजी हैं वे हटाने, समाप्त होने या सत्र सफल साफ़ होने तक रह सकती हैं। कुछ नया नहीं भेजा जाएगा।',mode:'टाइपिंग पर जाने से मौजूदा रिकॉर्डिंग पूर्वावलोकन हट जाएगा। स्पष्ट रूप से सहेजी गई प्रति रह सकती है। कुछ नहीं भेजा जाएगा।',stay:'काम जारी रखें',leave:'हटाएँ और छोड़ें',type:'रिकॉर्डिंग हटाएँ',end:'सत्र समाप्त करें'},
  ur:{title:'نہ بھیجا گیا کام چھوڑ دیں؟',body:'چھوڑنے سے اس صفحے کا غیر محفوظ کام ضائع ہو جاتا ہے۔ واضح طور پر محفوظ نقل ہٹانے، میعاد ختم ہونے یا سیشن کی کامیاب صفائی تک باقی رہ سکتی ہے۔ کچھ نیا نہیں بھیجا جائے گا۔',mode:'لکھنے پر جانے سے موجودہ ریکارڈنگ کا پیش نظارہ ضائع ہو گا۔ واضح طور پر محفوظ نقل باقی رہ سکتی ہے۔ کچھ نہیں بھیجا جائے گا۔',stay:'کام جاری رکھیں',leave:'حذف کر کے چھوڑ دیں',type:'ریکارڈنگ حذف کریں',end:'سیشن ختم کریں'},
  bn:{title:'না পাঠানো কাজ ছাড়বেন?',body:'ছাড়লে এই পৃষ্ঠার অসংরক্ষিত কাজ মুছে যাবে। আপনি স্পষ্টভাবে সংরক্ষণ করা কপি সরানো, মেয়াদ শেষ বা সেশন সফলভাবে পরিষ্কার হওয়া পর্যন্ত থাকতে পারে। নতুন কিছু পাঠানো হবে না।',mode:'টাইপিংয়ে গেলে বর্তমান রেকর্ডিংয়ের পূর্বরূপ মুছে যাবে। স্পষ্টভাবে সংরক্ষিত কপি থাকতে পারে। কিছু পাঠানো হবে না।',stay:'কাজ চালিয়ে যান',leave:'মুছে ছাড়ুন',type:'রেকর্ডিং মুছুন',end:'সেশন শেষ করুন'},
  ml:{title:'അയയ്ക്കാത്ത ജോലി ഉപേക്ഷിക്കണോ?',body:'ഉപേക്ഷിച്ചാൽ ഈ പേജിലെ സൂക്ഷിക്കാത്ത ജോലി നഷ്ടമാകും. നിങ്ങൾ വ്യക്തമായി സൂക്ഷിച്ച പകർപ്പുകൾ നീക്കുന്നത്, കാലഹരണപ്പെടുന്നത് അല്ലെങ്കിൽ സെഷൻ വിജയകരമായി വൃത്തിയാക്കുന്നത് വരെ തുടരാം. പുതിയതൊന്നും അയയ്ക്കില്ല.',mode:'ടൈപ്പിംഗിലേക്ക് മാറിയാൽ നിലവിലെ റെക്കോർഡിംഗ് പ്രിവ്യൂ നഷ്ടമാകും. വ്യക്തമായി സൂക്ഷിച്ച പകർപ്പ് തുടരാം. ഒന്നും അയയ്ക്കില്ല.',stay:'ജോലി തുടരുക',leave:'നീക്കി പുറത്തുപോകുക',type:'റെക്കോർഡിംഗ് നീക്കുക',end:'സെഷൻ അവസാനിപ്പിക്കുക'},
  ta:{title:'அனுப்பாத வேலையை விட்டு வெளியேறவா?',body:'வெளியேறினால் இந்தப் பக்கத்தின் சேமிக்காத வேலை நீங்கும். நீங்கள் வெளிப்படையாகச் சேமித்த நகல்கள் நீக்கும் வரை, காலாவதியாகும் வரை அல்லது அமர்வு வெற்றிகரமாகச் சுத்தம் ஆகும் வரை இருக்கலாம். புதிதாக எதுவும் அனுப்பப்படாது.',mode:'தட்டச்சுக்கு மாறினால் தற்போதைய பதிவின் முன்னோட்டம் நீங்கும். வெளிப்படையாகச் சேமித்த நகல் இருக்கலாம். எதுவும் அனுப்பப்படாது.',stay:'வேலையைத் தொடர்',leave:'நீக்கி வெளியேறு',type:'பதிவை நீக்கு',end:'அமர்வை முடி'},
  te:{title:'పంపని పనిని వదిలేయాలా?',body:'వదిలేస్తే ఈ పేజీలోని సేవ్ చేయని పని పోతుంది. మీరు స్పష్టంగా సేవ్ చేసిన కాపీలు తీసివేసే వరకు, గడువు ముగిసే వరకు లేదా సెషన్ విజయవంతంగా శుభ్రం అయ్యే వరకు ఉండవచ్చు. కొత్తది ఏమీ పంపబడదు.',mode:'టైపింగ్‌కు మారితే ప్రస్తుత రికార్డింగ్ ప్రివ్యూ పోతుంది. స్పష్టంగా సేవ్ చేసిన కాపీ ఉండవచ్చు. ఏమీ పంపబడదు.',stay:'పని కొనసాగించండి',leave:'తీసివేసి వెళ్లండి',type:'రికార్డింగ్ తీసివేయండి',end:'సెషన్ ముగించండి'},
  ne:{title:'नपठाएको काम छोड्ने?',body:'छोड्दा यो पृष्ठको नसुरक्षित काम हराउँछ। तपाईंले स्पष्ट रूपमा सुरक्षित गरेका प्रतिलिपि हटाउने, म्याद सकिने वा सत्र सफलतापूर्वक सफा नभएसम्म रहन सक्छन्। नयाँ केही पठाइने छैन।',mode:'टाइपिङमा जाँदा हालको रेकर्डिङ पूर्वावलोकन हराउँछ। स्पष्ट रूपमा सुरक्षित प्रतिलिपि रहन सक्छ। केही पठाइने छैन।',stay:'काम जारी राख्नुहोस्',leave:'हटाएर छोड्नुहोस्',type:'रेकर्डिङ हटाउनुहोस्',end:'सत्र अन्त्य गर्नुहोस्'},
  fil:{title:'Iwan ang hindi naipadalang trabaho?',body:'Kapag umalis, mawawala ang hindi na-save na trabaho sa pahinang ito. Maaaring manatili ang mga kopyang tahasan mong sine-save hanggang maalis, mag-expire o matagumpay na malinis ang session. Walang bagong ipapadala.',mode:'Kapag lumipat sa pagta-type, mawawala ang preview ng kasalukuyang rekording. Maaaring manatili ang tahasang na-save na kopya. Walang ipapadala.',stay:'Magpatuloy sa trabaho',leave:'Alisin at umalis',type:'Alisin ang rekording',end:'Tapusin ang session'},
  si:{title:'නොයැවූ වැඩ හැර යන්නද?',body:'හැර යාමෙන් මෙම පිටුවේ නොසුරකින වැඩ ඉවත් වේ. ඔබ පැහැදිලිව සුරකින ලද පිටපත් ඉවත් කිරීම, කල් ඉකුත් වීම හෝ සැසිය සාර්ථකව පිරිසිදු වීම දක්වා රැඳී තිබිය හැක. අලුතින් කිසිවක් යවනු නොලැබේ.',mode:'ටයිප් කිරීමට මාරු වීමෙන් වත්මන් පටිගත කිරීමේ පෙරදසුන ඉවත් වේ. පැහැදිලිව සුරකින ලද පිටපතක් රැඳී තිබිය හැක. කිසිවක් යවනු නොලැබේ.',stay:'වැඩ දිගටම කරන්න',leave:'ඉවත් කර හැර යන්න',type:'පටිගත කිරීම ඉවත් කරන්න',end:'සැසිය අවසන් කරන්න'},
  ru:{title:'Покинуть неотправленную работу?',body:'При выходе несохранённая работа на этой странице будет потеряна. Копии, которые вы явно сохранили, могут оставаться до удаления, истечения срока или успешной очистки сеанса. Ничего нового не будет отправлено.',mode:'Переход к вводу текста удалит текущий предпросмотр записи. Явно сохранённая копия может остаться. Ничего не будет отправлено.',stay:'Продолжить работу',leave:'Удалить и выйти',type:'Удалить запись',end:'Завершить сеанс'},
  'pa-Guru':{title:'ਨਾ ਭੇਜਿਆ ਕੰਮ ਛੱਡਣਾ ਹੈ?',body:'ਛੱਡਣ ਨਾਲ ਇਸ ਪੇਜ ਦਾ ਨਾ-ਸੰਭਾਲਿਆ ਕੰਮ ਮਿਟ ਜਾਵੇਗਾ। ਤੁਸੀਂ ਸਪਸ਼ਟ ਤੌਰ ’ਤੇ ਸੰਭਾਲੀਆਂ ਕਾਪੀਆਂ ਹਟਾਉਣ, ਮਿਆਦ ਪੁੱਗਣ ਜਾਂ ਸੈਸ਼ਨ ਸਫਲ ਸਾਫ਼ ਹੋਣ ਤੱਕ ਰਹਿ ਸਕਦੀਆਂ ਹਨ। ਕੁਝ ਨਵਾਂ ਨਹੀਂ ਭੇਜਿਆ ਜਾਵੇਗਾ।',mode:'ਟਾਈਪਿੰਗ ’ਤੇ ਜਾਣ ਨਾਲ ਮੌਜੂਦਾ ਰਿਕਾਰਡਿੰਗ ਦਾ ਪੂਰਵਦਰਸ਼ਨ ਮਿਟ ਜਾਵੇਗਾ। ਸਪਸ਼ਟ ਤੌਰ ’ਤੇ ਸੰਭਾਲੀ ਕਾਪੀ ਰਹਿ ਸਕਦੀ ਹੈ। ਕੁਝ ਨਹੀਂ ਭੇਜਿਆ ਜਾਵੇਗਾ।',stay:'ਕੰਮ ਜਾਰੀ ਰੱਖੋ',leave:'ਹਟਾ ਕੇ ਛੱਡੋ',type:'ਰਿਕਾਰਡਿੰਗ ਹਟਾਓ',end:'ਸੈਸ਼ਨ ਖਤਮ ਕਰੋ'},
  'pa-Arab':{title:'نہ بھیجیا کم چھڈنا اے؟',body:'چھڈن نال ایس صفحے دا نہ سنبھالیا کم مٹ جاوے گا۔ تسیں صاف طور تے سنبھالیاں کاپیاں ہٹان، میعاد مُکن یا سیشن سفل ساف ہون تک رہ سکدیاں نیں۔ کجھ نواں نئیں بھیجیا جاوے گا۔',mode:'ٹائپنگ تے جان نال موجودہ ریکارڈنگ دا پیش نظارہ مٹ جاوے گا۔ صاف طور تے سنبھالی کاپی رہ سکدی اے۔ کجھ نئیں بھیجیا جاوے گا۔',stay:'کم جاری رکھو',leave:'ہٹا کے چھڈو',type:'ریکارڈنگ ہٹاؤ',end:'سیشن ختم کرو'},
  id:{title:'Tinggalkan pekerjaan yang belum dikirim?',body:'Meninggalkan halaman ini akan menghapus pekerjaan yang belum disimpan. Salinan yang Anda simpan secara eksplisit dapat tetap ada sampai dihapus, kedaluwarsa, atau sesi berhasil dibersihkan. Tidak ada yang baru akan dikirim.',mode:'Beralih ke pengetikan akan menghapus pratinjau rekaman saat ini. Salinan yang disimpan eksplisit dapat tetap ada. Tidak ada yang akan dikirim.',stay:'Lanjut bekerja',leave:'Hapus dan tinggalkan',type:'Hapus rekaman',end:'Akhiri sesi'},
};
