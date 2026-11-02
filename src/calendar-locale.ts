import type {CalendarEvent,CalendarEventKind} from './calendar-data';

export type CalendarLanguage='en'|'ar'|'ur';

// UI copy only. Instruction titles, worker names and stored activity stay unchanged.
export const calendarTranslations={
  'Instruction calendar':['تقويم التعليمات','ہدایات کا کیلنڈر'],
  'See what was sent, scheduled and answered on any day.':['اطّلع على ما أُرسل وجُدول وأُجيب عنه في أي يوم.','دیکھیں کسی بھی دن کیا بھیجا، شیڈول کیا اور جواب دیا گیا۔'],
  'Previous month':['الشهر السابق','پچھلا مہینہ'],
  'Next month':['الشهر التالي','اگلا مہینہ'],
  'This month':['هذا الشهر','یہ مہینہ'],
  'Refresh calendar':['تحديث التقويم','کیلنڈر تازہ کریں'],
  'All times shown in {zone}.':['تُعرض جميع الأوقات بتوقيت {zone}.','تمام اوقات {zone} کے مطابق ہیں۔'],
  'Calendar month':['شهر التقويم','کیلنڈر کا مہینہ'],
  'Today':['اليوم','آج'],
  'Selected day':['اليوم المحدد','منتخب دن'],
  'Sent':['مُرسل','بھیجی گئی'],
  'Scheduled':['مجدول','شیڈول شدہ'],
  'Updates':['التحديثات','اپ ڈیٹس'],
  'sent':['مُرسل','بھیجی گئی'],
  'scheduled':['مجدول','شیڈول شدہ'],
  'updates':['تحديث','اپ ڈیٹس'],
  'Instructions':['التعليمات','ہدایات'],
  'Activity':['النشاط','سرگرمی'],
  'Show activity':['عرض النشاط','سرگرمی دکھائیں'],
  'Hide activity':['إخفاء النشاط','سرگرمی چھپائیں'],
  'No instructions on this day.':['لا تعليمات في هذا اليوم.','اس دن کوئی ہدایت نہیں۔'],
  'No instructions or activity on this day.':['لا تعليمات أو نشاط في هذا اليوم.','اس دن کوئی ہدایت یا سرگرمی نہیں۔'],
  '{instructions} instructions, {events} updates':['التعليمات: {instructions}. التحديثات: {events}.','ہدایات: {instructions}۔ اپ ڈیٹس: {events}۔'],
  'Open':['مفتوح','کھلا'],
  'Resolved':['محلول','حل شدہ'],
  'Published':['منشور','شائع شدہ'],
  'Superseded':['استُبدل بإصدار أحدث','نئے نسخے سے تبدیل شدہ'],
  'Withdrawn':['مسحوب','واپس لیا گیا'],
  'Processing':['قيد المعالجة','پروسیسنگ جاری ہے'],
  'Failed':['فشل','ناکام'],
  'Archived':['مؤرشف','محفوظ شدہ'],
  'Version {version}':['الإصدار {version}','نسخہ {version}'],
  '{count} workers':['{count} عامل','{count} کارکن'],
  '{responses} of {assigned} answered':['{responses} من {assigned} أجابوا','{responses} از {assigned} نے جواب دیا'],
  '{count} matched':['{count} مطابق','{count} مماثل'],
  '{count} need clarification':['{count} يحتاج إلى توضيح','{count} کو وضاحت درکار'],
  '{count} open clarification':['{count} توضيح مفتوح','{count} کھلی وضاحت'],
  'Open instruction':['افتح التعليمات','ہدایت کھولیں'],
  'Loading calendar...':['جارٍ تحميل التقويم...','کیلنڈر لوڈ ہو رہا ہے...'],
  'The instruction calendar could not be loaded.':['تعذّر تحميل تقويم التعليمات.','ہدایات کا کیلنڈر لوڈ نہیں ہو سکا۔'],
  'Try again':['إعادة المحاولة','دوبارہ کوشش کریں'],
  'Use the arrow keys to move between days.':['استخدم مفاتيح الأسهم للتنقل بين الأيام.','دنوں کے درمیان جانے کے لیے تیر والے بٹن استعمال کریں۔'],
  'Select a day to see its instructions and activity.':['اختر يومًا لعرض تعليماته ونشاطه.','تفصیلات دیکھنے کے لیے کسی دن کو منتخب کریں۔'],
  'Calendar legend':['دليل رموز التقويم','کیلنڈر کی علامات'],
  'Response or clarification resolved':['استلام إجابة أو حل توضيح','جواب موصول یا وضاحت حل'],
  'Close day details':['إغلاق تفاصيل اليوم','دن کی تفصیلات بند کریں'],
  'Response received':['تم استلام الإجابة','جواب موصول ہوا'],
  'Voice response received':['تم استلام إجابة صوتية','آواز کا جواب موصول ہوا'],
  'Instruction acknowledged':['تم الإقرار باستلام التعليمات','ہدایت کی تصدیق ہوئی'],
  'Clarification requested':['طُلب توضيح','وضاحت مانگی گئی'],
  'Clarification resolved':['حُلّ التوضيح','وضاحت حل ہو گئی'],
  'Worker marked complete':['أكمل العامل التعليمات','کارکن نے مکمل کیا'],
  'Instruction created':['أُنشئت التعليمات','ہدایت بنائی گئی'],
  'Instruction edited':['عُدّلت التعليمات','ہدایت میں ترمیم ہوئی'],
  'Instruction archived':['أُرشفت التعليمات','ہدایت محفوظ شدہ ہوئی'],
  'Publication withdrawn':['سُحب النشر','اشاعت واپس لی گئی'],
  'Matched key facts':['طابقت المعلومات الأساسية','اہم معلومات سے مطابقت'],
  'Follow-up needed':['يلزم متابعة','فالو اپ درکار'],
  'Could not assess':['تعذّر التقييم','جانچ نہ ہو سکی'],
  'Awaiting review':['بانتظار المراجعة','جائزے کا انتظار'],
  'Instruction':['التعليمات','ہدایت'],
  'Worker':['عامل','کارکن'],
  'Calendar unavailable':['التقويم غير متاح','کیلنڈر دستیاب نہیں'],
} as const;

