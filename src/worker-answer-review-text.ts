import type {WorkerUiLanguage} from './worker-ui-language';

type Copy={title:string;body:string;chosen:string;unrecorded:string};
const keys:(keyof Copy)[]=['title','body','chosen','unrecorded'];
const rows:Record<WorkerUiLanguage,readonly string[]>={
 en:['Your answer','This is what you sent. Your supervisor can follow up in the chat.','Your choice','Your answer was recorded.'],
 ar:['إجابتك','هذا ما أرسلته. يمكن للمشرف المتابعة في المحادثة.','اختيارك','تم تسجيل إجابتك.'],
 ur:['آپ کا جواب','یہ وہی ہے جو آپ نے بھیجا۔ سپروائزر گفتگو میں رابطہ کر سکتا ہے۔','آپ کا انتخاب','آپ کا جواب درج ہو گیا۔'],
 hi:['आपका उत्तर','यह वही है जो आपने भेजा। सुपरवाइज़र बातचीत में आगे बात कर सकता है।','आपका चयन','आपका उत्तर दर्ज हो गया।'],
 bn:['আপনার উত্তর','এটি আপনি যা পাঠিয়েছেন। সুপারভাইজার কথোপকথনে যোগাযোগ করতে পারেন।','আপনার পছন্দ','আপনার উত্তর রেকর্ড হয়েছে।'],
 ml:['നിങ്ങളുടെ ഉത്തരം','നിങ്ങൾ അയച്ചത് ഇതാണ്. സൂപ്പർവൈസർ സംഭാഷണത്തിൽ ബന്ധപ്പെടാം.','നിങ്ങളുടെ തിരഞ്ഞെടുപ്പ്','നിങ്ങളുടെ ഉത്തരം രേഖപ്പെടുത്തി.'],
 ta:['உங்கள் பதில்','நீங்கள் அனுப்பியது இதுதான். மேற்பார்வையாளர் அரட்டையில் தொடரலாம்.','உங்கள் தேர்வு','உங்கள் பதில் பதிவாகிவிட்டது.'],
 te:['మీ సమాధానం','మీరు పంపినది ఇదే. సూపర్‌వైజర్ చాట్‌లో కొనసాగించవచ్చు.','మీ ఎంపిక','మీ సమాధానం నమోదైంది.'],
 ne:['तपाईंको उत्तर','तपाईंले पठाउनुभएको यही हो। सुपरभाइजर कुराकानीमा सम्पर्क गर्न सक्नुहुन्छ।','तपाईंको छनोट','तपाईंको उत्तर रेकर्ड भयो।'],
 fil:['Ang sagot mo','Ito ang ipinadala mo. Maaaring mag-follow up ang supervisor sa chat.','Ang pinili mo','Naitala ang sagot mo.'],
 si:['ඔබේ පිළිතුර','ඔබ යැව්වේ මෙයයි. අධීක්ෂකට කතාබහේදී පසු විපරම් කළ හැක.','ඔබේ තේරීම','ඔබේ පිළිතුර සටහන් විය.'],
 ru:['Ваш ответ','Это то, что вы отправили. Руководитель может ответить в чате.','Ваш выбор','Ваш ответ записан.'],
 'pa-Guru':['ਤੁਹਾਡਾ ਜਵਾਬ','ਇਹ ਉਹੀ ਹੈ ਜੋ ਤੁਸੀਂ ਭੇਜਿਆ। ਸੁਪਰਵਾਈਜ਼ਰ ਗੱਲਬਾਤ ਵਿੱਚ ਸੰਪਰਕ ਕਰ ਸਕਦਾ ਹੈ।','ਤੁਹਾਡੀ ਚੋਣ','ਤੁਹਾਡਾ ਜਵਾਬ ਦਰਜ ਹੋ ਗਿਆ।'],
 'pa-Arab':['تہاڈا جواب','ایہ اوہی اے جیہڑا تسیں بھیجیا۔ سپروائزر گل بات وچ رابطہ کر سکدا اے۔','تہاڈی چون','تہاڈا جواب درج ہو گیا۔'],
 id:['Jawaban Anda','Ini yang Anda kirim. Supervisor dapat menindaklanjuti di chat.','Pilihan Anda','Jawaban Anda tercatat.'],
};

export function workerAnswerReviewText(language:WorkerUiLanguage):Copy{
  const values=rows[language]||rows.en;
  return Object.fromEntries(keys.map((key,index)=>[key,values[index]])) as Copy;
}
