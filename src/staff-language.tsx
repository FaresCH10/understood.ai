import {createContext,useContext} from 'react';
export const StaffLanguageContext=createContext<'en'|'ar'|'ur'>('en');
const ar:Record<string,string>={
 'Resize sidebar':'تغيير عرض الشريط الجانبي','Drag to resize. Double-click to reset.':'اسحب لتغيير العرض. انقر مرتين لإعادة الضبط.',
 'At least 10 characters.':'10 أحرف على الأقل.','characters':'حرف',
 'Recording is sent to Gemini for transcription.':'يُرسل التسجيل إلى Gemini لتحويله إلى نص.',
 'Instructions':'التعليمات','Send instruction':'إرسال تعليمات','Send an instruction':'إرسال تعليمات','Track instructions from draft to finished work.':'تابع التعليمات من المسودة إلى إنجاز العمل.',
 'Instruction name':'اسم التعليمات','Search by name':'البحث بالاسم','Language':'اللغة','All languages':'كل اللغات','Date':'التاريخ','Status':'الحالة','Instruction status':'حالة التعليمات',
 'All':'الكل','Draft':'مسودة','Sent':'مرسلة','In progress':'قيد التنفيذ','Follow-up':'متابعة','Done':'منجزة','Archived':'مؤرشفة','Name':'الاسم','Languages':'اللغات','Work completed':'العمل المنجز','Updated':'آخر تحديث',
 'Loading instructions…':'جارٍ تحميل التعليمات…','No instructions match these filters.':'لا توجد تعليمات تطابق هذه الخيارات.','Previous page':'الصفحة السابقة','Next page':'الصفحة التالية','Page':'الصفحة','of':'من',
 'Title':'العنوان','Instruction':'التعليمات','Who should receive it?':'من سيتلقى التعليمات؟','All active workers':'كل العمال النشطين','Crews':'الفرق','Members':'الأعضاء','Choose crew':'اختر الفريق','Select crew':'اختر فريقاً','Record':'تسجيل','Choose members':'اختر الأعضاء','Search members':'البحث عن أعضاء','Search by name or ID':'البحث بالاسم أو الرقم','No members match your search.':'لا يوجد أعضاء يطابقون البحث.','Previous':'السابق','Next':'التالي',
 'Write or record your instruction, choose recipients, and send.':'اكتب التعليمات أو سجّلها بصوتك، ثم اختر المستلمين وأرسلها.',
 'Attachments':'المرفقات','Photos, PDFs, Office documents, CSV and text files. Up to 5 MB each; five files and 10 MB total. Workers receive these with the instruction.':'صور وملفات PDF ومستندات Office وملفات CSV ونصوص. حتى 5 ميغابايت للملف؛ خمسة ملفات و10 ميغابايت إجمالاً. يتلقى العمال المرفقات مع التعليمات.',
 'Saving attachment…':'جارٍ حفظ المرفق…','Remove':'إزالة','Include a question':'إضافة سؤال','Delivery format':'طريقة العرض','Text only':'نص فقط','Voice only':'صوت فقط','Both':'نص وصوت','Record instruction':'تسجيل التعليمات','Close':'إغلاق',
 'Your recording is transcribed for review. Approve the text before adding it to the instruction.':'يُحوّل تسجيلك إلى نص للمراجعة. وافق على النص قبل إضافته إلى التعليمات.',
 'Approving this transcript replaces the current instruction text.':'الموافقة على التفريغ تستبدل نص التعليمات الحالي.','Review transcript':'مراجعة النص المفرّغ','Transcribe recording':'تحويل التسجيل إلى نص','Check transcription':'التحقق من التفريغ','Approve and use transcript':'الموافقة واستخدام النص',
 'Instruction history':'سجل التعليمات','All assigned work, including completed instructions.':'كل الأعمال المسندة، بما فيها التعليمات المنجزة.','Loading history…':'جارٍ تحميل السجل…','No instructions assigned yet.':'لم تُسند تعليمات بعد.','Finished':'وقت الإنجاز'
};
export function staffText(language:'en'|'ar'|'ur',text:string){return language==='ar'?ar[text]||text:text;}
export function useStaffText(){const language=useContext(StaffLanguageContext);return (text:string)=>staffText(language,text);}
