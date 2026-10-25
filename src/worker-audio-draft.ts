import {validWorkerSession,sameWorkerSession,type PageSession} from './session-state.ts';
import type {RecordingScope} from './worker-audio-retry.ts';
import {privateDeviceAllowed} from './worker-device-policy.ts';

export const audioDraftCopy={
  en:{title:'Saved recording',consent:'Save only on a device I control',privacy:'One optional recording is encrypted in this browser for this session and exact briefing, for at most 24 hours. The key is held here too; this is not a secure vault. Do not save on a shared device. Browser cleanup or expiry can remove it. Nothing uploads automatically.',loading:'Checking saved recording...',empty:'No recording saved here.',saved:'Saved here. Server receipt and AI assessment are separate.',other:'A recording for another briefing version is saved here. It cannot be sent to this one.',failed:'Saved recording could not be verified or updated. No delivery is confirmed.',removed:'Saved recording removed.',received:'Recording receipt verified. The saved copy remains until removed or expired.',send:'Send saved recording',check:'Check recording receipt',remove:'Remove saved recording',reload:'Recheck saved recording'},
  ar:{title:'التسجيل المحفوظ',consent:'أحفظ فقط على جهاز أتحكم فيه',privacy:'يُشفّر تسجيل اختياري واحد في هذا المتصفح لهذه الجلسة وإصدار التعليمات نفسه لمدة لا تتجاوز 24 ساعة. المفتاح محفوظ هنا أيضًا؛ هذه ليست خزنة آمنة. لا تحفظ على جهاز مشترك. قد يحذفه تنظيف المتصفح أو انتهاء الصلاحية. لا يُرفع شيء تلقائيًا.',loading:'جارٍ فحص التسجيل المحفوظ...',empty:'لا يوجد تسجيل محفوظ هنا.',saved:'محفوظ هنا. استلام الخادم وتقييم الذكاء الاصطناعي أمران منفصلان.',other:'يوجد تسجيل محفوظ لإصدار تعليمات آخر. لا يمكن إرساله إلى هذا الإصدار.',failed:'تعذر التحقق من التسجيل المحفوظ أو تحديثه. لم يتم تأكيد الإرسال.',removed:'حُذف التسجيل المحفوظ.',received:'تم التحقق من استلام التسجيل. تبقى النسخة المحفوظة حتى حذفها أو انتهاء صلاحيتها.',send:'أرسل التسجيل المحفوظ',check:'تحقق من استلام التسجيل',remove:'احذف التسجيل المحفوظ',reload:'أعد فحص التسجيل المحفوظ'},
  ur:{title:'محفوظ ریکارڈنگ',consent:'صرف اپنے اختیار والے آلے پر محفوظ کروں',privacy:'اس براؤزر میں اسی سیشن اور ہدایات کے عین ورژن کی ایک اختیاری ریکارڈنگ زیادہ سے زیادہ 24 گھنٹے رمز بند رہتی ہے۔ کلید بھی یہیں ہے؛ یہ محفوظ تجوری نہیں۔ مشترکہ آلے پر محفوظ نہ کریں۔ براؤزر کی صفائی یا میعاد اسے ہٹا سکتی ہے۔ کچھ خود بخود اپ لوڈ نہیں ہوتا۔',loading:'محفوظ ریکارڈنگ چیک ہو رہی ہے...',empty:'یہاں کوئی ریکارڈنگ محفوظ نہیں۔',saved:'یہیں محفوظ ہے۔ سرور کی وصولی اور مصنوعی ذہانت کی جانچ الگ ہیں۔',other:'ہدایات کے دوسرے ورژن کی ریکارڈنگ یہاں محفوظ ہے۔ اسے اس ورژن پر نہیں بھیجا جا سکتا۔',failed:'محفوظ ریکارڈنگ کی تصدیق یا تبدیلی نہیں ہو سکی۔ بھیجنے کی تصدیق نہیں ہوئی۔',removed:'محفوظ ریکارڈنگ ہٹا دی گئی۔',received:'ریکارڈنگ کی وصولی کی تصدیق ہو گئی۔ محفوظ نقل ہٹانے یا میعاد ختم ہونے تک باقی رہے گی۔',send:'محفوظ ریکارڈنگ بھیجیں',check:'ریکارڈنگ کی وصولی چیک کریں',remove:'محفوظ ریکارڈنگ ہٹائیں',reload:'محفوظ ریکارڈنگ دوبارہ چیک کریں'},
  hi:{title:'सहेजी गई रिकॉर्डिंग',consent:'केवल अपने नियंत्रण वाले डिवाइस पर सहेजें',privacy:'इस ब्राउज़र में इस सत्र और इसी निर्देश संस्करण के लिए एक वैकल्पिक रिकॉर्डिंग अधिकतम 24 घंटे तक एन्क्रिप्ट रहती है। कुंजी भी यहीं रखी है; यह सुरक्षित तिजोरी नहीं है। साझा डिवाइस पर सहेजें नहीं। ब्राउज़र सफ़ाई या समाप्ति इसे हटा सकती है। कुछ भी स्वतः अपलोड नहीं होता।',loading:'सहेजी गई रिकॉर्डिंग जाँची जा रही है...',empty:'यहाँ कोई रिकॉर्डिंग सहेजी नहीं है।',saved:'यहाँ सहेजी गई। सर्वर रसीद और AI मूल्यांकन अलग हैं।',other:'यहाँ किसी दूसरे निर्देश संस्करण की रिकॉर्डिंग सहेजी है। इसे इस संस्करण को नहीं भेजा जा सकता।',failed:'सहेजी गई रिकॉर्डिंग सत्यापित या अपडेट नहीं हो सकी। कोई डिलीवरी पुष्ट नहीं है।',removed:'सहेजी गई रिकॉर्डिंग हटा दी गई।',received:'रिकॉर्डिंग रसीद सत्यापित। सहेजी प्रतिलिपि हटाने या समाप्त होने तक रहती है।',send:'सहेजी रिकॉर्डिंग भेजें',check:'रिकॉर्डिंग रसीद जाँचें',remove:'सहेजी रिकॉर्डिंग हटाएँ',reload:'सहेजी रिकॉर्डिंग फिर जाँचें'},
  bn:{title:'সংরক্ষিত রেকর্ডিং',consent:'শুধু আমার নিয়ন্ত্রণাধীন ডিভাইসে সংরক্ষণ করুন',privacy:'এই ব্রাউজারে এই সেশন ও নির্দেশনার ঠিক এই সংস্করণের জন্য একটি ঐচ্ছিক রেকর্ডিং সর্বোচ্চ ২৪ ঘণ্টা এনক্রিপ্ট থাকে। চাবিও এখানেই রাখা; এটি নিরাপদ ভল্ট নয়। শেয়ার করা ডিভাইসে সংরক্ষণ করবেন না। ব্রাউজার পরিষ্কার বা মেয়াদ এটি মুছে ফেলতে পারে। কিছু স্বয়ংক্রিয়ভাবে আপলোড হয় না।',loading:'সংরক্ষিত রেকর্ডিং যাচাই হচ্ছে...',empty:'এখানে কোনো রেকর্ডিং সংরক্ষিত নেই।',saved:'এখানে সংরক্ষিত। সার্ভার রসিদ ও AI মূল্যায়ন আলাদা।',other:'এখানে নির্দেশনার অন্য সংস্করণের রেকর্ডিং সংরক্ষিত আছে। এটি এই সংস্করণে পাঠানো যায় না।',failed:'সংরক্ষিত রেকর্ডিং যাচাই বা হালনাগাদ করা যায়নি। কোনো ডেলিভারি নিশ্চিত নয়।',removed:'সংরক্ষিত রেকর্ডিং সরানো হয়েছে।',received:'রেকর্ডিং রসিদ যাচাই হয়েছে। সংরক্ষিত কপি সরানো বা মেয়াদ শেষ হওয়া পর্যন্ত থাকে।',send:'সংরক্ষিত রেকর্ডিং পাঠান',check:'রেকর্ডিং রসিদ যাচাই করুন',remove:'সংরক্ষিত রেকর্ডিং সরান',reload:'সংরক্ষিত রেকর্ডিং আবার যাচাই করুন'},
  ml:{title:'സംരക്ഷിത റെക്കോർഡിംഗ്',consent:'ഞാൻ നിയന്ത്രിക്കുന്ന ഉപകരണത്തിൽ മാത്രം സംരക്ഷിക്കുക',privacy:'ഈ ബ്രൗസറിൽ ഈ സെഷനും അതേ നിർദ്ദേശ പതിപ്പിനും വേണ്ടി ഒരു ഓപ്ഷണൽ റെക്കോർഡിംഗ് പരമാവധി 24 മണിക്കൂർ എൻക്രിപ്റ്റ് ചെയ്ത് സൂക്ഷിക്കുന്നു. കീയും ഇവിടെത്തന്നെ; ഇത് സുരക്ഷിത വോൾട്ട് അല്ല. പങ്കിട്ട ഉപകരണത്തിൽ സംരക്ഷിക്കരുത്. ബ്രൗസർ വൃത്തിയാക്കലോ കാലാവധിയോ ഇത് നീക്കാം. ഒന്നും സ്വയമേവ അപ്‌ലോഡ് ചെയ്യുന്നില്ല.',loading:'സംരക്ഷിത റെക്കോർഡിംഗ് പരിശോധിക്കുന്നു...',empty:'ഇവിടെ റെക്കോർഡിംഗ് സംരക്ഷിച്ചിട്ടില്ല.',saved:'ഇവിടെ സംരക്ഷിച്ചു. സെർവർ രസീതും AI വിലയിരുത്തലും വെവ്വേറെയാണ്.',other:'മറ്റൊരു നിർദ്ദേശ പതിപ്പിന്റെ റെക്കോർഡിംഗ് ഇവിടെ സംരക്ഷിച്ചിരിക്കുന്നു. അത് ഈ പതിപ്പിലേക്ക് അയക്കാനാവില്ല.',failed:'സംരക്ഷിത റെക്കോർഡിംഗ് പരിശോധിക്കാനോ പുതുക്കാനോ കഴിഞ്ഞില്ല. ഡെലിവറി സ്ഥിരീകരിച്ചിട്ടില്ല.',removed:'സംരക്ഷിത റെക്കോർഡിംഗ് നീക്കി.',received:'റെക്കോർഡിംഗ് രസീത് സ്ഥിരീകരിച്ചു. സംരക്ഷിത പകർപ്പ് നീക്കുന്നതുവരെയോ കാലാവധി തീരുന്നതുവരെയോ നിലനിൽക്കും.',send:'സംരക്ഷിത റെക്കോർഡിംഗ് അയക്കുക',check:'റെക്കോർഡിംഗ് രസീത് പരിശോധിക്കുക',remove:'സംരക്ഷിത റെക്കോർഡിംഗ് നീക്കുക',reload:'സംരക്ഷിത റെക്കോർഡിംഗ് വീണ്ടും പരിശോധിക്കുക'},
  ta:{title:'சேமித்த பதிவு',consent:'நான் கட்டுப்படுத்தும் சாதனத்தில் மட்டும் சேமி',privacy:'இந்த உலாவியில் இந்த அமர்வுக்கும் அதே அறிவுறுத்தல் பதிப்புக்கும் ஒரு விருப்பப் பதிவு அதிகபட்சம் 24 மணி நேரம் மறையாக்கப்பட்டு வைக்கப்படும். விசையும் இங்கேயே உள்ளது; இது பாதுகாப்பான பெட்டகம் அல்ல. பகிரப்பட்ட சாதனத்தில் சேமிக்க வேண்டாம். உலாவி சுத்தம் அல்லது காலாவதி இதை நீக்கலாம். எதுவும் தானாக பதிவேற்றப்படாது.',loading:'சேமித்த பதிவு சரிபார்க்கப்படுகிறது...',empty:'இங்கே பதிவு எதுவும் சேமிக்கப்படவில்லை.',saved:'இங்கே சேமிக்கப்பட்டது. சேவையக ரசீதும் AI மதிப்பீடும் தனித்தனி.',other:'வேறு அறிவுறுத்தல் பதிப்பின் பதிவு இங்கே சேமிக்கப்பட்டுள்ளது. அதை இந்தப் பதிப்புக்கு அனுப்ப முடியாது.',failed:'சேமித்த பதிவைச் சரிபார்க்கவோ புதுப்பிக்கவோ முடியவில்லை. எந்த வழங்கலும் உறுதிப்படுத்தப்படவில்லை.',removed:'சேமித்த பதிவு நீக்கப்பட்டது.',received:'பதிவு ரசீது சரிபார்க்கப்பட்டது. சேமித்த நகல் நீக்கும் வரை அல்லது காலாவதியாகும் வரை இருக்கும்.',send:'சேமித்த பதிவை அனுப்பு',check:'பதிவு ரசீதைச் சரிபார்',remove:'சேமித்த பதிவை நீக்கு',reload:'சேமித்த பதிவை மீண்டும் சரிபார்'},
  te:{title:'సేవ్ చేసిన రికార్డింగ్',consent:'నేను నియంత్రించే పరికరంలో మాత్రమే సేవ్ చేయండి',privacy:'ఈ బ్రౌజర్‌లో ఈ సెషన్ మరియు అదే సూచన వెర్షన్ కోసం ఒక ఐచ్ఛిక రికార్డింగ్ గరిష్ఠంగా 24 గంటలు ఎన్‌క్రిప్ట్ చేయబడి ఉంటుంది. కీ కూడా ఇక్కడే ఉంటుంది; ఇది సురక్షిత వాల్ట్ కాదు. పంచుకున్న పరికరంలో సేవ్ చేయవద్దు. బ్రౌజర్ శుభ్రత లేదా గడువు దీన్ని తొలగించవచ్చు. ఏదీ స్వయంగా అప్‌లోడ్ కాదు.',loading:'సేవ్ చేసిన రికార్డింగ్ తనిఖీ అవుతోంది...',empty:'ఇక్కడ రికార్డింగ్ ఏదీ సేవ్ చేయలేదు.',saved:'ఇక్కడ సేవ్ చేయబడింది. సర్వర్ రసీదు మరియు AI మూల్యాంకనం వేర్వేరు.',other:'మరో సూచన వెర్షన్ రికార్డింగ్ ఇక్కడ సేవ్ చేయబడింది. దాన్ని ఈ వెర్షన్‌కు పంపలేము.',failed:'సేవ్ చేసిన రికార్డింగ్‌ను ధృవీకరించలేకపోయాం లేదా అప్‌డేట్ చేయలేకపోయాం. ఏ డెలివరీ నిర్ధారించబడలేదు.',removed:'సేవ్ చేసిన రికార్డింగ్ తొలగించబడింది.',received:'రికార్డింగ్ రసీదు ధృవీకరించబడింది. సేవ్ చేసిన కాపీ తొలగించే లేదా గడువు ముగిసే వరకు ఉంటుంది.',send:'సేవ్ చేసిన రికార్డింగ్ పంపండి',check:'రికార్డింగ్ రసీదు తనిఖీ చేయండి',remove:'సేవ్ చేసిన రికార్డింగ్ తొలగించండి',reload:'సేవ్ చేసిన రికార్డింగ్ మళ్లీ తనిఖీ చేయండి'},
  ne:{title:'सुरक्षित रेकर्डिङ',consent:'मैले नियन्त्रण गर्ने यन्त्रमा मात्र सुरक्षित गर्नुहोस्',privacy:'यो ब्राउजरमा यही सत्र र यही निर्देशन संस्करणका लागि एउटा वैकल्पिक रेकर्डिङ अधिकतम २४ घण्टा इन्क्रिप्ट गरी राखिन्छ। कुञ्जी पनि यहीँ रहन्छ; यो सुरक्षित भल्ट होइन। साझा यन्त्रमा सुरक्षित नगर्नुहोस्। ब्राउजर सफाई वा म्यादले यो हटाउन सक्छ। केही पनि स्वतः अपलोड हुँदैन।',loading:'सुरक्षित रेकर्डिङ जाँचिँदैछ...',empty:'यहाँ कुनै रेकर्डिङ सुरक्षित छैन।',saved:'यहीँ सुरक्षित भयो। सर्भर रसिद र AI मूल्याङ्कन छुट्टाछुट्टै हुन्।',other:'यहाँ अर्को निर्देशन संस्करणको रेकर्डिङ सुरक्षित छ। त्यो यो संस्करणमा पठाउन सकिँदैन।',failed:'सुरक्षित रेकर्डिङ जाँच्न वा अद्यावधिक गर्न सकिएन। कुनै डेलिभरी पुष्टि भएको छैन।',removed:'सुरक्षित रेकर्डिङ हटाइयो।',received:'रेकर्डिङ रसिद प्रमाणित भयो। सुरक्षित प्रतिलिपि हटाउने वा म्याद सकिनेसम्म रहन्छ।',send:'सुरक्षित रेकर्डिङ पठाउनुहोस्',check:'रेकर्डिङ रसिद जाँच्नुहोस्',remove:'सुरक्षित रेकर्डिङ हटाउनुहोस्',reload:'सुरक्षित रेकर्डिङ फेरि जाँच्नुहोस्'},
  fil:{title:'Naka-save na recording',consent:'I-save lang sa device na kontrolado ko',privacy:'Isang opsyonal na recording ang naka-encrypt sa browser na ito para sa session na ito at eksaktong bersyon ng briefing, nang hanggang 24 oras. Nandito rin ang key; hindi ito secure na vault. Huwag i-save sa shared na device. Maaaring burahin ito ng browser cleanup o pag-expire. Walang awtomatikong naa-upload.',loading:'Sinusuri ang naka-save na recording...',empty:'Walang naka-save na recording dito.',saved:'Naka-save dito. Hiwalay ang resibo ng server at AI assessment.',other:'May naka-save na recording para sa ibang bersyon ng briefing dito. Hindi ito maipapadala sa bersyong ito.',failed:'Hindi na-verify o na-update ang naka-save na recording. Walang kumpirmadong delivery.',removed:'Naalis ang naka-save na recording.',received:'Na-verify ang resibo ng recording. Mananatili ang naka-save na kopya hanggang maalis o mag-expire.',send:'Ipadala ang naka-save na recording',check:'I-check ang resibo ng recording',remove:'Alisin ang naka-save na recording',reload:'I-check muli ang naka-save na recording'},
  si:{title:'සුරකින ලද පටිගත කිරීම',consent:'මම පාලනය කරන උපාංගයක පමණක් සුරකින්න',privacy:'මෙම බ්‍රව්සරයේ මෙම සැසියට සහ හරියටම මෙම උපදෙස් අනුවාදයට එක් අත්‍යවශ්‍ය නොවන පටිගත කිරීමක් උපරිම පැය 24ක් සංකේතනය කර තබා ඇත. යතුර ද මෙහිම ඇත; මෙය ආරක්ෂිත භාණ්ඩාගාරයක් නොවේ. හවුල් උපාංගයක සුරකින්න එපා. බ්‍රව්සර් පිරිසිදු කිරීම හෝ කල් ඉකුත්වීම මෙය ඉවත් කළ හැක. කිසිවක් ස්වයංක්‍රීයව උඩුගත නොවේ.',loading:'සුරකින ලද පටිගත කිරීම පරීක්ෂා කරමින්...',empty:'මෙහි පටිගත කිරීමක් සුරකා නැත.',saved:'මෙහි සුරකින ලදී. සේවාදායක රිසිට්පත සහ AI ඇගයීම වෙන වෙනම ය.',other:'වෙනත් උපදෙස් අනුවාදයක පටිගත කිරීමක් මෙහි සුරකා ඇත. එය මෙම අනුවාදයට යැවිය නොහැක.',failed:'සුරකින ලද පටිගත කිරීම තහවුරු කිරීමට හෝ යාවත්කාලීන කිරීමට නොහැකි විය. කිසිදු බෙදාහැරීමක් තහවුරු වී නැත.',removed:'සුරකින ලද පටිගත කිරීම ඉවත් කරන ලදී.',received:'පටිගත කිරීමේ රිසිට්පත තහවුරු විය. සුරකින ලද පිටපත ඉවත් කරන තෙක් හෝ කල් ඉකුත් වන තෙක් රැඳේ.',send:'සුරකින ලද පටිගත කිරීම යවන්න',check:'පටිගත කිරීමේ රිසිට්පත පරීක්ෂා කරන්න',remove:'සුරකින ලද පටිගත කිරීම ඉවත් කරන්න',reload:'සුරකින ලද පටිගත කිරීම නැවත පරීක්ෂා කරන්න'},
  ru:{title:'Сохранённая запись',consent:'Сохранять только на устройстве, которое я контролирую',privacy:'Одна необязательная запись зашифрована в этом браузере для этой сессии и точной версии инструкции, не более 24 часов. Ключ тоже хранится здесь; это не защищённое хранилище. Не сохраняйте на общем устройстве. Очистка браузера или истечение срока могут удалить её. Ничего не загружается автоматически.',loading:'Проверка сохранённой записи...',empty:'Здесь нет сохранённой записи.',saved:'Сохранено здесь. Квитанция сервера и оценка ИИ — отдельно.',other:'Здесь сохранена запись для другой версии инструкции. Её нельзя отправить в эту версию.',failed:'Не удалось проверить или обновить сохранённую запись. Доставка не подтверждена.',removed:'Сохранённая запись удалена.',received:'Квитанция записи подтверждена. Сохранённая копия остаётся до удаления или истечения срока.',send:'Отправить сохранённую запись',check:'Проверить квитанцию записи',remove:'Удалить сохранённую запись',reload:'Перепроверить сохранённую запись'},
  'pa-Guru':{title:'ਸੰਭਾਲੀ ਰਿਕਾਰਡਿੰਗ',consent:'ਸਿਰਫ਼ ਆਪਣੇ ਕੰਟਰੋਲ ਵਾਲੇ ਡਿਵਾਈਸ ’ਤੇ ਸੰਭਾਲੋ',privacy:'ਇਸ ਬ੍ਰਾਊਜ਼ਰ ਵਿੱਚ ਇਸ ਸੈਸ਼ਨ ਅਤੇ ਹਦਾਇਤ ਦੇ ਇਸੇ ਵਰਜ਼ਨ ਲਈ ਇੱਕ ਚੋਣਵੀਂ ਰਿਕਾਰਡਿੰਗ ਵੱਧ ਤੋਂ ਵੱਧ 24 ਘੰਟੇ ਐਨਕ੍ਰਿਪਟ ਰਹਿੰਦੀ ਹੈ। ਕੁੰਜੀ ਵੀ ਇੱਥੇ ਹੈ; ਇਹ ਸੁਰੱਖਿਅਤ ਤਿਜੋਰੀ ਨਹੀਂ। ਸਾਂਝੇ ਡਿਵਾਈਸ ’ਤੇ ਨਾ ਸੰਭਾਲੋ। ਬ੍ਰਾਊਜ਼ਰ ਸਫ਼ਾਈ ਜਾਂ ਮਿਆਦ ਇਸਨੂੰ ਹਟਾ ਸਕਦੀ ਹੈ। ਕੁਝ ਵੀ ਆਪਣੇ ਆਪ ਅੱਪਲੋਡ ਨਹੀਂ ਹੁੰਦਾ।',loading:'ਸੰਭਾਲੀ ਰਿਕਾਰਡਿੰਗ ਜਾਂਚੀ ਜਾ ਰਹੀ ਹੈ...',empty:'ਇੱਥੇ ਕੋਈ ਰਿਕਾਰਡਿੰਗ ਸੰਭਾਲੀ ਨਹੀਂ।',saved:'ਇੱਥੇ ਸੰਭਾਲੀ ਗਈ। ਸਰਵਰ ਰਸੀਦ ਅਤੇ AI ਮੁਲਾਂਕਣ ਵੱਖਰੇ ਹਨ।',other:'ਇੱਥੇ ਹਦਾਇਤ ਦੇ ਕਿਸੇ ਹੋਰ ਵਰਜ਼ਨ ਦੀ ਰਿਕਾਰਡਿੰਗ ਸੰਭਾਲੀ ਹੈ। ਇਸਨੂੰ ਇਸ ਵਰਜ਼ਨ ਨੂੰ ਨਹੀਂ ਭੇਜਿਆ ਜਾ ਸਕਦਾ।',failed:'ਸੰਭਾਲੀ ਰਿਕਾਰਡਿੰਗ ਦੀ ਪੁਸ਼ਟੀ ਜਾਂ ਅੱਪਡੇਟ ਨਹੀਂ ਹੋ ਸਕੀ। ਕੋਈ ਡਿਲੀਵਰੀ ਪੁਸ਼ਟ ਨਹੀਂ।',removed:'ਸੰਭਾਲੀ ਰਿਕਾਰਡਿੰਗ ਹਟਾ ਦਿੱਤੀ ਗਈ।',received:'ਰਿਕਾਰਡਿੰਗ ਰਸੀਦ ਦੀ ਪੁਸ਼ਟੀ ਹੋਈ। ਸੰਭਾਲੀ ਕਾਪੀ ਹਟਾਉਣ ਜਾਂ ਮਿਆਦ ਖਤਮ ਹੋਣ ਤੱਕ ਰਹੇਗੀ।',send:'ਸੰਭਾਲੀ ਰਿਕਾਰਡਿੰਗ ਭੇਜੋ',check:'ਰਿਕਾਰਡਿੰਗ ਰਸੀਦ ਜਾਂਚੋ',remove:'ਸੰਭਾਲੀ ਰਿਕਾਰਡਿੰਗ ਹਟਾਓ',reload:'ਸੰਭਾਲੀ ਰਿਕਾਰਡਿੰਗ ਮੁੜ ਜਾਂਚੋ'},
  'pa-Arab':{title:'محفوظ ریکارڈنگ',consent:'صرف اپنے اختیار والے آلے تے محفوظ کرو',privacy:'اس براؤزر وچ اس سیشن تے ہدایات دے ایسے ورژن لئی اک اختیاری ریکارڈنگ ودھ توں ودھ 24 گھنٹے خفیہ رہندی اے۔ کلید وی ایتھے اے؛ ایہ محفوظ تجوری نئیں۔ مشترکہ آلے تے محفوظ نہ کرو۔ براؤزر دی صفائی یا میعاد اینوں ہٹا سکدی اے۔ کجھ وی خود بخود اپ لوڈ نئیں ہوندا۔',loading:'محفوظ ریکارڈنگ چیک ہو رہی اے...',empty:'ایتھے کوئی ریکارڈنگ محفوظ نئیں۔',saved:'ایتھے محفوظ اے۔ سرور دی رسید تے AI جانچ وکھریاں نیں۔',other:'ایتھے ہدایات دے کسے ہور ورژن دی ریکارڈنگ محفوظ اے۔ اینوں ایس ورژن نوں نئیں بھیجیا جا سکدا۔',failed:'محفوظ ریکارڈنگ دی تصدیق یا تبدیلی نہیں ہو سکی۔ کوئی ڈیلیوری پکی نئیں۔',removed:'محفوظ ریکارڈنگ ہٹا دتی گئی۔',received:'ریکارڈنگ دی رسید دی تصدیق ہو گئی۔ محفوظ نقل ہٹانے یا میعاد ختم ہونے تک رہوے گی۔',send:'محفوظ ریکارڈنگ بھیجو',check:'ریکارڈنگ دی رسید چیک کرو',remove:'محفوظ ریکارڈنگ ہٹاؤ',reload:'محفوظ ریکارڈنگ دوبارہ چیک کرو'},
  id:{title:'Rekaman tersimpan',consent:'Simpan hanya di perangkat yang saya kendalikan',privacy:'Satu rekaman opsional dienkripsi di browser ini untuk sesi ini dan versi briefing yang sama, paling lama 24 jam. Kuncinya juga disimpan di sini; ini bukan brankas aman. Jangan simpan di perangkat bersama. Pembersihan browser atau kedaluwarsa dapat menghapusnya. Tidak ada yang diunggah otomatis.',loading:'Memeriksa rekaman tersimpan...',empty:'Tidak ada rekaman tersimpan di sini.',saved:'Tersimpan di sini. Tanda terima server dan penilaian AI terpisah.',other:'Ada rekaman untuk versi briefing lain yang tersimpan di sini. Rekaman itu tidak dapat dikirim ke versi ini.',failed:'Rekaman tersimpan tidak dapat diverifikasi atau diperbarui. Pengiriman tidak dikonfirmasi.',removed:'Rekaman tersimpan dihapus.',received:'Tanda terima rekaman terverifikasi. Salinan tersimpan tetap ada sampai dihapus atau kedaluwarsa.',send:'Kirim rekaman tersimpan',check:'Periksa tanda terima rekaman',remove:'Hapus rekaman tersimpan',reload:'Periksa ulang rekaman tersimpan'},
};

