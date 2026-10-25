import { useEffect, useRef, useState } from 'react';
import { Mic, Play, RotateCcw, Send, Square, Trash2,RefreshCw,Save } from 'lucide-react';
import { createRecordingSubmission } from './audio';
import type { RecordingSubmission } from './audio';
import { recordingNotice,conversationRecordingNotice,staffCaseRecordingNotice,siteNoticeText,conversationRecorderText,type RecordingLanguage } from './recording-notice';
import {workerRecordingNotice} from './notice-recovery';
import {recorderHasUnsent} from './worker-unsent';
import {WorkerAudioRetryError,workerAudioRetryText} from './worker-audio-retry';
import type {OfflineNotice} from './worker-offline';
import type {WorkerUiLanguage} from './worker-ui-language';

type RecorderLabels={title:string;requesting:string;stop:string;cancel:string;preview:string;again:string;discard:string;send:string;uploading:string;received:string;permission:string;empty:string;interrupted:string;format:string;error:string};
const labels:Record<WorkerUiLanguage,RecorderLabels> = {
  en: { title: 'Record my answer', requesting: 'Waiting for microphone...', stop: 'Stop recording', cancel: 'Cancel', preview: 'Listen before sending', again: 'Record again', discard: 'Discard', send: 'Send recording', uploading: 'Uploading...', received: 'Recording received', permission: 'Microphone access is unavailable. Check browser permission or type your answer.', empty: 'No audio was recorded. Try again.', interrupted: 'Recording stopped unexpectedly. Please record again.', format: 'This recording could not be prepared. Record again or type your answer.', error: 'Receipt could not be confirmed. Your preview remains here; retrying uses the same submission ID.' },
  ar: { title: 'سجّل إجابتي', requesting: 'جارٍ انتظار الميكروفون...', stop: 'إيقاف التسجيل', cancel: 'إلغاء', preview: 'استمع قبل الإرسال', again: 'سجّل مرة أخرى', discard: 'حذف', send: 'إرسال التسجيل', uploading: 'جارٍ الإرسال...', received: 'تم استلام التسجيل', permission: 'الميكروفون غير متاح. تحقق من إذن المتصفح أو اكتب إجابتك.', empty: 'لم يُسجّل أي صوت. حاول مرة أخرى.', interrupted: 'توقف التسجيل بشكل غير متوقع. يرجى إعادة التسجيل.', format: 'تعذّر تجهيز التسجيل. سجّل مرة أخرى أو اكتب إجابتك.', error: 'تعذّر تأكيد الاستلام. بقي التسجيل هنا، وستستخدم إعادة المحاولة رقم الإرسال نفسه.' },
  ur: { title: 'میرا جواب ریکارڈ کریں', requesting: 'مائیکروفون کا انتظار ہے...', stop: 'ریکارڈنگ بند کریں', cancel: 'منسوخ کریں', preview: 'بھیجنے سے پہلے سنیں', again: 'دوبارہ ریکارڈ کریں', discard: 'حذف کریں', send: 'ریکارڈنگ بھیجیں', uploading: 'بھیجا جا رہا ہے...', received: 'ریکارڈنگ موصول ہو گئی', permission: 'مائیکروفون دستیاب نہیں۔ براؤزر کی اجازت دیکھیں یا جواب لکھیں۔', empty: 'آواز ریکارڈ نہیں ہوئی۔ دوبارہ کوشش کریں۔', interrupted: 'ریکارڈنگ غیر متوقع طور پر رک گئی۔ دوبارہ ریکارڈ کریں۔', format: 'ریکارڈنگ تیار نہیں ہو سکی۔ دوبارہ ریکارڈ کریں یا جواب لکھیں۔', error: 'وصولی کی تصدیق نہیں ہو سکی۔ پیش نظارہ موجود ہے؛ دوبارہ کوشش میں وہی ارسال شناخت استعمال ہو گی۔' },
  hi: { title: 'मेरा उत्तर रिकॉर्ड करें', requesting: 'माइक्रोफ़ोन की प्रतीक्षा हो रही है...', stop: 'रिकॉर्डिंग रोकें', cancel: 'रद्द करें', preview: 'भेजने से पहले सुनें', again: 'फिर से रिकॉर्ड करें', discard: 'हटाएँ', send: 'रिकॉर्डिंग भेजें', uploading: 'भेजा जा रहा है...', received: 'रिकॉर्डिंग प्राप्त हुई', permission: 'माइक्रोफ़ोन उपलब्ध नहीं है। ब्राउज़र की अनुमति जाँचें या अपना उत्तर लिखें।', empty: 'कोई ऑडियो रिकॉर्ड नहीं हुआ। फिर से प्रयास करें।', interrupted: 'रिकॉर्डिंग अचानक रुक गई। कृपया फिर से रिकॉर्ड करें।', format: 'यह रिकॉर्डिंग तैयार नहीं हो सकी। फिर से रिकॉर्ड करें या अपना उत्तर लिखें।', error: 'प्राप्ति की पुष्टि नहीं हो सकी। आपका पूर्वावलोकन यहाँ है; पुनः प्रयास वही सबमिशन ID उपयोग करेगा।' },
  bn: { title: 'আমার উত্তর রেকর্ড করুন', requesting: 'মাইক্রোফোনের জন্য অপেক্ষা করা হচ্ছে...', stop: 'রেকর্ডিং বন্ধ করুন', cancel: 'বাতিল করুন', preview: 'পাঠানোর আগে শুনুন', again: 'আবার রেকর্ড করুন', discard: 'মুছুন', send: 'রেকর্ডিং পাঠান', uploading: 'পাঠানো হচ্ছে...', received: 'রেকর্ডিং পাওয়া গেছে', permission: 'মাইক্রোফোন পাওয়া যাচ্ছে না। ব্রাউজারের অনুমতি দেখুন বা আপনার উত্তর লিখুন।', empty: 'কোনো অডিও রেকর্ড হয়নি। আবার চেষ্টা করুন।', interrupted: 'রেকর্ডিং হঠাৎ বন্ধ হয়ে গেছে। আবার রেকর্ড করুন।', format: 'এই রেকর্ডিং প্রস্তুত করা যায়নি। আবার রেকর্ড করুন বা আপনার উত্তর লিখুন।', error: 'প্রাপ্তি নিশ্চিত করা যায়নি। আপনার প্রিভিউ এখানে আছে; আবার চেষ্টায় একই সাবমিশন ID ব্যবহার হবে।' },
  ml: { title: 'എന്റെ ഉത്തരം റെക്കോർഡ് ചെയ്യുക', requesting: 'മൈക്രോഫോണിനായി കാത്തിരിക്കുന്നു...', stop: 'റെക്കോർഡിംഗ് നിർത്തുക', cancel: 'റദ്ദാക്കുക', preview: 'അയക്കുന്നതിന് മുമ്പ് കേൾക്കുക', again: 'വീണ്ടും റെക്കോർഡ് ചെയ്യുക', discard: 'നീക്കം ചെയ്യുക', send: 'റെക്കോർഡിംഗ് അയക്കുക', uploading: 'അയക്കുന്നു...', received: 'റെക്കോർഡിംഗ് ലഭിച്ചു', permission: 'മൈക്രോഫോൺ ലഭ്യമല്ല. ബ്രൗസർ അനുമതി പരിശോധിക്കുക അല്ലെങ്കിൽ നിങ്ങളുടെ ഉത്തരം ടൈപ്പ് ചെയ്യുക.', empty: 'ഓഡിയോ റെക്കോർഡ് ചെയ്തിട്ടില്ല. വീണ്ടും ശ്രമിക്കുക.', interrupted: 'റെക്കോർഡിംഗ് അപ്രതീക്ഷിതമായി നിന്നു. വീണ്ടും റെക്കോർഡ് ചെയ്യുക.', format: 'ഈ റെക്കോർഡിംഗ് തയ്യാറാക്കാനായില്ല. വീണ്ടും റെക്കോർഡ് ചെയ്യുക അല്ലെങ്കിൽ ഉത്തരം ടൈപ്പ് ചെയ്യുക.', error: 'സ്വീകരണം സ്ഥിരീകരിക്കാനായില്ല. നിങ്ങളുടെ പ്രിവ്യൂ ഇവിടെയുണ്ട്; വീണ്ടും ശ്രമിക്കുമ്പോൾ അതേ സമർപ്പണ ID ഉപയോഗിക്കും.' },
  ta: { title: 'என் பதிலைப் பதிவு செய்', requesting: 'மைக்ரோஃபோனுக்காகக் காத்திருக்கிறது...', stop: 'பதிவை நிறுத்து', cancel: 'ரத்து செய்', preview: 'அனுப்புவதற்கு முன் கேள்', again: 'மீண்டும் பதிவு செய்', discard: 'நீக்கு', send: 'பதிவை அனுப்பு', uploading: 'அனுப்பப்படுகிறது...', received: 'பதிவு பெறப்பட்டது', permission: 'மைக்ரோஃபோன் கிடைக்கவில்லை. உலாவி அனுமதியைச் சரிபார்க்கவும் அல்லது உங்கள் பதிலைத் தட்டச்சு செய்யவும்.', empty: 'ஒலி எதுவும் பதிவு செய்யப்படவில்லை. மீண்டும் முயற்சிக்கவும்.', interrupted: 'பதிவு எதிர்பாராதவிதமாக நின்றது. மீண்டும் பதிவு செய்யவும்.', format: 'இந்தப் பதிவைத் தயாரிக்க முடியவில்லை. மீண்டும் பதிவு செய்யவும் அல்லது பதிலைத் தட்டச்சு செய்யவும்.', error: 'பெறுதலை உறுதிப்படுத்த முடியவில்லை. உங்கள் முன்னோட்டம் இங்கே உள்ளது; மீண்டும் முயற்சிக்கும்போது அதே சமர்ப்பிப்பு ID பயன்படும்.' },
  te: { title: 'నా సమాధానాన్ని రికార్డ్ చేయండి', requesting: 'మైక్రోఫోన్ కోసం వేచి ఉంది...', stop: 'రికార్డింగ్ ఆపండి', cancel: 'రద్దు చేయండి', preview: 'పంపే ముందు వినండి', again: 'మళ్లీ రికార్డ్ చేయండి', discard: 'తొలగించండి', send: 'రికార్డింగ్ పంపండి', uploading: 'పంపుతోంది...', received: 'రికార్డింగ్ అందింది', permission: 'మైక్రోఫోన్ అందుబాటులో లేదు. బ్రౌజర్ అనుమతిని తనిఖీ చేయండి లేదా మీ సమాధానాన్ని టైప్ చేయండి.', empty: 'ఆడియో ఏదీ రికార్డ్ కాలేదు. మళ్లీ ప్రయత్నించండి.', interrupted: 'రికార్డింగ్ అనుకోకుండా ఆగిపోయింది. దయచేసి మళ్లీ రికార్డ్ చేయండి.', format: 'ఈ రికార్డింగ్ను సిద్ధం చేయలేకపోయాం. మళ్లీ రికార్డ్ చేయండి లేదా మీ సమాధానాన్ని టైప్ చేయండి.', error: 'అందుబాటును నిర్ధారించలేకపోయాం. మీ ప్రివ్యూ ఇక్కడ ఉంది; మళ్లీ ప్రయత్నించినప్పుడు అదే సబ్మిషన్ ID ఉపయోగించబడుతుంది.' },
  ne: { title: 'मेरो उत्तर रेकर्ड गर्नुहोस्', requesting: 'माइक्रोफोन प्रतीक्षा गर्दै...', stop: 'रेकर्डिङ रोक्नुहोस्', cancel: 'रद्द गर्नुहोस्', preview: 'पठाउनु अघि सुन्नुहोस्', again: 'फेरि रेकर्ड गर्नुहोस्', discard: 'हटाउनुहोस्', send: 'रेकर्डिङ पठाउनुहोस्', uploading: 'पठाइँदै छ...', received: 'रेकर्डिङ प्राप्त भयो', permission: 'माइक्रोफोन उपलब्ध छैन। ब्राउजर अनुमति जाँच्नुहोस् वा आफ्नो उत्तर लेख्नुहोस्।', empty: 'कुनै अडियो रेकर्ड भएन। फेरि प्रयास गर्नुहोस्।', interrupted: 'रेकर्डिङ अचानक रोकियो। कृपया फेरि रेकर्ड गर्नुहोस्।', format: 'यो रेकर्डिङ तयार गर्न सकिएन। फेरि रेकर्ड गर्नुहोस् वा आफ्नो उत्तर लेख्नुहोस्।', error: 'प्राप्तिको पुष्टि गर्न सकिएन। तपाईंको पूर्वावलोकन यहाँ छ; फेरि प्रयास गर्दा उही सबमिशन ID प्रयोग हुनेछ।' },
  fil: { title: 'I-record ang sagot ko', requesting: 'Naghihintay ng mikropono...', stop: 'Itigil ang pag-record', cancel: 'Kanselahin', preview: 'Pakinggan bago ipadala', again: 'Mag-record muli', discard: 'Itapon', send: 'Ipadala ang recording', uploading: 'Ipinapadala...', received: 'Natanggap ang recording', permission: 'Hindi available ang mikropono. Suriin ang pahintulot ng browser o i-type ang sagot mo.', empty: 'Walang na-record na audio. Subukan muli.', interrupted: 'Biglang huminto ang pag-record. Mag-record muli.', format: 'Hindi naisagawa ang recording na ito. Mag-record muli o i-type ang sagot mo.', error: 'Hindi nakumpirma ang pagtanggap. Nandito ang preview mo; gagamitin ng muling pagsubok ang parehong submission ID.' },
  si: { title: 'මගේ පිළිතුර පටිගත කරන්න', requesting: 'මයික්‍රොෆෝනය සඳහා රැඳී සිටී...', stop: 'පටිගත කිරීම නවත්වන්න', cancel: 'අවලංගු කරන්න', preview: 'යැවීමට පෙර සවන් දෙන්න', again: 'නැවත පටිගත කරන්න', discard: 'ඉවත් කරන්න', send: 'පටිගත කිරීම යවන්න', uploading: 'යවමින්...', received: 'පටිගත කිරීම ලැබුණි', permission: 'මයික්‍රොෆෝනය ලබා ගත නොහැක. බ්‍රව්සර් අවසරය පරීක්ෂා කරන්න හෝ ඔබේ පිළිතුර ටයිප් කරන්න.', empty: 'ශ්‍රව්‍ය කිසිවක් පටිගත වී නැත. නැවත උත්සාහ කරන්න.', interrupted: 'පටිගත කිරීම අනපේක්ෂිතව නතර විය. කරුණාකර නැවත පටිගත කරන්න.', format: 'මෙම පටිගත කිරීම සකස් කළ නොහැක. නැවත පටිගත කරන්න හෝ ඔබේ පිළිතුර ටයිප් කරන්න.', error: 'ලැබීම තහවුරු කළ නොහැක. ඔබේ පෙරදසුන මෙහි ඇත; නැවත උත්සාහ කිරීමේදී එම ඉදිරිපත් කිරීමේ ID භාවිත වේ.' },
  ru: { title: 'Записать мой ответ', requesting: 'Ожидание микрофона...', stop: 'Остановить запись', cancel: 'Отмена', preview: 'Прослушайте перед отправкой', again: 'Записать снова', discard: 'Удалить', send: 'Отправить запись', uploading: 'Отправка...', received: 'Запись получена', permission: 'Микрофон недоступен. Проверьте разрешение браузера или введите ответ.', empty: 'Аудио не записано. Попробуйте снова.', interrupted: 'Запись неожиданно остановилась. Запишите снова.', format: 'Не удалось подготовить запись. Запишите снова или введите ответ.', error: 'Получение не подтверждено. Ваше превью осталось здесь; при повторной попытке будет использован тот же ID отправки.' },
  'pa-Guru': { title: 'ਮੇਰਾ ਜਵਾਬ ਰਿਕਾਰਡ ਕਰੋ', requesting: 'ਮਾਈਕ੍ਰੋਫ਼ੋਨ ਦੀ ਉਡੀਕ ਹੈ...', stop: 'ਰਿਕਾਰਡਿੰਗ ਰੋਕੋ', cancel: 'ਰੱਦ ਕਰੋ', preview: 'ਭੇਜਣ ਤੋਂ ਪਹਿਲਾਂ ਸੁਣੋ', again: 'ਦੁਬਾਰਾ ਰਿਕਾਰਡ ਕਰੋ', discard: 'ਹਟਾਓ', send: 'ਰਿਕਾਰਡਿੰਗ ਭੇਜੋ', uploading: 'ਭੇਜੀ ਜਾ ਰਹੀ ਹੈ...', received: 'ਰਿਕਾਰਡਿੰਗ ਪ੍ਰਾਪਤ ਹੋਈ', permission: 'ਮਾਈਕ੍ਰੋਫ਼ੋਨ ਉਪਲਬਧ ਨਹੀਂ ਹੈ। ਬ੍ਰਾਊਜ਼ਰ ਦੀ ਇਜਾਜ਼ਤ ਜਾਂਚੋ ਜਾਂ ਆਪਣਾ ਜਵਾਬ ਲਿਖੋ।', empty: 'ਕੋਈ ਆਡੀਓ ਰਿਕਾਰਡ ਨਹੀਂ ਹੋਈ। ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।', interrupted: 'ਰਿਕਾਰਡਿੰਗ ਅਚਾਨਕ ਰੁਕ ਗਈ। ਕਿਰਪਾ ਕਰਕੇ ਦੁਬਾਰਾ ਰਿਕਾਰਡ ਕਰੋ।', format: 'ਇਹ ਰਿਕਾਰਡਿੰਗ ਤਿਆਰ ਨਹੀਂ ਹੋ ਸਕੀ। ਦੁਬਾਰਾ ਰਿਕਾਰਡ ਕਰੋ ਜਾਂ ਆਪਣਾ ਜਵਾਬ ਲਿਖੋ।', error: 'ਪ੍ਰਾਪਤੀ ਦੀ ਪੁਸ਼ਟੀ ਨਹੀਂ ਹੋ ਸਕੀ। ਤੁਹਾਡੀ ਝਲਕ ਇੱਥੇ ਹੈ; ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਵਿੱਚ ਉਹੀ ਸਬਮਿਸ਼ਨ ID ਵਰਤੀ ਜਾਵੇਗੀ।' },
  'pa-Arab': { title: 'میرا جواب ریکارڈ کرو', requesting: 'مائیکروفون دا انتظار اے...', stop: 'ریکارڈنگ بند کرو', cancel: 'منسوخ کرو', preview: 'بھیجن توں پہلاں سنو', again: 'دوبارہ ریکارڈ کرو', discard: 'ہٹاؤ', send: 'ریکارڈنگ بھیجو', uploading: 'بھیجی جا رہی اے...', received: 'ریکارڈنگ مل گئی', permission: 'مائیکروفون دستیاب نہیں۔ براؤزر دی اجازت ویکھو یا اپنا جواب لکھو۔', empty: 'کوئی آڈیو ریکارڈ نہیں ہوئی۔ دوبارہ کوشش کرو۔', interrupted: 'ریکارڈنگ اچانک رک گئی۔ مہربانی کر کے دوبارہ ریکارڈ کرو۔', format: 'ایہ ریکارڈنگ تیار نہیں ہو سکی۔ دوبارہ ریکارڈ کرو یا اپنا جواب لکھو۔', error: 'وصولی دی تصدیق نہیں ہو سکی۔ تہاڈا پیش نظارہ ایتھے اے؛ دوبارہ کوشش وچ اوہی جمع کران دی شناخت ورتی جائے گی۔' },
  id: { title: 'Rekam jawaban saya', requesting: 'Menunggu mikrofon...', stop: 'Hentikan rekaman', cancel: 'Batal', preview: 'Dengarkan sebelum mengirim', again: 'Rekam lagi', discard: 'Buang', send: 'Kirim rekaman', uploading: 'Mengirim...', received: 'Rekaman diterima', permission: 'Mikrofon tidak tersedia. Periksa izin browser atau ketik jawaban Anda.', empty: 'Tidak ada audio yang direkam. Coba lagi.', interrupted: 'Rekaman berhenti tak terduga. Silakan rekam lagi.', format: 'Rekaman ini tidak dapat disiapkan. Rekam lagi atau ketik jawaban Anda.', error: 'Penerimaan tidak dapat dikonfirmasi. Pratinjau Anda tetap di sini; percobaan ulang memakai ID pengiriman yang sama.' },
};

