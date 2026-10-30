import {validWorkerSession,sameWorkerSession,type PageSession} from './session-state.ts';
import {privateDeviceAllowed} from './worker-device-policy.ts';

type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export type DraftScope={assignmentId:string;publicationId:string;version:number};
export type DraftReceipt={kind:'answer'|'help'|'audio';requestId:string;assignmentId:string;status:'unknown'|'received'|'failed'};
export type TextDraft={answer:string;help:string;receipts:DraftReceipt[]};
type Snapshot={session:PageSession;scope:DraftScope;savedAt:string;draft:TextDraft};
const key='understood:worker-text-draft:v1';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export class TextDraftError extends Error {
  readonly code:'storage'|'invalid'|'scope'|'expired';
  constructor(code:TextDraftError['code']){super(code);this.code=code;}
}
function exact(value:unknown,keys:string[]):value is Record<string,unknown>{
  return !!value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).sort().join(',')===keys.sort().join(',');
}
function validScope(value:unknown):value is DraftScope {
  return exact(value,['assignmentId','publicationId','version']) && ['assignmentId','publicationId'].every(name=>typeof value[name]==='string' && !!value[name] && (value[name] as string).length<=100)
    && Number.isSafeInteger(value.version) && (value.version as number)>0;
}
function validDraft(value:unknown,scope:DraftScope):value is TextDraft {
  if(!exact(value,['answer','help','receipts']) || typeof value.answer!=='string' || value.answer.length>2000 || typeof value.help!=='string' || value.help.length>500
    || !Array.isArray(value.receipts) || value.receipts.length>3)return false;
  const kinds=new Set();
  return value.receipts.every(item=>{
    if(!exact(item,['kind','requestId','assignmentId','status']) || !['answer','help','audio'].includes(item.kind as string) || kinds.has(item.kind)
      || typeof item.requestId!=='string' || !uuid.test(item.requestId) || item.assignmentId!==scope.assignmentId || !['unknown','received','failed'].includes(item.status as string))return false;
    kinds.add(item.kind);return true;
  });
}
function read(store:Store):Snapshot|null {
  let raw:string|null;
  try {raw=store.getItem(key);}catch {throw new TextDraftError('storage');}
  if(raw===null)return null;
  try {
    if(raw.length>20000)throw Error();
    const value=JSON.parse(raw);
    if(!exact(value,['session','scope','savedAt','draft']) || !exact(value.session,['authenticated','role','workerId','language','mode','clientContext','expiresAt'])
      || !validWorkerSession(value.session,0) || !validScope(value.scope) || !validDraft(value.draft,value.scope)
      || typeof value.savedAt!=='string' || !Number.isFinite(Date.parse(value.savedAt)) || new Date(value.savedAt).toISOString()!==value.savedAt
      || Date.parse(value.savedAt)>=Date.parse(value.session.expiresAt!))throw Error();
    return value as unknown as Snapshot;
  }catch {throw new TextDraftError('invalid');}
}
function current(session:PageSession,now:number){if(!validWorkerSession(session,now))throw new TextDraftError('expired');}
function sameScope(left:DraftScope,right:DraftScope){return left.assignmentId===right.assignmentId && left.publicationId===right.publicationId && left.version===right.version;}
function owned(store:Store,session:PageSession,now:number){
  current(session,now);const saved=read(store);
  if(saved && (!sameWorkerSession(saved.session,session,now) || saved.session.expiresAt!==session.expiresAt)){
    removeTextDraft(store);return null;
  }
  return saved;
}
export function textDraftStatus(store:Store,session:PageSession,scope:DraftScope,now=Date.now()){
  if(!validScope(scope))throw new TextDraftError('invalid');
  const saved=owned(store,session,now);
  return !saved ? 'empty' : sameScope(saved.scope,scope) ? 'saved' : 'other';
}
export function saveTextDraft(store:Store,session:PageSession,scope:DraftScope,draft:TextDraft,consent:boolean,now=Date.now()){
  current(session,now);
  if(typeof sessionStorage!=='undefined' && store===sessionStorage && !privateDeviceAllowed(session.clientContext!))throw new TextDraftError('storage');
  if(consent!==true || !validScope(scope) || !validDraft(draft,scope) || (!draft.answer.trim() && !draft.help.trim() && !draft.receipts.length))throw new TextDraftError('invalid');
  if(textDraftStatus(store,session,scope,now)==='other')throw new TextDraftError('scope');
  const {authenticated,role,workerId,language,mode,clientContext,expiresAt}=session;
  // Explicit tab-only snapshot, not an offline queue or encrypted vault.
  const raw=JSON.stringify({session:{authenticated,role,workerId,language,mode,clientContext,expiresAt},scope,savedAt:new Date(now).toISOString(),draft});
  try {store.setItem(key,raw);if(store.getItem(key)!==raw)throw Error();}catch {throw new TextDraftError('storage');}
}
export function restoreTextDraft(store:Store,session:PageSession,scope:DraftScope,now=Date.now()):TextDraft|null {
  if(!validScope(scope))throw new TextDraftError('invalid');
  const saved=owned(store,session,now);
  if(!saved)return null;
  if(!sameScope(saved.scope,scope))throw new TextDraftError('scope');
  if(Date.parse(saved.savedAt)>now)throw new TextDraftError('invalid');
  return saved.draft;
}
export function removeTextDraft(store:Store){
  try {store.removeItem(key);if(store.getItem(key)!==null)throw Error();}catch {throw new TextDraftError('storage');}
}
export function canRestoreTextDraft(draft:TextDraft,audioUnsent:boolean){return !audioUnsent && !draft.answer && !draft.help && !draft.receipts.length;}
export const textDraftCopy={
  en:{title:'Text saved in this tab',consent:'This is a device I control',save:'Save text in this tab',restore:'Restore saved text',remove:'Remove saved text',empty:'No text snapshot saved.',saved:'Text snapshot saved here, not sent. Later edits need another save. Audio is not included.',other:'A snapshot for another instruction version is saved. Remove it before saving this one.',restored:'Saved text restored. Nothing was sent.',removed:'Saved text removed. Current text remains.',failed:'Saved text could not be verified or updated. Current text remains.',limits:'This snapshot belongs to this tab and session. Browser restore may retain it after closing. Remove it before sharing the device. Browser storage is not a secure vault.'},
  ar:{title:'النص المحفوظ في هذه الصفحة',consent:'هذا جهاز أتحكم فيه',save:'احفظ النص في هذه الصفحة',restore:'استعد النص المحفوظ',remove:'احذف النص المحفوظ',empty:'لا توجد نسخة نصية محفوظة.',saved:'حُفظت نسخة النص هنا ولم تُرسل. تحتاج التعديلات اللاحقة إلى حفظ جديد. الصوت غير مشمول.',other:'توجد نسخة محفوظة لإصدار تعليمات آخر. احذفها قبل حفظ هذه النسخة.',restored:'تمت استعادة النص. لم يُرسل شيء.',removed:'حُذف النص المحفوظ. يبقى النص الحالي.',failed:'تعذر التحقق من النص المحفوظ أو تحديثه. يبقى النص الحالي.',limits:'هذه النسخة مرتبطة بهذه الصفحة والجلسة. قد تحتفظ بها استعادة المتصفح بعد الإغلاق. احذفها قبل مشاركة الجهاز. تخزين المتصفح ليس خزنة آمنة.'},
  hi:{title:'इस टैब में सहेजा गया टेक्स्ट',consent:'यह मेरे नियंत्रण वाला डिवाइस है',save:'इस टैब में टेक्स्ट सहेजें',restore:'सहेजा टेक्स्ट बहाल करें',remove:'सहेजा टेक्स्ट हटाएँ',empty:'कोई टेक्स्ट स्नैपशॉट सहेजा नहीं है।',saved:'टेक्स्ट स्नैपशॉट यहाँ सहेजा गया, भेजा नहीं गया। बाद के बदलावों के लिए फिर सहेजना होगा। ऑडियो शामिल नहीं है।',other:'दूसरे ब्रीफिंग संस्करण का स्नैपशॉट सहेजा है। इसे सहेजने से पहले उसे हटाएँ।',restored:'सहेजा टेक्स्ट बहाल हुआ। कुछ नहीं भेजा गया।',removed:'सहेजा टेक्स्ट हटा दिया गया। मौजूदा टेक्स्ट बना हुआ है।',failed:'सहेजे टेक्स्ट को सत्यापित या अपडेट नहीं किया जा सका। मौजूदा टेक्स्ट बना हुआ है।',limits:'यह स्नैपशॉट इस टैब और सत्र का है। ब्राउज़र बहाली इसे बंद करने के बाद भी रख सकती है। डिवाइस साझा करने से पहले इसे हटाएँ। ब्राउज़र संग्रह सुरक्षित तिजोरी नहीं है।'},
  ur:{title:'اس صفحے میں محفوظ متن',consent:'یہ آلہ میرے اختیار میں ہے',save:'اس صفحے میں متن محفوظ کریں',restore:'محفوظ متن بحال کریں',remove:'محفوظ متن ہٹائیں',empty:'متن کی کوئی محفوظ نقل نہیں۔',saved:'متن کی نقل یہاں محفوظ ہے، بھیجی نہیں گئی۔ مزید تبدیلیوں کے لیے دوبارہ محفوظ کریں۔ آڈیو شامل نہیں۔',other:'ہدایات کے دوسرے ورژن کی نقل محفوظ ہے۔ اس کو محفوظ کرنے سے پہلے پرانی نقل ہٹائیں۔',restored:'محفوظ متن بحال ہو گیا۔ کچھ نہیں بھیجا گیا۔',removed:'محفوظ متن ہٹا دیا گیا۔ موجودہ متن باقی ہے۔',failed:'محفوظ متن کی تصدیق یا تبدیلی نہیں ہو سکی۔ موجودہ متن باقی ہے۔',limits:'یہ نقل اسی ٹیب اور سیشن کی ہے۔ براؤزر بحال ہونے پر بند کرنے کے بعد بھی باقی رہ سکتی ہے۔ آلہ کسی اور کو دینے سے پہلے ہٹائیں۔ براؤزر کا ذخیرہ محفوظ تجوری نہیں ہے۔'},
  bn:{title:'এই ট্যাবে সংরক্ষিত লেখা',consent:'এটি আমার নিয়ন্ত্রণাধীন ডিভাইস',save:'এই ট্যাবে লেখা সংরক্ষণ করুন',restore:'সংরক্ষিত লেখা ফিরিয়ে আনুন',remove:'সংরক্ষিত লেখা সরান',empty:'কোনো লেখার স্ন্যাপশট সংরক্ষিত নেই।',saved:'লেখার স্ন্যাপশট এখানে সংরক্ষিত, পাঠানো হয়নি। পরে সম্পাদনার জন্য আবার সংরক্ষণ করতে হবে। অডিও অন্তর্ভুক্ত নয়।',other:'অন্য ব্রিফিং সংস্করণের স্ন্যাপশট সংরক্ষিত আছে। এটি সংরক্ষণের আগে সেটি সরান।',restored:'সংরক্ষিত লেখা ফিরেছে। কিছু পাঠানো হয়নি।',removed:'সংরক্ষিত লেখা সরানো হয়েছে। বর্তমান লেখা থাকছে।',failed:'সংরক্ষিত লেখা যাচাই বা হালনাগাদ করা যায়নি। বর্তমান লেখা থাকছে।',limits:'এই স্ন্যাপশট এই ট্যাব ও সেশনের। ব্রাউজার পুনরুদ্ধার বন্ধ করার পরেও এটি রাখতে পারে। ডিভাইস শেয়ার করার আগে সরান। ব্রাউজার স্টোরেজ নিরাপদ ভল্ট নয়।'},
  ml:{title:'ഈ ടാബിൽ സൂക്ഷിച്ച വാചകം',consent:'ഇത് ഞാൻ നിയന്ത്രിക്കുന്ന ഉപകരണമാണ്',save:'ഈ ടാബിൽ വാചകം സൂക്ഷിക്കുക',restore:'സൂക്ഷിച്ച വാചകം പുനഃസ്ഥാപിക്കുക',remove:'സൂക്ഷിച്ച വാചകം നീക്കുക',empty:'വാചക സ്നാപ്പ്ഷോട്ട് സൂക്ഷിച്ചിട്ടില്ല.',saved:'വാചക സ്നാപ്പ്ഷോട്ട് ഇവിടെ സൂക്ഷിച്ചു, അയച്ചിട്ടില്ല. പിന്നീടുള്ള മാറ്റങ്ങൾക്ക് വീണ്ടും സൂക്ഷിക്കണം. ഓഡിയോ ഉൾപ്പെടുന്നില്ല.',other:'മറ്റൊരു ബ്രീഫിംഗ് പതിപ്പിന്റെ സ്നാപ്പ്ഷോട്ട് സൂക്ഷിച്ചിരിക്കുന്നു. ഇത് സൂക്ഷിക്കുന്നതിന് മുമ്പ് അത് നീക്കുക.',restored:'സൂക്ഷിച്ച വാചകം പുനഃസ്ഥാപിച്ചു. ഒന്നും അയച്ചില്ല.',removed:'സൂക്ഷിച്ച വാചകം നീക്കി. നിലവിലെ വാചകം തുടരുന്നു.',failed:'സൂക്ഷിച്ച വാചകം പരിശോധിക്കാനോ അപ്ഡേറ്റ് ചെയ്യാനോ കഴിഞ്ഞില്ല. നിലവിലെ വാചകം തുടരുന്നു.',limits:'ഈ സ്നാപ്പ്ഷോട്ട് ഈ ടാബിന്റെയും സെഷന്റെയും ആണ്. ബ്രൗസർ പുനഃസ്ഥാപനം അടച്ചതിന് ശേഷവും ഇത് നിലനിർത്തിയേക്കാം. ഉപകരണം പങ്കിടുന്നതിന് മുമ്പ് നീക്കുക. ബ്രൗസർ സ്റ്റോറേജ് സുരക്ഷിത വോൾട്ട് അല്ല.'},
  ta:{title:'இந்த தாவலில் சேமிக்கப்பட்ட உரை',consent:'இது நான் கட்டுப்படுத்தும் சாதனம்',save:'இந்த தாவலில் உரையைச் சேமி',restore:'சேமித்த உரையை மீட்டெடு',remove:'சேமித்த உரையை நீக்கு',empty:'உரை நகல் சேமிக்கப்படவில்லை.',saved:'உரை நகல் இங்கே சேமிக்கப்பட்டது, அனுப்பப்படவில்லை. பிற்கால திருத்தங்களுக்கு மீண்டும் சேமிக்க வேண்டும். ஒலி சேர்க்கப்படவில்லை.',other:'வேறு வழிமுறை பதிப்பின் நகல் சேமிக்கப்பட்டுள்ளது. இதைச் சேமிக்கும் முன் அதை நீக்குங்கள்.',restored:'சேமித்த உரை மீட்டெடுக்கப்பட்டது. எதுவும் அனுப்பப்படவில்லை.',removed:'சேமித்த உரை நீக்கப்பட்டது. தற்போதைய உரை உள்ளது.',failed:'சேமித்த உரையைச் சரிபார்க்கவோ புதுப்பிக்கவோ முடியவில்லை. தற்போதைய உரை உள்ளது.',limits:'இந்த நகல் இந்த தாவல் மற்றும் அமர்வுக்குரியது. மூடிய பிறகும் உலாவி மீட்டெடுப்பு இதை வைத்திருக்கலாம். சாதனத்தைப் பகிரும் முன் நீக்குங்கள். உலாவி சேமிப்பு பாதுகாப்பான பெட்டகம் அல்ல.'},
  te:{title:'ఈ ట్యాబ్‌లో సేవ్ చేసిన వచనం',consent:'ఇది నా నియంత్రణలోని పరికరం',save:'ఈ ట్యాబ్‌లో వచనాన్ని సేవ్ చేయండి',restore:'సేవ్ చేసిన వచనాన్ని పునరుద్ధరించండి',remove:'సేవ్ చేసిన వచనాన్ని తీసివేయండి',empty:'వచన స్నాప్‌షాట్ సేవ్ చేయబడలేదు.',saved:'వచన స్నాప్‌షాట్ ఇక్కడ సేవ్ చేయబడింది, పంపబడలేదు. తర్వాత మార్పులకు మళ్లీ సేవ్ చేయాలి. ఆడియో చేర్చబడలేదు.',other:'మరో బ్రీఫింగ్ వెర్షన్ స్నాప్‌షాట్ సేవ్ ఉంది. దీన్ని సేవ్ చేసే ముందు దాన్ని తీసివేయండి.',restored:'సేవ్ చేసిన వచనం పునరుద్ధరించబడింది. ఏమీ పంపబడలేదు.',removed:'సేవ్ చేసిన వచనం తీసివేయబడింది. ప్రస్తుత వచనం ఉంది.',failed:'సేవ్ చేసిన వచనాన్ని ధృవీకరించలేకపోయాం లేదా నవీకరించలేకపోయాం. ప్రస్తుత వచనం ఉంది.',limits:'ఈ స్నాప్‌షాట్ ఈ ట్యాబ్ మరియు సెషన్‌కు చెందుతుంది. మూసిన తర్వాత కూడా బ్రౌజర్ పునరుద్ధరణ దీన్ని ఉంచవచ్చు. పరికరాన్ని పంచుకునే ముందు తీసివేయండి. బ్రౌజర్ నిల్వ సురక్షిత తిజోరి కాదు.'},
  ne:{title:'यो ट्याबमा सुरक्षित पाठ',consent:'यो मेरो नियन्त्रणमा रहेको यन्त्र हो',save:'यो ट्याबमा पाठ सुरक्षित गर्नुहोस्',restore:'सुरक्षित पाठ पुनर्स्थापना गर्नुहोस्',remove:'सुरक्षित पाठ हटाउनुहोस्',empty:'कुनै पाठ स्न्यापसट सुरक्षित छैन।',saved:'पाठ स्न्यापसट यहाँ सुरक्षित भयो, पठाइएन। पछिका सम्पादनका लागि फेरि सुरक्षित गर्नुपर्छ। अडियो समावेश छैन।',other:'अर्को ब्रिफिङ संस्करणको स्न्यापसट सुरक्षित छ। यो सुरक्षित गर्नु अघि त्यो हटाउनुहोस्।',restored:'सुरक्षित पाठ पुनर्स्थापित भयो। केही पठाइएन।',removed:'सुरक्षित पाठ हटाइयो। हालको पाठ रहन्छ।',failed:'सुरक्षित पाठ प्रमाणित वा अद्यावधिक गर्न सकिएन। हालको पाठ रहन्छ।',limits:'यो स्न्यापसट यो ट्याब र सत्रको हो। ब्राउजर पुनर्स्थापनाले बन्द गरेपछि पनि राख्न सक्छ। यन्त्र साझा गर्नु अघि हटाउनुहोस्। ब्राउजर भण्डारण सुरक्षित भल्ट होइन।'},
  fil:{title:'Na-save na teksto sa tab na ito',consent:'Device ko ito',save:'I-save ang teksto sa tab na ito',restore:'Ibalik ang na-save na teksto',remove:'Alisin ang na-save na teksto',empty:'Walang na-save na snapshot ng teksto.',saved:'Na-save dito ang snapshot ng teksto, hindi naipadala. Kailangan ng panibagong save para sa susunod na pagbabago. Hindi kasama ang audio.',other:'May naka-save na snapshot para sa ibang bersyon ng instruction. Alisin ito bago i-save ang isang ito.',restored:'Naibalik ang na-save na teksto. Walang naipadala.',removed:'Naalis ang na-save na teksto. Nanatili ang kasalukuyang teksto.',failed:'Hindi ma-verify o ma-update ang na-save na teksto. Nanatili ang kasalukuyang teksto.',limits:'Ang snapshot na ito ay para sa tab at session na ito. Maaaring itago ito ng browser restore pagkatapos isara. Alisin bago ibahagi ang device. Hindi vault ang browser storage.'},
  si:{title:'මෙම ටැබයේ සුරකින ලද පෙළ',consent:'මෙය මගේ පාලනයේ ඇති උපාංගයකි',save:'මෙම ටැබයේ පෙළ සුරකින්න',restore:'සුරකින ලද පෙළ ප්‍රතිස්ථාපනය කරන්න',remove:'සුරකින ලද පෙළ ඉවත් කරන්න',empty:'පෙළ ස්නැප්ෂොට් සුරකින නැත.',saved:'පෙළ ස්නැප්ෂොට් මෙහි සුරකින ලදී, යවා නැත. පසු සංස්කරණ සඳහා නැවත සුරැකීම අවශ්‍යයි. ශ්‍රව්‍ය ඇතුළත් නැත.',other:'වෙනත් බ්‍රීෆිං අනුවාදයක ස්නැප්ෂොට් සුරකින ඇත. මෙය සුරැකීමට පෙර එය ඉවත් කරන්න.',restored:'සුරකින ලද පෙළ ප්‍රතිස්ථාපනය විය. කිසිවක් යවා නැත.',removed:'සුරකින ලද පෙළ ඉවත් කරන ලදී. වත්මන් පෙළ රැඳේ.',failed:'සුරකින ලද පෙළ තහවුරු කිරීමට හෝ යාවත්කාලීන කිරීමට නොහැකි විය. වත්මන් පෙළ රැඳේ.',limits:'මෙම ස්නැප්ෂොට් මෙම ටැබයට සහ සැසියට අයත්ය. වැසීමෙන් පසුවත් බ්‍රව්සර් ප්‍රතිස්ථාපනය එය තබා ගත හැක. උපාංගය බෙදා ගැනීමට පෙර ඉවත් කරන්න. බ්‍රව්සර් ගබඩාව ආරක්ෂිත බඳුනක් නොවේ.'},
  ru:{title:'Текст, сохранённый в этой вкладке',consent:'Это устройство под моим контролем',save:'Сохранить текст в этой вкладке',restore:'Восстановить сохранённый текст',remove:'Удалить сохранённый текст',empty:'Сохранённого снимка текста нет.',saved:'Снимок текста сохранён здесь, не отправлен. Для дальнейших правок нужно сохранить снова. Аудио не включено.',other:'Сохранён снимок для другой версии инструкции. Удалите его перед сохранением этого.',restored:'Сохранённый текст восстановлен. Ничего не отправлено.',removed:'Сохранённый текст удалён. Текущий текст остался.',failed:'Не удалось проверить или обновить сохранённый текст. Текущий текст остался.',limits:'Этот снимок принадлежит этой вкладке и сеансу. Восстановление браузера может сохранить его после закрытия. Удалите его перед передачей устройства. Хранилище браузера не является защищённым хранилищем.'},
  'pa-Guru':{title:'ਇਸ ਟੈਬ ਵਿੱਚ ਸੰਭਾਲਿਆ ਟੈਕਸਟ',consent:'ਇਹ ਮੇਰੇ ਕੰਟਰੋਲ ਵਾਲਾ ਡਿਵਾਈਸ ਹੈ',save:'ਇਸ ਟੈਬ ਵਿੱਚ ਟੈਕਸਟ ਸੰਭਾਲੋ',restore:'ਸੰਭਾਲਿਆ ਟੈਕਸਟ ਬਹਾਲ ਕਰੋ',remove:'ਸੰਭਾਲਿਆ ਟੈਕਸਟ ਹਟਾਓ',empty:'ਕੋਈ ਟੈਕਸਟ ਸਨੈਪਸ਼ਾਟ ਸੰਭਾਲਿਆ ਨਹੀਂ।',saved:'ਟੈਕਸਟ ਸਨੈਪਸ਼ਾਟ ਇੱਥੇ ਸੰਭਾਲਿਆ, ਭੇਜਿਆ ਨਹੀਂ। ਅਗਲੀਆਂ ਤਬਦੀਲੀਆਂ ਲਈ ਫਿਰ ਸੰਭਾਲਣਾ ਪਵੇਗਾ। ਆਡੀਓ ਸ਼ਾਮਲ ਨਹੀਂ।',other:'ਹੋਰ ਬ੍ਰੀਫਿੰਗ ਵਰਜਨ ਦਾ ਸਨੈਪਸ਼ਾਟ ਸੰਭਾਲਿਆ ਹੈ। ਇਹ ਸੰਭਾਲਣ ਤੋਂ ਪਹਿਲਾਂ ਉਹ ਹਟਾਓ।',restored:'ਸੰਭਾਲਿਆ ਟੈਕਸਟ ਬਹਾਲ ਹੋਇਆ। ਕੁਝ ਨਹੀਂ ਭੇਜਿਆ ਗਿਆ।',removed:'ਸੰਭਾਲਿਆ ਟੈਕਸਟ ਹਟਾ ਦਿੱਤਾ। ਮੌਜੂਦਾ ਟੈਕਸਟ ਰਹਿੰਦਾ ਹੈ।',failed:'ਸੰਭਾਲੇ ਟੈਕਸਟ ਦੀ ਪੁਸ਼ਟੀ ਜਾਂ ਅੱਪਡੇਟ ਨਹੀਂ ਹੋ ਸਕੀ। ਮੌਜੂਦਾ ਟੈਕਸਟ ਰਹਿੰਦਾ ਹੈ।',limits:'ਇਹ ਸਨੈਪਸ਼ਾਟ ਇਸ ਟੈਬ ਅਤੇ ਸੈਸ਼ਨ ਦਾ ਹੈ। ਬ੍ਰਾਊਜ਼ਰ ਬਹਾਲੀ ਇਸਨੂੰ ਬੰਦ ਕਰਨ ਤੋਂ ਬਾਅਦ ਵੀ ਰੱਖ ਸਕਦੀ ਹੈ। ਡਿਵਾਈਸ ਸਾਂਝਾ ਕਰਨ ਤੋਂ ਪਹਿਲਾਂ ਹਟਾਓ। ਬ੍ਰਾਊਜ਼ਰ ਸਟੋਰੇਜ ਸੁਰੱਖਿਅਤ ਤਿਜੌਰੀ ਨਹੀਂ।'},
  'pa-Arab':{title:'ایس ٹیب وچ سنبھالیا متن',consent:'ایہ میرے کنٹرول والا ڈیوائس اے',save:'ایس ٹیب وچ متن سنبھالو',restore:'سنبھالیا متن بحال کرو',remove:'سنبھالیا متن ہٹاؤ',empty:'کوئی متن سنیپ شاٹ سنبھالیا نئیں۔',saved:'متن سنیپ شاٹ ایتھے سنبھالیا، بھیجیا نئیں۔ اگلیاں تبدیلیاں لئی فیر سنبھالنا پووے گا۔ آڈیو شامل نئیں۔',other:'ہور بریفنگ ورژن دا سنیپ شاٹ سنبھالیا اے۔ ایہ سنبھالن توں پہلاں اوہ ہٹاؤ۔',restored:'سنبھالیا متن بحال ہو گیا۔ کجھ نئیں بھیجیا گیا۔',removed:'سنبھالیا متن ہٹا دتا۔ موجودہ متن رہندا اے۔',failed:'سنبھالے متن دی تصدیق یا اپ ڈیٹ نئیں ہو سکی۔ موجودہ متن رہندا اے۔',limits:'ایہ سنیپ شاٹ ایس ٹیب تے سیشن دا اے۔ براؤزر بحالی اینوں بند کرن توں بعد وی رکھ سکدی اے۔ ڈیوائس سانجھا کرن توں پہلاں ہٹاؤ۔ براؤزر سٹوریج محفوظ تجوری نئیں۔'},
  id:{title:'Teks tersimpan di tab ini',consent:'Ini perangkat yang saya kendalikan',save:'Simpan teks di tab ini',restore:'Pulihkan teks tersimpan',remove:'Hapus teks tersimpan',empty:'Tidak ada snapshot teks tersimpan.',saved:'Snapshot teks tersimpan di sini, tidak dikirim. Suntingan nanti perlu disimpan lagi. Audio tidak termasuk.',other:'Snapshot untuk versi instruksi lain tersimpan. Hapus sebelum menyimpan yang ini.',restored:'Teks tersimpan dipulihkan. Tidak ada yang dikirim.',removed:'Teks tersimpan dihapus. Teks saat ini tetap ada.',failed:'Teks tersimpan tidak dapat diverifikasi atau diperbarui. Teks saat ini tetap ada.',limits:'Snapshot ini milik tab dan sesi ini. Pemulihan browser dapat menyimpannya setelah ditutup. Hapus sebelum berbagi perangkat. Penyimpanan browser bukan brankas aman.'},
};
