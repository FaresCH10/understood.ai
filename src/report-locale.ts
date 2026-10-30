import {workerLocale} from '../server/languages.mjs';
import {caseTimestamp} from './clarification-locale.ts';
export type ReportLocale='en'|'ar'|'ur';

// UI copy only. Published content, captured export filters and CSV bytes stay unchanged.
export const reportTranslations={
  'Instruction activity':['نشاط التعليمات','ہدایات کی سرگرمی'],
  'Response activity at this site':['نشاط الإجابات في هذا الموقع','اس مقام پر جوابات کی سرگرمی'],
  'Published v{version}':['الإصدار المنشور {version}','شائع شدہ نسخہ {version}'],
  'Export CSV':['تصدير CSV','CSV برآمد کریں'],
  'Queuing...':['جارٍ الإدراج في قائمة الانتظار...','قطار میں شامل ہو رہا ہے...'],
  'Working...':['جارٍ التنفيذ...','کام جاری ہے...'],
  'Instruction version':['إصدار التعليمات','ہدایات کا نسخہ'],
  'Publication history':['سجل النشر','اشاعت کی تاریخ'],
  'Refresh publication history':['تحديث سجل النشر','اشاعت کی تاریخ تازہ کریں'],
  'Title':['العنوان','عنوان'],
  'Published from':['نُشر ابتداءً من','اس تاریخ سے شائع شدہ'],
  'Published through':['نُشر حتى','اس تاریخ تک شائع شدہ'],
  'Apply publication filters':['تطبيق تصفية النشر','اشاعت کی چھانٹی لگائیں'],
  '{count} published versions':['عدد الإصدارات المنشورة: {count}','شائع شدہ نسخے: {count}'],
  'Loading publication history...':['جارٍ تحميل سجل النشر...','اشاعت کی تاریخ لوڈ ہو رہی ہے...'],
  'This page is no longer available.':['لم تعد هذه الصفحة متاحة.','یہ صفحہ اب دستیاب نہیں۔'],
  'No published versions match these filters.':['لا توجد إصدارات منشورة تطابق هذه التصفية.','کوئی شائع شدہ نسخہ ان شرائط سے مطابقت نہیں رکھتا۔'],
  'Page {page} of {pages}':['الصفحة {page} من {pages}','صفحہ {page} از {pages}'],
  'Previous publication page':['صفحة النشر السابقة','اشاعت کا پچھلا صفحہ'],
  'Next publication page':['صفحة النشر التالية','اشاعت کا اگلا صفحہ'],
  'First page':['الصفحة الأولى','پہلا صفحہ'],
  'Crew at publication':['الفريق وقت النشر','اشاعت کے وقت کی ٹیم'],
  'All assigned workers':['جميع العمال المكلّفين','تمام تفویض شدہ کارکن'],
  'No crew':['بلا فريق','کوئی ٹیم نہیں'],
  'Latest response from':['آخر إجابة ابتداءً من','تازہ ترین جواب اس تاریخ سے'],
  'Latest response through':['آخر إجابة حتى','تازہ ترین جواب اس تاریخ تک'],
  'Apply report filters':['تطبيق تصفية التقرير','رپورٹ کی چھانٹی لگائیں'],
  'Clear report filters':['مسح تصفية التقرير','رپورٹ کی چھانٹی صاف کریں'],
  'Historical crew snapshot unavailable for this version.':['لقطة الفرق التاريخية غير متاحة لهذا الإصدار.','اس نسخے کے لیے اشاعت کے وقت کی ٹیموں کا ریکارڈ دستیاب نہیں۔'],
  'Latest-response window':['الفترة الزمنية لآخر إجابة','تازہ ترین جواب کی مدت'],
  'Start':['البداية','آغاز'],
  'Present':['الوقت الحالي','اب تک'],
  'to':['إلى','تا'],
  'Loading report...':['جارٍ تحميل التقرير...','رپورٹ لوڈ ہو رہی ہے...'],
  'Retry report':['إعادة محاولة تحميل التقرير','رپورٹ دوبارہ لوڈ کریں'],
  'No published instruction is available.':['لا توجد تعليمات منشورة متاحة.','کوئی شائع شدہ ہدایات دستیاب نہیں۔'],
  'assigned':['مكلّف','تفویض شدہ'],
  'responses':['إجابات','جوابات'],
  'match key facts':['تطابق المعلومات الأساسية','اہم معلومات سے مطابقت'],
  'need clarification':['تحتاج إلى توضيح','وضاحت درکار ہے'],
  'no response in window':['لا إجابة ضمن الفترة','اس مدت میں کوئی جواب نہیں'],
  'awaiting response':['بانتظار الإجابة','جواب کا انتظار'],
  'Response status':['حالة الإجابات','جوابات کی حالت'],
  'match the rubric':['تطابق معايير التقييم','جانچ کے معیار سے مطابقت'],
  'awaiting assessment':['بانتظار التقييم','جانچ کا انتظار'],
  'acknowledged':['تم الإقرار','اقرار شدہ'],
  'acknowledged, not assessed':['تم الإقرار، بلا تقييم','اقرار شدہ، جانچ نہیں ہوئی'],
  'resolved after follow-up':['حُلّت بعد المتابعة','فالو اپ کے بعد حل ہوا'],
  'Response mode':['وضع الإجابة','جواب کی قسم'],
  'Question':['سؤال','سوال'],
  'Acknowledge only':['إقرار فقط','صرف اقرار'],
  'Mode not recorded (legacy)':['الوضع غير مسجل (سجل قديم)','قسم درج نہیں (پرانا ریکارڈ)'],
  'Delivery mode':['وضع التسليم','ترسیل کی قسم'],
  'Text':['نص','متن'],
  'Voice':['صوت','آواز'],
  'Text and voice':['نص وصوت','متن اور آواز'],
  'Delivery':['التسليم','ترسیل'],
  'Captured audience':['الجمهور المحفوظ وقت الإرسال','بھیجتے وقت محفوظ سامعین'],
  'Delivered':['تم التسليم','پہنچا دیا گیا'],
  'Not delivered':['لم يُسلّم','نہیں پہنچا'],
  'Preparing':['قيد التحضير','تیاری جاری ہے'],
  'Blocked':['محجوب','روکا گیا'],
  'Unreleased recipients are not counted as failing to respond.':['لا يُحتسب من لم تُحرّر تعليماته ضمن من لم يستجب.','جن افراد کو ہدایت جاری نہیں ہوئی وہ جواب نہ دینے میں شمار نہیں ہوتے۔'],
  'response completion':['اكتمال استلام الإجابات','جوابات کی تکمیل'],
  'Export request accepted. Check export history for its current status.':['تم قبول طلب التصدير. راجع سجل التصدير لمعرفة حالته الحالية.','برآمد کی درخواست قبول ہو گئی۔ موجودہ حالت کے لیے برآمد کی تاریخ دیکھیں۔'],
  'Export retry accepted. Check export history for its current status.':['تم قبول إعادة محاولة التصدير. راجع سجل التصدير لمعرفة حالتها الحالية.','برآمد کی دوبارہ کوشش قبول ہو گئی۔ موجودہ حالت کے لیے برآمد کی تاریخ دیکھیں۔'],
  'Saved export request':['طلب التصدير المحفوظ','محفوظ برآمد کی درخواست'],
  'Recover export request':['استرداد طلب التصدير','برآمد کی درخواست بحال کریں'],
  'Recover export retry':['استرداد إعادة محاولة التصدير','برآمد کی دوبارہ کوشش بحال کریں'],
  'Original request':['الطلب الأصلي','اصل درخواست'],
  'Published version':['الإصدار المنشور','شائع شدہ نسخہ'],
  'Crew':['الفريق','ٹیم'],
  'Latest responses':['آخر الإجابات','تازہ ترین جوابات'],
  'Export':['التصدير','برآمد'],
  'Original failed attempt':['المحاولة الفاشلة الأصلية','اصل ناکام کوشش'],
  'Check saved request':['التحقق من الطلب المحفوظ','محفوظ درخواست چیک کریں'],
  'Retry original request':['إعادة محاولة الطلب الأصلي','اصل درخواست دوبارہ بھیجیں'],
  'Language breakdown':['التوزيع حسب اللغة','زبان کے لحاظ سے تقسیم'],
  'Assignment language':['لغة التكليف','تفویض کی زبان'],
  'Assigned':['مكلّف','تفویض شدہ'],
  'Received':['تم الاستلام','موصول'],
  'Completion':['الاكتمال','تکمیل'],
  '{language} response completion':['اكتمال الإجابات باللغة {language}','{language} میں جوابات کی تکمیل'],
  'English (EN)':['الإنجليزية (EN)','انگریزی (EN)'],
  'Arabic (AR)':['العربية (AR)','عربی (AR)'],
  'Urdu (UR)':['الأردية (UR)','اردو (UR)'],
  'Export history':['سجل التصدير','برآمد کی تاریخ'],
  'Loading export history...':['جارٍ تحميل سجل التصدير...','برآمد کی تاریخ لوڈ ہو رہی ہے...'],
  'Refresh exports':['تحديث سجل التصدير','برآمد کی تاریخ تازہ کریں'],
  'No exports requested.':['لم تُطلب أي عمليات تصدير.','ابھی کوئی برآمد کی درخواست نہیں۔'],
  'Crew-filtered audience':['المكلّفون محددون حسب الفريق','ٹیم کے لحاظ سے منتخب کارکن'],
  'Expires':['تنتهي الصلاحية','میعاد ختم ہوگی'],
  'Download':['تنزيل','ڈاؤن لوڈ کریں'],
  'Retry':['إعادة المحاولة','دوبارہ کوشش کریں'],
  'Queued':['في قائمة الانتظار','قطار میں'],
  'Processing':['قيد المعالجة','پروسیسنگ جاری ہے'],
  'Ready':['جاهز','تیار'],
  'Failed':['فشل','ناکام'],
  'Expired':['منتهي الصلاحية','میعاد ختم'],
  'Published':['منشور','شائع شدہ'],
  'Superseded':['استُبدل بإصدار أحدث','نئے نسخے سے تبدیل شدہ'],
  'Withdrawn':['مسحوب','واپس لیا گیا'],
  'Archived':['مؤرشف','محفوظ شدہ'],
  'Status unavailable':['الحالة غير متاحة','حالت دستیاب نہیں'],
  'Response status is not proof of safe work or internal understanding.':['حالة الإجابة ليست دليلاً على العمل الآمن أو الفهم الداخلي.','جواب کی حالت محفوظ کام یا حقیقی سمجھ کا ثبوت نہیں ہے۔'],
  'The report could not be loaded. Try again.':['تعذّر تحميل التقرير. حاول مجدداً.','رپورٹ لوڈ نہیں ہو سکی۔ دوبارہ کوشش کریں۔'],
  'Publication history could not be loaded. Refresh to try again.':['تعذّر تحميل سجل النشر. حدّثه للمحاولة مجدداً.','اشاعت کی تاریخ لوڈ نہیں ہو سکی۔ دوبارہ لوڈ کریں۔'],
  'Export history cannot be verified.':['تعذّر التحقق من سجل التصدير.','برآمد کی تاریخ کی تصدیق نہیں ہو سکی۔'],
  'Export generation failed':['فشل إنشاء ملف التصدير','برآمد کی فائل تیار نہیں ہو سکی'],
  'Export retry limit reached':['تم بلوغ حد إعادة محاولات التصدير','برآمد کی دوبارہ کوششوں کی حد پوری ہو گئی'],
  'Export cannot be retried':['لا يمكن إعادة محاولة هذا التصدير','اس برآمد کی دوبارہ کوشش نہیں ہو سکتی'],
  'The export request could not be completed.':['تعذّر إكمال طلب التصدير.','برآمد کی درخواست مکمل نہیں ہو سکی۔'],
  'The export outcome is not confirmed. Check the saved request before retrying.':['لم تتأكد نتيجة التصدير. تحقّق من الطلب المحفوظ قبل إعادة المحاولة.','برآمد کا نتیجہ غیر مصدقہ ہے۔ دوبارہ کوشش سے پہلے محفوظ درخواست چیک کریں۔'],
  'Connection interrupted. The saved outcome is not confirmed.':['انقطع الاتصال. لم تتأكد النتيجة المحفوظة.','رابطہ منقطع ہو گیا۔ محفوظ نتیجہ غیر مصدقہ ہے۔'],
  'Saved export request cannot be verified. It has not been repeated or removed.':['تعذّر التحقق من طلب التصدير المحفوظ. لم يُكرّر أو يُحذف.','محفوظ برآمد کی درخواست کی تصدیق نہیں ہو سکی۔ اسے نہ دہرایا گیا ہے نہ ہٹایا گیا ہے۔'],
  'Recover the saved export request first.':['استردّ طلب التصدير المحفوظ أولاً.','پہلے محفوظ برآمد کی درخواست بحال کریں۔'],
  'This tab cannot retain the export request. No request was sent.':['لا تستطيع علامة التبويب هذه حفظ طلب التصدير. لم يُرسل أي طلب.','یہ ٹیب برآمد کی درخواست محفوظ نہیں کر سکتا۔ کوئی درخواست نہیں بھیجی گئی۔'],
  'The saved export request changed. Reload before continuing.':['تغيّر طلب التصدير المحفوظ. أعد التحميل قبل المتابعة.','محفوظ برآمد کی درخواست بدل گئی ہے۔ جاری رکھنے سے پہلے دوبارہ لوڈ کریں۔'],
  'The saved request could not be cleared. Check it before retrying.':['تعذّر مسح الطلب المحفوظ. تحقّق منه قبل إعادة المحاولة.','محفوظ درخواست صاف نہیں ہو سکی۔ دوبارہ کوشش سے پہلے اسے چیک کریں۔'],
  'Your current role or session cannot perform this action.':['لا يسمح دورك أو جلستك الحالية بهذا الإجراء.','آپ کا موجودہ کردار یا سیشن یہ عمل نہیں کر سکتا۔'],
  'Session verification is required. Saved request recovery is unchanged.':['يلزم التحقق من الجلسة. لم يتغير استرداد الطلب المحفوظ.','سیشن کی تصدیق ضروری ہے۔ محفوظ درخواست کی بحالی تبدیل نہیں ہوئی۔'],
  'Session check in progress. No request was sent.':['جارٍ التحقق من الجلسة. لم يُرسل أي طلب.','سیشن چیک ہو رہا ہے۔ کوئی درخواست نہیں بھیجی گئی۔'],
  'Loading reports...':['جارٍ تحميل التقارير...','رپورٹس لوڈ ہو رہی ہیں...'],
  'Reports page unavailable. Your saved export requests are unchanged.':['صفحة التقارير غير متاحة. لم تتغير طلبات التصدير المحفوظة.','رپورٹس کا صفحہ دستیاب نہیں۔ آپ کی محفوظ برآمد کی درخواستیں تبدیل نہیں ہوئیں۔'],
  'Reload':['إعادة تحميل','دوبارہ لوڈ کریں'],
} as const;
export type ReportTextKey=keyof typeof reportTranslations;
export const reportLocale=(value:unknown):ReportLocale=>value==='ar'||value==='ur'?value:'en';
export const reportsRoute=(view:string)=>view==='reports';
export function reportText(locale:ReportLocale,key:ReportTextKey,values:Record<string,string|number>={}){
  const template=locale==='en'?key:reportTranslations[key][locale==='ar'?0:1];
  return template.replace(/\{([A-Za-z]+)\}/g,(_match,name:string)=>String(values[name]??`{${name}}`));
}
export function reportErrorText(locale:ReportLocale,message:string,fallback:ReportTextKey){
  if(!message)return '';
  if(Object.hasOwn(reportTranslations,message))return reportText(locale,message as ReportTextKey);
  const known:Record<string,ReportTextKey>={
    'Saved export request changed.':'The saved export request changed. Reload before continuing.',
    'Saved export request could not be cleared.':'The saved request could not be cleared. Check it before retrying.',
    'Forbidden':'Your current role or session cannot perform this action.',
    'Session context changed. Saved request recovery is unchanged.':'Session verification is required. Saved request recovery is unchanged.',
    'Session context changed or verification is pending. Saved request recovery is unchanged.':'Session verification is required. Saved request recovery is unchanged.',
    'Artifact recovery scope cannot be verified. Saved requests are unchanged.':'Session verification is required. Saved request recovery is unchanged.',
  };
  return reportText(locale,Object.hasOwn(known,message)?known[message]:fallback);
}
export function reportState(locale:ReportLocale,value:string){
  const states:Record<string,ReportTextKey>={queued:'Queued',processing:'Processing',preparing:'Preparing',ready:'Ready',failed:'Failed',expired:'Expired',published:'Published',superseded:'Superseded',withdrawn:'Withdrawn',archived:'Archived'};
  return reportText(locale,Object.hasOwn(states,value)?states[value]:'Status unavailable');
}
export function reportLanguage(locale:ReportLocale,value:string){
  const keys:Record<string,ReportTextKey>={en:'English (EN)',ar:'Arabic (AR)',ur:'Urdu (UR)'};
  if(Object.hasOwn(keys,value))return reportText(locale,keys[value]);
  const item=workerLocale(value);
  return item?(locale==='en'?item.englishName:item.name):value;
}
export const reportTimestamp=caseTimestamp;