const helpTitles:Record<WorkerUiLanguage,string>={en:'Record a help request',ar:'سجّل طلب مساعدة',ur:'مدد کی درخواست ریکارڈ کریں',hi:'मदद का अनुरोध रिकॉर्ड करें',bn:'সহায়তার অনুরোধ রেকর্ড করুন',ml:'സഹായ അഭ്യർത്ഥന റെക്കോർഡ് ചെയ്യുക',ta:'உதவி கோரிக்கையைப் பதிவு செய்',te:'సహాయ అభ్యర్థనను రికార్డ్ చేయండి',ne:'सहयोग अनुरोध रेकर्ड गर्नुहोस्',fil:'Mag-record ng hiling ng tulong',si:'උදව් ඉල්ලීමක් පටිගත කරන්න',ru:'Записать запрос о помощи','pa-Guru':'ਮਦਦ ਦੀ ਬੇਨਤੀ ਰਿਕਾਰਡ ਕਰੋ','pa-Arab':'مدد دی درخواست ریکارڈ کرو',id:'Rekam permintaan bantuan'};
const replyTitles:Record<WorkerUiLanguage,string>={en:'Record a reply',ar:'سجّل ردًا',ur:'جواب کا پیغام ریکارڈ کریں',hi:'उत्तर रिकॉर्ड करें',bn:'উত্তর রেকর্ড করুন',ml:'മറുപടി റെക്കോർഡ് ചെയ്യുക',ta:'பதிலைப் பதிவு செய்',te:'ప్రత్యుత్తరాన్ని రికార్డ్ చేయండి',ne:'जवाफ रेकर्ड गर्नुहोस्',fil:'Mag-record ng sagot',si:'පිළිතුරක් පටිගත කරන්න',ru:'Записать ответ','pa-Guru':'ਜਵਾਬ ਰਿਕਾਰਡ ਕਰੋ','pa-Arab':'جواب ریکارڈ کرو',id:'Rekam balasan'};
const saveLabels:Record<WorkerUiLanguage,{save:string;saving:string;saved:string;failed:string}>={
  en:{save:'Save recording on this device',saving:'Saving recording here...',saved:'Recording saved here, not sent.',failed:'Saving could not be confirmed. Your current preview remains.'},
  ar:{save:'احفظ التسجيل على هذا الجهاز',saving:'جارٍ حفظ التسجيل هنا...',saved:'حُفظ التسجيل هنا ولم يُرسل.',failed:'تعذر تأكيد الحفظ. تبقى المعاينة الحالية.'},
  ur:{save:'اس آلے پر ریکارڈنگ محفوظ کریں',saving:'ریکارڈنگ یہاں محفوظ ہو رہی ہے...',saved:'ریکارڈنگ یہاں محفوظ ہے، بھیجی نہیں گئی۔',failed:'محفوظ ہونے کی تصدیق نہیں ہو سکی۔ موجودہ پیش نظارہ باقی ہے۔'},
  hi:{save:'रिकॉर्डिंग इस डिवाइस पर सहेजें',saving:'रिकॉर्डिंग यहाँ सहेजी जा रही है...',saved:'रिकॉर्डिंग यहाँ सहेजी गई, भेजी नहीं गई।',failed:'सहेजने की पुष्टि नहीं हो सकी। आपका मौजूदा पूर्वावलोकन बना रहेगा।'},
  bn:{save:'এই ডিভাইসে রেকর্ডিং সংরক্ষণ করুন',saving:'রেকর্ডিং এখানে সংরক্ষণ করা হচ্ছে...',saved:'রেকর্ডিং এখানে সংরক্ষিত, পাঠানো হয়নি।',failed:'সংরক্ষণ নিশ্চিত করা যায়নি। আপনার বর্তমান প্রিভিউ থাকছে।'},
  ml:{save:'റെക്കോർഡിംഗ് ഈ ഉപകരണത്തിൽ സേവ് ചെയ്യുക',saving:'റെക്കോർഡിംഗ് ഇവിടെ സേവ് ചെയ്യുന്നു...',saved:'റെക്കോർഡിംഗ് ഇവിടെ സേവ് ചെയ്തു, അയച്ചിട്ടില്ല.',failed:'സേവ് ചെയ്തത് സ്ഥിരീകരിക്കാനായില്ല. നിലവിലെ പ്രിവ്യൂ അവശേഷിക്കുന്നു.'},
  ta:{save:'பதிவை இந்தச் சாதனத்தில் சேமி',saving:'பதிவு இங்கே சேமிக்கப்படுகிறது...',saved:'பதிவு இங்கே சேமிக்கப்பட்டது, அனுப்பப்படவில்லை.',failed:'சேமிப்பை உறுதிப்படுத்த முடியவில்லை. தற்போதைய முன்னோட்டம் தொடர்கிறது.'},
  te:{save:'రికార్డింగ్ను ఈ పరికరంలో సేవ్ చేయండి',saving:'రికార్డింగ్ ఇక్కడ సేవ్ అవుతోంది...',saved:'రికార్డింగ్ ఇక్కడ సేవ్ అయింది, పంపలేదు.',failed:'సేవ్ నిర్ధారించలేకపోయాం. మీ ప్రస్తుత ప్రివ్యూ కొనసాగుతుంది.'},
  ne:{save:'रेकर्डिङ यो उपकरणमा सुरक्षित गर्नुहोस्',saving:'रेकर्डिङ यहाँ सुरक्षित हुँदै छ...',saved:'रेकर्डिङ यहाँ सुरक्षित भयो, पठाइएको छैन।',failed:'सुरक्षित भएको पुष्टि गर्न सकिएन। तपाईंको हालको पूर्वावलोकन रहन्छ।'},
  fil:{save:'I-save ang recording sa device na ito',saving:'Sine-save ang recording dito...',saved:'Na-save ang recording dito, hindi naipadala.',failed:'Hindi nakumpirma ang pag-save. Nananatili ang kasalukuyang preview.'},
  si:{save:'පටිගත කිරීම මෙම උපාංගයේ සුරකින්න',saving:'පටිගත කිරීම මෙහි සුරකිමින්...',saved:'පටිගත කිරීම මෙහි සුරකින ලදී, යවා නැත.',failed:'සුරැකීම තහවුරු කළ නොහැක. වත්මන් පෙරදසුන රැඳේ.'},
  ru:{save:'Сохранить запись на этом устройстве',saving:'Сохранение записи...',saved:'Запись сохранена здесь, не отправлена.',failed:'Не удалось подтвердить сохранение. Текущее превью остаётся.'},
  'pa-Guru':{save:'ਰਿਕਾਰਡਿੰਗ ਇਸ ਡਿਵਾਈਸ ਤੇ ਸੰਭਾਲੋ',saving:'ਰਿਕਾਰਡਿੰਗ ਇੱਥੇ ਸੰਭਾਲੀ ਜਾ ਰਹੀ ਹੈ...',saved:'ਰਿਕਾਰਡਿੰਗ ਇੱਥੇ ਸੰਭਾਲੀ ਗਈ, ਭੇਜੀ ਨਹੀਂ ਗਈ।',failed:'ਸੰਭਾਲਣ ਦੀ ਪੁਸ਼ਟੀ ਨਹੀਂ ਹੋ ਸਕੀ। ਤੁਹਾਡੀ ਮੌਜੂਦਾ ਝਲਕ ਬਣੀ ਰਹਿੰਦੀ ਹੈ।'},
  'pa-Arab':{save:'ریکارڈنگ ایس آلے تے محفوظ کرو',saving:'ریکارڈنگ ایتھے محفوظ ہو رہی اے...',saved:'ریکارڈنگ ایتھے محفوظ اے، بھیجی نہیں گئی۔',failed:'محفوظ ہون دی تصدیق نہیں ہو سکی۔ تہاڈا موجودہ پیش نظارہ باقی اے۔'},
  id:{save:'Simpan rekaman di perangkat ini',saving:'Menyimpan rekaman di sini...',saved:'Rekaman disimpan di sini, belum dikirim.',failed:'Penyimpanan tidak dapat dikonfirmasi. Pratinjau Anda saat ini tetap ada.'},
};