type Envelope={revision:string;context:string;key:CryptoKey;iv:Uint8Array;ciphertext:ArrayBuffer};
export type AudioDraft={scope:RecordingScope;submissionId:string;capturedAt:string;expiresAt:string;bytes:Uint8Array;presentationId:string|null};
export type AudioDraftStore={read:()=>Promise<Envelope|null>;replace:(revision:string|null,value:Envelope|null,allowed:()=>boolean)=>Promise<boolean>;clear:()=>Promise<void>};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export class AudioDraftError extends Error {
  readonly code:'storage'|'invalid'|'session'|'other';
  constructor(code:AudioDraftError['code']){super(code);this.code=code;}
}
const draftChannel='understood:worker-audio-change';
export function subscribeAudioDraftChanges(changed:()=>void){
  try {
    const channel=new BroadcastChannel(draftChannel);
    channel.onmessage=event=>{if(event.data==='changed')changed();};
    return()=>channel.close();
  }catch {return()=>{};}
}
function notifyDraftChanged(){
  try {const channel=new BroadcastChannel(draftChannel);channel.postMessage('changed');channel.close();}catch {/* Explicit recheck and session fences still apply. */}
}
const exact=(value:unknown,keys:string)=>!!value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).sort().join(',')===keys;
const iso=(value:unknown):value is string=>typeof value==='string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString()===value;
function scopeValid(scope:RecordingScope){
  return exact(scope,'assignmentId,language,publicationId,version') && [scope.assignmentId,scope.publicationId].every(value=>typeof value==='string' && value.trim().length>0 && value.length<=100)
    && Number.isSafeInteger(scope.version) && scope.version>0 && ['en','ar','ur'].includes(scope.language);
}
const sameScope=(a:RecordingScope,b:RecordingScope)=>a.assignmentId===b.assignmentId && a.publicationId===b.publicationId && a.version===b.version && a.language===b.language;
function wavValid(bytes:Uint8Array){
  if(bytes.length<8044 || bytes.length>2880044 || bytes.length%2)return false;
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),text=new TextDecoder('utf-8',{fatal:true});
  if(text.decode(bytes.slice(0,4))!=='RIFF' || text.decode(bytes.slice(8,16))!=='WAVEfmt ' || text.decode(bytes.slice(36,40))!=='data'
    || view.getUint32(4,true)!==bytes.length-8 || view.getUint32(16,true)!==16 || view.getUint16(20,true)!==1 || view.getUint16(22,true)!==1
    || view.getUint32(24,true)!==16000 || view.getUint32(28,true)!==32000 || view.getUint16(32,true)!==2 || view.getUint16(34,true)!==16 || view.getUint32(40,true)!==bytes.length-44)return false;
  for(let i=44;i<bytes.length;i+=2)if(Math.abs(view.getInt16(i,true))>16)return true;
  return false;
}
function checkedEnvelope(value:Envelope){
  if(!exact(value,'ciphertext,context,iv,key,revision') || !uuid.test(value.revision) || !/^[a-f0-9]{64}$/.test(value.context)
    || !(value.key instanceof CryptoKey) || value.key.extractable || value.key.type!=='secret' || value.key.algorithm.name!=='AES-GCM'
    || (value.key.algorithm as AesKeyAlgorithm).length!==256 || value.key.usages.slice().sort().join(',')!=='decrypt,encrypt'
    || !(value.iv instanceof Uint8Array) || value.iv.length!==12 || !(value.ciphertext instanceof ArrayBuffer)
    || value.ciphertext.byteLength<8064 || value.ciphertext.byteLength>2884144)throw new AudioDraftError('invalid');
  return value;
}
const aad=(value:Envelope)=>new TextEncoder().encode(JSON.stringify(['understood-audio-draft-v1',value.revision,value.context]));
function guardFor(session:PageSession,current:()=>boolean,now:()=>number){
  const expected={...session};
  return()=>{if(!current() || !sameWorkerSession(expected,session,now()) || expected.expiresAt!==session.expiresAt)throw new AudioDraftError('session');return true;};
}
async function unpack(value:Envelope){
  try {
    checkedEnvelope(value);
    const raw=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(value.iv),additionalData:aad(value)},value.key,value.ciphertext));
    const length=new DataView(raw.buffer).getUint32(0,true);
    if(length>4096 || length<1 || raw.length<4+length+8044)throw Error();
    const metadata=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw.slice(4,4+length)));
    // Older drafts have no presentationId; they remain readable but carry no presentation claim.
    const legacy=exact(metadata,'capturedAt,expiresAt,scope,session,submissionId');
    const current=exact(metadata,'capturedAt,expiresAt,presentationId,scope,session,submissionId');
    if(!legacy&&!current || !scopeValid(metadata.scope)
      || !uuid.test(metadata.submissionId) || !iso(metadata.capturedAt) || !iso(metadata.expiresAt)
      || current && metadata.presentationId!==null && !uuid.test(metadata.presentationId)
      || !exact(metadata.session,'authenticated,clientContext,expiresAt,language,mode,role,workerId') || !validWorkerSession(metadata.session,0)
      || metadata.session.clientContext!==value.context || Date.parse(metadata.expiresAt)>Date.parse(metadata.session.expiresAt)
      || Date.parse(metadata.expiresAt)<=Date.parse(metadata.capturedAt) || Date.parse(metadata.expiresAt)-Date.parse(metadata.capturedAt)>86400000)throw Error();
    const bytes=raw.slice(4+length);if(!wavValid(bytes))throw Error();
    return {...metadata,presentationId:metadata.presentationId ?? null,bytes} as AudioDraft & {session:PageSession};
  }catch {throw new AudioDraftError('invalid');}
}
async function owned(store:AudioDraftStore,session:PageSession,guard:()=>boolean,now:()=>number){
  guard();const envelope=await store.read();guard();if(!envelope)return null;
  checkedEnvelope(envelope);
  if(envelope.context!==session.clientContext){if(!await store.replace(envelope.revision,null,guard))throw new AudioDraftError('storage');guard();return null;}
  const draft=await unpack(envelope);guard();
  if(!sameWorkerSession(session,draft.session,now()) || session.expiresAt!==draft.session.expiresAt || Date.parse(draft.expiresAt)<=now()){
    if(!await store.replace(envelope.revision,null,guard))throw new AudioDraftError('storage');guard();return null;
  }
  if(Date.parse(draft.capturedAt)>now())throw new AudioDraftError('invalid');
  return {envelope,draft};
}
export async function readAudioDraft(store:AudioDraftStore,session:PageSession,scope:RecordingScope,current:()=>boolean=()=>true,now=Date.now){
  try {
    if(!scopeValid(scope))throw new AudioDraftError('invalid');
    const value=await owned(store,session,guardFor(session,current,now),now);
    if(!value)return {status:'empty' as const};
    if(!sameScope(scope,value.draft.scope))return {status:'other' as const};
    const {session:_,...draft}=value.draft;return {status:'saved' as const,draft};
  }catch(error){if(error instanceof AudioDraftError)throw error;throw new AudioDraftError('storage');}
}
export async function saveAudioDraft(store:AudioDraftStore,session:PageSession,scope:RecordingScope,input:{submissionId:string;capturedAt:string;bytes:Uint8Array;presentationId?:string|null},consent:boolean,current:()=>boolean=()=>true,now=Date.now){
  const guard=guardFor(session,current,now);
  try {
    guard();
    const presentationId=input.presentationId ?? null;
    if(consent!==true || !scopeValid(scope) || !uuid.test(input.submissionId) || !iso(input.capturedAt)
      || presentationId!==null && !uuid.test(presentationId)
      || Date.parse(input.capturedAt)>now() || !(input.bytes instanceof Uint8Array) || !wavValid(input.bytes))throw new AudioDraftError('invalid');
    const bytes=new Uint8Array(input.bytes),captured={...scope},expected={authenticated:true,role:'worker',workerId:session.workerId!,language:session.language!,mode:session.mode!,clientContext:session.clientContext!,expiresAt:session.expiresAt!};
    const {submissionId,capturedAt}=input;
    const old=await owned(store,session,guard,now);
    if(old){
      if(!sameScope(captured,old.draft.scope) || old.draft.submissionId!==submissionId)throw new AudioDraftError('other');
      if(old.draft.capturedAt!==capturedAt || old.draft.presentationId!==presentationId || old.draft.bytes.length!==bytes.length || !bytes.every((value,index)=>value===old.draft.bytes[index]))throw new AudioDraftError('invalid');
      return old.draft;
    }
    const expiresAt=new Date(Math.min(Date.parse(expected.expiresAt),Date.parse(capturedAt)+86400000)).toISOString();
    if(Date.parse(expiresAt)<=now())throw new AudioDraftError('session');
    const metadata=new TextEncoder().encode(JSON.stringify({session:expected,scope:captured,submissionId,capturedAt,expiresAt,presentationId}));
    if(metadata.length>4096)throw new AudioDraftError('invalid');
    const packet=new Uint8Array(4+metadata.length+bytes.length);new DataView(packet.buffer).setUint32(0,metadata.length,true);packet.set(metadata,4);packet.set(bytes,4+metadata.length);
    const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);guard();
    const envelope:Envelope={revision:crypto.randomUUID(),context:expected.clientContext,key,iv:crypto.getRandomValues(new Uint8Array(12)),ciphertext:new ArrayBuffer(0)};
    envelope.ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv:new Uint8Array(envelope.iv),additionalData:aad(envelope)},key,packet);guard();
    if(!await store.replace(null,envelope,guard))throw new AudioDraftError('other');
    guard();const stored=await store.read();guard();
    if(!stored || stored.revision!==envelope.revision)throw new AudioDraftError('storage');
    const verified=await unpack(stored);guard();
    if(verified.submissionId!==submissionId || !sameScope(captured,verified.scope) || verified.bytes.length!==bytes.length || !bytes.every((value,index)=>value===verified.bytes[index]))throw new AudioDraftError('storage');
    return verified;
  }catch(error){if(error instanceof AudioDraftError)throw error;throw new AudioDraftError('storage');}
}
export async function clearAudioDraft(store:AudioDraftStore=browserAudioDraftStore,context?:string){
  if(store===browserAudioDraftStore){await clearAudioOutbox(context);return;}
  try {
    if(context){
      const old=await store.read();if(!old || old.context!==context)return;
      if(!uuid.test(old.revision) || !await store.replace(old.revision,null,()=>true))throw Error();
      if((await store.read())?.context===context)throw Error();
    }else {await store.clear();if(await store.read())throw Error();}
  }catch {throw new AudioDraftError('storage');}
}

