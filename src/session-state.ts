import {isWorkerLanguage} from '../server/languages.mjs';
export type PageSession={authenticated:boolean;role?:string;clientContext?:string;expiresAt?:string;workerId?:string|null;language?:string;mode?:string;staffRole?:string|null;staffScope?:string|null;siteState?:string;name?:string;email?:string;organization?:string;site?:string;timezone?:string};

export function validWorkerSession(value:unknown,now=Date.now()):value is PageSession {
  if(!value || typeof value!=='object' || Array.isArray(value))return false;
  const session=value as PageSession;
  return session.authenticated===true && session.role==='worker' && typeof session.clientContext==='string'
    && /^[a-f0-9]{64}$/.test(session.clientContext) && typeof session.workerId==='string' && session.workerId.trim().length>0
    && typeof session.mode==='string' && /^[a-z][a-z0-9-]{0,63}$/.test(session.mode)
    && isWorkerLanguage(session.language) && typeof session.expiresAt==='string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(session.expiresAt)
    && Number.isFinite(Date.parse(session.expiresAt)) && Date.parse(session.expiresAt)>now;
}
export function sameWorkerSession(expected:PageSession,current:unknown,now=Date.now()) {
  if(!validWorkerSession(expected,now) || !validWorkerSession(current,now))return false;
  return current.clientContext===expected.clientContext && current.workerId===expected.workerId
    && current.language===expected.language && current.mode===expected.mode;
}
export function validStaffSession(value:unknown,now=Date.now()):value is PageSession {
  if(!value || typeof value!=='object' || Array.isArray(value))return false;
  const session=value as PageSession;let scope;
  try{scope=JSON.parse(session.staffScope || '');}catch{return false;}
  return session.authenticated===true && session.role==='staff' && ['owner','administrator','supervisor','auditor'].includes(session.staffRole || '')
    && Array.isArray(scope) && scope.length===3 && scope.every(item=>typeof item==='string' && item.trim() && item.length<=100 && !/[\u0000-\u001f\u007f]/.test(item))
    && session.staffScope===JSON.stringify(scope) && ['active','archived'].includes(session.siteState || '')
    && typeof session.clientContext==='string' && /^[a-f0-9]{64}$/.test(session.clientContext)
    && typeof session.mode==='string' && /^[a-z][a-z0-9-]{0,63}$/.test(session.mode)
    && typeof session.expiresAt==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(session.expiresAt)
    && Number.isFinite(Date.parse(session.expiresAt)) && Date.parse(session.expiresAt)>now;
}
export function sameStaffSession(expected:PageSession,current:unknown,now=Date.now()) {
  if(!validStaffSession(expected,now) || !validStaffSession(current,now))return false;
  return current.clientContext===expected.clientContext && current.staffScope===expected.staffScope
    && current.staffRole===expected.staffRole && current.siteState===expected.siteState
    && current.mode===expected.mode && current.expiresAt===expected.expiresAt;
}
export const validPageSession=(value:unknown,now=Date.now())=>validWorkerSession(value,now) || validStaffSession(value,now);
export function samePageSession(expected:PageSession,current:unknown,now=Date.now()) {
  return expected.role==='worker'?sameWorkerSession(expected,current,now):sameStaffSession(expected,current,now);
}
export const staffIdentityText={
  en:{unrecorded:'Not recorded',owner:'Owner',administrator:'Administrator',supervisor:'Supervisor',auditor:'Auditor'},
  ar:{unrecorded:'غير مسجل',owner:'المالك',administrator:'المسؤول',supervisor:'المشرف',auditor:'المدقق'},
  ur:{unrecorded:'درج نہیں',owner:'مالک',administrator:'منتظم',supervisor:'نگران',auditor:'آڈیٹر'},
};
export function staffIdentityLabel(value:unknown,language:keyof typeof staffIdentityText,role=false) {
  const labels=staffIdentityText[language];
  if(role)return typeof value==='string' && ['owner','administrator','supervisor','auditor'].includes(value)
    ? labels[value as 'owner'|'administrator'|'supervisor'|'auditor']:labels.unrecorded;
  return typeof value==='string' && value.trim() && value.length<=254 && !/[\u0000-\u001f\u007f]/.test(value)?value:labels.unrecorded;
}
export const staffSessionText={
  en:{title:'This workspace session is locked',body:'The session changed, ended or could not be verified. Unsubmitted changes on this page are no longer open. A request already sent may still complete.',next:'Saved request recovery records have not been replayed or removed.',check:'Recheck session',checking:'Checking session...',same:'The original account and site are verified.',different:'A different account, site or access policy is active.',guest:'No signed-in session is active.',worker:'A worker session is active. Reload and check the worker identity before continuing.',unavailable:'The session could not be verified. No workspace was opened and no request was repeated.',resume:'Return to verified workspace',open:'Open verified account and site',confirm:'I have checked the account and site shown below.',signIn:'Go to sign in',reload:'Reload and check identity',account:'Account',organization:'Organization',site:'Site',role:'Role'},
  ar:{title:'تم قفل جلسة مساحة العمل',body:'تغيّرت الجلسة أو انتهت أو تعذّر التحقق منها. لم تعد التغييرات غير المرسلة في هذه الصفحة مفتوحة. قد يكتمل طلب أُرسل بالفعل.',next:'لم تتم إعادة إرسال سجلات استعادة الطلبات المحفوظة أو حذفها.',check:'إعادة التحقق من الجلسة',checking:'جارٍ التحقق من الجلسة...',same:'تم التحقق من الحساب والموقع الأصليين.',different:'يوجد حساب أو موقع أو سياسة وصول مختلفة نشطة.',guest:'لا توجد جلسة مسجلة الدخول نشطة.',worker:'توجد جلسة عامل نشطة. أعد التحميل وتحقق من هوية العامل قبل المتابعة.',unavailable:'تعذر التحقق من الجلسة. لم يتم فتح مساحة عمل أو إعادة إرسال أي طلب.',resume:'العودة إلى مساحة العمل المتحقق منها',open:'فتح الحساب والموقع المتحقق منهما',confirm:'تحققت من الحساب والموقع الظاهرين أدناه.',signIn:'الانتقال إلى تسجيل الدخول',reload:'إعادة التحميل والتحقق من الهوية',account:'الحساب',organization:'المؤسسة',site:'الموقع',role:'الدور'},
  ur:{title:'یہ ورک اسپیس سیشن مقفل ہے',body:'سیشن بدل گیا، ختم ہو گیا یا اس کی تصدیق نہیں ہو سکی۔ اس صفحے کی غیر ارسال شدہ تبدیلیاں اب کھلی نہیں ہیں۔ پہلے بھیجی گئی درخواست مکمل ہو سکتی ہے۔',next:'محفوظ درخواست کی بازیابی کے ریکارڈ دوبارہ نہیں بھیجے گئے اور نہ ہی حذف ہوئے ہیں۔',check:'سیشن دوبارہ چیک کریں',checking:'سیشن چیک کیا جا رہا ہے...',same:'اصل اکاؤنٹ اور سائٹ کی تصدیق ہو گئی ہے۔',different:'ایک مختلف اکاؤنٹ، سائٹ یا رسائی کی پالیسی فعال ہے۔',guest:'کوئی سائن ان سیشن فعال نہیں ہے۔',worker:'کارکن کا سیشن فعال ہے۔ آگے بڑھنے سے پہلے دوبارہ لوڈ کریں اور کارکن کی شناخت چیک کریں۔',unavailable:'سیشن کی تصدیق نہیں ہو سکی۔ کوئی ورک اسپیس نہیں کھلی اور کوئی درخواست دوبارہ نہیں بھیجی گئی۔',resume:'تصدیق شدہ ورک اسپیس پر واپس جائیں',open:'تصدیق شدہ اکاؤنٹ اور سائٹ کھولیں',confirm:'میں نے نیچے دکھائے گئے اکاؤنٹ اور سائٹ کو چیک کیا ہے۔',signIn:'سائن ان پر جائیں',reload:'دوبارہ لوڈ کرکے شناخت چیک کریں',account:'اکاؤنٹ',organization:'ادارہ',site:'سائٹ',role:'کردار'},
};
export const workerSessionText={
  en:{title:'This worker session is locked',body:'The session changed, ended or could not be verified. Unsent work on this page has been cleared. A request already sent may still complete.',next:'Reopen your own access link, or reload and check the identity before continuing.',reload:'Reload'},
  ar:{title:'تم قفل جلسة العامل',body:'تغيّرت الجلسة أو انتهت أو تعذّر التحقق منها. تم مسح العمل غير المرسل في هذه الصفحة. قد يكتمل طلب أُرسل بالفعل.',next:'افتح رابط الوصول الخاص بك، أو أعد تحميل الصفحة وتحقق من الهوية قبل المتابعة.',reload:'إعادة تحميل'},
  ur:{title:'کارکن کا یہ سیشن مقفل ہے',body:'سیشن بدل گیا، ختم ہو گیا یا اس کی تصدیق نہیں ہو سکی۔ اس صفحے کا نہ بھیجا گیا کام مٹا دیا گیا ہے۔ پہلے بھیجی گئی درخواست مکمل ہو سکتی ہے۔',next:'اپنا رسائی کا لنک دوبارہ کھولیں، یا صفحہ دوبارہ لوڈ کر کے آگے بڑھنے سے پہلے شناخت چیک کریں۔',reload:'دوبارہ لوڈ کریں'},
  hi:{title:'यह वर्कर सत्र लॉक है',body:'सत्र बदला, समाप्त हुआ या सत्यापित नहीं हो सका। इस पेज का अनसेंट काम हटा दिया गया है। पहले भेजा गया अनुरोध अब भी पूरा हो सकता है।',next:'अपना एक्सेस लिंक फिर खोलें, या जारी रखने से पहले पेज रीलोड करके पहचान जाँचें।',reload:'रीलोड करें'},
  bn:{title:'এই কর্মীর সেশন লক করা আছে',body:'সেশন বদলেছে, শেষ হয়েছে বা যাচাই করা যায়নি। এই পেজের না-পাঠানো কাজ মুছে ফেলা হয়েছে। আগে পাঠানো অনুরোধ এখনও সম্পন্ন হতে পারে।',next:'নিজের প্রবেশাধিকার লিংক আবার খুলুন, অথবা চালিয়ে যাওয়ার আগে পেজ রিলোড করে পরিচয় যাচাই করুন।',reload:'রিলোড করুন'},
  ml:{title:'ഈ തൊഴിലാളി സെഷൻ ലോക്ക് ചെയ്തിരിക്കുന്നു',body:'സെഷൻ മാറി, അവസാനിച്ചു അല്ലെങ്കിൽ സ്ഥിരീകരിക്കാനായില്ല. ഈ പേജിലെ അയക്കാത്ത ജോലി മായ്ച്ചു. മുമ്പ് അയച്ച അഭ്യർത്ഥന ഇപ്പോഴും പൂർത്തിയാകാം.',next:'നിങ്ങളുടെ സ്വന്തം പ്രവേശന ലിങ്ക് വീണ്ടും തുറക്കുക, അല്ലെങ്കിൽ തുടരുന്നതിന് മുമ്പ് പേജ് റീലോഡ് ചെയ്ത് ഐഡന്റിറ്റി പരിശോധിക്കുക.',reload:'റീലോഡ് ചെയ്യുക'},
  ta:{title:'இந்தத் தொழிலாளர் அமர்வு பூட்டப்பட்டுள்ளது',body:'அமர்வு மாறியது, முடிந்தது அல்லது சரிபார்க்க முடியவில்லை. இந்தப் பக்கத்தின் அனுப்பாத வேலை அழிக்கப்பட்டது. ஏற்கனவே அனுப்பிய கோரிக்கை இன்னும் முடியலாம்.',next:'உங்கள் சொந்த அணுகல் இணைப்பை மீண்டும் திறக்கவும், அல்லது தொடரும் முன் பக்கத்தை மீளேற்றி அடையாளத்தைச் சரிபார்க்கவும்.',reload:'மீளேற்று'},
  te:{title:'ఈ కార్మిక సెషన్ లాక్ చేయబడింది',body:'సెషన్ మారింది, ముగిసింది లేదా ధృవీకరించలేకపోయాం. ఈ పేజీలోని పంపని పని తొలగించబడింది. ఇప్పటికే పంపిన అభ్యర్థన ఇంకా పూర్తికావచ్చు.',next:'మీ స్వంత ప్రవేశ లింక్‌ను మళ్లీ తెరవండి, లేదా కొనసాగించే ముందు పేజీని రీలోడ్ చేసి గుర్తింపును తనిఖీ చేయండి.',reload:'రీలోడ్'},
  ne:{title:'यो कामदार सत्र लक गरिएको छ',body:'सत्र बदलियो, अन्त्य भयो वा प्रमाणित गर्न सकिएन। यो पृष्ठको नपठाइएको काम मेटिएको छ। पहिले पठाइएको अनुरोध अझै पूरा हुन सक्छ।',next:'आफ्नै पहुँच लिंक फेरि खोल्नुहोस्, वा जारी राख्नुअघि पृष्ठ रिलोड गरेर पहिचान जाँच्नुहोस्।',reload:'रिलोड गर्नुहोस्'},
  fil:{title:'Naka-lock ang worker session na ito',body:'Nagbago, natapos, o hindi ma-verify ang session. Nabura ang hindi naipadalang trabaho sa pahinang ito. Maaaring matapos pa ang request na naipadala na.',next:'Buksan muli ang sarili mong access link, o i-reload at suriin ang pagkakakilanlan bago magpatuloy.',reload:'I-reload'},
  si:{title:'මෙම සේවක සැසිය අගුළු දමා ඇත',body:'සැසිය වෙනස් විය, අවසන් විය හෝ සත්‍යාපනය කළ නොහැක. මෙම පිටුවේ නොයැවූ වැඩ මකා ඇත. දැනටමත් යැවූ ඉල්ලීම තවමත් සම්පූර්ණ විය හැක.',next:'ඔබේම ප්‍රවේශ සබැඳිය නැවත විවෘත කරන්න, නැතහොත් ඉදිරියට යාමට පෙර පිටුව නැවුම් කර අනන්‍යතාවය පරීක්ෂා කරන්න.',reload:'නැවුම් කරන්න'},
  ru:{title:'Сеанс работника заблокирован',body:'Сеанс изменился, завершился или не может быть проверен. Неотправленная работа на этой странице удалена. Уже отправленный запрос всё ещё может завершиться.',next:'Снова откройте свою ссылку доступа либо перезагрузите страницу и проверьте личность, прежде чем продолжать.',reload:'Перезагрузить'},
  'pa-Guru':{title:'ਇਹ ਵਰਕਰ ਸੈਸ਼ਨ ਲਾਕ ਹੈ',body:'ਸੈਸ਼ਨ ਬਦਲਿਆ, ਖ਼ਤਮ ਹੋਇਆ ਜਾਂ ਪੁਸ਼ਟੀ ਨਹੀਂ ਹੋ ਸਕੀ। ਇਸ ਪੇਜ ਦਾ ਨਾ-ਭੇਜਿਆ ਕੰਮ ਮਿਟਾ ਦਿੱਤਾ ਗਿਆ ਹੈ। ਪਹਿਲਾਂ ਭੇਜੀ ਬੇਨਤੀ ਅਜੇ ਪੂਰੀ ਹੋ ਸਕਦੀ ਹੈ।',next:'ਆਪਣਾ ਐਕਸੈਸ ਲਿੰਕ ਦੁਬਾਰਾ ਖੋਲ੍ਹੋ, ਜਾਂ ਜਾਰੀ ਰੱਖਣ ਤੋਂ ਪਹਿਲਾਂ ਪੇਜ ਰੀਲੋਡ ਕਰਕੇ ਪਛਾਣ ਜਾਂਚੋ।',reload:'ਰੀਲੋਡ ਕਰੋ'},
  'pa-Arab':{title:'ایہہ ورکر سیشن لاک اے',body:'سیشن بدل گیا، ختم ہو گیا یا تصدیق نہیں ہو سکی۔ ایس صفحے دا نہ بھیجیا کم مٹا دتا گیا اے۔ پہلے بھیجی درخواست ہالے پوری ہو سکدی اے۔',next:'اپنا رسائی لنک دوبارہ کھولو، یا جاری رکھن توں پہلے صفحہ ری لوڈ کر کے شناخت چیک کرو۔',reload:'ری لوڈ کرو'},
  id:{title:'Sesi pekerja ini terkunci',body:'Sesi berubah, berakhir, atau tidak dapat diverifikasi. Pekerjaan yang belum terkirim di halaman ini telah dihapus. Permintaan yang sudah dikirim mungkin masih selesai.',next:'Buka lagi tautan akses Anda sendiri, atau muat ulang dan periksa identitas sebelum melanjutkan.',reload:'Muat ulang'},
};
export const sessionLoadText={
  en:{title:'Session unavailable',body:'Your session could not be checked. No workspace has been opened.',retry:'Recheck session',saved:'Open saved briefings',loading:'Loading Understood...'},
  ar:{title:'الجلسة غير متاحة',body:'تعذر التحقق من جلستك. لم يتم فتح أي مساحة عمل.',retry:'إعادة التحقق من الجلسة',saved:'فتح التعليمات المحفوظة',loading:'جارٍ تحميل Understood...'},
  ur:{title:'سیشن دستیاب نہیں',body:'آپ کے سیشن کی تصدیق نہیں ہو سکی۔ کوئی ورک اسپیس نہیں کھولی گئی۔',retry:'سیشن دوبارہ چیک کریں',saved:'محفوظ شدہ ہدایات کھولیں',loading:'Understood لوڈ ہو رہا ہے...'},
  hi:{title:'सत्र उपलब्ध नहीं',body:'आपका सत्र जाँचा नहीं जा सका। कोई कार्यक्षेत्र नहीं खोला गया।',retry:'सत्र फिर जाँचें',saved:'सहेजे गए निर्देश खोलें',loading:'Understood लोड हो रहा है...'},
  bn:{title:'সেশন পাওয়া যাচ্ছে না',body:'আপনার সেশন যাচাই করা যায়নি। কোনো ওয়ার্কস্পেস খোলা হয়নি।',retry:'সেশন আবার যাচাই করুন',saved:'সংরক্ষিত নির্দেশনা খুলুন',loading:'Understood লোড হচ্ছে...'},
  ml:{title:'സെഷൻ ലഭ്യമല്ല',body:'നിങ്ങളുടെ സെഷൻ പരിശോധിക്കാനായില്ല. വർക്ക്സ്പേസ് തുറന്നിട്ടില്ല.',retry:'സെഷൻ വീണ്ടും പരിശോധിക്കുക',saved:'സംരക്ഷിച്ച നിർദ്ദേശങ്ങൾ തുറക്കുക',loading:'Understood ലോഡ് ചെയ്യുന്നു...'},
  ta:{title:'அமர்வு கிடைக்கவில்லை',body:'உங்கள் அமர்வைச் சரிபார்க்க முடியவில்லை. எந்தப் பணியிடமும் திறக்கப்படவில்லை.',retry:'அமர்வை மீண்டும் சரிபார்',saved:'சேமித்த அறிவுறுத்தல்களைத் திற',loading:'Understood ஏற்றப்படுகிறது...'},
  te:{title:'సెషన్ అందుబాటులో లేదు',body:'మీ సెషన్‌ను తనిఖీ చేయలేకపోయాం. ఏ వర్క్‌స్పేస్ తెరవబడలేదు.',retry:'సెషన్‌ను మళ్లీ తనిఖీ చేయండి',saved:'సేవ్ చేసిన సూచనలను తెరవండి',loading:'Understood లోడ్ అవుతోంది...'},
  ne:{title:'सत्र उपलब्ध छैन',body:'तपाईंको सत्र जाँच्न सकिएन। कुनै कार्यक्षेत्र खोलिएको छैन।',retry:'सत्र फेरि जाँच्नुहोस्',saved:'सुरक्षित गरिएका निर्देशन खोल्नुहोस्',loading:'Understood लोड हुँदै...'},
  fil:{title:'Hindi available ang session',body:'Hindi masuri ang iyong session. Walang workspace na nabuksan.',retry:'Suriin muli ang session',saved:'Buksan ang mga naka-save na tagubilin',loading:'Naglo-load ang Understood...'},
  si:{title:'සැසිය නොමැත',body:'ඔබේ සැසිය පරීක්ෂා කළ නොහැක. කිසිදු කාර්ය අවකාශයක් විවෘත කර නැත.',retry:'සැසිය නැවත පරීක්ෂා කරන්න',saved:'සුරැකි උපදෙස් විවෘත කරන්න',loading:'Understood පූරණය වෙමින්...'},
  ru:{title:'Сеанс недоступен',body:'Не удалось проверить ваш сеанс. Рабочее пространство не открыто.',retry:'Проверить сеанс снова',saved:'Открыть сохранённые инструкции',loading:'Загрузка Understood...'},
  'pa-Guru':{title:'ਸੈਸ਼ਨ ਉਪਲਬਧ ਨਹੀਂ',body:'ਤੁਹਾਡਾ ਸੈਸ਼ਨ ਜਾਂਚਿਆ ਨਹੀਂ ਜਾ ਸਕਿਆ। ਕੋਈ ਵਰਕਸਪੇਸ ਨਹੀਂ ਖੋਲ੍ਹੀ ਗਈ।',retry:'ਸੈਸ਼ਨ ਦੁਬਾਰਾ ਜਾਂਚੋ',saved:'ਸੰਭਾਲੀਆਂ ਹਦਾਇਤਾਂ ਖੋਲ੍ਹੋ',loading:'Understood ਲੋਡ ਹੋ ਰਿਹਾ ਹੈ...'},
  'pa-Arab':{title:'سیشن دستیاب نہیں',body:'تہاڈا سیشن چیک نہیں ہو سکیا۔ کوئی ورک اسپیس نہیں کھلی۔',retry:'سیشن دوبارہ چیک کرو',saved:'محفوظ ہدایتاں کھولو',loading:'Understood لوڈ ہو ریا اے...'},
  id:{title:'Sesi tidak tersedia',body:'Sesi Anda tidak dapat diperiksa. Tidak ada ruang kerja yang dibuka.',retry:'Periksa sesi lagi',saved:'Buka instruksi tersimpan',loading:'Memuat Understood...'},
};