export type CalendarTextKey=keyof typeof calendarTranslations;

export const calendarLanguage=(value:unknown):CalendarLanguage=>value==='ar'||value==='ur'?value:'en';

export function calendarText(language:CalendarLanguage,key:CalendarTextKey,values:Record<string,string|number>={}) {
  const template=language==='en'?key:calendarTranslations[key][language==='ar'?0:1];
  return template.replace(/\{([A-Za-z]+)\}/g,(_match,name:string)=>String(values[name]??`{${name}}`));
}

export function calendarLocaleTag(language:CalendarLanguage) {
  return language==='ar'?'ar':language==='ur'?'ur':'en-GB';
}

function civilDate(date:string) {
  return new Date(`${date}T12:00:00Z`);
}

export function calendarMonthTitle(month:string,language:CalendarLanguage) {
  return new Intl.DateTimeFormat(calendarLocaleTag(language),{month:'long',year:'numeric',timeZone:'UTC'}).format(civilDate(`${month}-01`));
}

const weekAnchor=Date.UTC(2024,0,1,12); // Monday
export function calendarWeekdays(language:CalendarLanguage) {
  const format=new Intl.DateTimeFormat(calendarLocaleTag(language),{weekday:'short',timeZone:'UTC'});
  return Array.from({length:7},(_,index)=>format.format(new Date(weekAnchor+index*86400000)));
}

export function calendarDayHeading(date:string,language:CalendarLanguage) {
  return new Intl.DateTimeFormat(calendarLocaleTag(language),{weekday:'long',day:'numeric',month:'long',timeZone:'UTC'}).format(civilDate(date));
}

export function calendarDayNumber(date:string) {
  return Number(date.slice(8,10));
}

export function calendarTime(value:string,timeZone:string,language:CalendarLanguage) {
  const date=new Date(value);
  const options:Intl.DateTimeFormatOptions={hour:'2-digit',minute:'2-digit'};
  try {return new Intl.DateTimeFormat(calendarLocaleTag(language),{...options,timeZone}).format(date);}
  catch {return new Intl.DateTimeFormat(calendarLocaleTag(language),{...options,timeZone:'UTC'}).format(date);}
}

export function calendarStateLabel(state:string,language:CalendarLanguage) {
  const keys:Record<string,CalendarTextKey>={published:'Published',superseded:'Superseded',withdrawn:'Withdrawn',processing:'Processing',failed:'Failed',archived:'Archived',scheduled:'Scheduled',queued:'Scheduled',open:'Open',resolved:'Resolved'};
  return Object.hasOwn(keys,state)?calendarText(language,keys[state]):state.replaceAll('_',' ');
}

export function calendarEventTitle(event:CalendarEvent,language:CalendarLanguage) {
  const kinds:Record<CalendarEventKind,CalendarTextKey>={response:'Response received',audio:'Voice response received',acknowledgment:'Instruction acknowledged',clarification:'Clarification requested',clarification_resolved:'Clarification resolved',completion:'Worker marked complete',edit:'Instruction edited'};
  if(event.kind!=='edit'||!event.action)return calendarText(language,kinds[event.kind]);
  const actions:Record<string,CalendarTextKey>={'briefing.created':'Instruction created','briefing.edited':'Instruction edited','briefing.archived':'Instruction archived','briefing.withdrawn':'Publication withdrawn'};
  const key=actions[event.action];
  return key?calendarText(language,key):calendarText(language,'Instruction edited');
}

export function calendarOutcomeLabel(outcome:string|undefined,language:CalendarLanguage) {
  if(!outcome)return '';
  const keys:Record<string,CalendarTextKey>={matched:'Matched key facts',clarification:'Follow-up needed',unassessable:'Could not assess'};
  return Object.hasOwn(keys,outcome)?calendarText(language,keys[outcome]):calendarText(language,'Awaiting review');
}