function transaction<T>(mode:IDBTransactionMode,work:(store:IDBObjectStore,set:(value:T)=>void)=>void):Promise<T>{
  return new Promise((resolve,reject)=>{
    if(typeof indexedDB==='undefined'){reject(new AudioDraftError('storage'));return;}
    let settled=false,db:IDBDatabase|undefined,tx:IDBTransaction|undefined,result:T;
    const fail=()=>{if(settled)return;settled=true;clearTimeout(timer);try {tx?.abort();}catch {}db?.close();reject(new AudioDraftError('storage'));};
    const timer=setTimeout(fail,5000);let request:IDBOpenDBRequest;
    try {request=indexedDB.open('understood-worker-audio-v1',1);}catch {fail();return;}
    request.onerror=fail;request.onblocked=fail;
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('drafts'))request.result.createObjectStore('drafts');};
    request.onsuccess=()=>{
      db=request.result;if(settled){db.close();return;}db.onversionchange=()=>db?.close();
      try {
        tx=db.transaction('drafts',mode);tx.onerror=fail;tx.onabort=fail;
        tx.oncomplete=()=>{if(settled)return;settled=true;clearTimeout(timer);db?.close();resolve(result);};
        work(tx.objectStore('drafts'),value=>{result=value;});
      }catch {fail();}
    };
  });
}
export const audioOutboxLimits={recordings:10,bytes:25*1024*1024} as const;
export type AudioOutboxCollection={entries:()=>Promise<{key:string;value:Envelope}[]>;slot:(key:string)=>AudioDraftStore;clear:(context?:string)=>Promise<void>};
export type AudioOutboxItem={key:string;draft:AudioDraft};
export async function audioOutboxKey(id:string){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(id));
  return `assignment:${Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('')}`;
}
function browserSlot(key:string):AudioDraftStore{return {
  read:()=>transaction<Envelope|null>('readonly',(store,set)=>{const request=store.get(key);request.onsuccess=()=>set(request.result ?? null);}),
  replace:(revision,value,allowed)=>transaction<boolean>('readwrite',(store,set)=>{
    const request=store.get(key);request.onsuccess=()=>{
      try {
        if(!allowed() || (request.result?.revision ?? null)!==revision){set(false);return;}
        if(!value){store.delete(key);set(true);return;}
        if(!privateDeviceAllowed(value.context)){set(false);return;}
        const all=store.getAll();all.onsuccess=()=>{
          try {
            const values=all.result as Envelope[],old=request.result as Envelope|undefined;
            const count=values.length+(old?0:1),bytes=values.reduce((total,item)=>total+(item.ciphertext?.byteLength ?? audioOutboxLimits.bytes),0)-(old?.ciphertext.byteLength ?? 0)+value.ciphertext.byteLength;
            if(!allowed() || !privateDeviceAllowed(value.context) || count>audioOutboxLimits.recordings || bytes>audioOutboxLimits.bytes){set(false);return;}
            store.put(value,key);set(true);
          }catch {store.transaction.abort();}
        };
      }
      catch {store.transaction.abort();}
    };
  }).then(changed=>{if(changed)notifyDraftChanged();return changed;}),
  clear:()=>transaction<void>('readwrite',(store,set)=>{store.delete(key);set();}).then(()=>notifyDraftChanged()),
};}
export const browserAudioOutbox:AudioOutboxCollection={
  entries:()=>transaction('readonly',(store,set)=>{
    const items:{key:string;value:Envelope}[]=[],request=store.openCursor();
    request.onsuccess=()=>{const cursor=request.result;if(!cursor){set(items);return;}items.push({key:String(cursor.key),value:cursor.value});cursor.continue();};
  }),
  slot:browserSlot,
  clear:context=>transaction<void>('readwrite',(store,set)=>{
    if(!context){store.clear();set();return;}
    const request=store.openCursor();request.onsuccess=()=>{const cursor=request.result;if(!cursor){set();return;}if(cursor.value?.context===context)cursor.delete();cursor.continue();};
  }).then(()=>notifyDraftChanged()),
};
// The legacy slot stays readable; device inventory also exposes it without migrating or overwriting it.
export const browserAudioDraftStore:AudioDraftStore={...browserSlot('pending'),clear:()=>browserAudioOutbox.clear()};
export async function browserAudioDraftFor(scope:RecordingScope){
  if(!scopeValid(scope))throw new AudioDraftError('invalid');
  return browserSlot(await audioOutboxKey(scope.assignmentId));
}
export async function readAudioOutbox(session:PageSession,current:()=>boolean=()=>true,collection:AudioOutboxCollection=browserAudioOutbox,now=Date.now):Promise<AudioOutboxItem[]>{
  const guard=guardFor(session,current,now);
  try {
    guard();const entries=await collection.entries();guard();
    if(entries.length>audioOutboxLimits.recordings)throw new AudioDraftError('invalid');
    const result:AudioOutboxItem[]=[];
    for(const {key} of entries){
      if(key!=='pending' && !key.startsWith('assignment:'))throw new AudioDraftError('invalid');
      const value=await owned(collection.slot(key),session,guard,now);guard();if(!value)continue;
      if(key!=='pending' && key!==await audioOutboxKey(value.draft.scope.assignmentId))throw new AudioDraftError('invalid');
      guard();
      const {session:_,...draft}=value.draft;result.push({key,draft});
    }
    return result.sort((a,b)=>Date.parse(b.draft.capturedAt)-Date.parse(a.draft.capturedAt));
  }catch(error){if(error instanceof AudioDraftError)throw error;throw new AudioDraftError('storage');}
}
export async function clearAudioOutbox(context?:string,collection:AudioOutboxCollection=browserAudioOutbox){
  try {await collection.clear(context);if((await collection.entries()).some(item=>!context || item.value?.context===context))throw Error();}
  catch {throw new AudioDraftError('storage');}
}