export const staffRecorderText={
  en:{title:'Record in-person clarification',preview:'Listen before saving',send:'Save private recording',received:'Private recording saved',permission:'Microphone is unavailable. Check browser permission or add written resolution notes instead.',format:'Recording could not be prepared. Record again or add written notes.',error:'Save receipt is unconfirmed. Keep this preview and check the private recording receipt.'},
  ar:{title:'تسجيل توضيح حضوري',preview:'استمع قبل الحفظ',send:'حفظ التسجيل الخاص',received:'تم حفظ التسجيل الخاص',permission:'الميكروفون غير متاح. تحقق من إذن المتصفح أو أضف ملاحظات حل مكتوبة بدلًا من ذلك.',format:'تعذر تجهيز التسجيل. سجّل مجددًا أو أضف ملاحظات مكتوبة.',error:'استلام الحفظ غير مؤكد. احتفظ بهذه المعاينة وتحقق من استلام التسجيل الخاص.'},
  ur:{title:'بالمشافہ وضاحت ریکارڈ کریں',preview:'محفوظ کرنے سے پہلے سنیں',send:'نجی ریکارڈنگ محفوظ کریں',received:'نجی ریکارڈنگ محفوظ ہو گئی',permission:'مائیکروفون دستیاب نہیں۔ براؤزر کی اجازت چیک کریں یا تحریری حل کے نوٹس شامل کریں۔',format:'ریکارڈنگ تیار نہیں ہو سکی۔ دوبارہ ریکارڈ کریں یا تحریری نوٹس شامل کریں۔',error:'محفوظ ہونے کی تصدیق نہیں ہو سکی۔ پیش نظارہ برقرار رکھیں اور نجی ریکارڈنگ کی وصولی چیک کریں۔'},
};
export type RecorderProps = { language: WorkerUiLanguage; noticeLanguage?:RecordingLanguage; purpose?:'answer'|'help'|'reply'|'in_person'; loadSiteNotice?:(language:RecordingLanguage,signal:AbortSignal)=>Promise<string|null>; retryOnly?:boolean; localOnlyNotice?:OfflineNotice; synthetic: boolean; disabled:boolean; saveAllowed:boolean;onSave:(bytes:Uint8Array,id:string,capturedAt:string)=>Promise<void>; onSend: (bytes: Uint8Array, submissionId: string) => Promise<void>;onUnsavedChange:(unsaved:boolean)=>void };
type Phase = 'idle' | 'requesting' | 'recording' | 'preview' | 'uploading' | 'received';

function stopTracks(live: MediaStream | null) {
  live?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
}

async function decodeRecording(source: Blob): Promise<AudioBuffer> {
  const context = new AudioContext();
  try { return await context.decodeAudioData(await source.arrayBuffer()); }
  finally { await context.close().catch(() => {}); }
}

export function WorkerRecorder({ language, noticeLanguage, purpose='answer', loadSiteNotice, retryOnly=false, localOnlyNotice, synthetic,disabled,saveAllowed,onSave, onSend,onUnsavedChange }: RecorderProps) {
  const contentLanguage:RecordingLanguage=noticeLanguage??(language==='ar'||language==='ur'?language:'en');
  const staffLanguage:RecordingLanguage=language==='ar'||language==='ur'?language:'en';
  const t = {...labels[language],...(purpose==='in_person'?staffRecorderText[staffLanguage]:purpose==='help'||purpose==='reply'?conversationRecorderText[language]:{})};
  const notice = purpose==='answer'?recordingNotice(language, synthetic):purpose==='in_person'?staffCaseRecordingNotice(contentLanguage):conversationRecordingNotice(language);
  const title=purpose==='answer'||purpose==='in_person'?t.title:purpose==='help'?helpTitles[language]:replyTitles[language];
  const siteText=siteNoticeText[language];
  const [siteNotice,setSiteNotice]=useState<string|null>(null),[noticeReady,setNoticeReady]=useState(false),[noticeError,setNoticeError]=useState(false),[noticeTick,setNoticeTick]=useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [url, setUrl] = useState('');
  const [saving,setSaving]=useState(false),[saveStatus,setSaveStatus]=useState('');
  const saveText=saveLabels[language];
  const mounted = useRef(false);
  const generation = useRef(0);
  const phaseRef = useRef<Phase>('idle');
  const media = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const blob = useRef<Blob | null>(null);
  const submission = useRef<RecordingSubmission | null>(null);
  const previewUrl = useRef('');
  const sending = useRef(false);
  const elapsed = useRef(0);
  const requestedStop = useRef(false);

  const changePhase = (next: Phase) => { phaseRef.current = next; if (mounted.current) setPhase(next); };
  const clearPreview = () => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = '';
    blob.current = null;
    submission.current = null;
    if(mounted.current)setSaveStatus('');
    if (mounted.current) setUrl('');
  };
  const releaseCapture = () => {
    const recorder = media.current;
    media.current = null;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      if (recorder.state !== 'inactive') {
        try { recorder.stop(); } catch { /* Already stopped by the browser. */ }
      }
    }
    stopTracks(stream.current);
    stream.current = null;
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
      releaseCapture();
      clearPreview();
    };
  }, []);
  useEffect(()=>{onUnsavedChange(recorderHasUnsent(phase));},[phase,onUnsavedChange]);
  useEffect(()=>()=>onUnsavedChange(false),[onUnsavedChange]);
  useEffect(()=>{
    const controller=new AbortController();setNoticeReady(false);setNoticeError(false);setSiteNotice(null);
    if(localOnlyNotice!==undefined){
      try{setSiteNotice(workerRecordingNotice(localOnlyNotice,contentLanguage));setNoticeReady(true);}catch{setNoticeError(true);}
      return()=>controller.abort();
    }
    if(!loadSiteNotice){setNoticeError(true);return()=>controller.abort();}
    const load=loadSiteNotice(contentLanguage,controller.signal);
    load.then(value=>{
      if(!controller.signal.aborted){setSiteNotice(value);setNoticeReady(true);}
    }).catch(()=>{if(!controller.signal.aborted)setNoticeError(true);});
    return()=>controller.abort();
  },[contentLanguage,noticeTick,localOnlyNotice,loadSiteNotice,purpose]);
  useEffect(() => {
    if (phase !== 'recording') return;
    const timer = window.setInterval(() => {
      elapsed.current = Math.min(90, elapsed.current + 1);
      setSeconds(elapsed.current);
      if (elapsed.current === 90 && media.current?.state === 'recording') {
        requestedStop.current = true;
        media.current.stop();
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  const discard = () => {
    generation.current++;
    releaseCapture();
    clearPreview();
    elapsed.current = 0;
    setSeconds(0);
    setError('');
    changePhase('idle');
  };

  const cancelRequest = () => {
    generation.current++;
    setError('');
    changePhase(blob.current ? 'preview' : 'idle');
  };

  const start = async () => {
    if (disabled || retryOnly || !noticeReady || !['idle', 'preview'].includes(phaseRef.current)) return;
    const request = ++generation.current;
    setError('');
    changePhase('requesting');
    let live: MediaStream | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error(t.permission);
      live = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true } });
      if (!mounted.current || request !== generation.current) { stopTracks(live); return; }
      const preferred = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm']
        .find((mime) => typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(mime));
      const recorder = preferred ? new MediaRecorder(live, { mimeType: preferred }) : new MediaRecorder(live);
      const chunks: Blob[] = [];
      let interrupted = false;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        stopTracks(live);
        if (stream.current === live) stream.current = null;
        if (media.current === recorder) media.current = null;
        if (!mounted.current || request !== generation.current) return;
        if (interrupted || !requestedStop.current) { setError(t.interrupted); changePhase('idle'); return; }
        const recorded = new Blob(chunks, { type: recorder.mimeType });
        if (!recorded.size) { setError(t.empty); changePhase('idle'); return; }
        blob.current = recorded;
        submission.current = createRecordingSubmission(recorded, crypto.randomUUID(), decodeRecording);
        previewUrl.current = URL.createObjectURL(recorded);
        setUrl(previewUrl.current);
        changePhase('preview');
      };
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = finish;
      recorder.onerror = () => {
        interrupted = true;
        if (recorder.state === 'inactive') finish();
        else { try { recorder.stop(); } catch { finish(); } }
      };
      for (const track of live.getTracks()) track.onended = () => {
        if (request !== generation.current) return;
        interrupted = true;
        if (recorder.state === 'inactive') finish();
        else { try { recorder.stop(); } catch { finish(); } }
      };
      recorder.start(500);
      clearPreview();
      stream.current = live;
      media.current = recorder;
      elapsed.current = 0;
      requestedStop.current = false;
      setSeconds(0);
      changePhase('recording');
    } catch {
      stopTracks(live);
      if (!mounted.current || request !== generation.current) return;
      setError(t.permission);
      changePhase(blob.current ? 'preview' : 'idle');
    }
  };

  const stop = () => {
    if (media.current?.state !== 'recording') return;
    try { requestedStop.current = true; media.current.stop(); }
    catch {
      generation.current++;
      releaseCapture();
      setError(t.interrupted);
      changePhase('idle');
    }
  };

  const send = async () => {
    if (localOnlyNotice!==undefined || disabled || !noticeReady || phaseRef.current !== 'preview' || sending.current || !blob.current || !submission.current) return;
    sending.current = true;
    const request = generation.current;
    const recordedSubmission = submission.current;
    changePhase('uploading');
    setError('');
    let startedUpload = false;
    try {
      const bytes = await recordedSubmission.bytes();
      if (!mounted.current || request !== generation.current) return;
      startedUpload = true;
      await onSend(bytes, recordedSubmission.submissionId);
      if (mounted.current && request === generation.current) {
        clearPreview();
        changePhase('received');
      }
    } catch (cause) {
      if (mounted.current && request === generation.current) {
        setError(cause instanceof WorkerAudioRetryError ? workerAudioRetryText[language][cause.code] : cause instanceof Error && /No audio|between 0\.25 and 90 seconds/.test(cause.message)
          ? t.empty : startedUpload ? t.error : t.format);
        changePhase('preview');
      }
    } finally { sending.current = false; }
  };

  const savePreview=async()=>{
    if(disabled || !saveAllowed || !noticeReady || sending.current || phaseRef.current!=='preview' || !submission.current)return;
    const recordedSubmission=submission.current,request=generation.current;sending.current=true;setSaving(true);setSaveStatus(saveText.saving);
    try {
      const bytes=await recordedSubmission.bytes();if(!mounted.current || request!==generation.current)return;
      await onSave(bytes,recordedSubmission.submissionId,recordedSubmission.capturedAt);
      if(mounted.current && request===generation.current)setSaveStatus(saveText.saved);
    }catch {if(mounted.current && request===generation.current)setSaveStatus(saveText.failed);}
    finally {sending.current=false;if(mounted.current)setSaving(false);}
  };

  return <div className="record-answer">
    <aside className="recording-notice" aria-label={notice.title}>
      <h3>{notice.title}</h3><p>{notice.local}</p><p>{notice.access} {notice.processing}</p><p>{notice.retention}</p>
      {!noticeReady && <p role={noticeError?'alert':'status'}>{noticeError?siteText.error:siteText.loading}</p>}
      {noticeError && <button className="button outline" onClick={()=>setNoticeTick(value=>value+1)}><RefreshCw size={18}/>{siteText.retry}</button>}
      {siteNotice && <><h3>{siteText.title}</h3><p className="recording-site-copy" lang={contentLanguage} dir={contentLanguage==='en'?'ltr':'rtl'}>{siteNotice}</p></>}
    </aside>
    {phase === 'idle' && <button className="button primary full" disabled={disabled || !noticeReady} onClick={start}><Mic size={20} />{title}</button>}
    {phase === 'requesting' && <><p role="status">{t.requesting}</p><button className="button outline full" onClick={cancelRequest}>{t.cancel}</button></>}
    {phase === 'recording' && <><div className="record-timer" role="status">{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</div><button className="button primary full" onClick={stop}><Square size={18} />{t.stop}</button>{purpose!=='in_person'&&<button className="button outline full" onClick={discard}><Trash2 size={18} />{t.discard}</button>}</>}
    {(phase === 'preview' || phase === 'uploading') && <><label className="field">{t.preview}<audio controls src={url} /></label>{localOnlyNotice===undefined && <button className="button primary full" disabled={disabled || saving || phase === 'uploading' || !noticeReady} onClick={send}><Send size={18} />{phase === 'uploading' ? t.uploading : t.send}</button>}{purpose==='answer' && <button className="button outline full" disabled={disabled || saving || !saveAllowed || phase === 'uploading' || !noticeReady} onClick={()=>void savePreview()}><Save size={18}/>{saveText.save}</button>}<button className="button outline full" disabled={disabled || retryOnly || saving || phase === 'uploading' || !noticeReady} onClick={start}><RotateCcw size={18} />{t.again}</button>{purpose!=='in_person'&&<button className="button subtle full" disabled={retryOnly || saving || phase === 'uploading'} onClick={discard}><Trash2 size={18} />{t.discard}</button>}</>}
    {saveStatus && <p role="status">{saveStatus}</p>}
    {phase === 'received' && <><p className="record-receipt"><Play size={18} />{t.received}</p>{purpose!=='answer' && <button className="button outline full" disabled={disabled||retryOnly||!noticeReady} onClick={()=>{discard();void start();}}><Mic size={18}/>{title}</button>}</>}
    {error && <p role="alert" className="record-error">{error}</p>}
  </div>;
}
